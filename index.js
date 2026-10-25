const fs = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const { addonBuilder, getRouter } = require('stremio-addon-sdk')
const { parseSrt, buildSrt } = require('./srt')
const { matchScore } = require('./match')

const PORT = Number(process.env.PORT || 7000)
// Render preenche RENDER_EXTERNAL_URL sozinho
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL
const BASE = PUBLIC_URL || `http://127.0.0.1:${PORT}`
// Segredo no caminho: sem ele qualquer um com a URL gasta sua cota do Gemini/OpenSubtitles
const PREFIX = process.env.ADDON_SECRET ? `/${process.env.ADDON_SECRET}` : ''
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
const SOURCE_LANG = process.env.SOURCE_LANG || 'en'
const TARGET_LANG = process.env.TARGET_LANG || 'Brazilian Portuguese'
const TARGET_LANG_CODE = process.env.TARGET_LANG_CODE || 'pob'
const CACHE_DIR = path.join(__dirname, 'cache')
const OS_API = 'https://api.opensubtitles.com/api/v1'
const USER_AGENT = 'stremio-legendas-ia v0.1.0'
// Lote grande = poucas requests/dia no free tier e mais contexto pro modelo. ~5-8 requests por filme,
// todas em paralelo: o player do Stremio desiste se a legenda demora.
const BATCH_SIZE = 300
const CANDIDATES = 3

for (const k of ['GEMINI_API_KEY', 'OS_API_KEY']) {
  if (!process.env[k]) {
    console.error(`Falta ${k} no .env`)
    process.exit(1)
  }
}
if (PUBLIC_URL && !PREFIX) {
  console.error('Exposto publicamente sem ADDON_SECRET. Defina ADDON_SECRET.')
  process.exit(1)
}

const PROMPT = `You translate movie and TV subtitles into ${TARGET_LANG}.
Input: a JSON array of {id, text} subtitle cues. Output: a JSON array of {id, text} with exactly one item per input id, text translated.
Never merge, split or skip cues. Keep "\\n" line breaks and tags like <i>...</i> where they are.
Use natural, colloquial ${TARGET_LANG} that reads fast on screen. Keep names as they are.`

let osToken = null

async function login() {
  if (!process.env.OS_USERNAME) return false
  osToken = null
  const { token } = await opensubtitles('/login', {
    method: 'POST',
    body: JSON.stringify({ username: process.env.OS_USERNAME, password: process.env.OS_PASSWORD }),
  })
  osToken = token
  console.log('OpenSubtitles: logado')
  return true
}

async function opensubtitles(pathname, opts = {}, retried = false) {
  const res = await fetch(OS_API + pathname, {
    ...opts,
    headers: {
      'Api-Key': process.env.OS_API_KEY,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(osToken && { Authorization: `Bearer ${osToken}` }),
    },
  })
  // Token expira (~24h) e o servidor fica de pe por dias
  if (res.status === 401 && osToken && !retried && await login()) return opensubtitles(pathname, opts, true)
  if (!res.ok) throw new Error(`OpenSubtitles ${pathname}: ${res.status} ${await res.text()}`)
  return res.json()
}

// Legenda certa pro arquivo = sincronizada. Ordem: hash do video, release (ver match.js), popularidade.
async function findCandidates(id, extra) {
  const [imdb, season, episode] = id.split(':')
  const imdbNum = String(parseInt(imdb.slice(2), 10))
  const query = { languages: SOURCE_LANG }
  if (season) Object.assign(query, { parent_imdb_id: imdbNum, season_number: season, episode_number: episode })
  else query.imdb_id = imdbNum
  if (extra.videoHash) query.moviehash = extra.videoHash
  // OpenSubtitles pede params ordenados, senao redireciona
  const qs = new URLSearchParams(Object.entries(query).sort())
  const { data } = await opensubtitles(`/subtitles?${qs}`)

  const score = ({ attributes: a }) =>
    (a.moviehash_match ? 1000 : 0)
    + matchScore(extra.filename, [a.release, a.files[0].file_name])
    + Math.log10(1 + (a.download_count || 0))
    - (a.ai_translated || a.machine_translated ? 500 : 0)
  const best = data
    .filter(s => s.attributes.files?.length)
    .sort((a, b) => score(b) - score(a))
    .slice(0, CANDIDATES)

  console.log(`[${id}] arquivo=${extra.filename || '-'} hash=${extra.videoHash ? 'sim' : 'nao'}`)
  best.forEach(s => console.log(`  ${score(s).toFixed(0).padStart(4)} ${s.attributes.moviehash_match ? 'HASH ' : ''}${s.attributes.release}`))
  return best.map(s => String(s.attributes.files[0].file_id))
}

let geminiCalls = 0

async function gemini(cues) {
  geminiCalls++
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(cues) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'minimal' },
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { id: { type: 'INTEGER' }, text: { type: 'STRING' } },
            required: ['id', 'text'],
          },
        },
      },
    }),
  })
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${await res.text()}`)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  return JSON.parse(data.candidates[0].content.parts.map(p => p.text).join(''))
}

// Cada fala vai com id: se o modelo pular ou juntar alguma, so ela e pedida de novo
async function translateBatch(lines) {
  const out = new Array(lines.length)
  let todo = lines.map((_, i) => i)
  for (let attempt = 1; attempt <= 3 && todo.length; attempt++) {
    try {
      for (const { id, text } of await gemini(todo.map(i => ({ id: i, text: lines[i] })))) {
        if (todo.includes(id) && typeof text === 'string') out[id] = text
      }
      todo = todo.filter(i => out[i] === undefined)
      if (todo.length) console.warn(`Faltaram ${todo.length} falas no lote, tentativa ${attempt}`)
    } catch (e) {
      if (attempt === 3 || (e.status && e.status < 500 && e.status !== 429)) throw e
      console.warn(`Repetindo lote (tentativa ${attempt}): ${e.message.slice(0, 200)}`)
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt))
    }
  }
  // Melhor manter o original nessas falas do que perder a legenda
  return out.map((t, i) => t ?? lines[i])
}

function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

async function translateFile(fileId) {
  const cacheFile = path.join(CACHE_DIR, `${fileId}.${TARGET_LANG_CODE}.srt`)
  try {
    return await fs.readFile(cacheFile, 'utf8')
  } catch {}

  const started = Date.now()
  const callsBefore = geminiCalls
  const { link } = await opensubtitles('/download', {
    method: 'POST',
    body: JSON.stringify({ file_id: Number(fileId), sub_format: 'srt' }),
  })
  const cues = parseSrt(decode(Buffer.from(await (await fetch(link)).arrayBuffer())))
  const texts = cues.map(c => c.text)

  const starts = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) starts.push(i)
  const out = (await Promise.all(starts.map(s => translateBatch(texts.slice(s, s + BATCH_SIZE))))).flat()

  const srt = buildSrt(cues.map((c, i) => ({ ...c, text: out[i] })))
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(cacheFile, srt)
  console.log(`Traduzido ${fileId}: ${cues.length} falas, ${geminiCalls - callsBefore} requests, ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return srt
}

// Uma traducao por arquivo mesmo com varios pedidos simultaneos
const jobs = new Map()
function getTranslation(fileId) {
  if (!jobs.has(fileId)) {
    jobs.set(fileId, translateFile(fileId).catch(e => {
      jobs.delete(fileId)
      throw e
    }))
  }
  return jobs.get(fileId)
}

const builder = new addonBuilder({
  id: 'local.legendas.ia',
  version: '0.1.0',
  name: 'Legendas IA',
  description: `Traduz legendas (${SOURCE_LANG}) para ${TARGET_LANG} com Gemini`,
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
})

builder.defineSubtitlesHandler(async ({ id, extra }) => {
  try {
    const fileIds = await findCandidates(id, extra || {})
    // Ja comeca a melhor enquanto o player abre, pra estar pronta quando selecionar
    if (fileIds[0]) getTranslation(fileIds[0]).catch(e => console.error(e.message))
    return {
      subtitles: fileIds.map(fid => ({ id: `ia-${fid}`, url: `${BASE}${PREFIX}/sub/${fid}.srt`, lang: TARGET_LANG_CODE })),
    }
  } catch (e) {
    console.error(e.message)
    return { subtitles: [] }
  }
})

const app = express()
const routes = express.Router()

routes.get('/sub/:fileId.srt', async (req, res) => {
  if (!/^\d+$/.test(req.params.fileId)) return res.sendStatus(400)
  const started = Date.now()
  req.on('close', () => {
    if (!res.writableFinished) console.warn(`Player desistiu da legenda ${req.params.fileId} apos ${((Date.now() - started) / 1000).toFixed(1)}s`)
  })
  try {
    const srt = await getTranslation(req.params.fileId)
    res.set('Access-Control-Allow-Origin', '*').type('application/x-subrip; charset=utf-8').send(srt)
    console.log(`Legenda ${req.params.fileId} entregue em ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.error(e.message)
    res.sendStatus(502)
  }
})

routes.use(getRouter(builder.getInterface()))
app.get('/health', (req, res) => res.send('ok'))
app.use(PREFIX || '/', routes)

async function main() {
  await login()
  const host = PUBLIC_URL ? '0.0.0.0' : '127.0.0.1'
  app.listen(PORT, host, () => console.log(`Instale no Stremio: ${BASE}${PREFIX}/manifest.json`))
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
