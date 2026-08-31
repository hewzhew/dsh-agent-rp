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
import { StoryWorkspaceStore } from '../src/story-workspace.ts'
import { installIgnorableSessionEventFixture } from './session-event-fixture.ts'

installIgnorableSessionEventFixture()

test('selects and clears a story workspace when private command args are not recorded', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-selection-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const workspace = store.create({ format: 2, name: '会话故事' })
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
  assert.equal(readSessionStoryWorkspaceId(session.events), workspace.id)

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
  assert.equal(readSessionStoryWorkspaceId(session.events), undefined)
})
