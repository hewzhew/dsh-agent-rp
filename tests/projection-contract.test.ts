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

test('keeps the selected story workspace visible while the Session is idle', () => {
  const definition = createAgentRpProjectionDefinition()
  let state = definition.init(Session.create(SessionId('projection-story-workspace')).header)
  state = definition.apply(state, {
    type: 'agent-rp/story-workspace-selection',
    seq: 0,
    time: 1,
    ignorable: true,
    data: { format: 0, workspaceId: 'workspace-1', source: 'launch' },
  })
  assert.equal(definition.wire.view(state).storyWorkspaceId, 'workspace-1')

  state = definition.apply(state, {
    type: 'agent-rp/story-workspace-selection',
    seq: 2,
    time: 2,
    ignorable: true,
    data: { format: 0, sourceEventSeq: 1 },
  })
  assert.equal(definition.wire.view(state).storyWorkspaceId, undefined)
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
    requests: [{
      requestId: 'history-1',
      stage: 'history',
      subjectId: 'reimu',
      startedAt: historyRequest.time,
      status: 'running',
    }],
  })

  const historyResult = appendAgentRpSessionEvent(session, 'agent-rp/story-stage-result', {
    format: 0,
    requestId: 'history-1',
    requestSeq: historyRequest.seq,
    result: {
      kind: 'failure',
      failure: 'provider',
      detail: { code: 'RATE_LIMIT', message: '请求过快', status: 429, providerRetryAfterMs: 1_000 },
    },
  })
  state = definition.apply(state, historyResult)
  assert.deepEqual(definition.wire.view(state).storyTurn?.requests[0], {
    requestId: 'history-1',
    stage: 'history',
    subjectId: 'reimu',
    startedAt: historyRequest.time,
    finishedAt: historyResult.time,
    durationMs: historyResult.time - historyRequest.time,
    status: 'failed',
    failure: 'provider',
    detail: { code: 'RATE_LIMIT', message: '请求过快', status: 429, providerRetryAfterMs: 1_000 },
  })

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

  const characterRequest = appendAgentRpSessionEvent(session, 'agent-rp/story-stage-request', {
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
  })
  state = definition.apply(state, characterRequest)
  assert.deepEqual(definition.wire.view(state).storyTurn?.requests, [
    {
      requestId: 'character-2',
      stage: 'character',
      subjectId: 'marisa',
      startedAt: characterRequest.time,
      status: 'running',
    },
  ])
})
