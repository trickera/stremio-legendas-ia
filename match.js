// Legenda dessincroniza quando foi feita pra outro release do mesmo filme.
// Grupo do release e servico de streaming sao os sinais mais fortes de mesma edicao.
const SOURCES = {
  web: ['web', 'webdl', 'webrip'],
  bluray: ['bluray', 'bdrip', 'brrip', 'bdremux', 'remux'],
  hdtv: ['hdtv'],
  dvd: ['dvdrip', 'dvd'],
}
const SOURCE_TOKENS = new Set([...Object.values(SOURCES).flat(), 'dl', 'rip'])
const SERVICES = new Set(['amzn', 'nf', 'dsnp', 'hmax', 'atvp', 'hulu', 'pcok', 'pmtp', 'cr', 'stan'])

function releaseInfo(name) {
  const clean = (name || '').toLowerCase().replace(/\[[^\]]*\]/g, '').trim().replace(/\.(mkv|mp4|avi|srt)$/, '')
  const tokens = clean.split(/[^a-z0-9]+/).filter(t => t.length > 1)
  const group = clean.match(/-([a-z0-9]+)$/)?.[1]
  return {
    tokens: new Set(tokens),
    source: Object.keys(SOURCES).find(s => tokens.some(t => SOURCES[s].includes(t))),
    service: tokens.find(t => SERVICES.has(t)),
    group: SOURCE_TOKENS.has(group) ? undefined : group,
  }
}

function matchScore(fileName, subNames) {
  const f = releaseInfo(fileName)
  if (!f.tokens.size) return 0
  return Math.max(0, ...subNames.filter(Boolean).map(name => {
    const s = releaseInfo(name)
    return (f.group && f.group === s.group ? 100 : 0)
      + (f.service && f.service === s.service ? 30 : 0)
      + (f.source && f.source === s.source ? 20 : 0)
      + [...s.tokens].filter(t => f.tokens.has(t)).length * 2
  }))
}

module.exports = { releaseInfo, matchScore }
