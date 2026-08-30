/** Standalone SillyTavern World Info JSON parser with bounded runtime behavior. */

import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  ImportedLorebookEntry,
  ImportedWorldInfo,
  LorebookEntryCompatibilityBlocker,
  WorldInfoImportDegradation,
} from './types.ts'

/** Maximum decoded JSON accepted from one standalone World Info file. */
export const MAX_WORLD_INFO_JSON_BYTES = 8 * 1024 * 1024

type JsonObject = { [key: string]: JsonValue }

function object(value: JsonValue | undefined, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value
}

function optionalString(value: JsonValue | undefined, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function boolean(value: JsonValue | undefined, path: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean or null`)
  return value
}

function finiteNumber(value: JsonValue | undefined, path: string, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number or null`)
  return value
}

function optionalFiniteNumber(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number or null`)
  return value
}

function stringArray(value: JsonValue | undefined, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${path} must be an array of strings`)
  return [...value] as string[]
}

function hasDecorator(content: string): boolean {
  return /(?:^|\n)@@@?[a-z_]+(?:\s|$)/imu.test(content)
}

function isDelimitedRegex(key: string): boolean {
  return /^\/[\s\S]+\/[gimsuy]*$/u.test(key)
}

function hasAdvancedMatching(entry: JsonObject): boolean {
  const filter = entry.characterFilter
  return entry.matchPersonaDescription === true
    || entry.matchCharacterDescription === true
    || entry.matchCharacterPersonality === true
    || entry.matchCharacterDepthPrompt === true
    || entry.matchScenario === true
    || entry.matchCreatorNotes === true
    || (typeof filter === 'object' && filter !== null && Object.keys(filter).length > 0)
}

function secondaryLogic(value: number, path: string): ImportedLorebookEntry['secondaryLogic'] {
  if (value === 0) return 'and-any'
  if (value === 1) return 'not-all'
  if (value === 2) return 'not-any'
  if (value === 3) return 'and-all'
  throw new Error(`${path} must be 0, 1, 2, or 3`)
}

function atDepthPlacement(
  depth: JsonValue | undefined,
  role: JsonValue | undefined,
): Pick<ImportedLorebookEntry, 'injectionDepth' | 'injectionRole'> | undefined {
  const injectionDepth = depth === undefined || depth === null ? 4 : depth
  const roleValue = role === undefined || role === null ? 0 : role
  const injectionRole = roleValue === 0 ? 'system'
    : roleValue === 1 ? 'user' : roleValue === 2 ? 'assistant' : undefined
  if (typeof injectionDepth !== 'number' || !Number.isSafeInteger(injectionDepth)
    || injectionDepth < 0 || injectionDepth > 10_000 || injectionRole === undefined) return undefined
  return { injectionDepth, injectionRole }
}

function parseEntry(
  value: JsonValue,
  id: string,
  degradations: Set<WorldInfoImportDegradation>,
): ImportedLorebookEntry {
  const path = `entries.${id}`
  const entry = object(value, path)
  const keys = stringArray(entry.key, `${path}.key`)
  const secondaryKeys = stringArray(entry.keysecondary, `${path}.keysecondary`)
  const content = optionalString(entry.content, `${path}.content`) ?? ''
  const position = finiteNumber(entry.position, `${path}.position`, 0)
  const probability = finiteNumber(entry.probability, `${path}.probability`, 100)
  const usesProbability = boolean(entry.useProbability, `${path}.useProbability`, true) && probability < 100
  const advancedMatching = hasAdvancedMatching(entry)
  const vectorized = entry.vectorized === true
  const timed = entry.sticky !== undefined && entry.sticky !== null
    || entry.cooldown !== undefined && entry.cooldown !== null
    || entry.delay !== undefined && entry.delay !== null
  const recursive = entry.excludeRecursion === true || entry.preventRecursion === true || entry.delayUntilRecursion === true
  const explicitRegex = boolean(entry.useRegex ?? entry.use_regex, `${path}.useRegex`, false)
  const useRegex = explicitRegex || [...keys, ...secondaryKeys].some(isDelimitedRegex)
  const decorated = hasDecorator(content)
  const uid = entry.uid
  if (uid !== undefined && uid !== null && typeof uid !== 'string' && typeof uid !== 'number') {
    throw new Error(`${path}.uid must be a string or number`)
  }
  const authoredName = optionalString(entry.name, `${path}.name`)
  const authoredComment = optionalString(entry.comment, `${path}.comment`)
  const displayName = authoredName ?? authoredComment
  const placement = position === 4 ? atDepthPlacement(entry.depth, entry.role) : undefined
  const validAtDepth = position !== 4 || placement !== undefined
  const supportedPosition = (position === 0 || position === 1 || position === 4) && validAtDepth
  if (decorated) degradations.add('entry-decorators')
  if (!supportedPosition) degradations.add('entry-unsupported-position')
  if (usesProbability) degradations.add('entry-probability')
  if (advancedMatching) degradations.add('entry-advanced-matching')
  if (vectorized) degradations.add('vector-matching')
  if (timed) degradations.add('timed-effects')
  if (recursive) degradations.add('lorebook-recursion')
  const compatibilityBlockers: LorebookEntryCompatibilityBlocker[] = [
    ...(usesProbability ? ['entry-probability' as const] : []),
    ...(advancedMatching ? ['entry-advanced-matching' as const] : []),
    ...(vectorized ? ['vector-matching' as const] : []),
    ...(timed ? ['timed-effects' as const] : []),
    ...(recursive ? ['lorebook-recursion' as const] : []),
    ...(!supportedPosition ? ['entry-unsupported-position' as const] : []),
  ]
  const scanDepth = optionalFiniteNumber(entry.scanDepth, `${path}.scanDepth`)
  if (scanDepth !== undefined && scanDepth < 0) throw new Error(`${path}.scanDepth must not be negative`)
  const priority = optionalFiniteNumber(entry.priority, `${path}.priority`)
  const extensions = entry.extensions === undefined ? undefined : object(entry.extensions, `${path}.extensions`)
  return {
    sourceId: uid === undefined || uid === null ? id : String(uid),
    ...(displayName === undefined ? {} : { name: displayName }),
    ...(authoredName === undefined || authoredComment === undefined ? {} : { comment: authoredComment }),
    keys,
    secondaryKeys,
    content,
    enabled: !boolean(entry.disable, `${path}.disable`, false),
    insertionOrder: finiteNumber(entry.order, `${path}.order`, 100),
    selective: boolean(entry.selective, `${path}.selective`, secondaryKeys.length > 0),
    constant: boolean(entry.constant, `${path}.constant`, false),
    caseSensitive: boolean(entry.caseSensitive, `${path}.caseSensitive`, false),
    matchWholeWords: boolean(entry.matchWholeWords, `${path}.matchWholeWords`, false),
    secondaryLogic: secondaryLogic(finiteNumber(entry.selectiveLogic, `${path}.selectiveLogic`, 0), `${path}.selectiveLogic`),
    ...(scanDepth === undefined ? {} : { scanDepth }),
    position: position === 0 ? 'before_char' : position === 4 ? 'at_depth' : 'after_char',
    ...(placement ?? {}),
    ...(priority === undefined ? {} : { priority }),
    ignoreBudget: boolean(extensions?.ignore_budget, `${path}.extensions.ignore_budget`, false),
    useRegex,
    hasDecorators: decorated,
    ...(compatibilityBlockers.length === 0 ? {} : { compatibilityBlockers }),
  }
}

/** Decode one standalone World Info JSON file without replacement characters. */
export function parseWorldInfoJsonBytes(data: Uint8Array): ImportedWorldInfo {
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/u, '')
  } catch (error) {
    throw new Error('World Info JSON must be valid UTF-8', { cause: error })
  }
  return parseWorldInfoJson(json)
}

/**
 * Parse one SillyTavern World Info JSON document.
 * @param json - UTF-8 JSON text from a standalone file.
 * @returns normalized lore plus exact parsed JSON.
 */
export function parseWorldInfoJson(json: string): ImportedWorldInfo {
  if (Buffer.byteLength(json, 'utf8') > MAX_WORLD_INFO_JSON_BYTES) {
    throw new Error(`World Info JSON exceeds ${MAX_WORLD_INFO_JSON_BYTES} bytes`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error('World Info is not valid JSON', { cause: error })
  }
  const raw = snapshotJsonValue(parsed) as JsonValue | undefined
  if (raw === undefined) throw new Error('World Info must contain lossless JSON')
  const root = object(raw, 'World Info')
  const entries = root.entries
  if (typeof entries !== 'object' || entries === null) throw new Error('World Info entries must be an object or array')
  const values = Array.isArray(entries) ? entries.map((entry, index) => [String(index), entry] as const) : Object.entries(entries)
  const degradations = new Set<WorldInfoImportDegradation>()
  const lorebookEntries = values.map(([id, entry]) => parseEntry(entry, id, degradations))
  const name = optionalString(root.name, 'World Info name')
  const scanDepth = optionalFiniteNumber(root.scan_depth, 'World Info scan_depth')
  const extensions = root.extensions === undefined ? undefined : object(root.extensions, 'World Info extensions')
  const extensionTokenBudget = optionalFiniteNumber(extensions?.token_budget, 'World Info extensions.token_budget')
  const tokenBudget = optionalFiniteNumber(root.token_budget, 'World Info token_budget') ?? extensionTokenBudget
  if (scanDepth !== undefined && scanDepth < 0) throw new Error('World Info scan_depth must not be negative')
  if (tokenBudget !== undefined && tokenBudget < 0) throw new Error('World Info token_budget must not be negative')
  return {
    format: 0,
    ...(name === undefined ? {} : { name }),
    lorebook: {
      ...(scanDepth === undefined ? {} : { scanDepth }),
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
      recursiveScanning: boolean(root.recursive_scanning, 'World Info recursive_scanning', false),
      entries: lorebookEntries,
    },
    degradations: [...degradations].sort(),
    raw,
  }
}
