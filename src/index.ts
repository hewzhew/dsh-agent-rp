/** Agent RP profile bundle and preset-scoped character runtime. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { WorkspaceSettingsStore } from './workspace-settings-store.ts'
import { installWorkspaceSettingsHttp } from './workspace-settings-http.ts'
import {
  Config,
  resolveConfig,
  type Config as AgentRpConfig,
  type ResolvedConfig,
} from './config.ts'
import {
  AGENT_RP_MEMORY_KINDS,
  prepareAgentRpMemory,
} from './memory.ts'
import { executeAgentRpMemoryCommand } from './memory-command.ts'
import { installAgentRpMemoryHttp } from './memory-http.ts'
import { parseCharacterCardJson, parseCharacterCardJsonBytes, parseCharacterCardValue } from './import/character-card.ts'
import { parseCharx } from './import/charx.ts'
import { createCharacterCardSessionSeed } from './import/character-card-seed.ts'
import { readCharacterCardPng } from './import/png.ts'
import {
  cardFromImportMeta,
  isCharxCharacterCardAttachment,
  isJsonCharacterCardAttachment,
  isPngCharacterCardAttachment,
  prepareCharacterImportResult,
  readActiveSessionCharacter,
  type CharacterCardAttachmentRef,
  type CharacterImportMeta,
  type FileAttachmentRef,
} from './import/session-character.ts'
import {
  CHARACTER_IMPORT_DEGRADATIONS,
  WORLD_INFO_IMPORT_DEGRADATIONS,
} from './import/types.ts'
import { parseWorldInfoJsonBytes } from './import/world-info.ts'
import { parseSillyTavernChatBytes } from './import/sillytavern-chat.ts'
import { parseSillyTavernPresetBytes, presetJson } from './import/sillytavern-preset.ts'
import { createSillyTavernMigrationSeed } from './import/sillytavern-migration-seed.ts'
import {
  createSillyTavernChatSeed,
  readSillyTavernChatIdentity,
  resolveSillyTavernChatIdentity,
} from './import/sillytavern-chat-seed.ts'
import {
  isJsonWorldInfoAttachment,
  prepareWorldInfoImportResult,
  type WorldInfoImportMeta,
} from './import/session-world-info.ts'
import {
  createPresetSessionSeed,
  preparePresetImportResult,
  readActiveSessionPreset,
  type PresetImportMeta,
} from './import/session-preset.ts'
import {
  renderCharacterPrompt,
  renderImportedChatPrompt,
  renderImportedCharacterPrompt,
  renderMemoryContext,
  roleplayVisibleDialogue,
  roleplayVisibleTranscript,
  renderSessionLorebooks,
  substituteCardMacros,
  type MacroDialogueContext,
} from './prompt.ts'
import { createEjsWorldInfoBooks, EjsTemplateEngine, type EjsTemplateContext } from './ejs-template.ts'
import { installBundledAgentRpPreset } from './preset.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { createAgentRpProjectionDefinition } from './projection.ts'
import { readCurrentMvuState } from './mvu.ts'
import { installMvuStreamCompletion } from './mvu-stream.ts'
import { installPromptRegexStream } from './prompt-regex-stream.ts'
import { assembleSillyTavernPreset, type SillyTavernInChatPrompt } from './preset-prompt.ts'
import { configurePresetFromCommand } from './preset-configuration.ts'
import { PresetLibrary } from './preset-library.ts'
import { installPresetLibraryHttp } from './preset-library-http.ts'
import { executePresetLibraryCommand } from './preset-library-command.ts'
import { CharacterLibrary } from './character-library.ts'
import { executeCharacterLibraryCommand } from './character-library-command.ts'
import { installCharacterLibraryHttp } from './character-library-http.ts'
import {
  CHARACTER_LIBRARY_SESSION_PREFIX,
  type CharacterLibrarySessionRequest,
} from './character-library-protocol.ts'
import { installPersonaLibraryHttp } from './persona-library-http.ts'
import { PersonaLibrary } from './persona-library.ts'
import { parseSessionPersona, resolveSessionPersonaIdentity } from './session-persona.ts'
import { executePersonaCommand } from './persona-command.ts'
import { executeSillyTavernChatCommand } from './sillytavern-chat-command.ts'
import { installSillyTavernChatHttp } from './sillytavern-chat-http.ts'
import { SillyTavernChatLibrary } from './sillytavern-chat-library.ts'
import { installSillyTavernChatExportHttp } from './sillytavern-chat-export-http.ts'
import { installSessionLaunchHttp } from './session-launch-http.ts'
import { executeGenerationCommand } from './generation.ts'
import type { AgentRpHttpServer } from './host-http.ts'
import {
  configuredLorebook,
  readWorldInfoConfiguration,
  worldInfoTokenBudget,
} from './world-info-configuration-core.ts'
import {
  executeWorldInfoConfiguration,
  readActiveSessionLorebookSources,
} from './world-info-configuration.ts'
import { WorldInfoLibrary } from './world-info-library.ts'
import { executeWorldInfoLibraryCommand } from './world-info-library-command.ts'
import { installWorldInfoLibraryHttp } from './world-info-library-http.ts'
import { GeneratedImageLibrary } from './generated-image-library.ts'
import { executeImageGenerationCommand } from './image-generation-command.ts'
import { installImageGenerationHttp } from './image-generation-http.ts'
import { executeTavernHelperMutation } from './tavern-helper-command.ts'
import {
  readTavernHelperState,
  tavernInjectedInChatPrompts,
  tavernInjectedScanText,
  type TavernHelperState,
} from './tavern-helper.ts'
import { executeTavernTrigger } from './tavern-trigger.ts'
import { installTavernGenerationHttp } from './tavern-generation-http.ts'
import { installTavernModelListHttp } from './tavern-model-list-http.ts'
import { installRpDistributionBridgeHttp } from './rp-distribution-bridge-http.ts'

/** Cordis plugin identity. */
export const name = 'dsh-agent-rp'
export { Config }
export const inject = ['attachments', 'commands', 'credentials', 'llm', 'systemPrompt', 'tools']

interface PromptAttachmentGateway {
  registerPromptAttachmentConsumer?(
    name: string,
    consumer: (offer: {
      readonly agent: Agent
      readonly content: ReadonlyArray<
        | { readonly type: 'text'; readonly text: string }
        | { readonly type: 'image'; readonly mediaType: string; readonly name?: string }
        | { readonly type: 'file'; readonly name: string; readonly mediaType?: string }
      >
    }) => { readonly text: string } | undefined,
  ): () => void
  registerPromptSessionImporter?(
    name: string,
    importer: {
      recognize(offer: {
        readonly agent: Agent
        readonly content: ReadonlyArray<
          | { readonly type: 'text'; readonly text: string }
          | { readonly type: 'image'; readonly mediaType: string; readonly name?: string }
          | { readonly type: 'file'; readonly name: string; readonly mediaType?: string }
        >
      }): boolean
      import(input: {
        readonly source: Agent
        readonly text: string
        readonly attachments: readonly PromptImportAttachment[]
        readFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<Uint8Array>
      }, signal?: AbortSignal): Promise<{ readonly seed: readonly SessionEvent[]; readonly title?: string }>
    },
  ): () => void
}

interface HumanCommandGateway {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input: { readonly hint: string }
    readonly recordInput?: boolean
    readonly handler: (invocation: {
      readonly commandId: CommandId
      readonly agent: Agent
      readonly rawInput: string
      readonly signal: AbortSignal
    }) => { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: number }
      | Promise<{ readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: number }>
  }): () => void
}

interface FileAttachmentReader {
  readFile(
    ref: FileAttachmentRef,
    signal?: AbortSignal,
  ): Promise<{ readonly ref: FileAttachmentRef; readonly data: Uint8Array }>
  readImage(
    ref: ImageAttachmentRef,
    signal?: AbortSignal,
  ): Promise<{ readonly ref: ImageAttachmentRef; readonly data: Uint8Array }>
}

type PromptImportAttachment = CharacterCardAttachmentRef | FileAttachmentRef

type PromptAttachmentPart = Parameters<Parameters<NonNullable<PromptAttachmentGateway['registerPromptAttachmentConsumer']>>[1]>[0]['content'][number]

function decodeCharacterCardAttachment(
  attachment: CharacterCardAttachmentRef,
  data: Uint8Array,
): { readonly card: import('./import/types.ts').ImportedCharacterCard; readonly transport: import('./import/session-character.ts').CharacterImportTransport } {
  if (isCharxCharacterCardAttachment(attachment)) {
    return { card: parseCharx(data).card, transport: { transport: 'charx' } }
  }
  if (isJsonCharacterCardAttachment(attachment)) {
    return { card: parseCharacterCardJsonBytes(data), transport: { transport: 'json' } }
  }
  const payload = readCharacterCardPng(data)
  return {
    card: parseCharacterCardJson(payload.json),
    transport: { transport: 'png', metadataKeyword: payload.keyword },
  }
}

function isCharacterCardOffer(part: PromptAttachmentPart): boolean {
  return part.type === 'image'
    ? part.mediaType === 'image/png'
    : part.type === 'file' && /\.(?:json|charx)$/iu.test(part.name)
}

function isWorldInfoRequest(text: string): boolean {
  return /(?:世界书|世界信息|world\s*info|lorebook)/iu.test(text) && /(?:导入|加载|使用|接入)/u.test(text)
}

function isPresetRequest(text: string): boolean {
  return /(?:预设|preset)/iu.test(text) && /(?:导入|加载|使用|接入)/u.test(text)
}

/** Recognize one preset attachment before opening a model turn. */
export function isSillyTavernPresetOffer(
  agentRpActive: boolean,
  content: readonly PromptAttachmentPart[],
): boolean {
  if (!agentRpActive) return false
  const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const attachments = content.filter(part => part.type !== 'text')
  return isPresetRequest(text)
    && attachments.length === 1
    && attachments[0]?.type === 'file'
    && /\.json$/iu.test(attachments[0].name)
}

/** Recognize one explicit Character Card import without exposing attachment bytes to the model. */
export function claimAgentRpPrompt(
  agentRpActive: boolean,
  content: readonly PromptAttachmentPart[],
): { readonly text: string } | undefined {
  if (!agentRpActive) return undefined
  const attachments = content.filter(part => part.type !== 'text')
  const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  if (isWorldInfoRequest(text)) {
    const files = attachments.filter(part => part.type === 'file' && /\.json$/iu.test(part.name))
    return files.length === 1 ? { text } : undefined
  }
  if (isPresetRequest(text)) {
    const files = attachments.filter(part => part.type === 'file' && /\.json$/iu.test(part.name))
    return files.length === 1 ? { text } : undefined
  }
  const cards = attachments.filter(isCharacterCardOffer)
  if (cards.length !== 1 || !/(?:角色卡|character\s*card|导入|接管|切换角色)/iu.test(text)) return undefined
  return { text }
}

/** Recognize one standalone SillyTavern JSONL chat upload. */
export function isSillyTavernChatOffer(
  agentRpActive: boolean,
  content: readonly PromptAttachmentPart[],
): boolean {
  if (!agentRpActive) return false
  const attachments = content.filter(part => part.type !== 'text')
  return attachments.length === 1
    && attachments[0]?.type === 'file'
    && /\.jsonl$/iu.test(attachments[0].name)
}

/** Recognize one Character Card and one JSONL chat submitted together. */
export function isSillyTavernMigrationOffer(
  agentRpActive: boolean,
  content: readonly PromptAttachmentPart[],
): boolean {
  if (!agentRpActive) return false
  const attachments = content.filter(part => part.type !== 'text')
  return attachments.length === 2
    && attachments.filter(isCharacterCardOffer).length === 1
    && attachments.filter(part => part.type === 'file' && /\.jsonl$/iu.test(part.name)).length === 1
}

/** Recognize one explicitly selected standalone Character Card import. */
export function isCharacterCardSessionOffer(
  agentRpActive: boolean,
  content: readonly PromptAttachmentPart[],
): boolean {
  if (!agentRpActive) return false
  const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const attachments = content.filter(part => part.type !== 'text')
  return parseCharacterCardSessionRequest(text) !== undefined
    && attachments.length === 1
    && attachments[0] !== undefined
    && isCharacterCardOffer(attachments[0])
}

/** Parse a legacy direct import or an explicit character-library launch. */
export function parseCharacterCardSessionRequest(text: string): CharacterLibrarySessionRequest | undefined {
  const source = text.trim()
  if (source === '请导入这张角色卡') return { format: 0, greetingIndex: 0 }
  if (!source.startsWith(`${CHARACTER_LIBRARY_SESSION_PREFIX}\n`)) return undefined
  let value: unknown
  try {
    value = JSON.parse(source.slice(CHARACTER_LIBRARY_SESSION_PREFIX.length + 1))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.format !== 0 || typeof record.greetingIndex !== 'number'
    || !Number.isSafeInteger(record.greetingIndex) || record.greetingIndex < 0
    || (record.userName !== undefined && (typeof record.userName !== 'string'
      || record.userName.trim() === '' || record.userName.trim().length > 120))
    || keys.some(key => key !== 'format' && key !== 'greetingIndex' && key !== 'userName' && key !== 'persona')) return undefined
  let persona
  try {
    persona = record.persona === undefined ? undefined : parseSessionPersona(record.persona)
  } catch {
    return undefined
  }
  if (persona !== undefined && typeof record.userName === 'string' && record.userName.trim() !== persona.name) return undefined
  return {
    format: 0,
    greetingIndex: record.greetingIndex,
    ...(persona === undefined && typeof record.userName === 'string' ? { userName: record.userName.trim() } : {}),
    ...(persona === undefined ? {} : { persona }),
  }
}

/** Canonical output schema for one accepted `remember` call. */
export const MEMORY_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true, const: 0 },
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: AGENT_RP_MEMORY_KINDS },
    subject: { type: 'string', required: true },
    text: { type: 'string', required: true },
    sourceEventSeq: { type: 'integer', required: true },
    supersedes: { type: 'string' },
  },
} as const

/** Canonical output schema for one accepted Character Card import. */
export const CHARACTER_IMPORT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true, const: 0 },
    name: { type: 'string', required: true },
    cardVersion: { type: 'integer', required: true, enum: [1, 2, 3] },
    sourceEventSeq: { type: 'integer', required: true },
    sourceAttachmentId: { type: 'string', required: true },
    transport: { type: 'string', required: true, enum: ['png', 'json', 'charx'] },
    metadataKeyword: { type: 'string', enum: ['ccv3', 'chara'] },
    greetingIndex: { type: 'integer', required: true },
    selectedGreeting: { type: 'string', required: true },
    userName: { type: 'string' },
    libraryId: { type: 'string' },
    degradations: { type: 'array', required: true, items: { type: 'string', enum: CHARACTER_IMPORT_DEGRADATIONS } },
    raw: { type: 'json', required: true },
  },
} as const

/** Canonical output schema for one accepted standalone World Info import. */
export const WORLD_INFO_IMPORT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true, const: 0 },
    name: { type: 'string', required: true },
    sourceEventSeq: { type: 'integer', required: true },
    sourceAttachmentId: { type: 'string', required: true },
    entryCount: { type: 'integer', required: true },
    degradations: { type: 'array', required: true, items: { type: 'string', enum: WORLD_INFO_IMPORT_DEGRADATIONS } },
    raw: { type: 'json', required: true },
  },
} as const

/** Canonical output schema for one accepted SillyTavern preset import. */
export const PRESET_IMPORT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true, const: 0 },
    name: { type: 'string', required: true },
    sourceEventSeq: { type: 'integer', required: true },
    sourceAttachmentId: { type: 'string', required: true },
    promptCount: { type: 'integer', required: true },
    enabledCount: { type: 'integer', required: true },
    regexScriptCount: { type: 'integer', required: true },
    preset: { type: 'json', required: true },
  },
} as const

function rememberCall(subject: string, text: string): GenericCallView {
  return { card: 'generic', title: `记住：${subject}`, kind: 'other', rawInput: text }
}

function isCharacterCardAttachment(value: unknown): value is CharacterCardAttachmentRef {
  return isPngCharacterCardAttachment(value) || isJsonCharacterCardAttachment(value)
    || isCharxCharacterCardAttachment(value)
}

function latestConsumedAttachments(agent: Agent): { eventSeq: number; attachments: FileAttachmentRef[] } {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const source = event.data.source as unknown as { attachmentConsumer?: unknown; attachments?: unknown }
    const attachments = source.attachmentConsumer === 'dsh-agent-rp' && Array.isArray(source.attachments)
      ? source.attachments.filter(isJsonWorldInfoAttachment)
      : []
    if (attachments.length === 0) throw new Error('当前消息没有可导入的 JSON 文件')
    return { eventSeq: event.seq, attachments }
  }
  throw new Error('没有找到导入请求；请在同一条消息中附上 JSON 文件')
}

function latestUserAttachments(agent: Agent): { eventSeq: number; attachments: CharacterCardAttachmentRef[] } {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const direct = event.data.content.flatMap(block => block.type === 'image' ? [block.attachment] : [])
    const source = event.data.source as unknown as {
      attachmentConsumer?: unknown
      attachments?: unknown
    }
    const consumed = source.attachmentConsumer === 'dsh-agent-rp' && Array.isArray(source.attachments)
      ? source.attachments.filter(isCharacterCardAttachment)
      : []
    const attachments = [...direct.filter(isCharacterCardAttachment), ...consumed]
    if (attachments.length === 0) throw new Error('当前消息没有可导入的角色卡；请附上 Character Card PNG、JSON 或 CHARX')
    return { eventSeq: event.seq, attachments }
  }
  throw new Error('没有找到导入请求；请在同一条消息中附上 Character Card PNG、JSON 或 CHARX')
}

function importedCharacter(agentsByScope: WeakMap<ScopeKey, Agent>, scope: ScopeKey | undefined) {
  if (scope === undefined) return undefined
  const agent = agentsByScope.get(scope)
  return agent === undefined ? undefined : readActiveSessionCharacter(agent.session.events)
}

function ejsVariableScopes(state: TavernHelperState | undefined): NonNullable<EjsTemplateContext['variableScopes']> {
  return state?.scopes ?? {}
}

function ejsLorebookOptions(engine: EjsTemplateEngine | undefined, context: EjsTemplateContext) {
  return engine === undefined ? {} : {
    regexEngine: engine,
    renderTemplate: engine.createRenderer(context),
  }
}

/**
 * Attach one persistent character identity and memory tool to a top-level Agent.
 * @param agent - published top-level Agent whose scope owns every registration.
 * @param config - normalized character configuration.
 */
export function installAgentRp(
  ctx: Context,
  config: ResolvedConfig,
  options: {
    readonly characterLibraryRoot?: string
    readonly ejsTemplateEngine?: EjsTemplateEngine
  } = {},
): void {
  const agentsByScope = new WeakMap<ScopeKey, Agent>()
  const agentsBySession = new Map<string, Agent>()
  const pendingMessagesByAgent = new WeakMap<Agent, UserMessage[]>()
  const presetAfterHistoryByAgent = new WeakMap<Agent, string>()
  const presetInChatByAgent = new WeakMap<Agent, readonly SillyTavernInChatPrompt[]>()
  const gateway = ctx.get('apiProxy') as PromptAttachmentGateway | undefined
  const commands = (ctx as Context & { commands: HumanCommandGateway }).commands
  const presetLibrary = new PresetLibrary()
  const characterLibrary = new CharacterLibrary(options.characterLibraryRoot === undefined
    ? {}
    : { root: options.characterLibraryRoot })
  const chatLibrary = new SillyTavernChatLibrary()
  const worldInfoLibrary = new WorldInfoLibrary()
  const generatedImageLibrary = new GeneratedImageLibrary()
  const workspaceSettings = new WorkspaceSettingsStore()

  commands.register({
    name: 'rp-tavern-variables',
    description: 'persist an isolated Tavern Helper variable namespace',
    input: { hint: '<private Tavern Helper variable payload>' },
    recordInput: false,
    handler: executeTavernHelperMutation,
  })
  commands.register({
    name: 'rp-tavern-trigger',
    description: 'generate a roleplay reply after a Tavern script appends a user message',
    recordInput: false,
    handler: executeTavernTrigger,
  })
  commands.register({
    name: 'rp-character-library',
    description: 'start a roleplay Session from one local Character Card',
    input: { hint: '<private character-library payload>' },
    recordInput: false,
    handler: invocation => executeCharacterLibraryCommand(characterLibrary, invocation),
  })
  commands.register({
    name: 'rp-chat-import',
    description: 'migrate one Host-owned SillyTavern chat into this Session',
    input: { hint: '<private SillyTavern chat payload>' },
    recordInput: false,
    handler: invocation => executeSillyTavernChatCommand(chatLibrary, characterLibrary, invocation),
  })
  commands.register({
    name: 'rp-persona',
    description: 'change this roleplay Session Persona',
    input: { hint: '<private Persona payload>' },
    recordInput: false,
    handler: executePersonaCommand,
  })
  commands.register({
    name: 'rp-memory',
    description: 'correct or forget one active roleplay memory',
    input: { hint: '<private memory-manager payload>' },
    recordInput: false,
    handler: executeAgentRpMemoryCommand,
  })
  commands.register({
    name: 'rp-preset-configure',
    description: 'update this roleplay Session preset',
    input: { hint: '<private preset-manager payload>' },
    handler: configurePresetFromCommand,
  })
  commands.register({
    name: 'rp-preset-library',
    description: 'manage reusable roleplay presets',
    input: { hint: '<private preset-library payload>' },
    handler: invocation => executePresetLibraryCommand(presetLibrary, invocation),
  })
  commands.register({
    name: 'rp-generation',
    description: 'manage persistent roleplay reply versions',
    input: { hint: '<private reply-version payload>' },
    recordInput: false,
    handler: executeGenerationCommand,
  })
  commands.register({
    name: 'rp-draw',
    description: 'generate one roleplay image through the configured local provider',
    input: { hint: '<private image-generation payload>' },
    handler: invocation => executeImageGenerationCommand(
      generatedImageLibrary,
      workspaceSettings,
      ctx.credentials,
      invocation,
    ),
  })
  commands.register({
    name: 'rp-world-info',
    description: 'manage this roleplay Session world info',
    input: { hint: '<private world-info-manager payload>' },
    recordInput: false,
    handler: executeWorldInfoConfiguration,
  })
  commands.register({
    name: 'rp-world-info-import',
    description: 'import one Host-owned World Info source into this roleplay Session',
    input: { hint: '<private world-info import payload>' },
    recordInput: false,
    handler: invocation => executeWorldInfoLibraryCommand(worldInfoLibrary, invocation),
  })
  const registerAttachmentConsumer = gateway?.registerPromptAttachmentConsumer?.bind(gateway)
  if (registerAttachmentConsumer !== undefined) ctx.effect(() => registerAttachmentConsumer(
    'dsh-agent-rp',
    ({ agent, content }) => claimAgentRpPrompt(agentsByScope.get(agent) === agent, content),
  ), 'agent-rp: prompt attachment consumer')
  const registerSessionImporter = gateway?.registerPromptSessionImporter?.bind(gateway)
  if (registerSessionImporter !== undefined) ctx.effect(() => registerSessionImporter('dsh-agent-rp:sillytavern-migration', {
    recognize: ({ agent, content }) => isSillyTavernMigrationOffer(agentsByScope.get(agent) === agent, content),
    async import(input, signal) {
      const cardAttachment = input.attachments.find(attachment =>
        isJsonCharacterCardAttachment(attachment) || isPngCharacterCardAttachment(attachment)
        || isCharxCharacterCardAttachment(attachment))
      const chatAttachment = input.attachments.find((attachment): attachment is FileAttachmentRef =>
        'kind' in attachment && attachment.kind === 'file' && /\.jsonl$/iu.test(attachment.name))
      if (cardAttachment === undefined || chatAttachment === undefined) {
        throw new Error('SillyTavern migration requires one Character Card PNG, JSON, or CHARX and one chat JSONL')
      }
      const reader = ctx.attachments as unknown as FileAttachmentReader
      const [storedCard, chatBytes] = await Promise.all([
        isJsonCharacterCardAttachment(cardAttachment) || isCharxCharacterCardAttachment(cardAttachment)
          ? input.readFile(cardAttachment, signal).then(data => ({ ref: cardAttachment, data }))
          : reader.readImage(cardAttachment, signal),
        input.readFile(chatAttachment, signal),
      ])
      const { card, transport } = decodeCharacterCardAttachment(storedCard.ref, storedCard.data)
      const libraryEntry = characterLibrary.import({
        data: storedCard.data,
        ...(storedCard.ref.name === undefined ? {} : { filename: storedCard.ref.name }),
        ...(storedCard.ref.mediaType === undefined ? {} : { mediaType: storedCard.ref.mediaType }),
        card,
        transport,
      })
      const chat = parseSillyTavernChatBytes(chatBytes)
      return {
        seed: createSillyTavernMigrationSeed(card, storedCard.ref, transport, chat, chatAttachment, libraryEntry.id),
        title: card.nickname?.trim() || card.name,
      }
    },
  }), 'agent-rp: SillyTavern migration importer')
  if (registerSessionImporter !== undefined) ctx.effect(() => registerSessionImporter('dsh-agent-rp:sillytavern-chat', {
    recognize: ({ agent, content }) => isSillyTavernChatOffer(agentsByScope.get(agent) === agent, content),
    async import(input, signal) {
      if (input.attachments.length !== 1) throw new Error('SillyTavern chat import requires exactly one file')
      const attachment = input.attachments[0]
      if (attachment === undefined || !('kind' in attachment) || attachment.kind !== 'file'
        || !/\.jsonl$/iu.test(attachment.name)) {
        throw new Error('SillyTavern chat import requires one .jsonl file')
      }
      const chat = parseSillyTavernChatBytes(await input.readFile(attachment, signal))
      const title = resolveSillyTavernChatIdentity(chat).characterName
      return {
        seed: createSillyTavernChatSeed(chat, attachment),
        ...(title === undefined || title === '' ? {} : { title }),
      }
    },
  }), 'agent-rp: SillyTavern chat importer')
  if (registerSessionImporter !== undefined) ctx.effect(() => registerSessionImporter('dsh-agent-rp:character-card', {
    recognize: ({ agent, content }) => isCharacterCardSessionOffer(agentsByScope.get(agent) === agent, content),
    async import(input, signal) {
      if (input.attachments.length !== 1) throw new Error('Character Card import requires exactly one file')
      const attachment = input.attachments[0]
      if (attachment === undefined
        || (!isJsonCharacterCardAttachment(attachment) && !isPngCharacterCardAttachment(attachment)
          && !isCharxCharacterCardAttachment(attachment))) {
        throw new Error('Character Card import requires one PNG, JSON, or CHARX card')
      }
      const reader = ctx.attachments as unknown as FileAttachmentReader
      const stored = isJsonCharacterCardAttachment(attachment) || isCharxCharacterCardAttachment(attachment)
        ? { ref: attachment, data: await input.readFile(attachment, signal) }
        : await reader.readImage(attachment, signal)
      const { card, transport } = decodeCharacterCardAttachment(stored.ref, stored.data)
      const request = parseCharacterCardSessionRequest(input.text)
      if (request === undefined) throw new Error('Character Card import request is invalid')
      const greetings = [card.firstMessage, ...card.alternateGreetings]
      const selectedGreeting = greetings[request.greetingIndex]
      if (selectedGreeting === undefined) {
        throw new Error(`角色卡没有第 ${request.greetingIndex + 1} 条开场白`)
      }
      const libraryEntry = characterLibrary.import({
        data: stored.data,
        ...(stored.ref.name === undefined ? {} : { filename: stored.ref.name }),
        ...(stored.ref.mediaType === undefined ? {} : { mediaType: stored.ref.mediaType }),
        card,
        transport,
      })
      const userName = request.persona?.name ?? request.userName
      const greeting = substituteCardMacros(selectedGreeting, card, userName)
      return {
        seed: createCharacterCardSessionSeed(
          card, stored.ref, request.greetingIndex, greeting, transport, userName, request.persona, libraryEntry.id,
        ),
        title: card.nickname?.trim() || card.name,
      }
    },
  }), 'agent-rp: Character Card importer')
  if (registerSessionImporter !== undefined) ctx.effect(() => registerSessionImporter('dsh-agent-rp:sillytavern-preset', {
    recognize: ({ agent, content }) => isSillyTavernPresetOffer(agentsByScope.get(agent) === agent, content),
    async import(input, signal) {
      if (input.attachments.length !== 1) throw new Error('SillyTavern preset import requires exactly one file')
      const attachment = input.attachments[0]
      if (attachment === undefined || !('kind' in attachment) || attachment.kind !== 'file'
        || !/\.json$/iu.test(attachment.name)) {
        throw new Error('SillyTavern preset import requires one JSON file')
      }
      const preset = parseSillyTavernPresetBytes(await input.readFile(attachment, signal), attachment.name)
      const libraryEntry = presetLibrary.import(preset)
      return {
        seed: createPresetSessionSeed(input.source.session.events, libraryEntry.preset, attachment, libraryEntry.id),
        title: readActiveSessionCharacter(input.source.session.events)?.result.name ?? preset.name,
      }
    },
  }), 'agent-rp: SillyTavern preset importer')
  ctx.systemPrompt.section({
    name: 'deployment:persona',
    order: 0,
    text: ({ scope }) => {
      const agent = scope === undefined ? undefined : agentsByScope.get(scope)
      const pendingMessages = agent === undefined ? [] : pendingMessagesByAgent.get(agent) ?? []
      if (agent !== undefined) pendingMessagesByAgent.delete(agent)
      const active = importedCharacter(agentsByScope, scope)
      if (agent === undefined) return renderCharacterPrompt(config)
      const tavern = readTavernHelperState(agent.session.events)
      const injectedScanText = tavernInjectedScanText(tavern)
      const sources = readActiveSessionLorebookSources(agent)
      const worldInfoConfiguration = readWorldInfoConfiguration(agent.session.events)
      const configuredSources = sources.map(source => ({
        source,
        configured: configuredLorebook(source, worldInfoConfiguration).lorebook,
      }))
      const books = configuredSources.map(({ source, configured }) => ({
        id: source.id,
        name: source.name,
        lorebook: configured,
      }))
      const splitLore = (rendered: ReturnType<typeof renderSessionLorebooks>) => {
        const collect = (source: 'character' | 'standalone') => {
          const selected = rendered.books.filter((_book, index) => configuredSources[index]?.source.source === source)
          return {
            beforeCharacter: selected.flatMap(book => book.inspected.beforeCharacter),
            afterCharacter: selected.flatMap(book => book.inspected.afterCharacter),
          }
        }
        return { character: collect('character'), standalone: collect('standalone') }
      }
      if (active === undefined) {
        const importedChat = readSillyTavernChatIdentity(agent.session.events)
        const identity = resolveSessionPersonaIdentity(agent.session.events, undefined, importedChat?.userName)
        const templateOptions = ejsLorebookOptions(options.ejsTemplateEngine, {
          characterName: importedChat?.characterName ?? config.characterName,
          userName: identity.userName ?? '用户',
          messages: [...roleplayVisibleDialogue(agent.session, pendingMessages), ...injectedScanText],
          transcript: roleplayVisibleTranscript(agent.session, pendingMessages),
          variableScopes: ejsVariableScopes(tavern),
          worldInfoBooks: createEjsWorldInfoBooks(books),
        })
        const { standalone: standaloneLore } = splitLore(renderSessionLorebooks({
          books,
          session: agent.session,
          pendingMessages,
          scanText: injectedScanText,
          templateOptions,
          tokenBudget: worldInfoTokenBudget(worldInfoConfiguration),
        }))
        if (importedChat !== undefined) {
          return [
            ...standaloneLore.beforeCharacter,
            renderImportedChatPrompt(importedChat.characterName, identity.userName, identity.persona?.description),
            ...standaloneLore.afterCharacter,
          ].join('\n\n')
        }
        return renderCharacterPrompt(config, standaloneLore.beforeCharacter, standaloneLore.afterCharacter)
      }
      const importedCard = cardFromImportMeta(active.meta)
      const cardLorebook = configuredSources.find(value => value.source.source === 'character')?.configured
      const { lorebook: _importedLorebook, ...cardWithoutLorebook } = importedCard
      const card = cardLorebook === undefined ? cardWithoutLorebook : { ...importedCard, lorebook: cardLorebook }
      const identity = resolveSessionPersonaIdentity(
        agent.session.events,
        active.result.userName,
        readSillyTavernChatIdentity(agent.session.events)?.userName,
      )
      const { persona, userName } = identity
      const mvu = readCurrentMvuState(card, agent.session.events)
      const dialogueContext: MacroDialogueContext = {
        card,
        ...(userName === undefined ? {} : { userName }),
        ...(persona === undefined ? {} : { persona: persona.description }),
      }
      const templateOptions = ejsLorebookOptions(options.ejsTemplateEngine, {
        characterName: card.nickname?.trim() || card.name,
        userName: userName ?? '用户',
        messages: [...roleplayVisibleDialogue(agent.session, pendingMessages, dialogueContext), ...injectedScanText],
        transcript: roleplayVisibleTranscript(agent.session, pendingMessages, dialogueContext),
        variableScopes: ejsVariableScopes(tavern),
        ...(mvu === undefined ? {} : { statData: mvu.statData }),
        worldInfoBooks: createEjsWorldInfoBooks(books),
      })
      const { standalone: standaloneLore, character: characterLore } = splitLore(renderSessionLorebooks({
        books,
        session: agent.session,
        pendingMessages,
        scanText: injectedScanText,
        ...(mvu === undefined ? {} : { statData: mvu.statData }),
        context: dialogueContext,
        templateOptions,
        tokenBudget: worldInfoTokenBudget(worldInfoConfiguration),
      }))
      const preset = readActiveSessionPreset(agent.session.events)?.preset
      if (preset !== undefined) {
        const assembled = assembleSillyTavernPreset(preset, {
          card,
          ...(userName === undefined ? {} : { userName }),
          ...(persona === undefined ? {} : { userPersona: persona.description }),
          worldInfoBefore: [...standaloneLore.beforeCharacter, ...characterLore.beforeCharacter],
          worldInfoAfter: [...characterLore.afterCharacter, ...standaloneLore.afterCharacter],
          session: agent.session,
          pendingMessages,
          mvuEnabled: mvu !== undefined,
          ...(templateOptions.renderTemplate === undefined ? {} : { renderTemplate: templateOptions.renderTemplate }),
        })
        presetAfterHistoryByAgent.set(agent, assembled.afterHistory)
        presetInChatByAgent.set(agent, assembled.inChat)
        return assembled.system
      }
      presetAfterHistoryByAgent.delete(agent)
      presetInChatByAgent.delete(agent)
      return renderImportedCharacterPrompt(
        card,
        [...standaloneLore.beforeCharacter, ...characterLore.beforeCharacter],
        [...characterLore.afterCharacter, ...standaloneLore.afterCharacter],
        userName,
        mvu?.statData,
        persona?.description,
        templateOptions,
      )
    },
    complete: true,
  })
  ctx.on('agent/created', ({ agent }) => {
    agentsByScope.set(agent, agent)
    agentsBySession.set(String(agent.session.id), agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    agentsByScope.delete(agent)
    agentsBySession.delete(String(agent.session.id))
    pendingMessagesByAgent.delete(agent)
    presetAfterHistoryByAgent.delete(agent)
    presetInChatByAgent.delete(agent)
  })
  installPromptRegexStream(
    ctx,
    sessionId => agentsBySession.get(sessionId),
    agent => [
      ...(presetInChatByAgent.get(agent) ?? []),
      ...tavernInjectedInChatPrompts(readTavernHelperState(agent.session.events)),
    ],
  )
  installMvuStreamCompletion(ctx, sessionId => agentsBySession.get(sessionId))
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (agentsByScope.get(agent) !== agent) return
    const pending = pendingMessagesByAgent.get(agent)
    if (pending === undefined) pendingMessagesByAgent.set(agent, [message])
    else pending.push(message)
  })
  ctx.systemPrompt.context({
    name: 'agent-rp:memory',
    order: 70,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = agentsByScope.get(scope)
      return agent === undefined ? '' : renderMemoryContext(agent.session.events)
    },
  })
  ctx.systemPrompt.context({
    name: 'agent-rp:preset-after-history',
    order: 60,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = agentsByScope.get(scope)
      if (agent === undefined) return ''
      const value = presetAfterHistoryByAgent.get(agent) ?? ''
      presetAfterHistoryByAgent.delete(agent)
      return value
    },
  })
  ctx.on('agent/request', async ({ agent }, next) => {
    const config = await next()
    if (agentsByScope.get(agent) !== agent) return config
    const generation = readActiveSessionPreset(agent.session.events)?.preset.generation
    if (generation === undefined) return config
    const requestedEffort = generation.reasoningEffort
    const modelInfo = requestedEffort === undefined || requestedEffort === 'auto'
      ? undefined
      : await ctx.llm.resolveModelInfo(config.provider, config.model)
    const supportedEffort = modelInfo?.reasoning?.efforts.some(effort => effort.id === requestedEffort) === true
      ? requestedEffort
      : undefined
    return {
      ...config,
      ...generation.temperature === undefined ? {} : { temperature: generation.temperature },
      ...generation.maxTokens === undefined
        ? {}
        : { maxTokens: Math.min(generation.maxTokens, config.maxTokens ?? generation.maxTokens) },
      ...supportedEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(supportedEffort) },
    }
  })
  ctx.systemPrompt.context({ name: 'sandbox:policy', order: 0, text: '' })
  ctx.systemPrompt.context({ name: 'approval:policy', order: 0, text: '' })
  ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Persist one confirmed fact, promise, preference, relationship change, or shared event for later turns in this Session. Do not repeat information already covered. When this topic already exists, use supersedes with its active memory id instead of adding another record.',
    parameters: {
      kind: {
        type: 'string',
        enum: AGENT_RP_MEMORY_KINDS,
        required: true,
        description: 'Why this information must remain available in later turns.',
      },
      subject: {
        type: 'string',
        required: true,
        description: 'Short stable topic used to distinguish this memory from unrelated records.',
      },
      text: {
        type: 'string',
        required: true,
        description: 'Concise confirmed information to remember without speculation or hidden reasoning.',
      },
      supersedes: {
        type: 'string',
        description: 'Active memory id replaced by this corrected record.',
      },
    },
    output: {
      schema: MEMORY_VALUE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('remember requires an Agent Session')
      if (exec.parent !== undefined) throw new Error('remember must be called directly by the character Agent')
      const record = prepareAgentRpMemory(exec.agent.session, String(exec.callId), args)
      return Promise.resolve(record)
    },
    presentCall: args => rememberCall(args.subject, args.text),
    isConcurrencySafe: () => false,
  }))
  ctx.tools.register(defineTool({
    name: 'import_sillytavern_preset',
    description: 'Import one SillyTavern Chat Completion preset JSON attachment from the latest user message. The complete Prompt Manager module set and order become active for this roleplay Session; extension payloads remain preserved in the original attachment.',
    parameters: {
      attachmentIndex: {
        type: 'integer',
        description: 'Zero-based JSON attachment index in the latest user message. Omit when it contains exactly one file.',
      },
    },
    output: {
      schema: PRESET_IMPORT_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `已启用预设 ${value.name}：${value.promptCount} 个提示模块，当前启用 ${value.enabledCount} 个。原始扩展数据已随附件保留。`,
      }],
      presentationMeta: (_args, value) => {
        const { preset, ...result } = value
        const meta: PresetImportMeta = {
          format: 0,
          result,
          preset: preset as unknown as import('./import/sillytavern-preset.ts').ImportedSillyTavernPreset,
        }
        return meta as unknown as import('@deepseek-ai/dsh-session').JsonValue
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('import_sillytavern_preset requires an Agent Session')
      if (exec.parent !== undefined) throw new Error('import_sillytavern_preset must be called directly by the character Agent')
      const direct = latestConsumedAttachments(exec.agent)
      const attachmentIndex = args.attachmentIndex ?? 0
      if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= direct.attachments.length) {
        throw new Error(`attachmentIndex ${attachmentIndex} is unavailable; the current import source contains ${direct.attachments.length} JSON attachment(s)`)
      }
      const reader = ctx.attachments as unknown as FileAttachmentReader
      const stored = await reader.readFile(direct.attachments[attachmentIndex]!, exec.signal)
      const preset = parseSillyTavernPresetBytes(stored.data, stored.ref.name)
      const result = preparePresetImportResult(preset, direct.eventSeq, stored.ref)
      return { ...result, preset: presetJson(preset) }
    },
    presentCall: () => ({ card: 'generic', title: '导入酒馆预设', kind: 'read' }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '预设导入失败' : '预设已启用',
    }),
    isConcurrencySafe: () => false,
  }))
  ctx.tools.register(defineTool({
    name: 'import_character_card',
    description: 'Import a SillyTavern Character Card V1, V2, or V3 from a PNG, JSON, or CHARX attachment in the latest user message, then make that character active for this Session. Omit attachmentIndex unless the message has multiple recognized cards. greetingIndex 0 selects first_mes; later indexes select alternate_greetings.',
    parameters: {
      attachmentIndex: {
        type: 'integer',
        description: 'Zero-based Character Card attachment index in the latest user message. Omit when it contains exactly one card.',
      },
      greetingIndex: {
        type: 'integer',
        description: 'Zero selects first_mes; one and above select alternate_greetings. Defaults to zero.',
      },
    },
    output: {
      schema: CHARACTER_IMPORT_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `已导入 ${value.name}（Character Card V${value.cardVersion}）`,
          value.selectedGreeting.trim().length === 0
            ? '角色卡没有开场白；直接以新角色自然回应。'
            : `立即以新角色发送这段开场白，不解释导入过程：\n${substituteCardMacros(
              value.selectedGreeting,
              parseCharacterCardValue(value.raw),
              value.userName,
            )}`,
          value.degradations.length === 0 ? '未发现需要降级的能力。' : `未启用：${value.degradations.join('、')}`,
        ].join('\n'),
      }],
      presentationMeta: (_args, value) => {
        const { raw, ...result } = value
        const meta: CharacterImportMeta = { format: 0, result, raw }
        return meta as unknown as import('@deepseek-ai/dsh-session').JsonValue
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('import_character_card requires an Agent Session')
      if (exec.parent !== undefined) throw new Error('import_character_card must be called directly by the character Agent')
      const direct = latestUserAttachments(exec.agent)
      const attachmentIndex = args.attachmentIndex ?? 0
      const attachments = direct.attachments
      if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= attachments.length) {
        throw new Error(`attachmentIndex ${attachmentIndex} is unavailable; the current import source contains ${attachments.length} Character Card attachment(s)`)
      }
      const attachment = attachments[attachmentIndex]!
      if (isJsonCharacterCardAttachment(attachment) || isCharxCharacterCardAttachment(attachment)) {
        const reader = ctx.attachments as unknown as FileAttachmentReader
        const stored = await reader.readFile(attachment, exec.signal)
        const { card, transport } = decodeCharacterCardAttachment(stored.ref, stored.data)
        const libraryEntry = characterLibrary.import({
          data: stored.data,
          filename: stored.ref.name,
          ...(stored.ref.mediaType === undefined ? {} : { mediaType: stored.ref.mediaType }),
          card,
          transport,
        })
        return prepareCharacterImportResult(
          card,
          transport,
          direct.eventSeq,
          stored.ref,
          args.greetingIndex ?? 0,
          readSillyTavernChatIdentity(exec.agent.session.events)?.userName,
          libraryEntry.id,
        )
      }
      const stored = await ctx.attachments.readImage(attachment, exec.signal)
      const payload = readCharacterCardPng(stored.data)
      const card = parseCharacterCardJson(payload.json)
      const libraryEntry = characterLibrary.import({
        data: stored.data,
        ...(stored.ref.name === undefined ? {} : { filename: stored.ref.name }),
        mediaType: stored.ref.mediaType,
        card,
        transport: { transport: 'png', metadataKeyword: payload.keyword },
      })
      return prepareCharacterImportResult(card, {
        transport: 'png',
        metadataKeyword: payload.keyword,
      }, direct.eventSeq, stored.ref, args.greetingIndex ?? 0,
      readSillyTavernChatIdentity(exec.agent.session.events)?.userName, libraryEntry.id)
    },
    presentCall: () => ({ card: 'generic', title: '导入角色卡', kind: 'read' }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '角色卡导入失败' : '角色卡已导入',
    }),
    isConcurrencySafe: () => false,
  }))
  ctx.tools.register(defineTool({
    name: 'import_world_info',
    description: 'Import one standalone SillyTavern World Info / lorebook JSON attachment from the latest user message and keep it active in this Session. Omit attachmentIndex unless the message contains multiple JSON files.',
    parameters: {
      attachmentIndex: {
        type: 'integer',
        description: 'Zero-based JSON attachment index in the latest user message. Omit when it contains exactly one file.',
      },
    },
    output: {
      schema: WORLD_INFO_IMPORT_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `已导入世界书 ${value.name}（${value.entryCount} 个条目）`,
          value.degradations.length === 0 ? '未发现需要降级的能力。' : `未启用：${value.degradations.join('、')}`,
          '从下一次回应开始使用已激活的设定，不解释导入过程。',
        ].join('\n'),
      }],
      presentationMeta: (_args, value) => {
        const { raw, ...result } = value
        const meta: WorldInfoImportMeta = { format: 0, result, raw }
        return meta as unknown as import('@deepseek-ai/dsh-session').JsonValue
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('import_world_info requires an Agent Session')
      if (exec.parent !== undefined) throw new Error('import_world_info must be called directly by the character Agent')
      const direct = latestConsumedAttachments(exec.agent)
      const attachmentIndex = args.attachmentIndex ?? 0
      if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= direct.attachments.length) {
        throw new Error(`attachmentIndex ${attachmentIndex} is unavailable; the current import source contains ${direct.attachments.length} JSON attachment(s)`)
      }
      const reader = ctx.attachments as unknown as FileAttachmentReader
      const stored = await reader.readFile(direct.attachments[attachmentIndex]!, exec.signal)
      const worldInfo = parseWorldInfoJsonBytes(stored.data)
      return prepareWorldInfoImportResult(worldInfo, direct.eventSeq, stored.ref)
    },
    presentCall: () => ({ card: 'generic', title: '导入世界书', kind: 'read' }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '世界书导入失败' : '世界书已导入',
    }),
    isConcurrencySafe: () => false,
  }))
}

async function loadEjsTemplateEngine(ctx: Context): Promise<EjsTemplateEngine | undefined> {
  try {
    return await EjsTemplateEngine.create()
  } catch (error) {
    const kind = error instanceof Error ? error.name : 'UnknownError'
    ctx.logger.warn(`agent-rp: isolated EJS runtime unavailable (${kind}); templates remain preserved but inactive`)
    return undefined
  }
}

/**
 * Install the Agent RP profile behavior for every top-level Agent.
 * @param ctx - settled Web Host context.
 * @param config - character configuration for this profile.
 */
export async function apply(ctx: Context, config: AgentRpConfig): Promise<void> {
  const resolved = resolveConfig(config)
  if (resolved.mode === 'host') {
    const ejsTemplateEngine = await loadEjsTemplateEngine(ctx)
    const characterLibrary = new CharacterLibrary()
    const personaLibrary = new PersonaLibrary()
    const presetLibrary = new PresetLibrary()
    const chatLibrary = new SillyTavernChatLibrary()
    const worldInfoLibrary = new WorldInfoLibrary()
    const workspaceSettings = new WorkspaceSettingsStore()
    const generatedImageLibrary = new GeneratedImageLibrary()
    let mountedServer: AgentRpHttpServer | undefined
    const mountHost = (serviceName: 'httpServer' | 'webServer'): void => {
      ctx.inject([serviceName, 'credentials', 'agents', 'llm', 'systemPrompt'], webCtx => {
        const server = webCtx.get(serviceName) as AgentRpHttpServer
        if (mountedServer !== undefined) return
        mountedServer = server
        webCtx.effect(() => () => {
          if (mountedServer === server) mountedServer = undefined
        }, `agent-rp: release ${serviceName}`)
        installCharacterLibraryHttp(webCtx, characterLibrary, server)
        installPersonaLibraryHttp(webCtx, personaLibrary, server)
        installPresetLibraryHttp(webCtx, presetLibrary, server)
        installSillyTavernChatHttp(webCtx, chatLibrary, server)
        installSillyTavernChatExportHttp(webCtx, ctx, server)
        installAgentRpMemoryHttp(webCtx, ctx, server)
        installSessionLaunchHttp(webCtx, ctx, characterLibrary, chatLibrary, presetLibrary, server)
        installWorldInfoLibraryHttp(webCtx, worldInfoLibrary, server)
        installWorkspaceSettingsHttp(webCtx, workspaceSettings, server)
        installImageGenerationHttp(webCtx, generatedImageLibrary, webCtx.credentials, server)
        installTavernGenerationHttp(webCtx, server)
        installTavernModelListHttp(webCtx, server)
        installRpDistributionBridgeHttp(
          webCtx,
          characterLibrary,
          presetLibrary,
          personaLibrary,
          worldInfoLibrary,
          chatLibrary,
          server,
        )
      })
    }
    mountHost('httpServer')
    mountHost('webServer')
    ctx.inject(['sessionProjections'], projectionCtx => {
      projectionCtx.sessionProjections.register(createAgentRpProjectionDefinition(ejsTemplateEngine))
    })
    installBundledAgentRpPreset()
    return
  }
  const ejsTemplateEngine = await loadEjsTemplateEngine(ctx)
  installAgentRp(ctx, resolved, ejsTemplateEngine === undefined ? {} : { ejsTemplateEngine })
}
