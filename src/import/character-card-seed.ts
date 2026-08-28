/** Model-free Character Card import into a native roleplay Session. */
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  prepareCharacterImportResult,
  type CharacterCardAttachmentRef,
  type CharacterImportTransport,
  type CharacterImportMeta,
} from './session-character.ts'
import type { ImportedCharacterCard } from './types.ts'
import type { SessionPersonaSnapshot } from '../persona-library-protocol.ts'
import type {} from '../session-persona.ts'

/** Durable provenance for one Character Card used to seed a new Session. */
export interface CharacterCardSeedRecord {
  readonly format: 0
  readonly source:
  | {
    readonly attachmentConsumer: 'dsh-agent-rp'
    readonly attachments: readonly [CharacterCardAttachmentRef]
  }
  | {
    readonly characterLibraryId: string
  }
  readonly meta: CharacterImportMeta
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable model-free Character Card import that activates the preserved card. */
    'agent-rp/character-card-seed': CharacterCardSeedRecord
  }
}

type SessionSeedEvent = SessionEvent extends infer Event
  ? Event extends SessionEvent ? Omit<Event, 'seq'> : never
  : never

/**
 * Build a native Session that activates one Character Card and opens with its selected greeting.
 * @param card - parsed lossless Character Card.
 * @param attachment - Host-stored original card attachment.
 * @param greetingIndex - selected first or alternate greeting.
 * @param renderedGreeting - selected greeting after stable identity macro substitution.
 * @param transport - JSON, PNG, or CHARX provenance.
 * @param userName - optional imported user identity for card macros.
 * @param persona - optional reusable player Persona snapshotted for this Session.
 * @param libraryId - reusable card id used to resolve CHARX media.
 * @returns validated immutable Session seed.
 */
export function createCharacterCardSessionSeed(
  card: ImportedCharacterCard,
  attachment: CharacterCardAttachmentRef,
  greetingIndex: number,
  renderedGreeting: string,
  transport: CharacterImportTransport = { transport: 'json' },
  userName?: string,
  persona?: SessionPersonaSnapshot,
  libraryId?: string,
): readonly SessionEvent[] {
  const value = prepareCharacterImportResult(
    card,
    transport,
    0,
    attachment,
    greetingIndex,
    userName,
    libraryId,
  )
  const { raw, ...result } = value
  const meta: CharacterImportMeta = { format: 0, result, raw }
  const time = Date.now()
  const fromLibrary = libraryId !== undefined && String(attachment.attachmentId) === `library:${libraryId}`
  const events: SessionEvent[] = [{
    type: 'agent-rp/character-card-seed',
    seq: 0,
    time,
    data: {
      format: 0,
      source: fromLibrary
        ? { characterLibraryId: libraryId }
        : { attachmentConsumer: 'dsh-agent-rp', attachments: [attachment] },
      meta,
    },
  }]
  if (persona !== undefined) {
    events.push({
      type: 'agent-rp/persona-seed',
      seq: events.length,
      time,
      data: { format: 0, persona },
    })
  }
  if (renderedGreeting.trim() !== '') {
    const push = (event: SessionSeedEvent): void => {
      events.push({ ...event, seq: events.length } as SessionEvent)
    }
    push({ type: 'turn/start', time: time + 1, data: { turn: 1 } })
    push({ type: 'step/start', time: time + 1, data: { turn: 1, step: 1 } })
    push({
      type: 'assistant/message',
      time: time + 1,
      data: {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: renderedGreeting }],
          source: { provider: 'agent-rp-import', model: 'character-card' },
        }),
      },
      surfaceOp: 'append',
    })
    push({ type: 'step/end', time: time + 1, data: { turn: 1, step: 1 } })
    push({ type: 'turn/end', time: time + 1, data: { turn: 1, reason: { kind: 'completed' } } })
  }
  return Object.freeze(Session.create(SessionId('agent-rp-character-card-import-validation'), events).events.slice(0, events.length))
}
