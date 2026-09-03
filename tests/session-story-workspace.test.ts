import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  executeStoryWorkspaceCommand,
  readSessionStoryWorkspaceId,
} from '../src/session-story-workspace.ts'
import type { StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { createStoryOutputId, StoryWorkspaceStore } from '../src/story-workspace.ts'
import { sessionEvents } from '../src/session-events.ts'

function editable(snapshot: StoryWorkspaceSnapshot): StoryWorkspaceSaveRequest {
  return {
    format: 2,
    id: snapshot.id,
    revision: snapshot.revision,
    name: snapshot.name,
    pipeline: snapshot.pipeline,
    graph: snapshot.graph,
    characters: snapshot.characters,
    facts: snapshot.facts,
    events: snapshot.events,
    outputs: snapshot.outputs,
    sources: snapshot.sources,
    citations: snapshot.citations,
    researchInbox: snapshot.researchInbox,
  }
}

test('selects and clears a story workspace when private command args are not recorded', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-selection-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '会话故事' })
  const workspace = store.save({
    ...editable(created),
    outputs: [{ id: createStoryOutputId(), name: '正文', kind: 'prose', enabled: true, instructions: '' }],
  })
  const session = Session.create(SessionId('story-workspace-selection'))
  const agent = { session } as Agent
  const selectInput = JSON.stringify({ format: 0, workspaceId: workspace.id })
  const selectId = CommandId('story-workspace-select')
  session.append('command/run', {
    commandId: selectId,
    name: 'rp-story-workspace',
    args: '',
    source: { kind: 'user' },
  })

  executeStoryWorkspaceCommand(store, { commandId: selectId, agent, rawInput: selectInput })
  assert.equal(readSessionStoryWorkspaceId(sessionEvents(session)), workspace.id)

  const clearId = CommandId('story-workspace-clear')
  session.append('command/run', {
    commandId: clearId,
    name: 'rp-story-workspace',
    args: '',
    source: { kind: 'user' },
  })
  executeStoryWorkspaceCommand(store, {
    commandId: clearId,
    agent,
    rawInput: JSON.stringify({ format: 0, workspaceId: null }),
  })
  assert.equal(readSessionStoryWorkspaceId(sessionEvents(session)), undefined)
})

test('rejects a story workspace without an enabled prose output', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-output-readiness-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const workspace = store.create({ format: 2, name: '没有正文去处' })
  const session = Session.create(SessionId('story-workspace-without-prose'))
  const commandId = CommandId('story-workspace-invalid-select')
  session.append('command/run', {
    commandId,
    name: 'rp-story-workspace',
    args: '',
    source: { kind: 'user' },
  })

  assert.throws(() => {
    executeStoryWorkspaceCommand(store, {
      commandId,
      agent: { session } as Agent,
      rawInput: JSON.stringify({ format: 0, workspaceId: workspace.id }),
    })
  }, /启用至少一个正文分区/u)
  assert.equal(readSessionStoryWorkspaceId(sessionEvents(session)), undefined)
})

test('rejects malformed frozen continuity in durable Session events', () => {
  assert.throws(() => readSessionStoryWorkspaceId([{
    type: 'agent-rp/story-workspace-selection',
    seq: 0,
    time: 1,
    ignorable: true,
    data: {
      format: 0,
      workspaceId: 'workspace',
      source: 'launch',
      continuity: { turn: 1, title: '正文', text: '正文', unexpected: true },
    },
  } as never]), /接续前情无效/u)
})
