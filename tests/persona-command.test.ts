import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { executePersonaCommand } from '../src/persona-command.ts'
import {
  decodePersonaCommandRecord,
  parsePersonaCommandRequest,
} from '../src/persona-command-protocol.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import {
  readSessionPersonaSelection,
  resolveSessionPersonaIdentity,
} from '../src/session-persona.ts'
import { sessionEvents } from '../src/session-events.ts'

const persona = {
  id: 'persona-12345678-1234-4123-8123-123456789abc',
  name: '小满',
  description: '怕冷，喜欢旧书。',
}

function run(agent: Agent, rawInput: string, sequence: number): void {
  const commandId = CommandId(`persona-${sequence}`)
  agent.session.append('command/run', {
    commandId,
    name: 'rp-persona',
    args: rawInput,
    source: { kind: 'user' },
  })
  const result = executePersonaCommand({ commandId, agent, rawInput })
  agent.session.append('command/done', { commandId, ...result })
}

function project(agent: Agent) {
  let state = agentRpProjectionDefinition.init(agent.session.header, agent.session.inheritedEventCount)
  for (const event of sessionEvents(agent.session)) state = agentRpProjectionDefinition.apply(state, event)
  return agentRpProjectionDefinition.wire.view(state)
}

test('validates private Persona requests without accepting extra fields', () => {
  assert.deepEqual(parsePersonaCommandRequest(JSON.stringify({ format: 0, persona })), { format: 0, persona })
  assert.deepEqual(parsePersonaCommandRequest(JSON.stringify({ format: 0 })), { format: 0 })
  assert.throws(() => parsePersonaCommandRequest(JSON.stringify({ format: 0, persona, path: 'C:\\secret' })), /字段无效/u)
})

test('selects and clears a Persona through a replayable model-free command', () => {
  const agent = { session: Session.create(SessionId('persona-command')) } as Agent
  run(agent, JSON.stringify({ format: 0, persona }), 1)

  assert.deepEqual(readSessionPersonaSelection(sessionEvents(agent.session)), { explicit: true, persona })
  assert.deepEqual(resolveSessionPersonaIdentity(sessionEvents(agent.session), '旧称呼'), {
    persona,
    userName: persona.name,
  })
  assert.equal(project(agent).persona?.name, persona.name)
  assert.equal(project(agent).userName, persona.name)

  run(agent, JSON.stringify({ format: 0 }), 2)

  assert.deepEqual(readSessionPersonaSelection(sessionEvents(agent.session)), { explicit: true })
  assert.deepEqual(resolveSessionPersonaIdentity(sessionEvents(agent.session), '旧称呼'), {})
  assert.equal(project(agent).persona, undefined)
  assert.equal(project(agent).userName, undefined)
})

test('rejects a Persona result that cites a different command source', () => {
  const agent = { session: Session.create(SessionId('persona-command-source')) } as Agent
  run(agent, JSON.stringify({ format: 0, persona }), 1)
  const done = sessionEvents(agent.session).at(-1)
  assert.equal(done?.type, 'command/done')
  if (done?.type !== 'command/done' || done.data.kind !== 'success') assert.fail('missing Persona result')
  const record = decodePersonaCommandRecord(done.data.text)
  assert.equal(record?.sourceEventSeq, 0)

  const events = sessionEvents(agent.session).map((event, index) => index === 0
    ? { ...event, data: { ...event.data, name: 'rp-world-info' } }
    : event) as SessionEvent[]
  assert.throws(() => readSessionPersonaSelection(events), /没有对应的命令来源/u)
})
