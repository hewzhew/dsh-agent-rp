/** Convert a parsed SillyTavern chat into validated DSH Session history. */

import {
  createAssistantMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  Session,
  SessionId,
  SessionSeq,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { FileAttachmentRef } from './session-character.ts'
import { decodeCharacterLibraryLaunch } from './session-character.ts'
import {
  decodeSillyTavernChatCommandRecord,
  type SillyTavernChatCommandRecord,
} from '../sillytavern-chat-protocol.ts'
import type { ImportedSillyTavernChat, ImportedSillyTavernChatMessage } from './types.ts'
import { sessionEvents } from '../session-events.ts'

/** Durable import metadata that points back to the original JSONL attachment. */
export interface SillyTavernChatImportRecord {
  readonly format: 0
  readonly source: {
    readonly attachmentConsumer: 'dsh-agent-rp'
    readonly attachments: readonly [FileAttachmentRef]
  }
  readonly header: JsonValue
  readonly messages: readonly {
    readonly line: number
    readonly kind: ImportedSillyTavernChatMessage['kind']
    readonly name?: string
    readonly swipes: readonly string[]
    readonly swipeId?: number
    readonly extra?: JsonValue
  }[]
}

/** Character identity recovered from one imported SillyTavern chat header. */
export interface SillyTavernChatIdentity {
  readonly characterName: string
  readonly userName?: string
}

function usableIdentityName(value: string | undefined): string | undefined {
  const name = value?.trim()
  return name === undefined || name === '' || name.toLowerCase() === 'unused' ? undefined : name
}

/** Recover names from current SillyTavern exports whose legacy header names are `unused`. */
export function resolveSillyTavernChatIdentity(
  chat: ImportedSillyTavernChat,
): { readonly characterName?: string; readonly userName?: string } {
  const characterName = usableIdentityName(chat.header.characterName)
    ?? chat.messages.find(message => message.kind === 'assistant' && usableIdentityName(message.name) !== undefined)?.name?.trim()
  const userName = usableIdentityName(chat.header.userName)
    ?? chat.messages.find(message => message.kind === 'user' && usableIdentityName(message.name) !== undefined)?.name?.trim()
  return {
    ...(characterName === undefined ? {} : { characterName }),
    ...(userName === undefined ? {} : { userName }),
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable SillyTavern provenance; the original file remains authoritative. */
    'agent-rp/sillytavern-chat-import': SillyTavernChatImportRecord
  }
}

type SessionSeedEvent = SessionEvent extends infer Event
  ? Event extends SessionEvent ? Omit<Event, 'seq'> : never
  : never

function eventTime(message: ImportedSillyTavernChatMessage, fallback: number): number {
  if (typeof message.raw !== 'object' || message.raw === null || Array.isArray(message.raw)) return fallback
  const date = message.raw.send_date
  if (typeof date === 'number' && Number.isSafeInteger(date) && date >= 0) return date
  if (typeof date !== 'string') return fallback
  const parsed = Date.parse(date)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function metadata(chat: ImportedSillyTavernChat, attachment: FileAttachmentRef): SillyTavernChatImportRecord {
  return {
    format: 0,
    source: { attachmentConsumer: 'dsh-agent-rp', attachments: [attachment] },
    header: chat.header.raw,
    messages: chat.messages.map(message => ({
      line: message.line,
      kind: message.kind,
      ...(message.name === undefined ? {} : { name: message.name }),
      swipes: message.swipes,
      ...(message.swipeId === undefined ? {} : { swipeId: message.swipeId }),
      ...(message.extra === undefined ? {} : { extra: message.extra }),
    })),
  }
}

/**
 * Read the latest usable character identity attached to an imported chat Session.
 * @param events - current Session history.
 * @returns imported character and optional user names, when the chat header names a character.
 */
export function readSillyTavernChatIdentity(
  events: readonly SessionEvent[],
): SillyTavernChatIdentity | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'command/done' && event.data.kind === 'success') {
      let command: SillyTavernChatCommandRecord | undefined
      try {
        command = decodeSillyTavernChatCommandRecord(event.data.text)
          ?? decodeCharacterLibraryLaunch(event.data.text)?.chat
      } catch {
        continue
      }
      if (command !== undefined && command.characterName !== undefined) {
        return {
          characterName: command.characterName,
          ...(command.userName === undefined ? {} : { userName: command.userName }),
        }
      }
      continue
    }
    if (event?.type !== 'agent-rp/sillytavern-chat-import') continue
    const header = event.data.header
    if (typeof header !== 'object' || header === null || Array.isArray(header)) return undefined
    const headerCharacterName = typeof header.character_name === 'string' ? header.character_name : undefined
    const headerUserName = typeof header.user_name === 'string' ? header.user_name : undefined
    const characterName = usableIdentityName(headerCharacterName)
      ?? event.data.messages.find(message => message.kind === 'assistant'
        && usableIdentityName(message.name) !== undefined)?.name?.trim()
    if (characterName === undefined) return undefined
    const userName = usableIdentityName(headerUserName)
      ?? event.data.messages.find(message => message.kind === 'user'
        && usableIdentityName(message.name) !== undefined)?.name?.trim()
    return {
      characterName,
      ...(userName === undefined ? {} : { userName }),
    }
  }
  return undefined
}

function appendMessageEvents(
  events: SessionEvent[],
  message: ImportedSillyTavernChatMessage,
  turn: number,
  time: number,
): void {
  const push = (event: SessionSeedEvent): void => {
    events.push({ ...event, seq: SessionSeq(events.length) } as SessionEvent)
  }
  push({ type: 'turn/start', time, data: { turn } })
  push({ type: 'step/start', time, data: { turn, step: 1 } })
  if (message.kind === 'assistant') {
    push({
      type: 'assistant/message',
      time,
      data: {
        turn,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: message.text }],
          source: { provider: 'sillytavern-import', model: 'history' },
        }),
      },
      surfaceOp: 'append',
    })
  } else {
    push({
      type: 'user/message',
      time,
      data: createUserMessage({
        content: [{ type: 'text', text: message.text }],
        source: message.kind === 'user'
          ? { kind: 'user' }
          : { kind: 'plugin', plugin: 'dsh-agent-rp', form: 'recall' },
      }),
      surfaceOp: 'append',
    })
  }
  push({ type: 'step/end', time, data: { turn, step: 1 } })
  push({ type: 'turn/end', time, data: { turn, reason: { kind: 'completed' } } })
}

/**
 * Build a balanced Session seed from one parsed SillyTavern chat.
 * @param chat - validated lossless JSONL projection.
 * @param attachment - Host-stored original JSONL file owned by the imported Session.
 * @returns a frozen seed accepted by the native Session constructor.
 */
export function createSillyTavernChatSeed(
  chat: ImportedSillyTavernChat,
  attachment: FileAttachmentRef,
): readonly SessionEvent[] {
  if (!/\.jsonl$/iu.test(attachment.name)) throw new Error('SillyTavern chat source must be a .jsonl file')
  const events: SessionEvent[] = [{
    type: 'agent-rp/sillytavern-chat-import',
    seq: SessionSeq(0),
    time: Date.now(),
    ignorable: true,
    data: metadata(chat, attachment),
  }]
  let turn = 0
  let fallbackTime = events[0]!.time
  for (const message of chat.messages) {
    if (message.kind === 'system' || message.text.length === 0) continue
    turn += 1
    fallbackTime += 1
    appendMessageEvents(events, message, turn, eventTime(message, fallbackTime))
  }
  const validated = Session.create(SessionId('agent-rp-sillytavern-import-validation'), events)
  return Object.freeze(sessionEvents(validated).slice(0, events.length))
}
