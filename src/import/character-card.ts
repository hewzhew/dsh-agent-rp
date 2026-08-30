/** Character Card V1/V2/V3 JSON parser with lossless raw preservation. */

import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  CharacterCardVersion,
  CharacterImportDegradation,
  ImportedCharacterCard,
  ImportedCharacterAsset,
  ImportedCharacterFrontend,
  ImportedLorebook,
  ImportedLorebookEntry,
} from './types.ts'
import { parseRegexScript } from './regex-script.ts'
import { parseTavernHelperScripts, tavernHelperExtension, tavernHelperVariables } from './tavern-helper.ts'

/** Maximum decoded card definition accepted independently from transport media. */
export const MAX_CHARACTER_CARD_JSON_BYTES = 8 * 1024 * 1024

/** Maximum complete PNG, JSON, or CHARX transport accepted by the local library. */
export const MAX_CHARACTER_CARD_FILE_BYTES = 64 * 1024 * 1024

function characterCardSizeError(): Error {
  return new Error(`角色卡定义内容过大（最多 ${MAX_CHARACTER_CARD_JSON_BYTES / (1024 * 1024)} MiB；PNG/CHARX 图片不计入）`)
}

/** Reject an oversized decoded card definition before UTF-8 or JSON allocation. */
export function assertCharacterCardJsonSize(bytes: number): void {
  if (bytes > MAX_CHARACTER_CARD_JSON_BYTES) throw characterCardSizeError()
}

function jsonStringBytes(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
      || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2
    } else if (code < 0x20) {
      bytes += 6
    } else if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else if (code >= 0xd800 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
    if (bytes > MAX_CHARACTER_CARD_JSON_BYTES) throw characterCardSizeError()
  }
  return bytes
}

function assertCharacterCardValueSize(value: JsonValue): void {
  let bytes = 0
  const add = (amount: number): void => {
    bytes += amount
    if (bytes > MAX_CHARACTER_CARD_JSON_BYTES) throw characterCardSizeError()
  }
  const visit = (item: JsonValue): void => {
    if (item === null) return add(4)
    if (typeof item === 'string') return add(jsonStringBytes(item))
    if (typeof item === 'number') return add(Buffer.byteLength(JSON.stringify(item) ?? 'null', 'utf8'))
    if (typeof item === 'boolean') return add(item ? 4 : 5)
    if (Array.isArray(item)) {
      add(2 + Math.max(0, item.length - 1))
      for (const child of item) visit(child)
      return
    }
    const entries = Object.entries(item)
    add(2 + Math.max(0, entries.length - 1))
    for (const [key, child] of entries) {
      add(jsonStringBytes(key) + 1)
      visit(child)
    }
  }
  visit(value)
}

/** Decode one standalone Character Card JSON file without replacement characters. */
export function parseCharacterCardJsonBytes(data: Uint8Array): ImportedCharacterCard {
  assertCharacterCardJsonSize(data.byteLength)
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/u, '')
  } catch (error) {
    throw new Error('Character Card JSON must be valid UTF-8', { cause: error })
  }
  return parseCharacterCardJson(json)
}

type JsonObject = { [key: string]: JsonValue }

function object(value: JsonValue | undefined, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value
}

function optionalObject(value: JsonValue | undefined, path: string): JsonObject | undefined {
  if (value === undefined) return undefined
  return object(value, path)
}

function requiredString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function optionalString(value: JsonValue | undefined, path: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, path)
}

function lenientOptionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalBoolean(value: JsonValue | undefined, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function optionalFiniteNumber(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function stringArray(value: JsonValue | undefined, path: string, fallback: readonly string[] = []): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${path} must be an array of strings`)
  }
  return [...value] as string[]
}

function parseFrontend(data: JsonObject): ImportedCharacterFrontend {
  const extensions = optionalObject(data.extensions, 'data.extensions')
  const rawRegex = extensions?.regex_scripts
  const regexScripts = rawRegex === undefined ? [] : (() => {
    if (!Array.isArray(rawRegex)) throw new Error('data.extensions.regex_scripts must be an array')
    return rawRegex.map((value, index) => parseRegexScript(value, `data.extensions.regex_scripts[${index}]`))
  })()
  const helper = extensions?.tavern_helper
  const parsedHelper = helper === undefined ? undefined : tavernHelperExtension(helper, 'data.extensions.tavern_helper')
  const helperScripts = parsedHelper === undefined ? [] : (() => {
    if (parsedHelper.value.scripts === undefined) return []
    if (!Array.isArray(parsedHelper.value.scripts)) throw new Error('data.extensions.tavern_helper.scripts must be an array')
    return parseTavernHelperScripts(parsedHelper.value.scripts, 'data.extensions.tavern_helper.scripts')
  })()
  const helperVariables = tavernHelperVariables(parsedHelper?.value.variables)
  return {
    regexScripts,
    tavernHelperScriptNames: helperScripts.filter(script => script.enabled).map(script => script.name),
    tavernHelperScripts: helperScripts,
    tavernHelperVariables: helperVariables,
    ...(parsedHelper === undefined ? {} : { tavernHelper: {
      format: parsedHelper.format,
      scriptCount: helperScripts.length,
      enabledScriptCount: helperScripts.filter(script => script.enabled).length,
      variableCount: Object.keys(helperVariables).length,
      ignoredFieldCount: parsedHelper.ignoredFieldCount,
    } }),
  }
}

function parseAssets(value: JsonValue | undefined): ImportedCharacterAsset[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('data.assets must be an array')
  return value.map((item, index) => {
    const asset = object(item, `data.assets[${index}]`)
    return {
      type: requiredString(asset.type, `data.assets[${index}].type`),
      uri: requiredString(asset.uri, `data.assets[${index}].uri`),
      name: requiredString(asset.name, `data.assets[${index}].name`),
      ext: requiredString(asset.ext, `data.assets[${index}].ext`),
    }
  })
}

function hasDecorator(content: string): boolean {
  return /(?:^|\n)@@@?[a-z_]+(?:\s|$)/imu.test(content)
}

function lorebookPosition(
  value: JsonValue | undefined,
  depthValue: JsonValue | undefined,
  roleValue: JsonValue | undefined,
): {
  readonly position: ImportedLorebookEntry['position']
  readonly unsupported: boolean
  readonly injectionDepth?: number
  readonly injectionRole?: NonNullable<ImportedLorebookEntry['injectionRole']>
} {
  if (value === undefined || value === null || value === 'after_char' || value === 1) {
    return { position: 'after_char', unsupported: false }
  }
  if (value === 'before_char' || value === 0) return { position: 'before_char', unsupported: false }
  if (value === 4) {
    const injectionDepth = depthValue === undefined || depthValue === null ? 4 : depthValue
    const role = roleValue === undefined || roleValue === null ? 0 : roleValue
    const injectionRole = role === 0 ? 'system' : role === 1 ? 'user' : role === 2 ? 'assistant' : undefined
    const supported = typeof injectionDepth === 'number' && Number.isSafeInteger(injectionDepth)
      && injectionDepth >= 0 && injectionDepth <= 10_000 && injectionRole !== undefined
    return {
      position: 'at_depth',
      unsupported: !supported,
      ...(supported ? { injectionDepth, injectionRole } : {}),
    }
  }
  return { position: 'after_char', unsupported: true }
}

function parseLorebookEntry(value: JsonValue, index: number, version: CharacterCardVersion): ImportedLorebookEntry {
  const path = `data.character_book.entries[${index}]`
  const entry = object(value, path)
  const extensions = object(entry.extensions, `${path}.extensions`)
  const insertionOrder = optionalFiniteNumber(entry.insertion_order, `${path}.insertion_order`)
  if (insertionOrder === undefined) throw new Error(`${path}.insertion_order must be a finite number`)
  const enabled = optionalBoolean(entry.enabled, `${path}.enabled`)
  if (enabled === undefined) throw new Error(`${path}.enabled must be a boolean`)
  const priority = optionalFiniteNumber(entry.priority, `${path}.priority`)
  const useRegex = optionalBoolean(entry.use_regex, `${path}.use_regex`) ?? false
  if (version === 3 && entry.use_regex === undefined) throw new Error(`${path}.use_regex must be a boolean`)
  const extensionPosition = extensions.position
  const normalizedPosition = lorebookPosition(
    extensionPosition ?? entry.position,
    extensions.depth ?? entry.depth,
    extensions.role ?? entry.role,
  )
  const content = requiredString(entry.content, `${path}.content`)
  const sourceIdValue = entry.id
  if (sourceIdValue !== undefined && sourceIdValue !== null
    && typeof sourceIdValue !== 'string' && typeof sourceIdValue !== 'number') {
    throw new Error(`${path}.id must be a string or number`)
  }
  const name = optionalString(entry.name, `${path}.name`)
  const comment = optionalString(entry.comment, `${path}.comment`)
  return {
    sourceId: sourceIdValue === undefined || sourceIdValue === null ? String(index) : String(sourceIdValue),
    ...(name === undefined ? {} : { name }),
    ...(comment === undefined ? {} : { comment }),
    keys: stringArray(entry.keys, `${path}.keys`),
    secondaryKeys: stringArray(entry.secondary_keys, `${path}.secondary_keys`),
    content,
    enabled,
    insertionOrder,
    selective: optionalBoolean(entry.selective, `${path}.selective`) ?? false,
    constant: optionalBoolean(entry.constant, `${path}.constant`) ?? false,
    caseSensitive: optionalBoolean(entry.case_sensitive, `${path}.case_sensitive`) ?? false,
    matchWholeWords: optionalBoolean(entry.match_whole_words, `${path}.match_whole_words`) ?? false,
    secondaryLogic: 'and-any',
    position: normalizedPosition.position,
    ...(normalizedPosition.injectionDepth === undefined ? {} : { injectionDepth: normalizedPosition.injectionDepth }),
    ...(normalizedPosition.injectionRole === undefined ? {} : { injectionRole: normalizedPosition.injectionRole }),
    ...(priority === undefined ? {} : { priority }),
    useRegex,
    hasDecorators: hasDecorator(content),
    ...(normalizedPosition.unsupported
      ? { compatibilityBlockers: ['entry-unsupported-position' as const] }
      : {}),
    ignoreBudget: optionalBoolean(extensions.ignore_budget, `${path}.extensions.ignore_budget`) ?? false,
  }
}

function parseLorebook(value: JsonValue | undefined, version: CharacterCardVersion): ImportedLorebook | undefined {
  if (value === undefined) return undefined
  const book = object(value, 'data.character_book')
  optionalObject(book.extensions, 'data.character_book.extensions')
  if (!Array.isArray(book.entries)) throw new Error('data.character_book.entries must be an array')
  const scanDepth = optionalFiniteNumber(book.scan_depth, 'data.character_book.scan_depth')
  const extensions = optionalObject(book.extensions, 'data.character_book.extensions')
  const extensionTokenBudget = optionalFiniteNumber(extensions?.token_budget, 'data.character_book.extensions.token_budget')
  const tokenBudget = optionalFiniteNumber(book.token_budget, 'data.character_book.token_budget') ?? extensionTokenBudget
  if (scanDepth !== undefined && scanDepth < 0) throw new Error('data.character_book.scan_depth must not be negative')
  if (tokenBudget !== undefined && tokenBudget < 0) throw new Error('data.character_book.token_budget must not be negative')
  const name = optionalString(book.name, 'data.character_book.name')
  return {
    ...(name === undefined ? {} : { name }),
    ...(scanDepth === undefined ? {} : { scanDepth }),
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    recursiveScanning: optionalBoolean(book.recursive_scanning, 'data.character_book.recursive_scanning') ?? false,
    entries: book.entries.map((entry, index) => parseLorebookEntry(entry, index, version)),
  }
}

function cardVersion(root: JsonObject): { version: CharacterCardVersion; specVersion: string; data: JsonObject } {
  if (root.spec === 'chara_card_v3') {
    const specVersion = requiredString(root.spec_version, 'spec_version')
    const numeric = Number.parseFloat(specVersion)
    if (!Number.isFinite(numeric) || numeric < 3) throw new Error('spec_version must identify Character Card V3')
    return { version: 3, specVersion, data: object(root.data, 'data') }
  }
  if (root.spec === 'chara_card_v2') {
    const specVersion = requiredString(root.spec_version, 'spec_version')
    if (specVersion !== '2.0') throw new Error('spec_version must be 2.0 for Character Card V2')
    return { version: 2, specVersion, data: object(root.data, 'data') }
  }
  if (root.spec !== undefined) throw new Error(`unsupported character card spec ${JSON.stringify(root.spec)}`)
  return { version: 1, specVersion: '1.0', data: root }
}

function validateVersionFields(data: JsonObject, version: CharacterCardVersion): void {
  if (version === 1) return
  for (const field of ['creator_notes', 'creator', 'character_version'] as const) {
    requiredString(data[field], `data.${field}`)
  }
  for (const field of ['system_prompt', 'post_history_instructions'] as const) {
    if (version === 2) requiredString(data[field], `data.${field}`)
    else optionalString(data[field], `data.${field}`)
  }
  stringArray(data.alternate_greetings, 'data.alternate_greetings')
  stringArray(data.tags, 'data.tags')
  object(data.extensions, 'data.extensions')
  if (version === 3) stringArray(data.group_only_greetings, 'data.group_only_greetings')
}

function degradationSet(
  data: JsonObject,
  version: CharacterCardVersion,
  specVersion: string,
  lorebook: ImportedLorebook | undefined,
): CharacterImportDegradation[] {
  const result = new Set<CharacterImportDegradation>()
  if (version === 3 && Number.parseFloat(specVersion) > 3) result.add('future-card-version')
  const assets = data.assets
  if (Array.isArray(assets) && assets.length > 0) {
    result.add('character-assets')
    if (assets.some(asset => typeof asset === 'object' && asset !== null && !Array.isArray(asset)
      && typeof asset.uri === 'string' && /^(?:https?:|data:)/iu.test(asset.uri))) {
      result.add('remote-assets')
    }
  }
  if ((stringArray(data.group_only_greetings, 'data.group_only_greetings')).length > 0) result.add('group-greetings')
  if (lorebook?.recursiveScanning === true) result.add('lorebook-recursion')
  if (lorebook?.entries.some(entry => entry.hasDecorators) === true) result.add('lorebook-decorators')
  if (lorebook?.entries.some(entry => entry.compatibilityBlockers?.includes('entry-unsupported-position')) === true) {
    result.add('lorebook-position')
  }
  return [...result].sort()
}

/**
 * Parse one decoded Character Card JSON document.
 * @param json - UTF-8 JSON text from a JSON file or PNG metadata.
 * @returns a normalized runtime card plus its exact parsed JSON value.
 */
export function parseCharacterCardJson(json: string): ImportedCharacterCard {
  assertCharacterCardJsonSize(Buffer.byteLength(json, 'utf8'))
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error('character card is not valid JSON', { cause: error })
  }
  const raw = snapshotJsonValue(parsed) as JsonValue | undefined
  if (raw === undefined) throw new Error('character card must contain lossless JSON')
  return normalizeCharacterCardValue(raw)
}

/**
 * Validate one already-decoded JSON value without serializing and parsing it again.
 * @param raw - Lossless JSON value from a trusted JSON or durable Session decoder.
 * @returns a normalized runtime card retaining the supplied JSON value.
 */
export function parseCharacterCardValue(raw: JsonValue): ImportedCharacterCard {
  assertCharacterCardValueSize(raw)
  return normalizeCharacterCardValue(raw)
}

function normalizeCharacterCardValue(raw: JsonValue): ImportedCharacterCard {
  const root = object(raw, 'character card')
  const { version, specVersion, data } = cardVersion(root)
  validateVersionFields(data, version)
  const lorebook = parseLorebook(data.character_book, version)
  // Nickname is optional display metadata. Several otherwise valid exporters
  // emit null or another placeholder here, so it must never veto the card.
  const nickname = lenientOptionalString(data.nickname)
  const alternateGreetings = stringArray(data.alternate_greetings, 'data.alternate_greetings')
  const systemPrompt = optionalString(data.system_prompt, 'data.system_prompt') ?? ''
  const postHistoryInstructions = optionalString(data.post_history_instructions, 'data.post_history_instructions') ?? ''
  const frontend = parseFrontend(data)
  const assets = parseAssets(data.assets)
  return {
    format: 0,
    version,
    specVersion,
    name: requiredString(data.name, 'data.name'),
    ...(nickname === undefined ? {} : { nickname }),
    description: requiredString(data.description, 'data.description'),
    personality: requiredString(data.personality, 'data.personality'),
    scenario: requiredString(data.scenario, 'data.scenario'),
    firstMessage: requiredString(data.first_mes, 'data.first_mes'),
    messageExample: requiredString(data.mes_example, 'data.mes_example'),
    alternateGreetings,
    systemPrompt,
    postHistoryInstructions,
    assets,
    ...(lorebook === undefined ? {} : { lorebook }),
    frontend,
    degradations: degradationSet(data, version, specVersion, lorebook),
    raw,
  }
}
