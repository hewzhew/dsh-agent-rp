import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatConversationViewNode, ConversationMatch } from '@deepseek-ai/dsh-client-runtime/client'
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
  const match = {
    event: value,
    view: undefined,
    role: result.role,
    location: { kind: 'session' },
  } as ConversationMatch
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

test('does not turn interactive changes or malformed launch records into launch cards', () => {
  assert.equal(projectLaunch(event(0, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'ordinary', sourceEventSeq: 0,
  })), null)
  assert.equal(projectLaunch(event(1, 'agent-rp/story-workspace-selection', {
    format: 0, workspaceId: 'late', source: 'launch',
  })), null)
})
