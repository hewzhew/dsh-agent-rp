import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationMatch, ConversationStartMatch } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  storyWorkspaceLaunchDefinition,
  storyWorkspaceLaunchUrl,
} from '../src/client/story-workspace-launch-node.ts'

function event(seq: number, type: string, data: unknown): Parameters<typeof storyWorkspaceLaunchDefinition.match>[0] {
  return { seq, time: 1, type, data } as Parameters<typeof storyWorkspaceLaunchDefinition.match>[0]
}

function projectLaunch(
  value: Parameters<typeof storyWorkspaceLaunchDefinition.match>[0],
): ChatConversationViewNode | null {
  const result = storyWorkspaceLaunchDefinition.match(value)
  if (result === null) return null
  const match: ConversationStartMatch = {
    event: value as SessionEvent,
    role: 'start',
    location: { kind: 'session' },
  }
  const initial = {
    key: `${storyWorkspaceLaunchDefinition.kind}:${result.id}`,
    kind: storyWorkspaceLaunchDefinition.kind,
    id: result.id,
    matches: [match],
    start: match,
    state: undefined,
    current: new Map(),
  }
  const state = storyWorkspaceLaunchDefinition.start(initial, match, { previous: () => undefined })
  return storyWorkspaceLaunchDefinition.buildViewNode?.({ ...initial, state }) as ChatConversationViewNode | null
}

function projectSelections(
  values: readonly Parameters<typeof storyWorkspaceLaunchDefinition.match>[0][],
): ChatConversationViewNode | null {
  const [first, ...rest] = values
  if (first === undefined) throw new Error('launch selection required')
  const startResult = storyWorkspaceLaunchDefinition.match(first)
  if (startResult?.role !== 'start') throw new Error('first selection must start the launch card')
  const start: ConversationStartMatch = {
    event: first as SessionEvent,
    role: 'start',
    location: { kind: 'session' },
  }
  const context = {
    key: `${storyWorkspaceLaunchDefinition.kind}:${startResult.id}`,
    kind: storyWorkspaceLaunchDefinition.kind,
    id: startResult.id,
    matches: [start] as ConversationMatch[],
    start,
    state: undefined,
    current: new Map(),
  }
  let state = storyWorkspaceLaunchDefinition.start(context, start, { previous: () => undefined })
  for (const value of rest) {
    const result = storyWorkspaceLaunchDefinition.match(value)
    if (result?.role !== 'update') throw new Error('later selection must update the launch card')
    const match: ConversationMatch = {
      event: value as SessionEvent,
      role: 'update',
      location: { kind: 'session' },
    }
    context.matches.push(match)
    state = storyWorkspaceLaunchDefinition.update({ ...context, state }, match)
  }
  return storyWorkspaceLaunchDefinition.buildViewNode?.({ ...context, state }) as ChatConversationViewNode | null
}

test('projects a launch selection into one visible session-level play-space card', () => {
  const projected = projectLaunch(event(0, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'workspace / one', source: 'launch',
  }))
  assert.equal(projected?.kind, 'agent-rp-story-workspace-launch')
  assert.equal(projected?.anchorSeq, 0)
  assert.deepEqual(projected?.location, { kind: 'session' })
  assert.deepEqual(projected?.data, { workspaceId: 'workspace / one' })
  assert.equal(projected?.visibility, 'visible')
  assert.equal(storyWorkspaceLaunchUrl('workspace / one'), '/api/agent-rp/story-workspaces/workspace%20%2F%20one')
})

test('projects bounded frozen continuity from the launch event', () => {
  const continuity = {
    turn: 7,
    title: '折签露出',
    text: '灵梦把第一架木机推进航线。',
    truncatedStart: true,
  }
  assert.deepEqual(projectLaunch(event(0, 'agent-rp/story-workspace-selection', {
    format: 0,
    workspaceId: 'ongoing-workspace',
    source: 'launch',
    continuity,
  }))?.data, { workspaceId: 'ongoing-workspace', continuity })
})

test('classifies interactive changes as updates and rejects malformed launch records', () => {
  assert.deepEqual(storyWorkspaceLaunchDefinition.match(event(2, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'ordinary', sourceEventSeq: 1,
  })), { id: 'launch', role: 'update' })
  assert.equal(projectLaunch(event(0, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'ordinary', sourceEventSeq: 0,
  })), null)
  assert.equal(projectLaunch(event(1, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'late', source: 'launch',
  })), null)
  assert.equal(projectLaunch(event(0, 'agent-rp/story-workspace-selection', {
    format: 0,
    workspaceId: 'invalid-continuity',
    source: 'launch',
    continuity: { turn: 1, title: '正文', text: '过长'.repeat(3_001) },
  })), null)
  assert.equal(storyWorkspaceLaunchDefinition.match(event(2, 'agent-rp/story-workspace-selection', {
    format: 0,
    workspaceId: 'ordinary',
    sourceEventSeq: 1,
    continuity: { turn: 1, title: '正文', text: '不能随切换事件传递。' },
  })), null)
})

test('keeps the launch card on the Session current play space without leaking launch continuity', () => {
  const launch = event(0, 'agent-rp/story-workspace-selection', {
    format: 0,
    workspaceId: 'workspace-one',
    source: 'launch',
    continuity: { turn: 2, title: '旧场地前情', text: '只属于第一个场地。' },
  })
  const switched = event(4, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'workspace-two', sourceEventSeq: 3,
  })
  assert.deepEqual(projectSelections([launch, switched])?.data, { workspaceId: 'workspace-two' })

  const cleared = event(6, 'agent-rp/story-workspace-selection', {
    format: 0, sourceEventSeq: 5,
  })
  assert.equal(projectSelections([launch, switched, cleared]), null)

  const reconnected = event(8, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'workspace-three', sourceEventSeq: 7,
  })
  assert.deepEqual(projectSelections([launch, switched, cleared, reconnected])?.data, {
    workspaceId: 'workspace-three',
  })
})
