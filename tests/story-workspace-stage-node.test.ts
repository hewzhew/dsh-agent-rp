import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ConversationMatch,
  ConversationNodeDefinition,
  ConversationStartMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { storyTurnProgressText, storyTurnStageLabel } from '../src/client/story-turn-progress.ts'
import {
  storyWorkspaceStageDefinition,
  storyWorkspaceWorldEvidenceDefinition,
  type StoryWorkspaceStageChatData,
  type StoryWorkspaceWorldEvidenceChatData,
} from '../src/client/story-workspace-stage-node.ts'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'

type ProjectEvent = Parameters<typeof storyWorkspaceStageDefinition.match>[0]

function event(seq: number, time: number, type: string, data: unknown): ProjectEvent {
  return { seq, time, type, data } as ProjectEvent
}

function project<State>(
  definition: ConversationNodeDefinition<State>,
  values: readonly ProjectEvent[],
): ChatConversationViewNode | null {
  const [first, ...rest] = values
  if (first === undefined) throw new Error('node start required')
  const firstResult = definition.match(first)
  if (firstResult?.role !== 'start') throw new Error('first event must start the node')
  const start: ConversationStartMatch = {
    event: first as SessionEvent,
    role: 'start',
    location: { kind: 'session' },
  }
  const matches: ConversationMatch[] = [start]
  const base = {
    key: `${definition.kind}:${firstResult.id}`,
    kind: definition.kind,
    id: firstResult.id,
    matches,
    start,
    current: new Map(),
  }
  let state = definition.start({ ...base, state: undefined }, start, { previous: () => undefined })
  for (const value of rest) {
    const result = definition.match(value)
    if (result?.role !== 'update' || result.id !== firstResult.id) throw new Error('child event must update the same node')
    const match: ConversationMatch = {
      event: value as SessionEvent,
      role: 'update',
      location: { kind: 'session' },
    }
    matches.push(match)
    state = definition.update({ ...base, matches, state }, match)
  }
  return definition.buildViewNode?.({ ...base, matches, state }) as ChatConversationViewNode | null
}

const identity = {
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  workspaceRevision: 2,
  turn: 3,
  step: 1,
} as const

test('projects each privacy-safe Worker request as an independent native row', () => {
  const request = event(8, 1_000, 'agent-rp/story-stage-request', {
    format: 0,
    ...identity,
    requestId: 'request-1',
    stage: 'character',
    subjectId: 'character-reimu',
    dispatch: { messages: ['private prompt must not enter the node'] },
  })
  const running = project(storyWorkspaceStageDefinition, [request])
  assert.deepEqual(running?.data, {
    ...identity,
    requestId: 'request-1',
    stage: 'character',
    subjectId: 'character-reimu',
    startedAt: 1_000,
    status: 'running',
  })
  assert.doesNotMatch(JSON.stringify(running?.data), /private prompt/u)

  const completed = project(storyWorkspaceStageDefinition, [request,
    event(9, 2_250, 'agent-rp/story-stage-result', {
      format: 0,
      ...identity,
      requestId: 'request-1',
      requestSeq: 8,
      stage: 'character',
      subjectId: 'character-reimu',
      result: { kind: 'success', text: 'private Worker output must not enter the node' },
    }),
  ])
  const completedData = completed?.data as StoryWorkspaceStageChatData | undefined
  assert.equal(completedData?.status, 'succeeded')
  assert.equal(completedData?.finishedAt, 2_250)
  assert.doesNotMatch(JSON.stringify(completed?.data), /private Worker output/u)
  assert.equal(completed?.anchorSeq, 8)
  assert.equal(completed?.visibility, 'visible')
  assert.equal(storyWorkspaceStageDefinition.match(event(10, 2_300, 'agent-rp/story-turn-start', {
    format: 0, ...identity,
  })), null)
})

test('keeps parallel Worker requests as distinct rows and exposes stable failure detail', () => {
  const first = event(2, 20, 'agent-rp/story-stage-request', {
    format: 0, ...identity, requestId: 'history-reimu', stage: 'history', subjectId: 'reimu', dispatch: {},
  })
  const second = event(3, 30, 'agent-rp/story-stage-request', {
    format: 0, ...identity, requestId: 'history-marisa', stage: 'history', subjectId: 'marisa', dispatch: {},
  })
  const firstMatch = storyWorkspaceStageDefinition.match(first)
  const secondMatch = storyWorkspaceStageDefinition.match(second)
  assert.equal(firstMatch?.role, 'start')
  assert.equal(secondMatch?.role, 'start')
  assert.notEqual(firstMatch?.id, secondMatch?.id)

  const failed = project(storyWorkspaceStageDefinition, [first,
    event(5, 50, 'agent-rp/story-stage-result', {
      format: 0, ...identity, requestId: 'history-reimu', requestSeq: 2, stage: 'history', subjectId: 'reimu',
      result: { kind: 'failure', failure: 'provider', detail: { code: 'RATE_LIMIT', message: '模型暂时繁忙' } },
    }),
  ])
  const data = failed?.data as StoryWorkspaceStageChatData | undefined
  assert.equal(data?.status, 'failed')
  assert.equal(data?.failure, '模型暂时繁忙')
  assert.equal(storyWorkspaceStageDefinition.match(event(6, 60, 'agent-rp/story-stage-result', {
    format: 0, requestId: 'missing-identity', requestSeq: 2, result: { kind: 'success', text: '' },
  })), null)
})

test('projects public rule events as one folded evidence row at the prepared reply', () => {
  const brief = event(10, 2_300, 'agent-rp/story-turn-brief', {
    format: 1,
    ...identity,
    publicWorldEvents: [
      { type: 'die.rolled', title: '博丽灵梦掷出 2', summary: '第 1 回合掷骰结果为 2。', actorId: 'reimu' },
      { type: 'turn.passed', title: '未达到起飞点数', summary: '基地中的飞机需要掷出 6 点才能起飞。', actorId: 'reimu' },
    ],
    finalDraft: '正文不进入证据节点',
  })
  const projected = project(storyWorkspaceWorldEvidenceDefinition, [brief])
  const data = projected?.data as StoryWorkspaceWorldEvidenceChatData | undefined
  assert.equal(data?.events.length, 2)
  assert.equal(data?.events[0]?.title, '博丽灵梦掷出 2')
  assert.doesNotMatch(JSON.stringify(data), /正文不进入证据节点/u)
  assert.equal(projected?.anchorSeq, 10)
  assert.equal(storyWorkspaceWorldEvidenceDefinition.match(event(11, 2_400, 'agent-rp/story-turn-brief', {
    format: 1, ...identity, publicWorldEvents: [],
  })), null)
})

test('retains terminal turn copy for the composer progress surface', () => {
  const workspace = { id: identity.workspaceId, characters: [], outputs: [] } as unknown as StoryWorkspaceSnapshot
  assert.equal(storyTurnProgressText(workspace, {
    workspaceId: identity.workspaceId,
    turn: identity.turn,
    step: identity.step,
    status: 'aborted',
    requests: [],
  }), '本轮已中止，可以重试')
  assert.equal(storyTurnProgressText(workspace, {
    workspaceId: identity.workspaceId,
    turn: identity.turn,
    step: identity.step,
    status: 'failed',
    requests: [],
  }), '本轮未完成，可以重试')
})

test('names each dialogue pass by its actual responsibility', () => {
  assert.equal(storyTurnStageLabel('voice', 'draft:reimu:1'), '生成对白候选')
  assert.equal(storyTurnStageLabel('voice', 'review:reimu:1'), '审校人物对白')
  assert.equal(storyTurnStageLabel('voice', 'retry-draft:reimu:1'), '重写对白候选')
  assert.equal(storyTurnStageLabel('voice', 'retry-review:reimu:1'), '复核人物对白')
})
