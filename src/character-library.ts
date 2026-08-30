/** Host-owned reusable Character Card library retaining original transport bytes. */

import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CharacterImportTransport } from './import/session-character.ts'
import type {
  ImportedCharacterCard, ImportedLorebookEntry, ImportedRegexScript, TavernHelperImportSummary,
} from './import/types.ts'
import { parseCharacterCardJson, parseCharacterCardJsonBytes, parseCharacterCardValue } from './import/character-card.ts'
import { parseRegexScript } from './import/regex-script.ts'
import { readCharacterCardPng } from './import/png.ts'
import { charxAvatar, charxImageAssets, parseCharx, readCharxImageAsset } from './import/charx.ts'
import { AI_OUTPUT_PLACEMENT, renderCharacterDisplay, summarizeCharacterRegexScript } from './frontend-regex.ts'
import {
  CHARACTER_REMOTE_RESOURCE_TYPES,
  type CharacterLibraryDetail, type CharacterLibraryDisplayExtension, type CharacterLibraryEditableContent,
  type CharacterLibraryImage, type CharacterLibraryRegexScript,
  type CharacterLibraryImportResult, type CharacterLibrarySummary, type CharacterLibraryWorldInfo,
  type CharacterLibraryWorldBinding, type CharacterWorldBindingUpdateRequest,
  type CharacterLibraryWorldInfoEntry, type CharacterLibraryWorldInfoPage, type CharacterRemoteResourceApproval,
  type CharacterRemoteResourcePolicy, type CharacterRemoteResourceType,
} from './character-library-protocol.ts'
import {
  cardRemoteResourceApprovalKey, cardRemoteResourceRequirements,
  characterRemoteResourceOrigin, isCharacterRemoteResourceType,
} from './card-remote-resource.ts'
import {
  CharacterWorldBindingStore,
  type CharacterWorldBinding,
} from './character-world-binding-store.ts'
import { characterCardWithWorldInfo, embeddedWorldInfoAsset } from './embedded-world-info.ts'
import { WorldInfoLibrary } from './world-info-library.ts'

const META_SUFFIX = '.meta.json'
const OVERLAY_SUFFIX = '.overlay.json'
const ID_PATTERN = /^card-[a-f0-9]{32}$/u
const DISPLAY_EXTENSION_ID_PATTERN = /^display-[a-f0-9]{32}$/u
const MAX_DISPLAY_EXTENSION_BYTES = 256 * 1024
const MAX_REMOTE_RESOURCE_APPROVALS = 128
const MAX_PARSED_CACHE_ENTRIES = 8
const MAX_PARSED_CACHE_SOURCE_BYTES = 64 * 1024 * 1024

interface StoredCharacterMetadata {
  readonly format: 0
  readonly id: string
  readonly originalFilename: string
  readonly mediaType: string
  readonly transport: 'png' | 'json' | 'charx'
  readonly metadataKeyword?: 'ccv3' | 'chara'
  readonly bytes: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly archivedAt?: number
  readonly index?: StoredCharacterIndex
}

interface StoredCharacterIndex {
  readonly format: 0
  readonly name: string
  readonly displayName: string
  readonly cardVersion: 1 | 2 | 3
  readonly greetingCount: number
  readonly worldInfoCount: number
  readonly regexScriptCount: number
  readonly avatarAvailable: boolean
  readonly imageAssetCount: number
  readonly tavernHelper?: TavernHelperImportSummary
}

interface StoredTextReplacement {
  readonly from: string
  readonly to: string
  readonly expectedMatches: number
}

interface StoredDisplayExtension {
  readonly id: string
  readonly originalFilename: string
  readonly importedAt: number
  readonly enabled: boolean
  readonly remoteImageOrigins: readonly string[]
  readonly replacedCardRegexIndices: readonly number[]
  readonly script: ImportedRegexScript
}

interface StoredCharacterOverlay {
  readonly format: 0
  readonly revision: number
  readonly content?: CharacterLibraryEditableContent
  readonly regexOverrides: readonly StoredRegexOverride[]
  readonly textReplacements: readonly StoredTextReplacement[]
  readonly displayExtensions: readonly StoredDisplayExtension[]
  readonly approvedRemoteResources: readonly CharacterRemoteResourceApproval[]
  readonly remoteResourcePolicy: CharacterRemoteResourcePolicy
}

interface StoredRegexOverride {
  readonly index: number
  readonly enabled: boolean
}

/** Browser-selected standalone SillyTavern display regex. */
export interface CharacterDisplayExtensionImport {
  readonly data: Uint8Array
  readonly filename: string
  readonly approvedImageOrigins: readonly string[]
}

/** Original validated card submitted to the reusable library. */
export interface CharacterLibraryImport {
  readonly data: Uint8Array
  readonly filename?: string
  readonly mediaType?: string
  readonly card: ImportedCharacterCard
  readonly transport: CharacterImportTransport
}

/** Raw local file selected from the browser-owned character library. */
export interface CharacterLibraryFileImport {
  readonly data: Uint8Array
  readonly filename: string
  readonly mediaType?: string
}

/** Filesystem location override used by focused checks and portable deployments. */
export interface CharacterLibraryOptions {
  readonly root?: string
  readonly worldInfoLibrary?: WorldInfoLibrary
  readonly worldBindings?: CharacterWorldBindingStore
}

interface CharacterLibraryAsset {
  readonly summary: CharacterLibrarySummary
  readonly originalFilename: string
  readonly mediaType: string
  readonly data: Uint8Array
}

export interface CharacterLibraryExportAsset {
  readonly filename: string
  readonly mediaType: string
  readonly data: Uint8Array
}

/** Parsed Host-only contents behind one reusable library id. */
export interface ResolvedCharacterLibraryEntry {
  readonly detail: CharacterLibraryDetail
  readonly card: ImportedCharacterCard
  readonly transport: CharacterImportTransport
  readonly source: {
    readonly bytes: number
    readonly originalFilename: string
    readonly mediaType: string
  }
  readonly worldBinding?: CharacterWorldBinding
}

export interface CharacterLibraryAvatar {
  readonly mediaType: string
  readonly data: Uint8Array
}

export interface CharacterLibraryImageAsset extends CharacterLibraryImage {
  readonly data: Uint8Array
}

interface ParsedStoredCharacter {
  readonly card: ImportedCharacterCard
  readonly sourceCard: ImportedCharacterCard
  readonly overlay: StoredCharacterOverlay
  readonly avatarAvailable: boolean
  readonly images: readonly CharacterLibraryImage[]
}

interface CachedParsedStoredCharacter {
  readonly signature: string
  readonly sourceBytes: number
  readonly parsed: ParsedStoredCharacter
}

interface RegularFileVersion {
  readonly version: string
  readonly bytes: number
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function regularFileVersion(path: string): RegularFileVersion {
  const file = statSync(path, { bigint: true })
  const bytes = Number(file.size)
  if (!file.isFile() || !Number.isSafeInteger(bytes)) throw new Error('character library path is not a regular file')
  return {
    version: `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`,
    bytes,
  }
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

function editableContent(value: unknown, label: string): CharacterLibraryEditableContent {
  const content = object(value, label)
  const fields = ['name', 'description', 'personality', 'scenario', 'messageExample', 'firstMessage'] as const
  for (const field of fields) {
    if (typeof content[field] !== 'string') throw new Error(`${label}.${field} must be a string`)
  }
  const name = (content.name as string).trim()
  if (name === '' || name.length > 200) throw new Error('角色名称不能为空且不能超过 200 个字符')
  if (!Array.isArray(content.alternateGreetings)
    || content.alternateGreetings.length > 256
    || content.alternateGreetings.some(greeting => typeof greeting !== 'string')) {
    throw new Error('备选开场必须是最多 256 条文字')
  }
  return {
    name,
    description: content.description as string,
    personality: content.personality as string,
    scenario: content.scenario as string,
    messageExample: content.messageExample as string,
    firstMessage: content.firstMessage as string,
    alternateGreetings: [...content.alternateGreetings] as string[],
  }
}

function characterContent(card: ImportedCharacterCard): CharacterLibraryEditableContent {
  return {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    messageExample: card.messageExample,
    firstMessage: card.firstMessage,
    alternateGreetings: [...card.alternateGreetings],
  }
}

function parseTavernHelperSummary(value: unknown): TavernHelperImportSummary | undefined {
  if (value === undefined) return undefined
  const summary = object(value, 'character library index Tavern Helper summary')
  if (summary.format !== 'object' && summary.format !== 'entries') {
    throw new Error('character library index Tavern Helper format is invalid')
  }
  const expectedScriptCount = summary.expectedScriptCount === undefined
    ? undefined
    : nonNegativeInteger(summary.expectedScriptCount, 'character library index expected script count')
  return {
    format: summary.format,
    scriptCount: nonNegativeInteger(summary.scriptCount, 'character library index script count'),
    enabledScriptCount: nonNegativeInteger(summary.enabledScriptCount, 'character library index enabled script count'),
    variableCount: nonNegativeInteger(summary.variableCount, 'character library index variable count'),
    ignoredFieldCount: nonNegativeInteger(summary.ignoredFieldCount, 'character library index ignored field count'),
    ...(expectedScriptCount === undefined ? {} : { expectedScriptCount }),
  }
}

function parseStoredIndex(value: unknown): StoredCharacterIndex {
  const index = object(value, 'character library index')
  if (index.format !== 0 || typeof index.name !== 'string' || typeof index.displayName !== 'string'
    || (index.cardVersion !== 1 && index.cardVersion !== 2 && index.cardVersion !== 3)
    || typeof index.avatarAvailable !== 'boolean') {
    throw new Error('character library index has invalid fields')
  }
  const tavernHelper = parseTavernHelperSummary(index.tavernHelper)
  return {
    format: 0,
    name: index.name,
    displayName: index.displayName,
    cardVersion: index.cardVersion,
    greetingCount: nonNegativeInteger(index.greetingCount, 'character library index greeting count'),
    worldInfoCount: nonNegativeInteger(index.worldInfoCount, 'character library index World Info count'),
    regexScriptCount: nonNegativeInteger(index.regexScriptCount, 'character library index regex count'),
    avatarAvailable: index.avatarAvailable,
    imageAssetCount: nonNegativeInteger(index.imageAssetCount, 'character library index image count'),
    ...(tavernHelper === undefined ? {} : { tavernHelper }),
  }
}

function parseMetadata(value: unknown): StoredCharacterMetadata {
  const meta = object(value, 'character library metadata')
  const validTransport = meta.transport === 'json' || meta.transport === 'charx'
    ? meta.metadataKeyword === undefined
    : meta.transport === 'png' && (meta.metadataKeyword === 'ccv3' || meta.metadataKeyword === 'chara')
  if (meta.format !== 0 || typeof meta.id !== 'string' || !ID_PATTERN.test(meta.id)
    || typeof meta.originalFilename !== 'string' || meta.originalFilename.trim() === ''
    || typeof meta.mediaType !== 'string' || meta.mediaType.trim() === '' || !validTransport
    || typeof meta.bytes !== 'number' || !Number.isSafeInteger(meta.bytes) || meta.bytes < 1
    || typeof meta.createdAt !== 'number' || !Number.isSafeInteger(meta.createdAt) || meta.createdAt < 0
    || typeof meta.updatedAt !== 'number' || !Number.isSafeInteger(meta.updatedAt) || meta.updatedAt < 0
    || (meta.archivedAt !== undefined
      && (typeof meta.archivedAt !== 'number' || !Number.isSafeInteger(meta.archivedAt) || meta.archivedAt < 0))) {
    throw new Error('character library metadata has invalid fields')
  }
  const index = meta.index === undefined ? undefined : parseStoredIndex(meta.index)
  return { ...(meta as unknown as StoredCharacterMetadata), ...(index === undefined ? {} : { index }) }
}

function safeHttpsOrigin(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error(`${label} must be an HTTPS origin`, { cause: error })
  }
  const hostname = url.hostname.toLocaleLowerCase()
  if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== ''
    || (url.port !== '' && url.port !== '443') || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname)) {
    throw new Error(`${label} must be a public HTTPS origin`)
  }
  return url.origin
}

function parseOverlay(value: unknown): StoredCharacterOverlay {
  const record = object(value, 'character library overlay')
  if (record.format !== 0 || !Array.isArray(record.textReplacements) || !Array.isArray(record.displayExtensions)) {
    throw new Error('character library overlay has invalid fields')
  }
  const textReplacements = record.textReplacements.map((item, index) => {
    const replacement = object(item, `character library overlay text replacement ${index + 1}`)
    if (typeof replacement.from !== 'string' || replacement.from === '' || typeof replacement.to !== 'string'
      || typeof replacement.expectedMatches !== 'number' || !Number.isSafeInteger(replacement.expectedMatches)
      || replacement.expectedMatches < 1) {
      throw new Error('character library overlay has an invalid text replacement')
    }
    return replacement as unknown as StoredTextReplacement
  })
  const revision = record.revision === undefined ? 0 : nonNegativeInteger(record.revision, 'character library overlay revision')
  const content = record.content === undefined
    ? undefined : editableContent(record.content, 'character library overlay content')
  if (record.regexOverrides !== undefined && !Array.isArray(record.regexOverrides)) {
    throw new Error('character library overlay has invalid regex overrides')
  }
  const regexOverrides = (record.regexOverrides ?? []).map((item, position) => {
    const override = object(item, `character library regex override ${position + 1}`)
    if (typeof override.enabled !== 'boolean') throw new Error('character library overlay has an invalid regex override')
    return {
      index: nonNegativeInteger(override.index, `character library regex override ${position + 1} index`),
      enabled: override.enabled,
    }
  })
  if (new Set(regexOverrides.map(override => override.index)).size !== regexOverrides.length) {
    throw new Error('character library overlay has duplicate regex overrides')
  }
  const displayExtensions = record.displayExtensions.map((item, index) => {
    const extension = object(item, `character library display extension ${index + 1}`)
    if (typeof extension.id !== 'string' || !DISPLAY_EXTENSION_ID_PATTERN.test(extension.id)
      || typeof extension.originalFilename !== 'string' || extension.originalFilename.trim() === ''
      || typeof extension.importedAt !== 'number' || !Number.isSafeInteger(extension.importedAt) || extension.importedAt < 0
      || typeof extension.enabled !== 'boolean' || !Array.isArray(extension.remoteImageOrigins)
      || extension.remoteImageOrigins.some(origin => typeof origin !== 'string')
      || !Array.isArray(extension.replacedCardRegexIndices)
      || extension.replacedCardRegexIndices.some(candidate => typeof candidate !== 'number'
        || !Number.isSafeInteger(candidate) || candidate < 0)) {
      throw new Error('character library overlay has an invalid display extension')
    }
    const remoteImageOrigins = extension.remoteImageOrigins.map((origin, originIndex) =>
      safeHttpsOrigin(origin as string, `display extension origin ${originIndex + 1}`))
    const script = parseRegexScript(extension.script as JsonValue, `displayExtensions[${index}].script`)
    return {
      id: extension.id,
      originalFilename: extension.originalFilename,
      importedAt: extension.importedAt,
      enabled: extension.enabled,
      remoteImageOrigins,
      replacedCardRegexIndices: [...extension.replacedCardRegexIndices] as number[],
      script,
    }
  })
  if (record.approvedRemoteResources !== undefined && !Array.isArray(record.approvedRemoteResources)) {
    throw new Error('character library overlay has invalid resource approvals')
  }
  if (record.approvedRemoteResourceOrigins !== undefined && !Array.isArray(record.approvedRemoteResourceOrigins)) {
    throw new Error('character library overlay has invalid legacy resource origins')
  }
  const approvedRemoteResources = new Map<string, CharacterRemoteResourceApproval>()
  for (const [index, item] of (record.approvedRemoteResources ?? []).entries()) {
    const approval = object(item, `approved card resource ${index + 1}`)
    if (typeof approval.origin !== 'string' || !isCharacterRemoteResourceType(approval.type)) {
      throw new Error('character library overlay has an invalid resource approval')
    }
    const normalized = { origin: characterRemoteResourceOrigin(approval.origin), type: approval.type }
    approvedRemoteResources.set(cardRemoteResourceApprovalKey(normalized), normalized)
  }
  for (const [index, origin] of (record.approvedRemoteResourceOrigins ?? []).entries()) {
    if (typeof origin !== 'string') throw new Error('character library overlay has an invalid legacy resource origin')
    const normalizedOrigin = safeHttpsOrigin(origin, `approved card resource origin ${index + 1}`)
    for (const type of CHARACTER_REMOTE_RESOURCE_TYPES) {
      const approval = { origin: normalizedOrigin, type }
      approvedRemoteResources.set(cardRemoteResourceApprovalKey(approval), approval)
    }
  }
  if (approvedRemoteResources.size > MAX_REMOTE_RESOURCE_APPROVALS) {
    throw new Error('character library overlay has too many resource approvals')
  }
  const remoteResourcePolicy = record.remoteResourcePolicy ?? 'prompt'
  if (remoteResourcePolicy !== 'prompt' && remoteResourcePolicy !== 'isolated-https') {
    throw new Error('character library overlay has an invalid resource policy')
  }
  return {
    format: 0, revision, ...(content === undefined ? {} : { content }), regexOverrides,
    textReplacements, displayExtensions,
    approvedRemoteResources: [...approvedRemoteResources.values()].sort((left, right) =>
      left.origin.localeCompare(right.origin) || left.type.localeCompare(right.type)),
    remoteResourcePolicy,
  }
}

function emptyOverlay(): StoredCharacterOverlay {
  return {
    format: 0, revision: 0, regexOverrides: [], textReplacements: [], displayExtensions: [],
    approvedRemoteResources: [], remoteResourcePolicy: 'prompt',
  }
}

function remoteResourceOrigins(source: string): readonly string[] {
  const origins = new Set<string>()
  const patterns = [
    /<(?:img|script|source|video|audio)\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu,
    /<link\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu,
    /\bfetch\s*\(\s*(?:"([^"]+)"|'([^']+)')/giu,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const resource = match[1] ?? match[2] ?? match[3]
    if (resource === undefined || !/^https:\/\//iu.test(resource)) continue
    try {
      origins.add(safeHttpsOrigin(new URL(resource).origin, 'card resource origin'))
    } catch {
      // URL-like card text is not an executable resource declaration.
    }
  }
  for (const match of source.matchAll(/https:\/\/[^\s"'<>`\\)]+/giu)) {
    const resource = match[0].replace(/[),.;]+$/u, '')
    try {
      origins.add(safeHttpsOrigin(new URL(resource).origin, 'card resource origin'))
    } catch {
      // URL-like card text is not an executable resource declaration.
    }
  }
  return [...origins].sort()
}

function imageOrigins(script: ImportedRegexScript): readonly string[] {
  return remoteResourceOrigins(script.replaceString)
}

function cardRemoteResourcePlan(card: ImportedCharacterCard): {
  readonly origins: readonly string[]
  readonly resources: readonly CharacterRemoteResourceApproval[]
} {
  const greetings = [card.firstMessage, ...card.alternateGreetings]
    .map(greeting => renderCharacterDisplay(greeting, card, AI_OUTPUT_PLACEMENT, 0))
  const sources = [...card.frontend.regexScripts.map(script => script.replaceString), ...greetings]
  const origins = new Set(sources.flatMap(remoteResourceOrigins))
  const resources = new Map<string, CharacterRemoteResourceApproval>()
  for (const source of sources) for (const resource of cardRemoteResourceRequirements(source)) {
    origins.add(resource.origin)
    resources.set(cardRemoteResourceApprovalKey(resource), resource)
  }
  return {
    origins: [...origins].sort(),
    resources: [...resources.values()].sort((left, right) =>
      left.origin.localeCompare(right.origin) || left.type.localeCompare(right.type)),
  }
}

function sameMalformedPattern(left: ImportedRegexScript, right: ImportedRegexScript): boolean {
  return !left.findRegex.startsWith('/') && right.findRegex === `/${left.findRegex}`
    && left.replaceString === right.replaceString
    && JSON.stringify(left.placement) === JSON.stringify(right.placement)
    && left.markdownOnly === right.markdownOnly && left.promptOnly === right.promptOnly
}

function replaceStrings(value: unknown, replacement: StoredTextReplacement, state: { matches: number }): unknown {
  if (typeof value === 'string') {
    const matches = value.split(replacement.from).length - 1
    state.matches += matches
    return matches === 0 ? value : value.replaceAll(replacement.from, replacement.to)
  }
  if (Array.isArray(value)) return value.map(item => replaceStrings(item, replacement, state))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replacement, state)]))
}

function cardData(raw: unknown): Record<string, unknown> {
  const root = object(raw, 'character card overlay source')
  return root.spec === 'chara_card_v2' || root.spec === 'chara_card_v3'
    ? object(root.data, 'character card overlay data')
    : root
}

function scriptJson(script: ImportedRegexScript): Record<string, unknown> {
  return {
    ...(script.id === undefined ? {} : { id: script.id }),
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: [...script.trimStrings],
    placement: [...script.placement],
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  }
}

function applyOverlay(card: ImportedCharacterCard, overlay: StoredCharacterOverlay): ImportedCharacterCard {
  const enabled = overlay.displayExtensions.filter(extension => extension.enabled)
  if (overlay.textReplacements.length === 0 && enabled.length === 0
    && overlay.content === undefined && overlay.regexOverrides.length === 0) return card
  let raw: unknown = structuredClone(card.raw)
  for (const replacement of overlay.textReplacements) {
    const state = { matches: 0 }
    raw = replaceStrings(raw, replacement, state)
    if (state.matches !== replacement.expectedMatches) {
      throw new Error('character library local text correction no longer matches its source')
    }
  }
  const data = cardData(raw)
  if (overlay.content !== undefined) {
    data.name = overlay.content.name
    data.description = overlay.content.description
    data.personality = overlay.content.personality
    data.scenario = overlay.content.scenario
    data.mes_example = overlay.content.messageExample
    data.first_mes = overlay.content.firstMessage
    data.alternate_greetings = [...overlay.content.alternateGreetings]
  }
  if (overlay.regexOverrides.length > 0) {
    const extensions = data.extensions === undefined ? {} : object(data.extensions, 'character card overlay extensions')
    const stored = extensions.regex_scripts
    const scripts = stored === undefined ? [] : Array.isArray(stored) ? [...stored] : (() => {
      throw new Error('character card overlay regex scripts must be an array')
    })()
    for (const override of overlay.regexOverrides) {
      const script = scripts[override.index]
      if (script === undefined) throw new Error('character library regex override no longer matches its source')
      const record = object(script, `character card regex ${override.index + 1}`)
      scripts[override.index] = { ...record, disabled: !override.enabled }
    }
    extensions.regex_scripts = scripts
    data.extensions = extensions
  }
  if (enabled.length > 0) {
    const currentData = cardData(raw)
    const extensions = currentData.extensions === undefined ? {} : object(currentData.extensions, 'character card overlay extensions')
    const stored = extensions.regex_scripts
    const original = stored === undefined ? [] : Array.isArray(stored) ? stored : (() => {
      throw new Error('character card overlay regex scripts must be an array')
    })()
    const replaced = new Set(enabled.flatMap(extension => extension.replacedCardRegexIndices))
    extensions.regex_scripts = [
      ...original.filter((_script, index) => !replaced.has(index)),
      ...enabled.map(extension => scriptJson(extension.script)),
    ]
    currentData.extensions = extensions
  }
  return parseCharacterCardValue(raw as JsonValue)
}

function safeFilename(value: string | undefined, transport: 'png' | 'json' | 'charx'): string {
  const fallback = `character.${transport}`
  const name = basename(value?.trim() || fallback).trim()
  return name === '' ? fallback : name.slice(0, 240)
}

function editedFilename(value: string, transport: 'png' | 'json' | 'charx'): string {
  const suffix = new RegExp(`\\.${transport}$`, 'iu')
  const stem = basename(value).replace(suffix, '').trim() || 'character'
  return `${stem}.edited.${transport}`
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 0 ? crc >>> 1 : 0xedb88320 ^ (crc >>> 1)
  return crc >>> 0
})

function pngCrc32(value: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngTextChunk(keyword: 'ccv3' | 'chara', json: Uint8Array): Uint8Array {
  const type = Buffer.from('tEXt', 'ascii')
  const base64 = Buffer.from(json).toString('base64')
  const value = Buffer.concat([
    Buffer.from(keyword, 'ascii'), Buffer.from([0]), Buffer.from(base64, 'latin1'),
  ])
  const result = Buffer.alloc(12 + value.byteLength)
  result.writeUInt32BE(value.byteLength, 0)
  type.copy(result, 4)
  value.copy(result, 8)
  result.writeUInt32BE(pngCrc32(Buffer.concat([type, value])), 8 + value.byteLength)
  return result
}

function editedPng(source: Uint8Array, keyword: 'ccv3' | 'chara', json: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [source.subarray(0, 8)]
  let offset = 8
  let inserted = false
  while (offset < source.byteLength) {
    if (source.byteLength - offset < 12) throw new Error('character card PNG has a truncated chunk')
    const length = new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0)
    const end = offset + 12 + length
    if (!Number.isSafeInteger(end) || end > source.byteLength) throw new Error('character card PNG has an invalid chunk')
    const type = Buffer.from(source.subarray(offset + 4, offset + 8)).toString('ascii')
    const data = source.subarray(offset + 8, offset + 8 + length)
    const nul = type === 'tEXt' ? data.indexOf(0) : -1
    const textKeyword = nul < 0 ? '' : Buffer.from(data.subarray(0, nul)).toString('latin1').toLocaleLowerCase()
    if (type === 'IEND' && !inserted) {
      parts.push(pngTextChunk(keyword, json))
      inserted = true
    }
    if (!(type === 'tEXt' && textKeyword === keyword)) parts.push(source.subarray(offset, end))
    offset = end
    if (type === 'IEND') break
  }
  if (!inserted) throw new Error('character card PNG has no IEND chunk')
  return new Uint8Array(Buffer.concat(parts.map(part => Buffer.from(part))))
}

function summary(
  meta: StoredCharacterMetadata,
  card: ImportedCharacterCard,
  avatarAvailable: boolean,
  imageAssetCount: number,
): CharacterLibrarySummary {
  return {
    id: meta.id,
    name: card.name,
    displayName: card.nickname?.trim() || card.name,
    originalFilename: meta.originalFilename,
    cardVersion: card.version,
    greetingCount: 1 + card.alternateGreetings.length,
    worldInfoCount: card.lorebook?.entries.length ?? 0,
    regexScriptCount: card.frontend.regexScripts.length,
    avatarAvailable,
    imageAssetCount,
    ...(card.frontend.tavernHelper === undefined ? {} : { tavernHelper: card.frontend.tavernHelper }),
    archived: meta.archivedAt !== undefined,
    transport: meta.transport,
    importedAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

function storedIndex(value: CharacterLibrarySummary): StoredCharacterIndex {
  return {
    format: 0,
    name: value.name,
    displayName: value.displayName,
    cardVersion: value.cardVersion,
    greetingCount: value.greetingCount,
    worldInfoCount: value.worldInfoCount,
    regexScriptCount: value.regexScriptCount,
    avatarAvailable: value.avatarAvailable,
    imageAssetCount: value.imageAssetCount,
    ...(value.tavernHelper === undefined ? {} : { tavernHelper: value.tavernHelper }),
  }
}

function indexedSummary(meta: StoredCharacterMetadata, index: StoredCharacterIndex): CharacterLibrarySummary {
  return {
    id: meta.id,
    name: index.name,
    displayName: index.displayName,
    originalFilename: meta.originalFilename,
    cardVersion: index.cardVersion,
    greetingCount: index.greetingCount,
    worldInfoCount: index.worldInfoCount,
    regexScriptCount: index.regexScriptCount,
    avatarAvailable: index.avatarAvailable,
    imageAssetCount: index.imageAssetCount,
    ...(index.tavernHelper === undefined ? {} : { tavernHelper: index.tavernHelper }),
    archived: meta.archivedAt !== undefined,
    transport: meta.transport,
    importedAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

function greetingDetail(card: ImportedCharacterCard): {
  readonly greetings: readonly string[]
  readonly renderedGreetings: readonly string[]
} {
  const greetings = [card.firstMessage, ...card.alternateGreetings]
  return {
    greetings,
    renderedGreetings: greetings.map(greeting => renderCharacterDisplay(greeting, card, AI_OUTPUT_PLACEMENT, 0)),
  }
}

function regexScriptDetail(
  sourceCard: ImportedCharacterCard,
  overlay: StoredCharacterOverlay,
): readonly CharacterLibraryRegexScript[] {
  const overrides = new Map(overlay.regexOverrides.map(override => [override.index, override.enabled]))
  const replaced = new Set(overlay.displayExtensions.filter(extension => extension.enabled)
    .flatMap(extension => extension.replacedCardRegexIndices))
  const localCard = applyOverlay(sourceCard, { ...overlay, displayExtensions: [] })
  return localCard.frontend.regexScripts.map((script, index) => ({
    index,
    ...summarizeCharacterRegexScript(script),
    locallyOverridden: overrides.has(index),
    replacedByDisplayExtension: replaced.has(index),
  }))
}

function worldInfoEntryDetail(entry: ImportedLorebookEntry): CharacterLibraryWorldInfoEntry {
  return {
    sourceId: entry.sourceId,
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.comment === undefined ? {} : { comment: entry.comment }),
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    content: entry.content,
    enabled: entry.enabled,
    constant: entry.constant,
    selective: entry.selective,
    useRegex: entry.useRegex,
  }
}

function worldInfoDetail(card: ImportedCharacterCard): CharacterLibraryWorldInfo | undefined {
  if (card.lorebook === undefined) return undefined
  return {
    ...(card.lorebook.name === undefined ? {} : { name: card.lorebook.name }),
    entries: card.lorebook.entries.map(worldInfoEntryDetail),
  }
}

function displayExtensionDetail(
  overlay: StoredCharacterOverlay,
  sourceCard: ImportedCharacterCard,
): readonly CharacterLibraryDisplayExtension[] {
  return overlay.displayExtensions.map(extension => ({
    id: extension.id,
    scriptName: extension.script.scriptName,
    originalFilename: extension.originalFilename,
    enabled: extension.enabled,
    remoteImageOrigins: extension.remoteImageOrigins,
    replacedCardRegexNames: extension.replacedCardRegexIndices.flatMap(index => {
      const name = sourceCard.frontend.regexScripts[index]?.scriptName
      return name === undefined ? [] : [name]
    }),
  }))
}

function characterDetail(
  meta: StoredCharacterMetadata,
  parsed: ParsedStoredCharacter,
  includeWorldInfo: boolean,
  worldBinding?: CharacterWorldBinding,
): CharacterLibraryDetail {
  const worldInfo = includeWorldInfo ? worldInfoDetail(parsed.card) : undefined
  const declaredRemoteResources = cardRemoteResourcePlan(parsed.card)
  const approvedRemoteOrigins = [...new Set(parsed.overlay.approvedRemoteResources.map(approval => approval.origin))]
  const approvedTypesByOrigin = new Map<string, Set<CharacterRemoteResourceType>>()
  for (const approval of parsed.overlay.approvedRemoteResources) {
    const types = approvedTypesByOrigin.get(approval.origin) ?? new Set<CharacterRemoteResourceType>()
    types.add(approval.type)
    approvedTypesByOrigin.set(approval.origin, types)
  }
  return {
    ...summary(meta, parsed.card, parsed.avatarAvailable, parsed.images.length),
    mediaType: meta.mediaType,
    ...greetingDetail(parsed.card),
    imageAssets: parsed.images,
    remoteResourceOrigins: [...new Set([...declaredRemoteResources.origins, ...approvedRemoteOrigins])].sort(),
    remoteResources: declaredRemoteResources.resources,
    approvedRemoteResourceOrigins: approvedRemoteOrigins.filter(origin =>
      approvedTypesByOrigin.get(origin)?.size === CHARACTER_REMOTE_RESOURCE_TYPES.length),
    approvedRemoteResources: parsed.overlay.approvedRemoteResources,
    remoteResourcePolicy: parsed.overlay.remoteResourcePolicy,
    ...(worldInfo === undefined ? {} : { worldInfo }),
    ...(worldBinding === undefined ? {} : { worldBinding: browserWorldBinding(worldBinding) }),
    degradations: parsed.card.degradations,
    regexScripts: regexScriptDetail(parsed.sourceCard, parsed.overlay),
    displayExtensions: displayExtensionDetail(parsed.overlay, parsed.sourceCard),
    localCorrectionCount: parsed.overlay.textReplacements.reduce((total, replacement) =>
      total + replacement.expectedMatches, 0),
    content: characterContent(parsed.card),
    localRevision: parsed.overlay.revision,
    localEdits: parsed.overlay.content !== undefined || parsed.overlay.regexOverrides.length > 0,
  }
}

function browserWorldBinding(binding: CharacterWorldBinding): CharacterLibraryWorldBinding {
  return {
    format: 0,
    primary: binding.primary,
    additional: binding.additional,
    revision: binding.updatedAt,
  }
}

/** Small content-addressed card library; the original PNG, JSON, or CHARX remains exportable. */
export class CharacterLibrary {
  readonly root: string
  private readonly parsed = new Map<string, CachedParsedStoredCharacter>()
  private parsedSourceBytes = 0
  private readonly worldInfos: WorldInfoLibrary | undefined
  private readonly worldBindings: CharacterWorldBindingStore | undefined

  constructor(options: CharacterLibraryOptions = {}) {
    this.root = resolve(options.root ?? dshHomePath('agent-rp', 'characters'))
    if ((options.worldInfoLibrary === undefined) !== (options.worldBindings === undefined)) {
      throw new Error('角色库必须同时配置世界书库与角色世界绑定存储')
    }
    this.worldInfos = options.worldInfoLibrary
    this.worldBindings = options.worldBindings
  }

  /** List active or archived cards newest first without returning greeting bodies or file bytes. */
  list(collection: 'active' | 'archived' = 'active'): readonly CharacterLibrarySummary[] {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root)
      .filter(filename => filename.endsWith(META_SUFFIX))
      .map(filename => this.readEntry(join(this.root, filename)).summary)
      .filter(entry => entry.archived === (collection === 'archived'))
      .sort((left, right) => right.importedAt - left.importedAt || left.displayName.localeCompare(right.displayName))
  }

  /** Load card metadata and selectable greetings by opaque id. */
  get(id: string): CharacterLibraryDetail {
    const meta = this.readMetadata(id)
    const parsed = this.parseStoredId(meta)
    const worldBinding = this.ensureWorldBinding(id, parsed.card)
    const detail = characterDetail(meta, parsed, true, worldBinding)
    this.rememberIndex(meta, detail)
    return detail
  }

  /** Load greetings and frontend metadata without materializing World Info entry bodies. */
  overview(id: string): CharacterLibraryDetail {
    const meta = this.readMetadata(id)
    const parsed = this.parseStoredId(meta)
    const worldBinding = this.ensureWorldBinding(id, parsed.card)
    const detail = characterDetail(meta, parsed, false, worldBinding)
    this.rememberIndex(meta, detail)
    return detail
  }

  /** Load one bounded read-only World Info page without returning the rest to the browser. */
  worldInfoPage(id: string, offset: number, limit: number): CharacterLibraryWorldInfoPage | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid World Info offset')
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid World Info limit')
    const meta = this.readMetadata(id)
    const card = this.parseStoredId(meta).card
    this.ensureWorldBinding(id, card)
    if (card.lorebook === undefined) return undefined
    return {
      ...(card.lorebook.name === undefined ? {} : { name: card.lorebook.name }),
      offset,
      total: card.lorebook.entries.length,
      entries: card.lorebook.entries.slice(offset, offset + limit).map(worldInfoEntryDetail),
    }
  }

  /** Resolve one reusable card for a model-free Session launch. */
  resolve(id: string): ResolvedCharacterLibraryEntry {
    const meta = this.readMetadata(id)
    const parsed = this.parseStoredId(meta)
    const worldBinding = this.ensureWorldBinding(id, parsed.card)
    return {
      detail: characterDetail(meta, parsed, true, worldBinding),
      card: parsed.card,
      transport: meta.transport === 'png'
        ? { transport: 'png', metadataKeyword: meta.metadataKeyword! }
        : { transport: meta.transport },
      source: {
        bytes: meta.bytes,
        originalFilename: meta.originalFilename,
        mediaType: meta.mediaType,
      },
      ...(worldBinding === undefined ? {} : { worldBinding }),
    }
  }

  /** Resolve the reusable default world composition for one character. */
  worldBinding(id: string): CharacterWorldBinding | undefined {
    const meta = this.readMetadata(id)
    return this.ensureWorldBinding(id, this.parseStoredId(meta).card)
  }

  /** Replace the worlds used by future Sessions after validating every referenced reusable asset. */
  updateWorldBinding(id: string, request: CharacterWorldBindingUpdateRequest): CharacterLibraryDetail {
    if (this.worldInfos === undefined || this.worldBindings === undefined) {
      throw new Error('当前角色库没有配置可编辑的世界绑定')
    }
    const meta = this.readMetadata(id)
    if (meta.archivedAt !== undefined) throw new Error('请先恢复这个角色，再编辑世界组合')
    const parsed = this.parseStoredId(meta)
    this.ensureWorldBinding(id, parsed.card)
    const worldInfoIds = [
      ...(request.primaryWorldInfoId === null ? [] : [request.primaryWorldInfoId]),
      ...request.additionalWorldInfoIds,
    ]
    for (const worldInfoId of worldInfoIds) this.worldInfos.resolve(worldInfoId)
    const binding = this.worldBindings.replaceUserBinding(
      id,
      request.revision,
      request.primaryWorldInfoId,
      request.additionalWorldInfoIds,
    )
    const detail = characterDetail(meta, parsed, false, binding)
    this.rememberIndex(meta, detail)
    return detail
  }

  /** Materialize binding records for cards imported before resource separation. */
  migrateEmbeddedWorldInfos(): number {
    if (this.worldBindings === undefined) return 0
    if (!existsSync(this.root)) return 0
    let migrated = 0
    for (const filename of readdirSync(this.root).filter(value => value.endsWith(META_SUFFIX))) {
      const meta = this.readMetadata(filename.slice(0, -META_SUFFIX.length))
      if (this.worldBindings.get(meta.id) !== undefined) continue
      this.ensureWorldBinding(meta.id, this.parseStoredId(meta).card)
      migrated += 1
    }
    return migrated
  }

  /** Load the original immutable asset by opaque id. */
  asset(id: string): CharacterLibraryAsset {
    const entry = this.readId(id)
    let cardSummary = entry.meta.index === undefined ? undefined : indexedSummary(entry.meta, entry.meta.index)
    if (cardSummary === undefined) {
      const parsed = this.parseStored(entry.meta, entry.data)
      cardSummary = summary(entry.meta, parsed.card, parsed.avatarAvailable, parsed.images.length)
      this.rememberIndex(entry.meta, cardSummary)
    }
    return {
      summary: cardSummary,
      originalFilename: entry.meta.originalFilename,
      mediaType: entry.meta.mediaType,
      data: entry.data,
    }
  }

  /** Export the effective local revision in the original transport while retaining the source asset. */
  exportModified(id: string): CharacterLibraryExportAsset {
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    const binding = this.ensureWorldBinding(id, parsed.card)
    const worldInfo = binding?.primary === null || binding === undefined
      ? undefined
      : this.worldInfos!.asset(binding.primary.worldInfoId).worldInfo
    const raw = binding === undefined ? parsed.card.raw : characterCardWithWorldInfo(parsed.card, worldInfo)
    const json = new TextEncoder().encode(`${JSON.stringify(raw, null, 2)}\n`)
    if (entry.meta.transport === 'json') {
      return {
        filename: editedFilename(entry.meta.originalFilename, 'json'),
        mediaType: 'application/json',
        data: json,
      }
    }
    if (entry.meta.transport === 'png') {
      return {
        filename: editedFilename(entry.meta.originalFilename, 'png'),
        mediaType: 'image/png',
        data: editedPng(entry.data, entry.meta.metadataKeyword!, json),
      }
    }
    const files = unzipSync(entry.data)
    files['card.json'] = json
    return {
      filename: editedFilename(entry.meta.originalFilename, 'charx'),
      mediaType: 'application/zip',
      data: zipSync(files),
    }
  }

  /** Load the primary inert avatar image without exposing the enclosing CHARX archive. */
  avatar(id: string): CharacterLibraryAvatar | undefined {
    const entry = this.readId(id)
    if (entry.meta.transport === 'json') return undefined
    if (entry.meta.transport === 'charx') {
      const charx = parseCharx(entry.data)
      const avatar = charxAvatar(charx)
      return avatar === undefined
        ? undefined
        : { mediaType: avatar.mediaType, data: readCharxImageAsset(charx, avatar) }
    }
    return { mediaType: 'image/png', data: entry.data }
  }

  /** Load one card-declared embedded image by its stable V3 asset index. */
  image(id: string, index: number): CharacterLibraryImageAsset | undefined {
    if (!Number.isSafeInteger(index) || index < 0) return undefined
    const entry = this.readId(id)
    if (entry.meta.transport !== 'charx') return undefined
    const charx = parseCharx(entry.data)
    const asset = charxImageAssets(charx).find(image => image.index === index)
    return asset === undefined ? undefined : {
      index: asset.index,
      type: asset.type,
      name: asset.name,
      mediaType: asset.mediaType,
      sourceUri: charx.card.assets?.[asset.index]?.uri ?? '',
      data: readCharxImageAsset(charx, asset),
    }
  }

  /** Save one already validated card, deduplicating exact original bytes. */
  import(input: CharacterLibraryImport): CharacterLibraryDetail {
    return this.importWithOutcome(input).entry
  }

  /** Save one validated card and report whether it was added, reused, or restored. */
  importWithOutcome(input: CharacterLibraryImport): CharacterLibraryImportResult {
    const digest = createHash('sha256').update(input.data).digest('hex')
    const id = `card-${digest.slice(0, 32)}`
    const existingMeta = this.metaPath(id)
    if (existsSync(existingMeta)) {
      const existing = this.get(id)
      return existing.archived
        ? { entry: this.restore(id), outcome: 'restored' }
        : { entry: existing, outcome: 'existing' }
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const now = Date.now()
    const transport = input.transport.transport
    const meta: StoredCharacterMetadata = {
      format: 0,
      id,
      originalFilename: safeFilename(input.filename, transport),
      mediaType: input.mediaType?.trim() || (transport === 'png' ? 'image/png'
        : transport === 'charx' ? 'application/zip' : 'application/json'),
      transport,
      ...(input.transport.transport === 'png' ? { metadataKeyword: input.transport.metadataKeyword } : {}),
      bytes: input.data.byteLength,
      createdAt: now,
      updatedAt: now,
    }
    const assetPath = this.assetPath(meta)
    const assetStaging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.${transport}.tmp`)
    const metaStaging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.meta.tmp`)
    try {
      writeFileSync(assetStaging, input.data, { mode: 0o600 })
      writeFileSync(metaStaging, `${JSON.stringify(meta, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(assetStaging, assetPath)
      renameSync(metaStaging, existingMeta)
    } catch (error: unknown) {
      rmSync(assetStaging, { force: true })
      rmSync(metaStaging, { force: true })
      if (existsSync(existingMeta)) {
        const existing = this.get(id)
        return existing.archived
          ? { entry: this.restore(id), outcome: 'restored' }
          : { entry: existing, outcome: 'existing' }
      }
      rmSync(assetPath, { force: true })
      throw error
    }
    const detail = this.get(id)
    if (detail.name !== input.card.name || detail.cardVersion !== input.card.version) {
      throw new Error('stored character card does not match the validated import')
    }
    return { entry: detail, outcome: 'created' }
  }

  /** Parse and save one supported Character Card file selected from the local browser. */
  importFile(input: CharacterLibraryFileImport): CharacterLibraryDetail {
    return this.importFileWithOutcome(input).entry
  }

  /** Parse one browser-selected card file and report its library import outcome. */
  importFileWithOutcome(input: CharacterLibraryFileImport): CharacterLibraryImportResult {
    const filename = input.filename.trim()
    const mediaType = input.mediaType?.split(';', 1)[0]?.trim().toLocaleLowerCase()
    if (/\.charx$/iu.test(filename) || mediaType === 'application/zip') {
      const card = parseCharx(input.data).card
      return this.importWithOutcome({ ...input, card, transport: { transport: 'charx' } })
    }
    if (/\.json$/iu.test(filename) || mediaType === 'application/json') {
      const card = parseCharacterCardJsonBytes(input.data)
      return this.importWithOutcome({ ...input, card, transport: { transport: 'json' } })
    }
    if (/\.png$/iu.test(filename) || mediaType === 'image/png') {
      const payload = readCharacterCardPng(input.data)
      const card = parseCharacterCardJson(payload.json)
      return this.importWithOutcome({
        ...input,
        card,
        transport: { transport: 'png', metadataKeyword: payload.keyword },
      })
    }
    throw new Error('请选择 PNG、JSON 或 CHARX 角色卡')
  }

  /** Attach one display-only SillyTavern regex without modifying the original card bytes. */
  importDisplayExtension(id: string, input: CharacterDisplayExtensionImport): CharacterLibraryDetail {
    if (input.data.byteLength === 0 || input.data.byteLength > MAX_DISPLAY_EXTENSION_BYTES) {
      throw new Error('显示扩展文件为空或过大')
    }
    let json: string
    try {
      json = new TextDecoder('utf-8', { fatal: true }).decode(input.data).replace(/^\uFEFF/u, '')
    } catch (error) {
      throw new Error('显示扩展必须是 UTF-8 JSON', { cause: error })
    }
    let value: unknown
    try {
      value = JSON.parse(json)
    } catch (error) {
      throw new Error('显示扩展不是有效 JSON', { cause: error })
    }
    const script = parseRegexScript(value as JsonValue, 'display extension')
    if (!script.markdownOnly || script.promptOnly || !script.placement.includes(AI_OUTPUT_PLACEMENT)) {
      throw new Error('这里只接受作用于 AI 消息的纯显示正则')
    }
    const requiredOrigins = imageOrigins(script)
    const approvedOrigins = [...new Set(input.approvedImageOrigins.map((origin, index) =>
      safeHttpsOrigin(origin, `approved image origin ${index + 1}`)))].sort()
    if (JSON.stringify(requiredOrigins) !== JSON.stringify(approvedOrigins)) {
      throw new Error(requiredOrigins.length === 0 ? '显示扩展不需要外部图片授权' : '请先确认显示扩展使用的外部图片域名')
    }
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    const digest = createHash('sha256').update(input.data).digest('hex')
    const extensionId = `display-${digest.slice(0, 32)}`
    const existing = parsed.overlay.displayExtensions.find(extension => extension.id === extensionId)
    if (existing !== undefined) {
      if (!existing.enabled) this.setDisplayExtensionEnabled(id, extensionId, true)
      return this.get(id)
    }
    const replacedCardRegexIndices = parsed.sourceCard.frontend.regexScripts.flatMap((candidate, index) =>
      sameMalformedPattern(candidate, script) ? [index] : [])
    this.writeOverlay(id, {
      ...parsed.overlay,
      displayExtensions: [...parsed.overlay.displayExtensions, {
        id: extensionId,
        originalFilename: safeFilename(input.filename, 'json'),
        importedAt: Date.now(),
        enabled: true,
        remoteImageOrigins: requiredOrigins,
        replacedCardRegexIndices,
        script,
      }],
    })
    return this.get(id)
  }

  /** Enable or pause one local display extension. */
  setDisplayExtensionEnabled(id: string, extensionId: string, enabled: boolean): CharacterLibraryDetail {
    if (!DISPLAY_EXTENSION_ID_PATTERN.test(extensionId)) throw new Error('显示扩展 id 无效')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    if (!parsed.overlay.displayExtensions.some(extension => extension.id === extensionId)) {
      throw new Error('角色卡没有这个显示扩展')
    }
    this.writeOverlay(id, {
      ...parsed.overlay,
      displayExtensions: parsed.overlay.displayExtensions.map(extension => extension.id === extensionId
        ? { ...extension, enabled }
        : extension),
    })
    return this.get(id)
  }

  /** Remove one local display extension while keeping the original card unchanged. */
  removeDisplayExtension(id: string, extensionId: string): CharacterLibraryDetail {
    if (!DISPLAY_EXTENSION_ID_PATTERN.test(extensionId)) throw new Error('显示扩展 id 无效')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    const displayExtensions = parsed.overlay.displayExtensions.filter(extension => extension.id !== extensionId)
    if (displayExtensions.length === parsed.overlay.displayExtensions.length) throw new Error('角色卡没有这个显示扩展')
    this.writeOverlay(id, { ...parsed.overlay, displayExtensions })
    return this.get(id)
  }

  /** Allow or revoke one resource class at a public HTTPS origin. */
  setRemoteResourceApproved(
    id: string,
    origin: string,
    type: CharacterRemoteResourceType,
    approved: boolean,
  ): CharacterLibraryDetail {
    const normalized = characterRemoteResourceOrigin(origin)
    if (!isCharacterRemoteResourceType(type)) throw new Error('角色卡外部资源类型无效')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    const approval = { origin: normalized, type }
    const resources = new Map(parsed.overlay.approvedRemoteResources.map(value =>
      [cardRemoteResourceApprovalKey(value), value] as const))
    const key = cardRemoteResourceApprovalKey(approval)
    if (approved) resources.set(key, approval)
    else resources.delete(key)
    if (resources.size > MAX_REMOTE_RESOURCE_APPROVALS) {
      throw new Error('这张角色卡已达到外部资源授权上限')
    }
    this.writeOverlay(id, {
      ...parsed.overlay,
      approvedRemoteResources: [...resources.values()].sort((left, right) =>
        left.origin.localeCompare(right.origin) || left.type.localeCompare(right.type)),
    })
    return this.get(id)
  }

  /** Select prompted approvals or broad HTTPS access inside this card's isolated frame. */
  setRemoteResourcePolicy(id: string, policy: CharacterRemoteResourcePolicy): CharacterLibraryDetail {
    if (policy !== 'prompt' && policy !== 'isolated-https') throw new Error('角色卡外部资源策略无效')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    this.writeOverlay(id, { ...parsed.overlay, remoteResourcePolicy: policy })
    return this.get(id)
  }

  /** Allow or revoke every resource class for one statically declared legacy origin. */
  setRemoteResourceOriginApproved(id: string, origin: string, approved: boolean): CharacterLibraryDetail {
    const normalized = safeHttpsOrigin(origin, 'card resource origin')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    if (!cardRemoteResourcePlan(parsed.card).origins.includes(normalized)) {
      throw new Error('角色卡没有引用这个外部资源来源')
    }
    const resources = new Map(parsed.overlay.approvedRemoteResources.map(value =>
      [cardRemoteResourceApprovalKey(value), value] as const))
    for (const type of CHARACTER_REMOTE_RESOURCE_TYPES) {
      const approval = { origin: normalized, type }
      const key = cardRemoteResourceApprovalKey(approval)
      if (approved) resources.set(key, approval)
      else resources.delete(key)
    }
    this.writeOverlay(id, { ...parsed.overlay, approvedRemoteResources: [...resources.values()] })
    return this.get(id)
  }

  /** Apply one exact local wording correction without rewriting the imported card asset. */
  replaceText(id: string, from: string, to: string): CharacterLibraryDetail {
    if (from === '' || from === to || from.length > 2_000 || to.length > 2_000) throw new Error('本地文字修正无效')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    const state = { matches: 0 }
    replaceStrings(parsed.card.raw, { from, to, expectedMatches: 1 }, state)
    if (state.matches < 1) throw new Error('没有找到需要修正的文字')
    this.writeOverlay(id, {
      ...parsed.overlay,
      textReplacements: [...parsed.overlay.textReplacements, { from, to, expectedMatches: state.matches }],
    })
    return this.get(id)
  }

  /** Save a complete local character definition without rewriting the imported asset. */
  updateContent(id: string, value: CharacterLibraryEditableContent, revision: number): CharacterLibraryDetail {
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    this.assertLocalRevision(parsed.overlay, revision)
    const content = editableContent(value, '角色设定')
    const source = characterContent(parsed.sourceCard)
    const { content: _previousContent, ...withoutContent } = parsed.overlay
    const next: StoredCharacterOverlay = {
      ...withoutContent,
      revision: parsed.overlay.revision + 1,
      ...(JSON.stringify(content) === JSON.stringify(source) ? {} : { content }),
    }
    return this.commitLocalRevision(entry, parsed.sourceCard, next)
  }

  /** Enable or pause one card-owned regex through the same reversible local revision. */
  setRegexEnabled(id: string, index: number, enabled: boolean, revision: number): CharacterLibraryDetail {
    if (!Number.isSafeInteger(index) || index < 0 || typeof enabled !== 'boolean') throw new Error('角色卡正则开关无效')
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    this.assertLocalRevision(parsed.overlay, revision)
    const source = parsed.sourceCard.frontend.regexScripts[index]
    if (source === undefined) throw new Error('角色卡中没有这条正则')
    const sourceEnabled = !source.disabled
    const regexOverrides = [
      ...parsed.overlay.regexOverrides.filter(override => override.index !== index),
      ...(enabled === sourceEnabled ? [] : [{ index, enabled }]),
    ].sort((left, right) => left.index - right.index)
    return this.commitLocalRevision(entry, parsed.sourceCard, {
      ...parsed.overlay,
      revision: parsed.overlay.revision + 1,
      regexOverrides,
    })
  }

  /** Restore imported character fields and regex switches while retaining permissions and display extensions. */
  resetLocalEdits(id: string, revision: number): CharacterLibraryDetail {
    const entry = this.readId(id)
    const parsed = this.parseStored(entry.meta, entry.data)
    this.assertLocalRevision(parsed.overlay, revision)
    if (parsed.overlay.content === undefined && parsed.overlay.regexOverrides.length === 0) return this.get(id)
    const { content: _content, ...withoutContent } = parsed.overlay
    return this.commitLocalRevision(entry, parsed.sourceCard, {
      ...withoutContent,
      revision: parsed.overlay.revision + 1,
      regexOverrides: [],
    })
  }

  /** Hide one reusable card from the everyday collection without touching its original asset. */
  archive(id: string): CharacterLibraryDetail {
    const meta = this.readMetadata(id)
    if (meta.archivedAt !== undefined) return this.get(id)
    const now = Date.now()
    this.writeMetadata({ ...meta, archivedAt: now, updatedAt: now })
    return this.get(id)
  }

  /** Return one archived card to the everyday collection without changing its original asset. */
  restore(id: string): CharacterLibraryDetail {
    const meta = this.readMetadata(id)
    if (meta.archivedAt === undefined) return this.get(id)
    const { archivedAt: _archivedAt, ...active } = meta
    this.writeMetadata({ ...active, updatedAt: Date.now() })
    return this.get(id)
  }

  /** Permanently remove one archived card and every Host-owned local revision. */
  deleteArchived(id: string): void {
    const meta = this.readMetadata(id)
    if (meta.archivedAt === undefined) throw new Error('请先把角色移入收纳箱，再永久删除')
    const paths = [this.assetPath(meta), this.overlayPath(id), this.metaPath(id)]
    const staged: Array<{ readonly source: string; readonly target: string }> = []
    try {
      for (const source of paths) {
        if (!existsSync(source)) continue
        const target = join(this.root, `.${id}.${process.pid}.${randomUUID()}.delete.tmp`)
        renameSync(source, target)
        staged.push({ source, target })
      }
      this.worldBindings?.removeCharacter(id)
    } catch (error: unknown) {
      for (const entry of staged.reverse()) {
        if (existsSync(entry.target) && !existsSync(entry.source)) renameSync(entry.target, entry.source)
      }
      throw new Error('无法完整移除角色卡文件', { cause: error })
    }
    const cached = this.parsed.get(id)
    if (cached !== undefined) this.parsedSourceBytes -= cached.sourceBytes
    this.parsed.delete(id)
    for (const entry of staged) rmSync(entry.target, { force: true })
  }

  private ensureWorldBinding(id: string, card: ImportedCharacterCard): CharacterWorldBinding | undefined {
    if (this.worldInfos === undefined || this.worldBindings === undefined) return undefined
    const existing = this.worldBindings.get(id)
    if (existing !== undefined) return existing
    const embedded = embeddedWorldInfoAsset(card)
    const world = embedded === undefined ? undefined : this.worldInfos.importFile(embedded)
    return this.worldBindings.bindEmbedded(id, world?.id)
  }

  private assertId(id: string): void {
    if (!ID_PATTERN.test(id)) throw new Error('角色库 id 无效')
  }

  private metaPath(id: string): string {
    this.assertId(id)
    return join(this.root, `${id}${META_SUFFIX}`)
  }

  private overlayPath(id: string): string {
    this.assertId(id)
    return join(this.root, `${id}${OVERLAY_SUFFIX}`)
  }

  private assetPath(meta: StoredCharacterMetadata): string {
    return join(this.root, `${meta.id}.${meta.transport}`)
  }

  private writeMetadata(meta: StoredCharacterMetadata): void {
    const staging = join(this.root, `.${meta.id}.${process.pid}.${randomUUID()}.meta.tmp`)
    try {
      writeFileSync(staging, `${JSON.stringify(meta, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(staging, this.metaPath(meta.id))
    } finally {
      rmSync(staging, { force: true })
    }
  }

  private rememberIndex(meta: StoredCharacterMetadata, value: CharacterLibrarySummary): void {
    const index = storedIndex(value)
    if (JSON.stringify(meta.index) === JSON.stringify(index)) return
    this.writeMetadata({ ...meta, index })
  }

  private readOverlay(id: string): StoredCharacterOverlay {
    const path = this.overlayPath(id)
    if (!existsSync(path)) return emptyOverlay()
    try {
      return parseOverlay(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error: unknown) {
      throw new Error(`无法读取角色库本地调整 ${JSON.stringify(path)}`, { cause: error })
    }
  }

  private writeOverlay(id: string, overlay: StoredCharacterOverlay): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const path = this.overlayPath(id)
    const staging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.overlay.tmp`)
    try {
      writeFileSync(staging, `${JSON.stringify(overlay, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(staging, path)
    } finally {
      rmSync(staging, { force: true })
    }
  }

  private assertLocalRevision(overlay: StoredCharacterOverlay, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('角色修订版本无效')
    if (revision !== overlay.revision) throw new Error('角色设定已在别处改变，请刷新后重试')
  }

  private commitLocalRevision(
    entry: { readonly meta: StoredCharacterMetadata; readonly data: Uint8Array },
    sourceCard: ImportedCharacterCard,
    overlay: StoredCharacterOverlay,
  ): CharacterLibraryDetail {
    // Parse before committing so a too-large or structurally invalid edit never replaces the last usable revision.
    applyOverlay(sourceCard, overlay)
    this.writeOverlay(entry.meta.id, overlay)
    const updatedMeta = {
      ...entry.meta,
      updatedAt: Math.max(Date.now(), entry.meta.updatedAt + 1),
    }
    const parsed = this.parseStored(updatedMeta, entry.data)
    const detail = characterDetail(
      updatedMeta,
      parsed,
      true,
      this.ensureWorldBinding(updatedMeta.id, parsed.card),
    )
    this.writeMetadata({ ...updatedMeta, index: storedIndex(detail) })
    return detail
  }

  private parseStored(meta: StoredCharacterMetadata, data: Uint8Array): ParsedStoredCharacter {
    const overlay = this.readOverlay(meta.id)
    const asset = regularFileVersion(this.assetPath(meta))
    if (asset.bytes !== meta.bytes) throw new Error('character library asset byte count changed')
    const signature = this.parsedSignature(meta, overlay, asset.version)
    const cached = this.cachedParsed(meta.id, signature)
    if (cached !== undefined) return cached
    return this.parseAndRemember(meta, data, overlay, signature)
  }

  private parseStoredId(meta: StoredCharacterMetadata): ParsedStoredCharacter {
    const asset = regularFileVersion(this.assetPath(meta))
    if (asset.bytes !== meta.bytes) throw new Error('character library asset byte count changed')
    const overlay = this.readOverlay(meta.id)
    const signature = this.parsedSignature(meta, overlay, asset.version)
    const cached = this.cachedParsed(meta.id, signature)
    if (cached !== undefined) return cached
    return this.parseAndRemember(meta, new Uint8Array(readFileSync(this.assetPath(meta))), overlay, signature)
  }

  private parsedSignature(meta: StoredCharacterMetadata, overlay: StoredCharacterOverlay, sourceVersion: string): string {
    return JSON.stringify([meta.transport, meta.metadataKeyword ?? null, meta.bytes, sourceVersion, overlay])
  }

  private cachedParsed(id: string, signature: string): ParsedStoredCharacter | undefined {
    const cached = this.parsed.get(id)
    if (cached === undefined || cached.signature !== signature) return undefined
    this.parsed.delete(id)
    this.parsed.set(id, cached)
    return cached.parsed
  }

  private rememberParsed(id: string, cached: CachedParsedStoredCharacter): ParsedStoredCharacter {
    const previous = this.parsed.get(id)
    if (previous !== undefined) this.parsedSourceBytes -= previous.sourceBytes
    this.parsed.delete(id)
    if (cached.sourceBytes <= MAX_PARSED_CACHE_SOURCE_BYTES) {
      this.parsed.set(id, cached)
      this.parsedSourceBytes += cached.sourceBytes
    }
    while (this.parsed.size > MAX_PARSED_CACHE_ENTRIES
      || this.parsedSourceBytes > MAX_PARSED_CACHE_SOURCE_BYTES) {
      const oldest = this.parsed.keys().next().value
      if (oldest === undefined) break
      this.parsedSourceBytes -= this.parsed.get(oldest)!.sourceBytes
      this.parsed.delete(oldest)
    }
    return cached.parsed
  }

  private parseAndRemember(
    meta: StoredCharacterMetadata,
    data: Uint8Array,
    overlay: StoredCharacterOverlay,
    signature: string,
  ): ParsedStoredCharacter {
    let parsed: ParsedStoredCharacter
    if (meta.transport === 'json') {
      const sourceCard = parseCharacterCardJsonBytes(data)
      parsed = { card: applyOverlay(sourceCard, overlay), sourceCard, overlay, avatarAvailable: false, images: [] }
    } else if (meta.transport === 'charx') {
      const charx = parseCharx(data)
      const charxImages = charxImageAssets(charx)
      const images = charxImages.map(image => ({
        index: image.index,
        type: image.type,
        name: image.name,
        mediaType: image.mediaType,
        sourceUri: charx.card.assets?.[image.index]?.uri ?? '',
      }))
      parsed = {
        card: applyOverlay(charx.card, overlay),
        sourceCard: charx.card,
        overlay,
        avatarAvailable: charxAvatar(charx) !== undefined,
        images,
      }
    } else {
      const payload = readCharacterCardPng(data)
      if (payload.keyword !== meta.metadataKeyword) throw new Error('character library PNG metadata keyword changed')
      const sourceCard = parseCharacterCardJson(payload.json)
      parsed = {
        card: applyOverlay(sourceCard, overlay), sourceCard, overlay,
        avatarAvailable: true, images: [],
      }
    }
    return this.rememberParsed(meta.id, {
      signature,
      sourceBytes: meta.bytes,
      parsed: deepFreeze(parsed),
    })
  }

  private readMetadata(id: string): StoredCharacterMetadata {
    const metaPath = this.metaPath(id)
    if (!existsSync(metaPath)) throw new Error(`角色库中没有 ${JSON.stringify(id)}`)
    let meta: StoredCharacterMetadata
    try {
      meta = parseMetadata(JSON.parse(readFileSync(metaPath, 'utf8')))
    } catch (error: unknown) {
      throw new Error(`无法读取角色库文件 ${JSON.stringify(metaPath)}`, { cause: error })
    }
    if (meta.id !== id) throw new Error('character library filename and metadata id differ')
    return meta
  }

  private readId(id: string): { readonly meta: StoredCharacterMetadata; readonly data: Uint8Array } {
    const meta = this.readMetadata(id)
    const assetPath = this.assetPath(meta)
    const data = new Uint8Array(readFileSync(assetPath))
    if (data.byteLength !== meta.bytes) throw new Error('character library asset byte count changed')
    return { meta, data }
  }

  private readEntry(metaPath: string): { readonly summary: CharacterLibrarySummary } {
    let meta: StoredCharacterMetadata
    try {
      meta = parseMetadata(JSON.parse(readFileSync(metaPath, 'utf8')))
    } catch (error: unknown) {
      throw new Error(`无法读取角色库文件 ${JSON.stringify(metaPath)}`, { cause: error })
    }
    const asset = statSync(this.assetPath(meta))
    if (!asset.isFile() || asset.size !== meta.bytes) throw new Error('character library asset byte count changed')
    return { summary: meta.index === undefined ? this.get(meta.id) : indexedSummary(meta, meta.index) }
  }
}
