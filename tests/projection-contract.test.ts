import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentRpProjectionDefinition, createAgentRpProjectionDefinition } from '../src/projection.ts'

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
