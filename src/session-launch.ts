/** Build complete Session seeds from Host-owned roleplay libraries. */

import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from './character-library.ts'
import { createCharacterCardSessionSeed } from './import/character-card-seed.ts'
import { createPresetSessionSeed } from './import/session-preset.ts'
import { createSillyTavernChatSeed, resolveSillyTavernChatIdentity } from './import/sillytavern-chat-seed.ts'
import { createSillyTavernMigrationSeed } from './import/sillytavern-migration-seed.ts'
import {
  appendCharacterWorldSessionSeed,
  appendWorldInfoLibrarySessionSeed,
  characterWorldInfoIds,
  createWorldInfoLibrarySessionSeed,
} from './import/world-info-seed.ts'
import { readActiveSessionCharacter, type FileAttachmentRef } from './import/session-character.ts'
import type { PresetLibrary, PresetLibraryEntry } from './preset-library.ts'
import { substituteCardMacros } from './prompt.ts'
import { parseSessionPersona } from './session-persona.ts'
import type {
  AgentRpSessionLaunchRequest,
  LibrarySessionLaunchRequest,
  StoryWorkspaceSessionLaunchRequest,
} from './session-launch-protocol.ts'
import type {
  RoleplayResourceKind,
  RoleplayResourceSelection,
} from './roleplay-resource-catalog-protocol.ts'
import type { RoleplayResourceCatalog } from './roleplay-resource-catalog.ts'
import { prepareRoleplayExperienceSession } from './roleplay-experience-materialization.ts'
import { isAgentRpCapabilityPresetId } from './agent-capability-preset-protocol.ts'
import { SillyTavernChatLibrary } from './sillytavern-chat-library.ts'
import { WorldInfoLibrary } from './world-info-library.ts'
import { sessionEvents } from './session-events.ts'

/** Complete seed and display metadata used to create one Agent. */
export interface PreparedAgentRpSession {
  readonly seed: readonly SessionEvent[]
  readonly title: string
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}不是对象`)
  return value as Record<string, unknown>
}

const worldInfoLibraryIdPattern = /^world-info-[a-f0-9]{32}$/u
const storyWorkspaceIdPattern = /^story-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function parseAdditionalWorldInfoIds(value: unknown, primaryId?: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 16
    || value.some(id => typeof id !== 'string' || !worldInfoLibraryIdPattern.test(id))) {
    throw new Error('附加世界书字段无效')
  }
  const ids = value as string[]
  if (new Set(ids).size !== ids.length || (primaryId !== undefined && ids.includes(primaryId))) {
    throw new Error('附加世界书不能重复')
  }
  return [...ids]
}

function parseResourceSelection(
  value: unknown,
  expectedKind: RoleplayResourceKind,
  label: string,
): RoleplayResourceSelection {
  const record = object(value, label)
  const keys = Object.keys(record)
  if (record.kind !== expectedKind
    || typeof record.id !== 'string' || record.id.length > 512
    || record.id.trim() !== record.id || record.id === '' || /\s/u.test(record.id)
    || (record.variant !== undefined
      && (typeof record.variant !== 'string' || record.variant.length > 256
        || record.variant.trim() !== record.variant || record.variant === '' || /\s/u.test(record.variant)))
    || keys.some(key => key !== 'kind' && key !== 'id' && key !== 'variant')) {
    throw new Error(`${label}字段无效`)
  }
  return {
    kind: expectedKind,
    id: record.id,
    ...(typeof record.variant === 'string' ? { variant: record.variant } : {}),
  }
}

function parseAgentPresetId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (!isAgentRpCapabilityPresetId(value) || value.length > 80) {
    throw new Error('Agent 能力预设字段无效')
  }
  return value
}

/** Validate one same-origin browser request without accepting filesystem paths. */
export function parseAgentRpSessionLaunchRequest(value: unknown): AgentRpSessionLaunchRequest {
  const record = object(value, '角色会话启动请求')
  const common = record.format === 0 && typeof record.sourceSessionId === 'string'
    && record.sourceSessionId.trim() !== '' && record.sourceSessionId.length <= 512
  if (!common) throw new Error('角色会话启动请求字段无效')
  if (record.kind === 'character') {
    if (typeof record.characterId !== 'string' || !/^card-[a-f0-9]{32}$/u.test(record.characterId)
      || typeof record.greetingIndex !== 'number' || !Number.isSafeInteger(record.greetingIndex)
      || record.greetingIndex < 0
      || (record.presetId !== undefined
        && (typeof record.presetId !== 'string' || !/^[a-z0-9-]{8,80}$/u.test(record.presetId)))
      || (record.memory !== undefined && record.memory !== 'copy-active')
      || Object.keys(record).some(key => !['format', 'sourceSessionId', 'kind', 'characterId', 'greetingIndex', 'persona', 'presetId', 'agentPresetId', 'worldInfoIds', 'memory'].includes(key))) {
      throw new Error('角色会话启动请求字段无效')
    }
    const persona = record.persona === undefined ? undefined : parseSessionPersona(record.persona)
    const worldInfoIds = parseAdditionalWorldInfoIds(record.worldInfoIds)
    const agentPresetId = parseAgentPresetId(record.agentPresetId)
    return {
      format: 0,
      sourceSessionId: record.sourceSessionId as string,
      kind: 'character',
      characterId: record.characterId,
      greetingIndex: record.greetingIndex,
      ...(persona === undefined ? {} : { persona }),
      ...(typeof record.presetId === 'string' ? { presetId: record.presetId } : {}),
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
      ...(worldInfoIds === undefined ? {} : { worldInfoIds }),
      ...(record.memory === 'copy-active' ? { memory: 'copy-active' as const } : {}),
    }
  }
  if (record.kind === 'world-info') {
    if (typeof record.importId !== 'string' || !worldInfoLibraryIdPattern.test(record.importId)
      || (record.presetId !== undefined
        && (typeof record.presetId !== 'string' || !/^[a-z0-9-]{8,80}$/u.test(record.presetId)))
      || Object.keys(record).some(key => !['format', 'sourceSessionId', 'kind', 'importId', 'persona', 'presetId', 'agentPresetId', 'worldInfoIds'].includes(key))) {
      throw new Error('世界书会话启动请求字段无效')
    }
    const persona = record.persona === undefined ? undefined : parseSessionPersona(record.persona)
    const worldInfoIds = parseAdditionalWorldInfoIds(record.worldInfoIds, record.importId)
    const agentPresetId = parseAgentPresetId(record.agentPresetId)
    return {
      format: 0,
      sourceSessionId: record.sourceSessionId as string,
      kind: 'world-info',
      importId: record.importId,
      ...(persona === undefined ? {} : { persona }),
      ...(typeof record.presetId === 'string' ? { presetId: record.presetId } : {}),
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
      ...(worldInfoIds === undefined ? {} : { worldInfoIds }),
    }
  }
  if (record.kind === 'chat') {
    if (typeof record.importId !== 'string' || !/^chat-[a-f0-9]{32}$/u.test(record.importId)
      || (record.characterId !== undefined
        && (typeof record.characterId !== 'string' || !/^card-[a-f0-9]{32}$/u.test(record.characterId)))
      || (record.presetId !== undefined
        && (typeof record.presetId !== 'string' || !/^[a-z0-9-]{8,80}$/u.test(record.presetId)))
      || Object.keys(record).some(key => !['format', 'sourceSessionId', 'kind', 'importId', 'characterId', 'presetId', 'agentPresetId'].includes(key))) {
      throw new Error('聊天迁移启动请求字段无效')
    }
    const agentPresetId = parseAgentPresetId(record.agentPresetId)
    return {
      format: 0,
      sourceSessionId: record.sourceSessionId as string,
      kind: 'chat',
      importId: record.importId,
      ...(typeof record.characterId === 'string' ? { characterId: record.characterId } : {}),
      ...(typeof record.presetId === 'string' ? { presetId: record.presetId } : {}),
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
    }
  }
  if (record.kind === 'experience') {
    if ((record.mode !== 'character' && record.mode !== 'scene')
      || (record.actor !== undefined && record.mode !== 'character')
      || (record.mode === 'character' && record.actor === undefined)
      || !Array.isArray(record.worlds) || record.worlds.length > 16
      || (record.regexPacks !== undefined && (!Array.isArray(record.regexPacks) || record.regexPacks.length > 16))
      || (record.mode === 'scene' && record.worlds.length === 0)
      || Object.keys(record).some(key => ![
        'format', 'sourceSessionId', 'kind', 'mode', 'actor', 'participant', 'worlds', 'promptPolicy', 'regexPacks', 'agentPresetId',
      ].includes(key))) {
      throw new Error('原生角色体验启动请求字段无效')
    }
    const actor = record.actor === undefined
      ? undefined
      : parseResourceSelection(record.actor, 'actor', '角色资源')
    const participant = record.participant === undefined
      ? undefined
      : parseResourceSelection(record.participant, 'persona', '玩家身份资源')
    const worlds = record.worlds.map(value => parseResourceSelection(value, 'world', '世界资源'))
    if (new Set(worlds.map(world => world.id)).size !== worlds.length) throw new Error('世界资源不能重复')
    const promptPolicy = record.promptPolicy === undefined
      ? undefined
      : parseResourceSelection(record.promptPolicy, 'prompt-policy', '提示策略资源')
    const regexPacks = (record.regexPacks ?? []).map(value => parseResourceSelection(value, 'regex', '正则包资源'))
    if (new Set(regexPacks.map(pack => pack.id)).size !== regexPacks.length) throw new Error('正则包资源不能重复')
    const agentPresetId = parseAgentPresetId(record.agentPresetId)
    return {
      format: 0,
      sourceSessionId: record.sourceSessionId as string,
      kind: 'experience',
      mode: record.mode,
      ...(actor === undefined ? {} : { actor }),
      ...(participant === undefined ? {} : { participant }),
      worlds,
      ...(promptPolicy === undefined ? {} : { promptPolicy }),
      regexPacks,
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
    }
  }
  if (record.kind === 'story-workspace') {
    if (typeof record.workspaceId !== 'string' || !storyWorkspaceIdPattern.test(record.workspaceId)
      || Object.keys(record).some(key => !['format', 'sourceSessionId', 'kind', 'workspaceId', 'agentPresetId'].includes(key))) {
      throw new Error('游玩场地会话启动请求字段无效')
    }
    const agentPresetId = parseAgentPresetId(record.agentPresetId)
    return {
      format: 0,
      sourceSessionId: record.sourceSessionId as string,
      kind: 'story-workspace',
      workspaceId: record.workspaceId,
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
    }
  }
  if (record.kind === 'rewrite') {
    if (typeof record.turn !== 'number' || !Number.isSafeInteger(record.turn) || record.turn < 1
      || typeof record.text !== 'string' || record.text.trim() === '' || record.text.length > 8_000
      || Object.keys(record).some(key => !['format', 'sourceSessionId', 'kind', 'turn', 'text'].includes(key))) {
      throw new Error('改写会话请求字段无效')
    }
    return {
      format: 0,
      sourceSessionId: record.sourceSessionId as string,
      kind: 'rewrite',
      turn: record.turn,
      text: record.text,
    }
  }
  throw new Error('角色会话启动类型无效')
}

function presetAttachment(entry: PresetLibraryEntry): FileAttachmentRef {
  return {
    kind: 'file',
    attachmentId: AttachmentId(`library:${entry.id}`),
    bytes: Buffer.byteLength(JSON.stringify(entry.preset), 'utf8'),
    name: 'preset.json',
    mediaType: 'application/json',
  }
}

function seedWithPreset(
  seed: readonly SessionEvent[],
  presets: PresetLibrary,
  presetId: string | undefined,
): readonly SessionEvent[] {
  if (presetId === undefined) return seed
  const entry = presets.get(presetId)
  return createPresetSessionSeed(seed, entry.preset, presetAttachment(entry), entry.id)
}

function seedWithWorldInfos(
  seed: readonly SessionEvent[],
  worldInfos: WorldInfoLibrary,
  worldInfoIds: readonly string[] | undefined,
  excludedIds: readonly string[] = [],
): readonly SessionEvent[] {
  const excluded = new Set(excludedIds)
  const selected = (worldInfoIds ?? worldInfos.defaultIds()).filter(id => !excluded.has(id))
  return selected.reduce(
    (events, id) => appendWorldInfoLibrarySessionSeed(events, worldInfos.asset(id)),
    seed,
  )
}

function libraryAttachment(
  characterId: string,
  transport: 'png' | 'json' | 'charx',
  bytes: number,
  originalFilename: string,
  mediaType: string,
): FileAttachmentRef {
  const extension = transport === 'png' ? 'png' : transport === 'charx' ? 'charx' : 'json'
  const name = new RegExp(`\\.${extension}$`, 'iu').test(originalFilename)
    ? originalFilename
    : `character.${extension}`
  return {
    kind: 'file',
    attachmentId: AttachmentId(`library:${characterId}`),
    bytes,
    name,
    mediaType,
  }
}

/** Resolve one validated launch into a balanced seed before any Agent exists. */
export function prepareAgentRpSession(
  characters: CharacterLibrary,
  chats: SillyTavernChatLibrary,
  presets: PresetLibrary,
  worldInfos: WorldInfoLibrary,
  request: Exclude<LibrarySessionLaunchRequest, StoryWorkspaceSessionLaunchRequest>,
  resources?: RoleplayResourceCatalog,
): PreparedAgentRpSession {
  if (request.kind === 'experience') {
    if (resources === undefined) throw new Error('当前 Host 没有可用的原生角色资源目录')
    return prepareRoleplayExperienceSession(resources, request)
  }
  if (request.kind === 'character') {
    const resolved = characters.resolve(request.characterId)
    if (resolved.detail.archived) throw new Error('请先恢复这个角色，再开始对话')
    const selectedGreeting = resolved.detail.greetings[request.greetingIndex]
    if (selectedGreeting === undefined) throw new Error(`角色卡没有第 ${request.greetingIndex + 1} 条开场白`)
    const source = libraryAttachment(
      request.characterId,
      resolved.transport.transport,
      resolved.source.bytes,
      resolved.source.originalFilename,
      resolved.source.mediaType,
    )
    const userName = request.persona?.name
    const characterSeed = createCharacterCardSessionSeed(
        resolved.card,
        source,
        request.greetingIndex,
        substituteCardMacros(selectedGreeting, resolved.card, userName).trim(),
        resolved.transport,
        userName,
        request.persona,
        request.characterId,
      )
    const characterWorldIds = characterWorldInfoIds(resolved.worldBinding)
    const characterWorldSeed = appendCharacterWorldSessionSeed(
      characterSeed,
      resolved.worldBinding,
      worldInfos,
    )
    return {
      seed: seedWithPreset(
        seedWithWorldInfos(
          characterWorldSeed,
          worldInfos,
          request.worldInfoIds,
          characterWorldIds,
        ),
        presets,
        request.presetId,
      ),
      title: resolved.detail.displayName,
    }
  }

  if (request.kind === 'world-info') {
    const asset = worldInfos.asset(request.importId)
    return {
      seed: seedWithPreset(
        seedWithWorldInfos(
          createWorldInfoLibrarySessionSeed(asset, request.persona),
          worldInfos,
          request.worldInfoIds,
          [request.importId],
        ),
        presets,
        request.presetId,
      ),
      title: asset.upload.name,
    }
  }

  const chat = chats.resolve(request.importId)
  if (request.characterId === undefined) {
    const identity = resolveSillyTavernChatIdentity(chat.chat)
    return {
      seed: seedWithPreset(createSillyTavernChatSeed(chat.chat, chat.attachment), presets, request.presetId),
      title: identity.characterName?.trim() || chat.upload.name.replace(/\.jsonl$/iu, ''),
    }
  }
  const character = characters.resolve(request.characterId)
  if (character.detail.archived) throw new Error('请先恢复这个角色，再迁移聊天记录')
  const source = libraryAttachment(
    request.characterId,
    character.transport.transport,
    character.source.bytes,
    character.source.originalFilename,
    character.source.mediaType,
  )
  const migrationSeed = createSillyTavernMigrationSeed(
      character.card,
      source,
      character.transport,
      chat.chat,
      chat.attachment,
      request.characterId,
    )
  return {
    seed: seedWithPreset(migrationSeed, presets, request.presetId),
    title: character.detail.displayName,
  }
}

/** Cut one completed user turn from an Agent RP transcript without changing its source. */
export function prepareAgentRpRewriteSession(
  session: Pick<Session, 'snapshotEvents'>,
  turn: number,
  sourceTitle?: string,
): PreparedAgentRpSession {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('改写轮次无效')
  const events = sessionEvents(session)
  const start = events.find(event => event.type === 'turn/start' && event.data.turn === turn)
  if (start === undefined) throw new Error(`第 ${turn} 轮不存在`)
  const end = events.find(event => event.seq > start.seq && event.type === 'turn/end' && event.data.turn === turn)
  if (end === undefined) throw new Error(`第 ${turn} 轮尚未完成，请等待回复结束`)
  const userMessage = events.find(event => event.seq > start.seq && event.seq < end.seq && event.type === 'user/message')
  if (userMessage === undefined) throw new Error('这一轮没有可改写的用户消息')
  const seed = events.slice(0, start.seq)
  const characterName = readActiveSessionCharacter(seed)?.result.name
  const title = sourceTitle?.trim() || characterName?.trim() || '角色对话'
  return { seed, title: `${title} · 改写` }
}
