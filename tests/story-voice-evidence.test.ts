import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseStoryVoiceDocument,
  parseStoryVoiceEvidence,
  storyVoiceEvidenceUnits,
  storyVoiceSpeakerAttributions,
} from '../src/story-voice-evidence.ts'

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

test('resets original and translated variants across repeated bilingual blocks', () => {
  const parts = parseStoryVoiceEvidence(['灵梦'], [
    '原文：',
    '灵梦：「最初の返事。」',
    '参考译文：',
    '灵梦：“第一次回答。”',
    '原文：',
    '灵梦：「次の返事。」',
    '参考译文：',
    '灵梦：“第二次回答。”',
  ].join('\n'))

  assert.deepEqual(parts.orderedLines.map(line => line.variant), [
    'original',
    'translation',
    'original',
    'translation',
  ])
  assert.equal(parts.notes, '')
})

test('groups bilingual lines into the same units used by voice generation', () => {
  const parts = parseStoryVoiceEvidence(['博麗霊夢', '博丽灵梦'], [
    '原文：',
    '霧雨魔理沙：「先に行くぜ。」',
    '博麗霊夢：「待ちなさい。」',
    '参考译文：',
    '雾雨魔理沙：“我先走了。”',
    '博丽灵梦：“等一下。”',
  ].join('\n'))
  const units = storyVoiceEvidenceUnits(parts)

  assert.equal(units.length, 2)
  assert.deepEqual(units.map(unit => [unit.owner, unit.lines.map(line => line.variant)]), [
    ['context', ['original', 'translation']],
    ['target', ['original', 'translation']],
  ])
  assert.deepEqual(units[1]?.lines.map(line => [line.speaker, line.dialogue]), [
    ['博麗霊夢', '待ちなさい。'],
    ['博丽灵梦', '等一下。'],
  ])
})

test('does not align unrelated original and translated lines after a local excerpt is sliced', () => {
  const parsed = parseStoryVoiceEvidence(['博丽灵梦'], [
    '原文：',
    '霧雨魔理沙：「最後の推測だ。」',
    '参考译文：',
    '雾雨魔理沙：“喂，灵梦。”',
    '博丽灵梦：“一看就知道了。”',
  ].join('\n'))
  const slicedLines = [parsed.orderedLines[0]!, parsed.orderedLines[2]!]
  const units = storyVoiceEvidenceUnits({
    orderedLines: slicedLines,
    targetLines: slicedLines.filter(line => line.owner === 'target'),
    contextLines: slicedLines.filter(line => line.owner === 'context'),
    notes: '',
  })

  assert.equal(units.length, 2)
  assert.deepEqual(units.map(unit => unit.lines.map(line => [line.speaker, line.dialogue])), [
    [['霧雨魔理沙', '最後の推測だ。']],
    [['博丽灵梦', '一看就知道了。']],
  ])
})

test('reports unmatched and ambiguous speaker labels without inventing attribution', () => {
  const document = parseStoryVoiceDocument([
    '博麗霊夢：「始めるわよ。」',
    '霧雨魔理沙：「待ってたぜ。」',
    '八雲紫：「見ているわ。」',
  ].join('\n'))
  const attributions = storyVoiceSpeakerAttributions(document, [
    { id: 'reimu', names: ['博丽灵梦', '博麗霊夢'] },
    { id: 'marisa', names: ['雾雨魔理沙', '霧雨魔理沙'] },
    { id: 'borrowed-alias', names: ['博麗霊夢'] },
    { id: 'zero-lines', names: ['東風谷早苗'] },
  ])

  assert.deepEqual(attributions, [
    { labels: ['博麗霊夢'], characterIds: ['reimu', 'borrowed-alias'], lineCount: 1 },
    { labels: ['霧雨魔理沙'], characterIds: ['marisa'], lineCount: 1 },
    { labels: ['八雲紫'], characterIds: [], lineCount: 1 },
  ])
  const zeroParts = parseStoryVoiceEvidence(['東風谷早苗'], document.orderedLines
    .map(line => `${line.speaker}：「${line.dialogue}」`).join('\n'))
  assert.equal(storyVoiceEvidenceUnits(zeroParts).filter(unit => unit.owner === 'target').length, 0)
})
