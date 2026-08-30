/** Standalone SillyTavern World Info projection preserving Character Card source fields. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  CharacterCardVersion,
  ImportedCharacterCard,
  ImportedLorebookEntry,
  ImportedWorldInfo,
} from './import/types.ts'

function record(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function secondaryLogic(value: ImportedLorebookEntry['secondaryLogic']): number {
  if (value === 'and-any') return 0
  if (value === 'not-all') return 1
  if (value === 'not-any') return 2
  return 3
}

function position(entry: ImportedLorebookEntry): number {
  return entry.position === 'before_char' ? 0 : entry.position === 'at_depth' ? 4 : 1
}

function role(entry: ImportedLorebookEntry): number | undefined {
  return entry.injectionRole === 'system' ? 0
    : entry.injectionRole === 'user' ? 1 : entry.injectionRole === 'assistant' ? 2 : undefined
}

function characterBookEntry(
  raw: JsonValue | undefined,
  entry: ImportedLorebookEntry,
  version: CharacterCardVersion,
): Record<string, JsonValue> {
  const original = record(raw) ?? {}
  const extensions = record(original.extensions) ?? {}
  const injectionRole = role(entry)
  const hasAuthoredLabel = original.name !== undefined || original.comment !== undefined
  return {
    ...structuredClone(original),
    id: original.id ?? original.uid ?? entry.sourceId,
    keys: [...entry.keys],
    secondary_keys: [...entry.secondaryKeys],
    ...(hasAuthoredLabel || entry.name === undefined ? {} : { name: entry.name }),
    ...(hasAuthoredLabel || entry.comment === undefined ? {} : { comment: entry.comment }),
    content: entry.content,
    enabled: entry.enabled,
    insertion_order: entry.insertionOrder,
    selective: entry.selective,
    constant: entry.constant,
    case_sensitive: entry.caseSensitive,
    match_whole_words: entry.matchWholeWords,
    position: entry.position === 'before_char' ? 'before_char'
      : entry.position === 'at_depth' ? 4 : 'after_char',
    ...(entry.injectionDepth === undefined ? {} : { depth: entry.injectionDepth }),
    ...(injectionRole === undefined ? {} : { role: injectionRole }),
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
    ...(version === 3 || entry.useRegex ? { use_regex: entry.useRegex } : {}),
    extensions: {
      ...structuredClone(extensions),
      ...(entry.ignoreBudget ? { ignore_budget: true } : {}),
    },
  }
}

function characterBook(worldInfo: ImportedWorldInfo, version: CharacterCardVersion): JsonValue {
  const original = record(worldInfo.raw) ?? {}
  const rawEntries = Array.isArray(original.entries)
    ? original.entries
    : Object.values(record(original.entries) ?? {})
  return {
    ...structuredClone(original),
    ...(worldInfo.name === undefined ? {} : { name: worldInfo.name }),
    ...(worldInfo.lorebook.scanDepth === undefined ? {} : { scan_depth: worldInfo.lorebook.scanDepth }),
    ...(worldInfo.lorebook.tokenBudget === undefined ? {} : { token_budget: worldInfo.lorebook.tokenBudget }),
    recursive_scanning: worldInfo.lorebook.recursiveScanning,
    extensions: structuredClone(record(original.extensions) ?? {}),
    entries: worldInfo.lorebook.entries.map((entry, index) => characterBookEntry(rawEntries[index], entry, version)),
  }
}

function projectedEntry(raw: JsonValue | undefined, entry: ImportedLorebookEntry): Record<string, JsonValue> {
  const original = record(raw) ?? {}
  const extensions = record(original.extensions) ?? {}
  const injectionRole = role(entry)
  return {
    ...structuredClone(original),
    uid: original.uid ?? original.id ?? entry.sourceId,
    key: [...entry.keys],
    keysecondary: [...entry.secondaryKeys],
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.comment === undefined ? {} : { comment: entry.comment }),
    content: entry.content,
    disable: !entry.enabled,
    order: entry.insertionOrder,
    selective: entry.selective,
    constant: entry.constant,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    selectiveLogic: secondaryLogic(entry.secondaryLogic),
    position: position(entry),
    ...(entry.injectionDepth === undefined ? {} : { depth: entry.injectionDepth }),
    ...(injectionRole === undefined ? {} : { role: injectionRole }),
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
    ...(entry.scanDepth === undefined ? {} : { scanDepth: entry.scanDepth }),
    useRegex: entry.useRegex,
    extensions: {
      ...structuredClone(extensions),
      ...(entry.ignoreBudget ? { ignore_budget: true } : {}),
    },
  }
}

/** Convert a validated embedded book into deterministic standalone JSON bytes. */
export function embeddedWorldInfoAsset(card: ImportedCharacterCard): {
  readonly data: Uint8Array
  readonly filename: string
} | undefined {
  if (card.lorebook === undefined) return undefined
  const root = record(card.raw)
  const cardData = card.version === 1 ? root : record(root?.data)
  const original = record(cardData?.character_book) ?? {}
  const originalEntries = Array.isArray(original.entries) ? original.entries : []
  const worldInfo: Record<string, JsonValue> = {
    ...structuredClone(original),
    ...(card.lorebook.name === undefined ? {} : { name: card.lorebook.name }),
    ...(card.lorebook.scanDepth === undefined ? {} : { scan_depth: card.lorebook.scanDepth }),
    ...(card.lorebook.tokenBudget === undefined ? {} : { token_budget: card.lorebook.tokenBudget }),
    recursive_scanning: card.lorebook.recursiveScanning,
    entries: card.lorebook.entries.map((entry, index) => projectedEntry(originalEntries[index], entry)),
  }
  const name = (card.lorebook.name?.trim() || `${card.nickname?.trim() || card.name}的世界书`)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_')
    .slice(0, 200)
  return {
    data: new TextEncoder().encode(`${JSON.stringify(worldInfo, null, 2)}\n`),
    filename: `${name || '角色内置世界书'}.json`,
  }
}

/** Rebuild the exchange-format `character_book` from one bound World Info snapshot. */
export function characterCardWithWorldInfo(
  card: ImportedCharacterCard,
  worldInfo: ImportedWorldInfo | undefined,
): JsonValue {
  const raw = structuredClone(card.raw)
  const root = record(raw)
  const cardData = card.version === 1 ? root : record(root?.data)
  if (root === undefined || cardData === undefined) throw new Error('角色卡原始数据缺少可导出的角色字段')
  if (worldInfo === undefined) delete cardData.character_book
  else cardData.character_book = characterBook(worldInfo, card.version)
  return raw
}
