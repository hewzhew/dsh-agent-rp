/** Strict, lossless parser for exported SillyTavern JSONL chats. */

import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  ImportedSillyTavernChat,
  ImportedSillyTavernChatHeader,
  ImportedSillyTavernChatMessage,
} from './types.ts'

/** Maximum UTF-8 input accepted as one SillyTavern chat export. */
export const MAX_SILLYTAVERN_CHAT_BYTES = 32 * 1024 * 1024

type JsonObject = { [key: string]: JsonValue }

function object(value: JsonValue, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value
}

function optionalString(value: JsonValue | undefined, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function optionalBoolean(value: JsonValue | undefined, path: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function optionalObject(value: JsonValue | undefined, path: string): JsonObject | undefined {
  if (value === undefined) return undefined
  return object(value, path)
}

function stringArray(value: JsonValue | undefined, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${path} must be an array of strings`)
  return [...value] as string[]
}

function optionalNonNegativeInteger(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative safe integer`)
  }
  return value
}

function parseLine(line: string, lineNumber: number): JsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    throw new Error(`SillyTavern chat line ${lineNumber} is not valid JSON`, { cause: error })
  }
  const raw = snapshotJsonValue(parsed) as JsonValue | undefined
  if (raw === undefined) throw new Error(`SillyTavern chat line ${lineNumber} must contain lossless JSON`)
  return raw
}

function parseHeader(raw: JsonValue, line: number): ImportedSillyTavernChatHeader {
  const header = object(raw, `SillyTavern chat line ${line}`)
  const metadata = header.chat_metadata
  if (metadata === undefined) throw new Error(`SillyTavern chat line ${line} must be the chat header with chat_metadata`)
  object(metadata, `SillyTavern chat line ${line}.chat_metadata`)
  const userName = optionalString(header.user_name, `SillyTavern chat line ${line}.user_name`)
  const characterName = optionalString(header.character_name, `SillyTavern chat line ${line}.character_name`)
  return {
    ...(userName === undefined ? {} : { userName }),
    ...(characterName === undefined ? {} : { characterName }),
    ...(header.create_date === undefined ? {} : { createDate: header.create_date }),
    chatMetadata: metadata,
    raw,
  }
}

function parseMessage(raw: JsonValue, line: number): ImportedSillyTavernChatMessage {
  const path = `SillyTavern chat line ${line}`
  const message = object(raw, path)
  const text = optionalString(message.mes, `${path}.mes`)
  if (text === undefined) throw new Error(`${path}.mes must be a string`)
  const name = optionalString(message.name, `${path}.name`)
  const isUser = optionalBoolean(message.is_user, `${path}.is_user`)
  const isSystem = optionalBoolean(message.is_system, `${path}.is_system`)
  if (isUser && isSystem) throw new Error(`${path} cannot be both a user and system message`)
  const extra = optionalObject(message.extra, `${path}.extra`)
  const narrator = extra?.type === 'narrator'
  const swipes = stringArray(message.swipes, `${path}.swipes`)
  const swipeId = optionalNonNegativeInteger(message.swipe_id, `${path}.swipe_id`)
  if (swipeId !== undefined && swipeId >= swipes.length) {
    throw new Error(`${path}.swipe_id ${swipeId} is outside ${swipes.length} swipe(s)`)
  }
  const kind = narrator ? 'narrator' : isUser ? 'user' : isSystem ? 'system' : 'assistant'
  return {
    line,
    ...(name === undefined ? {} : { name }),
    text,
    kind,
    swipes,
    ...(swipeId === undefined ? {} : { swipeId }),
    ...(extra === undefined ? {} : { extra }),
    raw,
  }
}

/** Decode one SillyTavern JSONL chat without replacement characters. */
export function parseSillyTavernChatBytes(data: Uint8Array): ImportedSillyTavernChat {
  if (data.byteLength > MAX_SILLYTAVERN_CHAT_BYTES) {
    throw new Error(`SillyTavern chat exceeds ${MAX_SILLYTAVERN_CHAT_BYTES} bytes`)
  }
  let jsonl: string
  try {
    jsonl = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/u, '')
  } catch (error) {
    throw new Error('SillyTavern chat must be valid UTF-8', { cause: error })
  }
  return parseSillyTavernChat(jsonl)
}

/**
 * Parse one SillyTavern JSONL chat while retaining every source row.
 * @param jsonl - decoded JSONL text from a SillyTavern export.
 * @returns the header and ordered chat messages; ordinary system rows remain inert.
 */
export function parseSillyTavernChat(jsonl: string): ImportedSillyTavernChat {
  if (Buffer.byteLength(jsonl, 'utf8') > MAX_SILLYTAVERN_CHAT_BYTES) {
    throw new Error(`SillyTavern chat exceeds ${MAX_SILLYTAVERN_CHAT_BYTES} bytes`)
  }
  const rows = jsonl.split(/\r?\n/u)
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(row => row.text.trim().length > 0)
  const first = rows[0]
  if (first === undefined) throw new Error('SillyTavern chat is empty')
  const header = parseHeader(parseLine(first.text, first.line), first.line)
  const messages = rows.slice(1).map(row => parseMessage(parseLine(row.text, row.line), row.line))
  return { format: 0, header, messages }
}
