import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'

const eventType = 'agent-rp/alpha-source-capability-probe'
const session = Session.create(SessionId('agent-rp-alpha-source-capability-probe'))

if (typeof session.appendIgnorable !== 'function') {
  throw new Error('linked DSH Session does not expose appendIgnorable()')
}
const written = session.appendIgnorable(eventType, { format: 0 })
if (written.ignorable !== true) throw new Error('appendIgnorable() did not mark the stored envelope')
if (KNOWN_SESSION_EVENT_TYPES.has(eventType)) throw new Error('Agent RP probe unexpectedly belongs to the Host vocabulary')
Session.create(session.id, structuredClone(session.snapshotEvents()))

process.stdout.write('ready')
