import assert from 'node:assert/strict'
import test from 'node:test'
import { assignImportedStoryWorldActor } from '../src/client/story-world-actor-assignment.ts'

const candidates = [
  { slotId: 'reimu', names: ['博丽灵梦', '霊夢'], required: true },
  { slotId: 'marisa', names: ['雾雨魔理沙', '魔理沙'], required: true },
  { slotId: 'guest', names: ['来客'], required: false },
] as const

test('assigns imported actors by character aliases before file order', () => {
  let assignments: Readonly<Record<string, string>> = {}
  assignments = assignImportedStoryWorldActor(assignments, candidates, { id: 'actor:marisa', name: '霧雨魔理沙' })
  assignments = assignImportedStoryWorldActor(assignments, candidates, { id: 'actor:reimu', name: '霊夢' })
  assert.deepEqual(assignments, { marisa: 'actor:marisa', reimu: 'actor:reimu' })
})

test('fills required slots before optional slots and never reuses one actor', () => {
  const first = assignImportedStoryWorldActor({}, candidates, { id: 'actor:unknown', name: '未知人物' })
  assert.deepEqual(first, { reimu: 'actor:unknown' })
  assert.equal(assignImportedStoryWorldActor(first, candidates, { id: 'actor:unknown', name: '未知人物' }), first)
  const second = assignImportedStoryWorldActor(first, candidates, { id: 'actor:second', name: '另一人物' })
  const third = assignImportedStoryWorldActor(second, candidates, { id: 'actor:third', name: '第三人物' })
  assert.deepEqual(third, {
    reimu: 'actor:unknown',
    marisa: 'actor:second',
    guest: 'actor:third',
  })
})
