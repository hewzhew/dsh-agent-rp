import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentRpProjectionDefinition, createAgentRpProjectionDefinition } from '../src/projection.ts'
import { appendAgentRpSessionEvent } from '../src/session-event-append.ts'

test('serves the same Agent RP view through current and newer DSH projection contracts', () => {
  const state = agentRpProjectionDefinition.init(Session.create(SessionId('projection-contract')).header)
  const currentHostView = agentRpProjectionDefinition.schema.parse(
    agentRpProjectionDefinition.view(state),
  )
  const newerHostView = agentRpProjectionDefinition.wire.viewSchema.parse(
    agentRpProjectionDefinition.wire.view(agentRpProjectionDefinition.stateSchema.parse(state)),
  )

  assert.deepEqual(currentHostView, newerHostView)
  assert.equal(agentRpProjectionDefinition.preload, false)
})

test('projects the selected turn mode through the required Session event capability', () => {
  const definition = createAgentRpProjectionDefinition()
  const selected = definition.apply(definition.init(Session.create(SessionId('projection-turn-mode')).header), {
    type: 'agent-rp/turn-mode',
    seq: 0,
    time: 1,
    data: { format: 0, mode: 'agent', source: 'default' },
  })
  const view = definition.wire.view(selected)

  assert.deepEqual(view.hostCapabilities, { sessionEvents: true })
  assert.equal(view.turnMode, 'agent')
})

test('projects live story stages and resets progress at the next turn', () => {
  const session = Session.create(SessionId('projection-story-progress'))
  const definition = createAgentRpProjectionDefinition()
  let state = definition.init(session.header)
  const historyRequest = appendAgentRpSessionEvent(session, 'agent-rp/story-stage-request', {
    format: 0,
    requestId: 'history-1',
    sessionId: String(session.id),
    workspaceId: 'workspace-1',
    workspaceRevision: 2,
    turn: 4,
    step: 1,
    stage: 'history',
    subjectId: 'reimu',
    dispatch: { provider: 'test', model: 'test', messages: [] },
  })
  state = definition.apply(state, historyRequest)
  assert.deepEqual(definition.wire.view(state).storyTurn, {
    workspaceId: 'workspace-1',
    turn: 4,
    step: 1,
    status: 'running',
    requests: [{ requestId: 'history-1', stage: 'history', subjectId: 'reimu', status: 'running' }],
  })

  state = definition.apply(state, appendAgentRpSessionEvent(session, 'agent-rp/story-stage-result', {
    format: 0,
    requestId: 'history-1',
    requestSeq: historyRequest.seq,
    result: { kind: 'failure', failure: 'provider' },
  }))
  assert.equal(definition.wire.view(state).storyTurn?.requests[0]?.status, 'failed')

  state = definition.apply(state, appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 1,
    sessionId: String(session.id),
    workspaceId: 'workspace-1',
    workspaceRevision: 2,
    turn: 4,
    step: 1,
    resultEventSeqs: [],
    directorBrief: '',
    finalSections: [],
    finalDraft: '',
    modelContext: '',
  }))
  assert.equal(definition.wire.view(state).storyTurn?.status, 'prepared')

  state = definition.apply(state, appendAgentRpSessionEvent(session, 'agent-rp/story-turn-materialized', {
    format: 3,
    sessionId: String(session.id),
    workspaceId: 'workspace-1',
    workspaceRevision: 2,
    turn: 4,
    step: 1,
    eventSummary: '第四回合完成。',
    changes: { characters: [], facts: [], nodes: [], edges: [] },
  }))
  assert.equal(definition.wire.view(state).storyTurn?.status, 'complete')

  state = definition.apply(state, appendAgentRpSessionEvent(session, 'agent-rp/story-stage-request', {
    format: 0,
    requestId: 'character-2',
    sessionId: String(session.id),
    workspaceId: 'workspace-1',
    workspaceRevision: 3,
    turn: 5,
    step: 1,
    stage: 'character',
    subjectId: 'marisa',
    dispatch: { provider: 'test', model: 'test', messages: [] },
  }))
  assert.deepEqual(definition.wire.view(state).storyTurn?.requests, [
    { requestId: 'character-2', stage: 'character', subjectId: 'marisa', status: 'running' },
  ])
})
