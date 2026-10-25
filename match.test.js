const test = require('node:test')
const assert = require('node:assert')
const { releaseInfo, matchScore } = require('./match')

test('mesmo grupo ganha de mesma resolucao e de outra fonte', () => {
  const file = 'The.Matrix.1999.1080p.BluRay.x264-SPARKS.mkv'
  const same = matchScore(file, ['The.Matrix.1999.1080p.BluRay.x264-SPARKS'])
  const otherGroup = matchScore(file, ['The.Matrix.1999.720p.BluRay.x264-AMIABLE'])
  const otherSource = matchScore(file, ['The.Matrix.1999.1080p.WEB-DL.DDP5.1-FLUX'])
  assert.ok(same > otherGroup && otherGroup > otherSource, `${same} ${otherGroup} ${otherSource}`)
})

test('servico de streaming conta e WEB-DL nao vira grupo', () => {
  assert.strictEqual(releaseInfo('Show.S01E01.1080p.WEB-DL').group, undefined)
  const file = 'Show.S01E01.1080p.NF.WEB-DL.DDP5.1.H.264-NTb.mkv'
  assert.ok(matchScore(file, ['Show.S01E01.NF.WEBRip']) > matchScore(file, ['Show.S01E01.AMZN.WEBRip']))
})

test('sem nome de arquivo nao pontua', () => {
  assert.strictEqual(matchScore(undefined, ['The.Matrix.1999.BluRay-SPARKS']), 0)
})
