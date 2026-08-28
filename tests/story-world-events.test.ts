import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPendingCharacterWorldResult, storyPendingWorldEvents } from '../src/story-world-events.ts'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'

test('finds only authoritative world events not represented by a story turn', () => {
  const workspace = {
    events: [{ worldEventSequences: [1] }],
    world: { events: [
      { sequence: 1, title: '棋局开始' },
      { sequence: 2, title: '灵梦掷出 1', actorId: 'character-reimu' },
      { sequence: 3, title: '没有可移动的飞机', actorId: 'character-reimu' },
    ] },
  } as unknown as StoryWorkspaceSnapshot

  assert.deepEqual(storyPendingWorldEvents(workspace).map(event => event.sequence), [2, 3])
  assert.equal(hasPendingCharacterWorldResult(workspace), true)
})

test('does not treat an actorless initial event as a completed character action', () => {
  const workspace = {
    events: [],
    world: { events: [{ sequence: 1, title: '棋局开始' }] },
  } as unknown as StoryWorkspaceSnapshot

  assert.equal(hasPendingCharacterWorldResult(workspace), false)
})
