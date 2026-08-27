import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStoryTurnRequest } from '../src/story-turn-request.ts'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'

const workspace = {
  world: {
    events: [{ title: '灵梦掷出 6' }],
  },
} as unknown as StoryWorkspaceSnapshot

test('keeps a player direction as the visible turn request', () => {
  assert.equal(resolveStoryTurnRequest(workspace, '  让魔理沙先吐槽一句。  '), '让魔理沙先吐槽一句。')
})

test('continues from the latest authoritative world event when direction is empty', () => {
  assert.equal(resolveStoryTurnRequest(workspace, '  '),
    '请把“灵梦掷出 6”这条已经发生的世界事件写成角色场面，让人物依据各自掌握的信息自然反应；棋局停在场地当前状态。')
})
