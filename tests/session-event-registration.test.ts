import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  AGENT_RP_SESSION_EVENT_OWNER,
  AGENT_RP_SESSION_EVENT_TYPES,
  registerAgentRpSessionEvents,
} from '../src/session-event-registration.ts'
import { appendAgentRpSessionEvent } from '../src/session-event-append.ts'
import { LEGACY_AGENT_RP_EVENT_TYPES } from '../src/session-repair.ts'

test('registers the complete Agent RP event vocabulary for exactly the plugin lifetime', async () => {
  const root = new Context()
  await root.plugin(SessionStore)
  try {
    const owner = await root.plugin(Object.assign((ctx: Context) => {
      registerAgentRpSessionEvents(ctx)
    }, { inject: ['sessions'] }))

    assert.equal(AGENT_RP_SESSION_EVENT_OWNER, '@hewzhew/dsh-agent-rp')
    assert.equal(AGENT_RP_SESSION_EVENT_TYPES.length, 37)
    assert.deepEqual([...LEGACY_AGENT_RP_EVENT_TYPES], [...AGENT_RP_SESSION_EVENT_TYPES])
    for (const type of AGENT_RP_SESSION_EVENT_TYPES) {
      assert.equal(root.sessions.recognizesEventType(type), true, type)
    }

    await owner.dispose()
    for (const type of AGENT_RP_SESSION_EVENT_TYPES) {
      assert.equal(root.sessions.recognizesEventType(type), false, type)
    }
  } finally {
    await root.fiber.dispose()
  }
})

test('writes required Agent RP events without extending the DSH envelope', () => {
  const session = Session.create(SessionId('agent-rp-required-event'))
  const data = {
    format: 0 as const,
    id: 'state:fixture',
    revision: 1,
    ownerModuleId: 'roleplay:fixture',
    writerModuleId: 'roleplay:fixture',
    value: { safe: true },
  }

  const written = appendAgentRpSessionEvent(session, 'agent-rp/state', data)

  assert.equal(written.type, 'agent-rp/state')
  assert.deepEqual(written.data, data)
  assert.equal('ignorable' in written, false)
  const replayed = Session.create(session.id, structuredClone(session.events))
  assert.deepEqual(replayed.events.slice(0, session.events.length), session.events)
  assert.equal(replayed.events.at(-1)?.type, 'session/end-seed')
})
