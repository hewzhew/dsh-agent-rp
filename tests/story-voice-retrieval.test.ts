import assert from 'node:assert/strict'
import test from 'node:test'
import { searchStoryWorkspaceSourceExcerpts } from '../src/story-research.ts'
import { searchStoryVoiceSourceExcerpts } from '../src/story-voice-retrieval.ts'

test('ranks reply meaning before frequent full-name speaker labels', () => {
  const characterNames = ['博丽灵梦', '博麗霊夢', '霊夢']
  const content = [
    ...Array.from({ length: 18 }, (_, index) => [
      `# 闲谈 ${String(index + 1)}`,
      `博麗霊夢：「${'今天照常巡查神社。'.repeat(90)}」`,
    ].join('\n')),
    '# 骰子争执',
    '霧雨魔理沙：「骰子还没落稳。」',
    '霊夢：「看清点数再说。」',
  ].join('\n\n')
  const sources = [{
    id: 'source-00000000-0000-4000-8000-000000000001',
    name: '原作对话',
    kind: 'original' as const,
    enabled: true,
    content,
  }]
  const coarse = searchStoryWorkspaceSourceExcerpts(
    { sources },
    [...characterNames, '点数'].join('\n'),
    6_000,
  )
  assert.equal(coarse.some(candidate => candidate.text.includes('看清点数再说')), false)

  const selected = searchStoryVoiceSourceExcerpts(sources, characterNames, {
    primary: '先确认点数。',
    context: '魔理沙催灵梦决定是否继续。',
  }, 6_000)

  assert.equal(selected[0]?.locator, '骰子争执 · 第 2 段')
  assert.equal(selected[0]?.reference, 'local:source-00000000-0000-4000-8000-000000000001:20')
  assert.deepEqual(selected[0]?.voiceParts.orderedLines.map(line => [line.owner, line.speaker, line.dialogue]), [
    ['context', '霧雨魔理沙', '骰子还没落稳。'],
    ['target', '霊夢', '看清点数再说。'],
  ])
  assert.equal(selected.some(candidate => candidate.text.includes('今天照常巡查神社')), false)
})
