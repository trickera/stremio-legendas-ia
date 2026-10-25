function parseSrt(text) {
  return text
    .replace(/^﻿/, '')
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/)
    .map(block => {
      const lines = block.split('\n')
      const i = lines.findIndex(l => l.includes('-->'))
      if (i < 0) return null
      // Tags ASS tipo {\an8} vem dentro de SRT e o Stremio mostra como texto
      const text = lines.slice(i + 1).join('\n').replace(/\{\\[^}]*\}/g, '').trim()
      return { time: lines[i].trim(), text }
    })
    .filter(c => c && c.text)
}

function buildSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${c.time}\n${c.text}`).join('\n\n') + '\n'
}

module.exports = { parseSrt, buildSrt }
