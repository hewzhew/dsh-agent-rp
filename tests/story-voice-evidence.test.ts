import assert from 'node:assert/strict'
import test from 'node:test'
import { parseStoryVoiceEvidence } from '../src/story-voice-evidence.ts'

test('attributes original and translated dialogue through character aliases', () => {
  const parts = parseStoryVoiceEvidence(['博丽灵梦', '博麗霊夢', '霊夢'], [
    '霧雨魔理沙：「どの台詞のことだ？」',
    '博麗霊夢：「自分で二つの話を繋げておいて、どっちかなんて聞くの？」',
    '参考译文：',
    '雾雨魔理沙：“你问的是哪句话？”',
    '博丽灵梦：“你自己把两句话接在一起，还问我是哪句？”',
  ].join('\n'))

  assert.deepEqual(parts.orderedLines.map(line => [line.owner, line.variant, line.speaker]), [
    ['context', 'original', '霧雨魔理沙'],
    ['target', 'original', '博麗霊夢'],
    ['context', 'translation', '雾雨魔理沙'],
    ['target', 'translation', '博丽灵梦'],
  ])
  assert.equal(parts.targetLines.length, 2)
  assert.equal(parts.contextLines.length, 2)
  assert.equal(parts.notes, '')
})

test('retains prose as notes and deduplicates repeated labelled lines', () => {
  const parts = parseStoryVoiceEvidence(['魔理沙'], [
    '这一段说明她会直接反问。',
    '魔理沙：“所以呢？”',
    '魔理沙：“所以呢？”',
  ].join('\n'))

  assert.equal(parts.targetLines.length, 1)
  assert.equal(parts.targetLines[0]?.variant, 'example')
  assert.equal(parts.notes, '这一段说明她会直接反问。')
})
