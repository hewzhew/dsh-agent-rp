import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  AGENT_RP_SESSION_EVENT_TYPES,
  appendAgentRpSessionEvent,
  hostSupportsAgentRpSessionEvents,
  supportsAgentRpSessionEvents,
} from '../src/session-event-append.ts'
import { LEGACY_AGENT_RP_EVENT_TYPES } from '../src/session-repair.ts'
import { sessionEvents } from '../src/session-events.ts'

test('keeps the complete Agent RP vocabulary on the replay-safe writer', () => {
  assert.equal(AGENT_RP_SESSION_EVENT_TYPES.length, 39)
  assert.deepEqual([...LEGACY_AGENT_RP_EVENT_TYPES], [...AGENT_RP_SESSION_EVENT_TYPES])
})

test('writes ignorable Agent RP events that a Host without the plugin may replay', () => {
  const session = Session.create(SessionId('agent-rp-ignorable-event'))
  const data = {
    format: 0 as const,
    id: 'state:fixture',
    revision: 1,
    ownerModuleId: 'roleplay:fixture',
    writerModuleId: 'roleplay:fixture',
    value: { safe: true },
  }

  assert.equal(hostSupportsAgentRpSessionEvents(), true)
  assert.equal(supportsAgentRpSessionEvents(session), true)
  const written = appendAgentRpSessionEvent(session, 'agent-rp/state', data)

  assert.equal(written.type, 'agent-rp/state')
  assert.deepEqual(written.data, data)
  assert.equal(written.ignorable, true)
  const replayed = Session.create(session.id, structuredClone(sessionEvents(session)))
  assert.deepEqual(sessionEvents(replayed).slice(0, sessionEvents(session).length), sessionEvents(session))
  assert.equal(sessionEvents(replayed).at(-1)?.type, 'session/end-seed')
})
