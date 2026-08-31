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
    '请接着“灵梦掷出 6”之后的当前状态继续：让当前行动人物依据自己的认知选择一个合法世界动作，再把程序结算出的新事件写成这一回合的角色场面。')
})
