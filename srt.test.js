const test = require('node:test')
const assert = require('node:assert')
const { parseSrt, buildSrt } = require('./srt')

test('parse e rebuild preserva tempo e quebra de linha', () => {
  const raw = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n<i>there</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n\r\n3\r\n00:00:05,000 --> 00:00:06,000\r\n\r\n'
  const cues = parseSrt(raw)
  assert.deepStrictEqual(cues, [
    { time: '00:00:01,000 --> 00:00:02,500', text: 'Hello\n<i>there</i>' },
    { time: '00:00:03,000 --> 00:00:04,000', text: 'Bye' },
  ])
  assert.strictEqual(
    buildSrt(cues),
    '1\n00:00:01,000 --> 00:00:02,500\nHello\n<i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n'
  )
})

test('remove tags ASS e descarta fala que so tinha tag', () => {
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Older, {\\i1}wiser\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an8}\n')
  assert.deepStrictEqual(cues, [{ time: '00:00:01,000 --> 00:00:02,000', text: 'Older, wiser' }])
})
