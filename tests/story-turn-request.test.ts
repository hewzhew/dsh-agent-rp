import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStoryTurnRequest } from '../src/story-turn-request.ts'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'

const workspace = {
  events: [],
  world: {
    events: [{ sequence: 1, title: '灵梦掷出 6' }],
  },
} as unknown as StoryWorkspaceSnapshot

test('keeps a player direction as the visible turn request', () => {
  assert.equal(resolveStoryTurnRequest(workspace, '  让魔理沙先吐槽一句。  '), '让魔理沙先吐槽一句。')
})

test('continues from the latest authoritative world event when direction is empty', () => {
  assert.equal(resolveStoryTurnRequest(workspace, '  '),
    '请接着“灵梦掷出 6”之后的当前状态继续：让当前行动人物依据自己的认知选择一个合法世界动作，再把程序结算出的新事件写成这一回合的角色场面。')
})

test('writes a pending character-owned world result before requesting another action', () => {
  const pending = {
    ...workspace,
    world: {
      ...workspace.world,
      events: [
        { sequence: 1, title: '棋局开始' },
        { sequence: 2, title: '灵梦掷出 1', actorId: 'character-reimu' },
        { sequence: 3, title: '没有可移动的飞机', actorId: 'character-reimu' },
      ],
    },
  } as unknown as StoryWorkspaceSnapshot

  assert.equal(resolveStoryTurnRequest(pending, ''),
    '请把游玩场地中尚未写入正文的规则结果（截至“没有可移动的飞机”）整理成这一回合的角色场面；不要执行新的世界动作。')
})
