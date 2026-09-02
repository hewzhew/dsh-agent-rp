/** Agent RP profile bundle and preset-scoped character runtime. */

import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { WorkspaceSettingsStore } from './workspace-settings-store.ts'
import { installWorkspaceSettingsHttp } from './workspace-settings-http.ts'
import { installStoryWorkspaceHttp } from './story-workspace-http.ts'
import { StoryWorkspaceStore } from './story-workspace.ts'
import { createFlyingChessWorldModule } from './flying-chess-world.ts'
import { flyingChessWorldResourceProvider } from './play-world-resource-provider.ts'
import {
  createDefaultPlayWorldRegistry,
  PLAY_WORLD_REGISTRY_KEY,
  PlayWorldRegistry,
} from './play-world.ts'
import { executeStoryWorkspaceCommand, readSessionStoryWorkspaceId } from './session-story-workspace.ts'
import {
  materializeStoryTurn,
  recoverStoppedStoryTurns,
  runStoryTurnPipeline,
  stopStoryTurnPipeline,
} from './story-turn-pipeline.ts'
import { installStoryTurnCompletion } from './story-turn-completion.ts'
import {
  ROLEPLAY_RESOURCE_CATALOG_KEY,
  RoleplayResourceCatalog,
} from './roleplay-resource-catalog.ts'
import { roleplayLibraryResourceProviders } from './roleplay-resource-library-providers.ts'
import { nativePromptPolicyResourceProvider } from './native-prompt-policy.ts'
import { characterLibraryRoleplayResourceId } from './roleplay-resource-library-ids.ts'
import { installRoleplayResourceCatalogHttp } from './roleplay-resource-catalog-http.ts'
import { RegexPackLibrary } from './regex-pack-library.ts'
import { installRegexPackLibraryHttp } from './regex-pack-library-http.ts'
import { tavernResourceLibraryPreflightContributors } from './tavern-resource-library-preflight.ts'
import {
  TAVERN_RESOURCE_PREFLIGHT_KEY,
  TavernResourcePreflightRegistry,
} from './tavern-resource-preflight.ts'
import {
  Config,
  resolveConfig,
  type Config as AgentRpConfig,
  type ResolvedConfig,
} from './config.ts'
import {
  AGENT_RP_MEMORY_KINDS,
  prepareAgentRpMemory,
  requestsPersistentMemory,
} from './memory.ts'
import { executeAgentRpMemoryCommand } from './memory-command.ts'
import { installAgentRpMemoryHttp } from './memory-http.ts'
import { installAgentRpCommandHttp } from './agent-rp-command-http.ts'
import { parseCharacterCardJson, parseCharacterCardJsonBytes, parseCharacterCardValue } from './import/character-card.ts'
import { parseCharx } from './import/charx.ts'
import { readCharacterCardPng } from './import/png.ts'
import {
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
import { parseSillyTavernPresetBytes, presetJson } from './import/sillytavern-preset.ts'
import {
  readSillyTavernChatIdentity,
} from './import/sillytavern-chat-seed.ts'
import {
  isJsonWorldInfoAttachment,
  prepareWorldInfoImportResult,
  type WorldInfoImportMeta,
} from './import/session-world-info.ts'
import {
  preparePresetImportResult,
  type PresetImportMeta,
} from './import/session-preset.ts'
import {
  renderCharacterPrompt,
  substituteCardMacros,
} from './prompt.ts'
import { EjsTemplateEngine } from './ejs-template.ts'
import { installBundledAgentRpPreset } from './preset.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { createAgentRpProjectionDefinition } from './projection.ts'
import { installMvuStreamCompletion } from './mvu-stream.ts'
import {
  installAgentPromptRegexStream,
} from './prompt-regex-stream.ts'
import { configurePresetFromCommand } from './preset-configuration.ts'
import { PresetLibrary } from './preset-library.ts'
import { installPresetLibraryHttp } from './preset-library-http.ts'
import { executePresetLibraryCommand } from './preset-library-command.ts'
import { installTavernExecutionHttp, installTavernPreflightHttp } from './tavern-preflight-http.ts'
import { TavernExecutionPlanCache } from './tavern-preflight.ts'
import { CharacterLibrary } from './character-library.ts'
import { CharacterWorldBindingStore } from './character-world-binding-store.ts'
import { executeCharacterLibraryCommand } from './character-library-command.ts'
import { installCharacterLibraryHttp } from './character-library-http.ts'
import { installPersonaLibraryHttp } from './persona-library-http.ts'
import { PersonaLibrary } from './persona-library.ts'
import { executePersonaCommand } from './persona-command.ts'
import { executeSillyTavernChatCommand } from './sillytavern-chat-command.ts'
import { installSillyTavernChatHttp } from './sillytavern-chat-http.ts'
import { SillyTavernChatLibrary } from './sillytavern-chat-library.ts'
import { installSillyTavernChatExportHttp } from './sillytavern-chat-export-http.ts'
import { installSessionLaunchHttp } from './session-launch-http.ts'
import { executeGenerationCommand } from './generation.ts'
import type { AgentRpHttpServer } from './host-http.ts'
import { executeWorldInfoConfiguration } from './world-info-configuration.ts'
import { WorldInfoLibrary } from './world-info-library.ts'
import { executeWorldInfoLibraryCommand } from './world-info-library-command.ts'
import { installWorldInfoLibraryHttp } from './world-info-library-http.ts'
import { GeneratedImageLibrary } from './generated-image-library.ts'
import { executeImageGenerationCommand } from './image-generation-command.ts'
import { installImageGenerationHttp } from './image-generation-http.ts'
import { executeTavernHelperMutation } from './tavern-helper-command.ts'
import { executeTavernTrigger } from './tavern-trigger.ts'
import { installTavernGenerationHttp } from './tavern-generation-http.ts'
import { installTavernModelListHttp } from './tavern-model-list-http.ts'
import { installRpDistributionBridgeHttp } from './rp-distribution-bridge-http.ts'
import { NativeIdentityStore } from './native-identity.ts'
import { installNativeIdentityHttp } from './native-identity-http.ts'
import {
  createWorldbookCharacterContextRegistry,
  installWorldbookSnapshotCoalescing,
  WORLDBOOK_CHARACTER_CONTEXT_KEY,
  worldbookCharacterContext,
  type WorldbookCharacterContextRegistry,
} from './worldbook-character-context.ts'
import { resolveSessionRoleplayRuntime } from './session-roleplay-runtime.ts'
import {
  ROLEPLAY_RUNTIME_EXTENSIONS_KEY,
  RoleplayRuntimeExtensionRegistry,
} from './roleplay-runtime-extension.ts'
import { prepareRoleplayTurn } from './roleplay-turn-plan.ts'
import { bindRoleplayExternalContext } from './roleplay-turn-context.ts'
import { RoleplayTurnCoordinator } from './roleplay-turn-coordinator.ts'
import { appendSessionRoleplayTurnPlan } from './session-roleplay-turn-plan.ts'
import { recoverSessionRoleplayTurns } from './session-roleplay-turn-recovery.ts'
import { installRoleplayTurnHealthHttp } from './roleplay-turn-health-http.ts'
import {
  appendRoleplayTurnPresentation,
} from './roleplay-turn-presentation.ts'
import {
  compileSessionRoleplayTurnPresentationUpdate,
} from './session-roleplay-turn-presentation.ts'
import { executeRoleplayStateCommand } from './roleplay-state-command.ts'
import { hostSupportsAgentRpSessionEvents } from './session-event-append.ts'
import { ensureDefaultRoleplayTurnMode } from './roleplay-turn-mode.ts'
import { executeRoleplayTurnModeCommand } from './roleplay-turn-mode-command.ts'
import {
  readRoleplayStateActionIntent,
  installRoleplayStateActionTool,
  ROLEPLAY_STATE_ACTION_TOOL,
} from './roleplay-state-action.ts'
import { runRoleplayStagedStateSettlement } from './roleplay-staged-state-settlement.ts'
import { createRoleplayNarrativeReviewWorker } from './roleplay-narrative-review-worker.ts'
import { ROLEPLAY_TURN_WORKERS_KEY, RoleplayTurnWorkerRegistry } from './roleplay-turn-worker.ts'
import { readRoleplayExperienceSelection } from './roleplay-experience-selection.ts'
import {
  installRoleplayActorRevisionCapability,
  ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY,
  RoleplayActorRevisionRegistry,
} from './roleplay-actor-revision.ts'
import { characterLibraryActorRevisionProvider } from './character-library-actor-revision.ts'
import {
  detectRoleplayArtifactFollowup,
  installRoleplayArtifactCapability,
} from './roleplay-artifact.ts'
import { installRoleplayImageGenerationTool } from './roleplay-image-generation-tool.ts'
import { installAgentRpCapabilityPresetHttp } from './agent-capability-preset.ts'
import { roleplayToolCallFollowsVisibleReply } from './roleplay-tool-continuation.ts'
import {
  beginStExtensionGeneration,
  registerStExtensionGenerationCoordinator,
  StExtensionGenerationCoordinator,
} from './st-extension-generation.ts'
import { installStExtensionGenerationHttp } from './st-extension-generation-http.ts'
import { sessionEvents } from './session-events.ts'

/** Cordis plugin identity. */
export const name = 'dsh-agent-rp'

const ROLEPLAY_ARTIFACT_HANDOFF_PROMPT = [
  '【Agent RP 产物交接】',
  '本回合的可见正文已经完成，不要续写、改写、总结或重新思考剧情。',
  '刚才的工具返回了图片。只完成一次呈现交接：若结果明确给出稳定 artifact id，调用 stage_roleplay_artifact；否则调用不带 path 的 publish_roleplay_image。',
  '不要输出新的正文；调用失败时不要原样重试。',
].join('\n')

export { Config }
export {
  registerRoleplayResourceProvider,
  ROLEPLAY_RESOURCE_CATALOG_KEY,
  RoleplayResourceCatalog,
} from './roleplay-resource-catalog.ts'
export type {
  LocatedPlayWorldResource,
  LocatedRoleplayResource,
  RoleplayActorProjection,
  RoleplayResourceMaterialization,
  RoleplayResourceMaterializationContext,
  RoleplayResourceMaterializationInput,
  RoleplayResourceProvider,
  RoleplayStorySourceProjection,
  RoleplayWorldProjection,
} from './roleplay-resource-catalog.ts'
export {
  registerTavernResourcePreflightContributor,
  TAVERN_RESOURCE_PREFLIGHT_KEY,
  TavernResourcePreflightRegistry,
} from './tavern-resource-preflight.ts'
export type {
  TavernResourcePreflightContributor,
  TavernResourcePreflightResolveInput,
} from './tavern-resource-preflight.ts'
export {
  parseRoleplayResourceDetail,
  ROLEPLAY_RESOURCE_CATALOG_PATH,
  ROLEPLAY_RESOURCE_KINDS,
} from './roleplay-resource-catalog-protocol.ts'
export type {
  RoleplayActorOpeningDetail,
  RoleplayActorResourceDetail,
  RoleplayPersonaResourceDetail,
  RoleplayPromptPolicyResourceDetail,
  RoleplayRegexResourceDetail,
  RoleplayResourceCatalogResponse,
  RoleplayResourceDescriptor,
  RoleplayResourceDetail,
  RoleplayResourceDetailResponse,
  RoleplayResourceKind,
  RoleplayResourceReference,
  RoleplayResourceSelection,
  RoleplayWorldResourceDetail,
} from './roleplay-resource-catalog-protocol.ts'
export {
  characterLibraryRoleplayResourceId,
  presetLibraryRoleplayResourceId,
  regexPackLibraryRoleplayResourceId,
  worldInfoLibraryRoleplayResourceId,
} from './roleplay-resource-library-ids.ts'
export {
  isSillyTavernRegexPackValue,
  MAX_REGEX_PACK_SCRIPTS,
  parseRegexPackBytes,
  parseRegexPackJson,
  parseRegexPackValue,
  summarizeRegexPackScripts,
} from './regex-pack.ts'
export type { RegexPackScriptSummary } from './regex-pack.ts'
export { MAX_REGEX_PACK_BYTES, REGEX_PACK_LIBRARY_PATH } from './regex-pack-library-protocol.ts'
export type {
  RegexPackLibraryDeleteResponse,
  RegexPackLibraryImportResponse,
  RegexPackLibraryListResponse,
  RegexPackLibrarySummary,
} from './regex-pack-library-protocol.ts'
export {
  appendSessionRegexPack,
  parseSessionRegexPack,
  readSessionRegexPacks,
  sessionRegexScripts,
} from './session-regex-pack.ts'
export type { SessionRegexPackSnapshot } from './session-regex-pack.ts'
export { prepareRoleplayExperienceSession } from './roleplay-experience-materialization.ts'
export {
  appendRoleplayExperienceSelection,
  parseRoleplayExperienceSelection,
  readRoleplayExperienceSelection,
} from './roleplay-experience-selection.ts'
export type { RoleplayExperienceSelectionSnapshot } from './roleplay-experience-selection.ts'
export {
  installRoleplayActorRevisionCapability,
  parseRoleplayActorDefinition,
  parseRoleplayActorInspectionResult,
  parseRoleplayActorRevisionChanges,
  parseRoleplayActorRevisionResult,
  parseRoleplayActorRevisionToolInput,
  registerRoleplayActorRevisionProvider,
  readRoleplayActorRevisionAttempts,
  ROLEPLAY_ACTOR_DEFINITION_FIELDS,
  ROLEPLAY_ACTOR_INSPECTION_TOOL,
  ROLEPLAY_ACTOR_INSPECTION_VALUE_SCHEMA,
  ROLEPLAY_ACTOR_REVISION_TOOL,
  ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY,
  ROLEPLAY_ACTOR_REVISION_VALUE_SCHEMA,
  RoleplayActorRevisionConflictError,
  RoleplayActorRevisionRegistry,
} from './roleplay-actor-revision.ts'
export {
  installRoleplayArtifactCapability,
  renderRoleplayArtifactToolGuidance,
  readRoleplayArtifactAutoStageIntent,
  readRoleplayArtifactStageRecord,
  readStagedRoleplayArtifacts,
  readToolArtifactPresentationMeta,
  roleplayToolArtifactPresentationMeta,
  ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
  ROLEPLAY_ARTIFACT_PUBLISH_FORMAT,
  ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
  ROLEPLAY_ARTIFACT_PUBLISH_VALUE_SCHEMA,
  ROLEPLAY_ARTIFACT_STAGE_FORMAT,
  ROLEPLAY_ARTIFACT_STAGE_TOOL,
  ROLEPLAY_ARTIFACT_STAGE_VALUE_SCHEMA,
  TOOL_ARTIFACT_PRESENTATION_FORMAT,
} from './roleplay-artifact.ts'
export {
  DEFAULT_TOOL_GUIDANCE,
  normalizeToolGuidanceConfig,
  prepareRoleplayToolPolicy,
} from './roleplay-tool-guidance.ts'
export type {
  AgentRpImageMode,
  ResolvedToolGuidanceConfig,
  RoleplayToolPolicyPlan,
  ToolGuidanceEntryConfig,
} from './roleplay-tool-guidance.ts'
export type {
  RoleplayArtifactCapabilityController,
  RoleplayArtifactAutoStageIntent,
  RoleplayArtifactPublishArgs,
  RoleplayArtifactPublishValue,
  RoleplayArtifactStageRecord,
  RoleplayToolImageArtifact,
  ToolArtifactPresentationMeta,
} from './roleplay-artifact.ts'
export type {
  RoleplayActorDefinition,
  RoleplayActorDefinitionField,
  RoleplayActorInspectionValue,
  RoleplayActorRevisionAttempt,
  RoleplayActorRevisionCapabilityOptions,
  RoleplayActorRevisionChanges,
  RoleplayActorRevisionInput,
  RoleplayActorRevisionProvider,
  RoleplayActorRevisionSettlement,
  RoleplayActorRevisionSnapshot,
  RoleplayActorRevisionToolInput,
  RoleplayActorRevisionValue,
} from './roleplay-actor-revision.ts'
export {
  registerRoleplayRuntimeExtension,
  ROLEPLAY_RUNTIME_EXTENSIONS_KEY,
  RoleplayRuntimeExtensionRegistry,
} from './roleplay-runtime-extension.ts'
export type {
  ResolvedRoleplayRuntimeExtensions,
  RoleplayRuntimeExtensionDefinition,
  RoleplayRuntimeExtensionResolution,
  RoleplayRuntimeExtensionResolveInput,
} from './roleplay-runtime-extension.ts'
export {
  applyRoleplayStateEvent,
  appendRoleplayState,
  appendUserRoleplayState,
  parseRoleplayStateRecord,
  parseRoleplayStateCommandRequest,
  readRoleplayStates,
  renderRoleplayStateContext,
  ROLEPLAY_STATE_MODULE_ID,
  ROLEPLAY_STATE_USER_WRITER_ID,
} from './roleplay-state.ts'
export type {
  RoleplayStateCommandRequest,
  RoleplayStateRecord,
  RoleplayStateSnapshot,
  WriteRoleplayStateInput,
} from './roleplay-state.ts'
export {
  readLatestRoleplayTurnRecord,
  readRoleplayTurnRecord,
  readRoleplayTurnRecords,
} from './roleplay-turn-record.ts'
export type {
  RoleplayTurnPlanEvidence,
  RoleplayTurnPrepareStepRecord,
  RoleplayTurnPresentRecord,
  RoleplayTurnRecallStepRecord,
  RoleplayTurnRecord,
  RoleplayTurnSettleRecord,
} from './roleplay-turn-record.ts'
export {
  roleplayTurnRecordFinalizable,
  summarizeRoleplayTurnHealth,
} from './roleplay-turn-health.ts'
export type {
  AgentRpTurnHealthDiagnostic,
  RoleplayTurnHealthEntry,
  RoleplayTurnHealthStatus,
  RoleplayTurnHealthSummary,
  RoleplayTurnPhaseDiagnostic,
  RoleplayWorldRecallDiagnostic,
} from './roleplay-turn-health-protocol.ts'
export { AGENT_RP_EMBEDDED_IDENTITY_CHANNEL } from './embedded-identity-protocol.ts'
export type {
  EmbeddedNativeIdentityFailure,
  EmbeddedNativeIdentityRequest,
} from './embedded-identity-protocol.ts'
export const inject = ['attachments', 'commands', 'credentials', 'llm', 'sessions', 'systemPrompt', 'tools']

interface HumanCommandGateway {
  register(definition: CommandDefinition): () => void
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
  for (let index = sessionEvents(agent.session).length - 1; index >= 0; index -= 1) {
    const event = sessionEvents(agent.session)[index]
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
  for (let index = sessionEvents(agent.session).length - 1; index >= 0; index -= 1) {
    const event = sessionEvents(agent.session)[index]
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
  const rememberIntentByAgent = new WeakMap<Agent, boolean>()
  const rememberRestrictions = new Map<Agent, () => void>()
  const stateActionRestrictions = new Map<Agent, () => void>()
  const highRiskToolRestrictions = new Map<Agent, () => void>()
  const pendingMessagesByAgent = new WeakMap<Agent, {
    readonly turn: number
    readonly messages: UserMessage[]
    stExtensionGeneration?: StExtensionGenerationCoordinator
  }>()
  const storyBriefByAgent = new WeakMap<Agent, {
    readonly turn: number
    readonly step: number
    readonly finalDraft: string
    readonly modelContext: string
  }>()
  const turnCoordinator = new RoleplayTurnCoordinator<Agent>()
  let settlementRuntimeActive = true
  ctx.effect(() => () => {
    settlementRuntimeActive = false
  }, 'agent-rp: turn settlement lifetime')
  const commands = (ctx as Context & { commands: HumanCommandGateway }).commands
  const setRememberAvailable = (agent: Agent, available: boolean): void => {
    rememberIntentByAgent.set(agent, available)
    const restricted = rememberRestrictions.get(agent)
    if (available) {
      restricted?.()
      rememberRestrictions.delete(agent)
    } else if (restricted === undefined) {
      rememberRestrictions.set(agent, agent.ctx.tools.restrict({ deny: ['remember'] }))
    }
  }
  const setStateActionAvailable = (agent: Agent, available: boolean): void => {
    const restricted = stateActionRestrictions.get(agent)
    if (available) {
      restricted?.()
      stateActionRestrictions.delete(agent)
    } else if (restricted === undefined) {
      stateActionRestrictions.set(agent, agent.ctx.tools.restrict({ deny: [ROLEPLAY_STATE_ACTION_TOOL] }))
    }
  }
  ctx.effect(() => () => {
    for (const dispose of rememberRestrictions.values()) dispose()
    rememberRestrictions.clear()
    for (const dispose of stateActionRestrictions.values()) dispose()
    stateActionRestrictions.clear()
    for (const dispose of highRiskToolRestrictions.values()) dispose()
    highRiskToolRestrictions.clear()
  }, 'agent-rp: capability gates')
  const presetLibrary = new PresetLibrary()
  const portableLibraryRoot = options.characterLibraryRoot === undefined
    ? undefined
    : dirname(options.characterLibraryRoot)
  const worldBindings = new CharacterWorldBindingStore(portableLibraryRoot === undefined
    ? {}
    : { root: join(portableLibraryRoot, 'character-world-bindings') })
  const worldInfoLibrary = new WorldInfoLibrary({
    ...(portableLibraryRoot === undefined ? {} : { root: join(portableLibraryRoot, 'world-info-imports') }),
    bindings: worldBindings,
  })
  const characterLibrary = new CharacterLibrary({
    ...(options.characterLibraryRoot === undefined ? {} : { root: options.characterLibraryRoot }),
    worldInfoLibrary,
    worldBindings,
  })
  characterLibrary.migrateEmbeddedWorldInfos()
  const actorRevisions = new RoleplayActorRevisionRegistry()
  ctx.provide(ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY, actorRevisions)
  ctx.effect(
    () => actorRevisions.register(characterLibraryActorRevisionProvider(characterLibrary)),
    'agent-rp: character-library actor revisions',
  )
  const chatLibrary = new SillyTavernChatLibrary()
  const generatedImageLibrary = new GeneratedImageLibrary()
  const workspaceSettings = new WorkspaceSettingsStore()
  let playWorlds: PlayWorldRegistry
  try {
    playWorlds = ctx.get(PLAY_WORLD_REGISTRY_KEY) ?? createDefaultPlayWorldRegistry()
  } catch {
    playWorlds = createDefaultPlayWorldRegistry()
  }
  const storyWorkspaces = new StoryWorkspaceStore({ worlds: playWorlds })
  let turnWorkers: RoleplayTurnWorkerRegistry
  try {
    turnWorkers = ctx.get(ROLEPLAY_TURN_WORKERS_KEY) ?? new RoleplayTurnWorkerRegistry()
  } catch {
    turnWorkers = new RoleplayTurnWorkerRegistry()
  }
  ctx.effect(
    () => turnWorkers.register(createRoleplayNarrativeReviewWorker(
      () => workspaceSettings.get().turnWorkers.narrativeReview.enabled,
    )),
    'agent-rp: narrative review Worker',
  )
  ctx.effect(
    () => turnWorkers.register({
      id: 'state-settlement',
      phase: 'settle',
      async run(input) {
        if (input.plan.plan.act.stateActions.length === 0) return { outcome: 'skipped' }
        const hasInlineStateAction = sessionEvents(input.agent.session).some((event) => {
          if (event.type !== 'tool/result' || event.data.turn !== input.turn || event.data.error !== undefined) return false
          const block = event.data.message.content[0]
          const intent = readRoleplayStateActionIntent(event.data.meta)
          return block?.type === 'tool-result' && block.isError !== true
            && intent?.turn === input.turn && intent.sessionId === String(input.agent.session.id)
        })
        return hasInlineStateAction
          ? { outcome: 'skipped' }
          : runRoleplayStagedStateSettlement({
              ...input,
              verification: workspaceSettings.get().turnWorkers.stateVerification,
            })
      },
    }),
    'agent-rp: state settlement Worker',
  )
  let worldbookCharacters: WorldbookCharacterContextRegistry | undefined
  let runtimeExtensions: RoleplayRuntimeExtensionRegistry | undefined
  try {
    const candidate = ctx.get(WORLDBOOK_CHARACTER_CONTEXT_KEY as never) as WorldbookCharacterContextRegistry | undefined
    if (candidate !== undefined && typeof candidate.register === 'function'
      && typeof candidate.getCurrentCharacter === 'function') worldbookCharacters = candidate
  } catch {
    worldbookCharacters = undefined
  }
  try {
    const candidate = ctx.get(ROLEPLAY_RUNTIME_EXTENSIONS_KEY)
    if (candidate !== undefined && typeof candidate.resolve === 'function') runtimeExtensions = candidate
  } catch {
    runtimeExtensions = undefined
  }
  const worldbookCharacterDisposers = new Map<Agent, readonly (() => void)[]>()

  installRoleplayActorRevisionCapability(ctx, actorRevisions, {
    resolveActor(agent) {
      if (agentsByScope.get(agent) !== agent) return undefined
      const active = readActiveSessionCharacter(sessionEvents(agent.session))
      if (active !== undefined) {
        return active.result.libraryId === undefined
          ? undefined
          : { kind: 'actor', id: characterLibraryRoleplayResourceId(active.result.libraryId) }
      }
      const selected = readRoleplayExperienceSelection(sessionEvents(agent.session))?.actor
      return selected === undefined ? undefined : { kind: 'actor', id: selected.id }
    },
  })
  const roleplayArtifactCapability = installRoleplayArtifactCapability(ctx, {
    toolPolicy: agent => agentsByScope.get(agent) === agent
      ? turnCoordinator.current(agent)?.tools
      : undefined,
  })
  const roleplayImageGenerationCapability = installRoleplayImageGenerationTool(ctx, {
    attachments: ctx.attachments,
    credentials: ctx.credentials,
    library: generatedImageLibrary,
    settings: workspaceSettings,
    toolPolicy: agent => agentsByScope.get(agent) === agent
      ? turnCoordinator.current(agent)?.tools
      : undefined,
  })
  ctx.on('tools/result', (exec, result) => {
    const agent = exec.agent
    if (agent === undefined || exec.parent !== undefined || agentsByScope.get(agent) !== agent
      || result.isError || turnCoordinator.currentActLane(agent) !== 'narrative') return
    const plan = turnCoordinator.current(agent)
    if (plan?.tools.capability.artifactPresentation !== true) return
    const followup = detectRoleplayArtifactFollowup(sessionEvents(agent.session), String(exec.callId), result)
    if (followup !== undefined) {
      turnCoordinator.enterArtifactHandoff(agent, followup.turn)
      roleplayImageGenerationCapability.prepare(agent, undefined)
    }
  })
  installRoleplayStateActionTool(ctx)

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
    name: 'rp-story-workspace',
    description: 'select the editable story workspace used by later Roleplay turns',
    input: { hint: '<private story-workspace payload>' },
    recordInput: false,
    handler: invocation => executeStoryWorkspaceCommand(storyWorkspaces, invocation),
  })
  commands.register({
    name: 'rp-memory',
    description: 'correct or forget one active roleplay memory',
    input: { hint: '<private memory-manager payload>' },
    recordInput: false,
    handler: executeAgentRpMemoryCommand,
  })
  ctx.effect(() => commands.register({
    name: 'rp-state',
    description: 'explicitly edit durable native roleplay state',
    input: { hint: '<private native state payload>' },
    handler: executeRoleplayStateCommand,
  }), 'agent-rp: native state player command')
  ctx.effect(() => commands.register({
    name: 'rp-turn-mode',
    description: 'select compatibility dialogue or native Agent turn settlement',
    input: { hint: '<private roleplay turn-mode payload>' },
    handler: executeRoleplayTurnModeCommand,
  }), 'agent-rp: turn mode player command')
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
  const roleplayPersonaText = (agent: Agent): string => {
    if (turnCoordinator.currentActLane(agent) === 'artifact-handoff') {
      return ROLEPLAY_ARTIFACT_HANDOFF_PROMPT
    }
    const workspaceId = readSessionStoryWorkspaceId(sessionEvents(agent.session))
    if (workspaceId !== undefined) {
      let workspaceName = '故事工作室'
      let characterNames = ''
      try {
        const workspace = storyWorkspaces.get(workspaceId)
        workspaceName = workspace.name
        characterNames = workspace.characters.map(character => character.name).join('、')
      } catch {
        // A deleted workspace still needs a neutral persona while the Session reports the missing source.
      }
      return [
        `你是“${workspaceName}”的回合呈现 Agent。`,
        characterNames === '' ? '' : `参与人物：${characterNames}。`,
        '世界规则、人物独立认知、资料检索、导演规划和正文编辑由故事工作区流水线分别处理。',
        '只呈现当前回合已经完成的编辑稿；不继承部署默认角色，不补写未记录的规则事件，也不泄露人物私有认知或 Worker 内部材料。',
      ].filter(text => text !== '').join('\n')
    }
    return turnCoordinator.current(agent)?.prompt.systemPromptText ?? renderCharacterPrompt(config)
  }
  const preparePendingRoleplayPlan = (
    agent: Agent,
    pending: { readonly turn: number; readonly messages: readonly UserMessage[] },
  ) => {
    const resolved = resolveSessionRoleplayRuntime({
      session: agent.session,
      deployment: config,
      memoryWriteAvailable: rememberIntentByAgent.get(agent) === true,
      templateEngineAvailable: options.ejsTemplateEngine !== undefined,
      ...(runtimeExtensions === undefined ? {} : { extensions: runtimeExtensions }),
    })
    const plan = prepareRoleplayTurn({
      session: agent.session,
      pendingMessages: pending.messages,
      deployment: config,
      resolved,
      toolGuidance: workspaceSettings.get().toolGuidance,
      ...(options.ejsTemplateEngine === undefined ? {} : { templateEngine: options.ejsTemplateEngine }),
    })
    turnCoordinator.prepare(agent, plan)
    roleplayArtifactCapability.prepare(agent, plan.tools)
    roleplayImageGenerationCapability.prepare(agent, plan.tools, pending.turn)
    return plan
  }
  ctx.systemPrompt.section({
    name: 'deployment:persona',
    order: 0,
    text: ({ scope }) => {
      const agent = scope === undefined ? undefined : agentsByScope.get(scope)
      if (agent === undefined) return renderCharacterPrompt(config)
      return roleplayPersonaText(agent)
    },
  })
  ctx.on('system-prompt/assemble', async (_assembly, assemblyContext, next) => {
    const agent = assemblyContext.scope === undefined ? undefined : agentsByScope.get(assemblyContext.scope)
    if (agent === undefined) return next()
    const pending = pendingMessagesByAgent.get(agent)
    let refreshRoleplayPersona = false
    if (pending?.stExtensionGeneration !== undefined) {
      const signal = assemblyContext.signal ?? new AbortController().signal
      const barrier = await pending.stExtensionGeneration.wait(String(agent.session.id), pending.turn, signal)
      if (barrier.outcome === 'applied') {
        try {
          preparePendingRoleplayPlan(agent, pending)
          refreshRoleplayPersona = true
        } catch (error: unknown) {
          ctx.logger.warn(`agent-rp: installed ST extension prompt refresh failed: ${String(error)}`)
        }
      } else if (barrier.outcome === 'failed' && barrier.error !== undefined
        && barrier.error !== 'generation aborted') {
        ctx.logger.warn(`agent-rp: installed ST extension generation failed: ${barrier.error}`)
      }
    }
    let transformed
    try {
      transformed = await next()
    } finally {
      if (pending !== undefined && pendingMessagesByAgent.get(agent) === pending) {
        pendingMessagesByAgent.delete(agent)
      }
    }
    const plan = turnCoordinator.currentActLane(agent) === 'narrative'
      ? turnCoordinator.current(agent)
      : undefined
    return {
      ...transformed,
      sections: refreshRoleplayPersona
        ? transformed.sections.map(section => section.name === 'deployment:persona'
          ? { ...section, text: roleplayPersonaText(agent) }
          : section)
        : transformed.sections,
      contexts: transformed.contexts.map(context => {
        if (context.name === 'agent-rp:memory') {
          return { ...context, text: plan?.memory.contextText ?? '' }
        }
        if (context.name === 'agent-rp:artifact-tools') {
          return { ...context, text: plan?.tools.guidance.contextText ?? '' }
        }
        return context
      }),
    }
  })
  ctx.on('agent/created', ({ agent }) => {
    agentsByScope.set(agent, agent)
    agentsBySession.set(String(agent.session.id), agent)
    installAgentPromptRegexStream(
      agent,
      current => turnCoordinator.currentActLane(current) === 'narrative'
        ? turnCoordinator.current(current)?.prompt
        : undefined,
    )
    setRememberAvailable(agent, false)
    setStateActionAvailable(agent, false)
    const highRiskToolCandidates = [
      'bash', 'pwsh', 'subagent',
      'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list',
      'read', 'write', 'edit', 'str_replace_editor', 'glob', 'grep',
    ]
    const getTool = agent.ctx.tools.get
    const highRiskTools = typeof getTool === 'function'
      ? highRiskToolCandidates.filter(name => getTool.call(agent.ctx.tools, name, agent) !== undefined)
      : []
    if (highRiskTools.length > 0) {
      highRiskToolRestrictions.set(agent, agent.ctx.tools.restrict({ deny: highRiskTools }))
    }
    const resolveCharacter = () => {
      const active = readActiveSessionCharacter(sessionEvents(agent.session))
      if (active === undefined) return undefined
      let originalFilename: string | undefined
      if (active.result.libraryId !== undefined) {
        try {
          originalFilename = characterLibrary.get(active.result.libraryId).originalFilename
        } catch {
          originalFilename = undefined
        }
      }
      return worldbookCharacterContext(active.meta, originalFilename)
    }
    const sessionIds = new Set([String(agent.id), String(agent.session.id)])
    worldbookCharacterDisposers.set(agent, [...sessionIds].map(sessionId =>
      worldbookCharacters?.register(sessionId, resolveCharacter) ?? (() => {})))
    queueMicrotask(() => {
      if (!settlementRuntimeActive || agentsByScope.get(agent) !== agent) return
      void (async () => {
        try {
          await recoverStoppedStoryTurns({ ctx, agent })
        } catch (error: unknown) {
          ctx.logger.warn(`agent-rp: story turn recovery failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        try {
          recoverSessionRoleplayTurns({
            session: agent.session,
            deployment: config,
            templateEngineAvailable: options.ejsTemplateEngine !== undefined,
            ...(runtimeExtensions === undefined ? {} : { extensions: runtimeExtensions }),
          })
        } catch (error: unknown) {
          ctx.logger.warn(`agent-rp: turn recovery failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    })
  })
  ctx.on('agent/session-start', ({ agent, source }) => {
    if (agentsByScope.get(agent) === agent && (source === 'startup' || source === 'clear')) {
      ensureDefaultRoleplayTurnMode(agent.session, 'agent')
    }
  })
  ctx.on('agent/disposed', ({ agent }) => {
    agentsByScope.delete(agent)
    agentsBySession.delete(String(agent.session.id))
    rememberRestrictions.get(agent)?.()
    rememberRestrictions.delete(agent)
    stateActionRestrictions.get(agent)?.()
    stateActionRestrictions.delete(agent)
    highRiskToolRestrictions.get(agent)?.()
    highRiskToolRestrictions.delete(agent)
    pendingMessagesByAgent.delete(agent)
    storyBriefByAgent.delete(agent)
    turnCoordinator.release(agent)
    for (const dispose of worldbookCharacterDisposers.get(agent) ?? []) dispose()
    worldbookCharacterDisposers.delete(agent)
  })
  ctx.effect(() => () => {
    for (const disposers of worldbookCharacterDisposers.values()) {
      for (const dispose of disposers) dispose()
    }
    worldbookCharacterDisposers.clear()
  }, 'agent-rp: worldbook character contexts')
  installStoryTurnCompletion(
    ctx,
    sessionId => agentsBySession.get(sessionId),
    agent => storyBriefByAgent.get(agent),
  )
  installMvuStreamCompletion(
    ctx,
    sessionId => agentsBySession.get(sessionId),
    agent => turnCoordinator.currentActLane(agent) === 'narrative'
      ? turnCoordinator.current(agent)
      : undefined,
  )
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    if (agentsByScope.get(agent) !== agent) return
    const existing = pendingMessagesByAgent.get(agent)
    const pending = existing?.turn === turn
      ? existing
      : { turn, messages: [] }
    pending.messages.push(message)
    pendingMessagesByAgent.set(agent, pending)
    setRememberAvailable(agent, pending.messages.some(requestsPersistentMemory))
    preparePendingRoleplayPlan(agent, pending)
    const stExtensionGeneration = pending.stExtensionGeneration
      ?? beginStExtensionGeneration(String(agent.session.id), turn)
    if (stExtensionGeneration !== undefined) pending.stExtensionGeneration = stExtensionGeneration
    // Inbox claims are published synchronously before SystemPrompt assembly.
    // The restriction must be settled here so the same assembly sees the tool schema.
    // Agent mode settles state after the visible reply at turn-stopping; the
    // actor step must not spend narrative attention on variable arithmetic.
    setStateActionAvailable(agent, false)
  })
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    const decision = await next()
    if (agentsByScope.get(agent) !== agent) return decision
    if (decision.kind === 'reject') {
      setStateActionAvailable(agent, false)
      storyBriefByAgent.delete(agent)
      return decision
    }
    if (step === 1) {
      storyBriefByAgent.delete(agent)
      const workspaceId = readSessionStoryWorkspaceId(sessionEvents(agent.session))
      if (workspaceId !== undefined) {
        try {
          const brief = await runStoryTurnPipeline({
            ctx,
            agent,
            store: storyWorkspaces,
            workspace: storyWorkspaces.get(workspaceId),
            turn,
            step,
            messages: decision.messages,
            signal,
          })
          storyBriefByAgent.set(agent, {
            turn,
            step,
            finalDraft: brief.finalDraft,
            modelContext: brief.modelContext,
          })
        } catch (error: unknown) {
          try {
            await stopStoryTurnPipeline({
              ctx,
              agent,
              workspaceId,
              turn,
              step,
              outcome: signal.aborted ? 'aborted' : 'failed',
            })
          } catch (stopError: unknown) {
            ctx.logger.warn(`agent-rp: story pipeline terminal state could not be saved: ${stopError instanceof Error ? stopError.message : String(stopError)}`)
          }
          ctx.logger.warn(`agent-rp: story pipeline skipped: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return decision
  })
  ctx.systemPrompt.context({
    name: 'agent-rp:memory',
    order: 70,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = agentsByScope.get(scope)
      return agent === undefined || turnCoordinator.currentActLane(agent) !== 'narrative'
        ? ''
        : turnCoordinator.current(agent)?.memory.contextText ?? ''
    },
  })
  ctx.systemPrompt.context({
    name: 'agent-rp:artifact-tools',
    order: 71,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = agentsByScope.get(scope)
      return agent === undefined || turnCoordinator.currentActLane(agent) !== 'narrative'
        ? ''
        : turnCoordinator.current(agent)?.tools.guidance.contextText ?? ''
    },
  })
  ctx.systemPrompt.context({
    name: 'agent-rp:story-engine',
    order: 72,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = agentsByScope.get(scope)
      return agent === undefined ? '' : storyBriefByAgent.get(agent)?.modelContext ?? ''
    },
  })
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const actLane = turnCoordinator.currentActLane(agent)
    const activePlan = agentsByScope.get(agent) === agent
      ? turnCoordinator.bindStep(agent, turn, step, plan => bindRoleplayExternalContext({
        plan,
        events: sessionEvents(agent.session),
        visibleMessages: agent.session.deriveMessages(),
        turn,
        step,
      }))
      : undefined
    if (activePlan !== undefined) {
      appendSessionRoleplayTurnPlan(agent.session, turn, step, activePlan)
    }
    const config = await next()
    if (agentsByScope.get(agent) !== agent) return config
    const generation = activePlan?.generation
    if (generation === undefined) return config
    const requestedEffort = actLane === 'artifact-handoff' ? 'low' : generation.reasoningEffort
    const modelInfo = requestedEffort === undefined || requestedEffort === 'auto'
      ? undefined
      : await ctx.llm.resolveModelInfo(config.provider, config.model)
    const supportedEffort = modelInfo?.reasoning?.efforts.some(effort => effort.id === requestedEffort) === true
      ? requestedEffort
      : undefined
    const requestedMaxTokens = actLane === 'artifact-handoff'
      ? Math.min(generation.maxTokens ?? 2_048, 2_048)
      : generation.maxTokens
    return {
      ...config,
      ...generation.temperature === undefined ? {} : { temperature: generation.temperature },
      ...requestedMaxTokens === undefined
        ? {}
        : { maxTokens: Math.min(requestedMaxTokens, config.maxTokens ?? requestedMaxTokens) },
      ...supportedEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(supportedEffort) },
    }
  })
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    if (agentsByScope.get(agent) !== agent) return
    const plans = turnCoordinator.plansForTurn(agent, turn)
    const latest = plans.at(-1)
    if (latest?.plan.act.strategy !== 'agent') return
    try {
      await turnWorkers.run({ ctx, agent, turn, plan: latest, signal })
    } catch (error: unknown) {
      ctx.logger.warn(`agent-rp: post-narrative Worker pipeline skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      const workspaceId = readSessionStoryWorkspaceId(sessionEvents(agent.session))
      if (workspaceId !== undefined) {
        await materializeStoryTurn({ ctx, agent, store: storyWorkspaces, workspaceId, turn, signal })
      }
    } catch (error: unknown) {
      ctx.logger.warn(`agent-rp: story continuity materialization skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'agent-rp/turn-mode') {
      const agent = agentsBySession.get(String(session.id))
      if (agent !== undefined) setStateActionAvailable(agent, false)
    }
    if (event.type === 'agent-rp/tavern-state-attachment'
      || (event.type === 'command/done' && event.data.kind === 'success')) {
      queueMicrotask(() => {
        if (!settlementRuntimeActive) return
        try {
          const presentation = compileSessionRoleplayTurnPresentationUpdate(session, event)
          if (presentation !== undefined) appendRoleplayTurnPresentation(session, presentation)
        } catch (error: unknown) {
          ctx.logger.warn(`agent-rp: presentation update failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    }
    if (event.type !== 'turn/end') return
    const agent = agentsBySession.get(String(session.id))
    if (agent === undefined || agentsByScope.get(agent) !== agent) return
    pendingMessagesByAgent.delete(agent)
    storyBriefByAgent.delete(agent)
    setStateActionAvailable(agent, false)
    turnCoordinator.completeTurn(agent, event.data.turn)
    queueMicrotask(() => {
      if (!settlementRuntimeActive) return
      void (async () => {
        try {
          await recoverStoppedStoryTurns({ ctx, agent })
        } catch (error: unknown) {
          ctx.logger.warn(`agent-rp: story turn recovery failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        try {
          recoverSessionRoleplayTurns({
            session,
            deployment: config,
            turn: event.data.turn,
            templateEngineAvailable: options.ejsTemplateEngine !== undefined,
            ...(runtimeExtensions === undefined ? {} : { extensions: runtimeExtensions }),
          })
        } catch (error: unknown) {
          ctx.logger.warn(`agent-rp: turn settlement failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    })
  })
  ctx.systemPrompt.context({ name: 'sandbox:policy', order: 0, text: '' })
  ctx.systemPrompt.context({ name: 'approval:policy', order: 0, text: '' })
  ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Persist one confirmed fact, promise, preference, relationship change, or shared event for later turns in this Session. When the player explicitly asks to remember something, finish the visible roleplay reply first and call this once at the end; a successful save then ends the turn. Do not repeat information already covered. When this topic already exists, use supersedes with its active memory id instead of adding another record.',
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
      if (roleplayToolCallFollowsVisibleReply(sessionEvents(exec.agent.session), String(exec.callId))) {
        exec.concludeTurn()
      }
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
        return meta as unknown as import('@deepseek-ai/dsh-util-values').JsonValue
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
        return meta as unknown as import('@deepseek-ai/dsh-util-values').JsonValue
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
          readSillyTavernChatIdentity(sessionEvents(exec.agent.session))?.userName,
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
      readSillyTavernChatIdentity(sessionEvents(exec.agent.session))?.userName, libraryEntry.id)
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
        return meta as unknown as import('@deepseek-ai/dsh-util-values').JsonValue
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
    if (!hostSupportsAgentRpSessionEvents()) {
      throw new Error('当前 DSH Host 缺少 Agent RP 所需的安全插件事件写入能力')
    }
    const stExtensionGeneration = new StExtensionGenerationCoordinator()
    const unregisterStExtensionGeneration = registerStExtensionGenerationCoordinator(stExtensionGeneration)
    ctx.effect(() => () => {
      unregisterStExtensionGeneration()
      stExtensionGeneration.dispose()
    }, 'agent-rp: installed ST extension generation lifetime')
    const runtimeExtensions = new RoleplayRuntimeExtensionRegistry()
    ctx.provide(ROLEPLAY_RUNTIME_EXTENSIONS_KEY, runtimeExtensions)
    const turnWorkers = new RoleplayTurnWorkerRegistry()
    ctx.provide(ROLEPLAY_TURN_WORKERS_KEY, turnWorkers)
    const playWorlds = new PlayWorldRegistry()
    ctx.provide(PLAY_WORLD_REGISTRY_KEY, playWorlds)
    ctx.effect(
      () => playWorlds.register(createFlyingChessWorldModule()),
      'agent-rp: built-in flying chess play world',
    )
    const resourceCatalog = new RoleplayResourceCatalog()
    const tavernResourcePreflight = new TavernResourcePreflightRegistry()
    ctx.provide(TAVERN_RESOURCE_PREFLIGHT_KEY, tavernResourcePreflight)
    const worldbookCharacters = createWorldbookCharacterContextRegistry()
    ctx.provide(WORLDBOOK_CHARACTER_CONTEXT_KEY as never, worldbookCharacters as never)
    installWorldbookSnapshotCoalescing(ctx)
    const ejsTemplateEngine = await loadEjsTemplateEngine(ctx)
    const worldBindings = new CharacterWorldBindingStore()
    const worldInfoLibrary = new WorldInfoLibrary({ bindings: worldBindings })
    const characterLibrary = new CharacterLibrary({ worldInfoLibrary, worldBindings })
    characterLibrary.migrateEmbeddedWorldInfos()
    const personaLibrary = new PersonaLibrary()
    const presetLibrary = new PresetLibrary()
    const regexPackLibrary = new RegexPackLibrary()
    const chatLibrary = new SillyTavernChatLibrary()
    const workspaceSettings = new WorkspaceSettingsStore()
    const storyWorkspaces = new StoryWorkspaceStore({ worlds: playWorlds, resources: resourceCatalog })
    const generatedImageLibrary = new GeneratedImageLibrary()
    for (const provider of roleplayLibraryResourceProviders({
      characters: characterLibrary,
      personas: personaLibrary,
      presets: presetLibrary,
      regexPacks: regexPackLibrary,
      worldInfos: worldInfoLibrary,
    }).concat(nativePromptPolicyResourceProvider(), flyingChessWorldResourceProvider())) ctx.effect(
      () => resourceCatalog.register(provider),
      `agent-rp: built-in resource provider ${provider.id}`,
    )
    for (const contributor of tavernResourceLibraryPreflightContributors({
      characters: characterLibrary,
      presets: presetLibrary,
    })) ctx.effect(
      () => tavernResourcePreflight.register(contributor),
      `agent-rp: built-in Tavern preflight provider ${contributor.providerId}`,
    )
    ctx.provide(ROLEPLAY_RESOURCE_CATALOG_KEY, resourceCatalog)
    let mountedServer: AgentRpHttpServer | undefined
    const mountHost = (serviceName: 'httpServer' | 'webServer'): void => {
      ctx.inject([
        serviceName,
        'credentials',
        'agents',
        'llm',
        'sessionController',
        'sessionProjections',
        'systemPrompt',
      ], webCtx => {
        const server = webCtx.get(serviceName) as AgentRpHttpServer
        if (mountedServer !== undefined) return
        mountedServer = server
        webCtx.effect(() => () => {
          if (mountedServer === server) mountedServer = undefined
        }, `agent-rp: release ${serviceName}`)
        installCharacterLibraryHttp(webCtx, ctx, characterLibrary, server)
        installPersonaLibraryHttp(webCtx, personaLibrary, server)
        installPresetLibraryHttp(webCtx, presetLibrary, server)
        installRegexPackLibraryHttp(webCtx, regexPackLibrary, server)
        const tavernExecutionPlans = new TavernExecutionPlanCache(undefined, 64, {
          persistentRoot: dshHomePath('agent-rp', 'cache', 'tavern-execution-plans'),
        })
        installTavernPreflightHttp(
          webCtx, characterLibrary, presetLibrary, resourceCatalog, tavernResourcePreflight,
          server, tavernExecutionPlans,
        )
        installTavernExecutionHttp(webCtx, characterLibrary, presetLibrary, server, tavernExecutionPlans)
        installSillyTavernChatHttp(webCtx, chatLibrary, server)
        installSillyTavernChatExportHttp(webCtx, ctx, server)
        installAgentRpCommandHttp(webCtx, ctx, server)
        installAgentRpMemoryHttp(webCtx, ctx, server)
        installRoleplayTurnHealthHttp(webCtx, ctx, server)
        installSessionLaunchHttp(
          webCtx,
          ctx,
          characterLibrary,
          chatLibrary,
          presetLibrary,
          worldInfoLibrary,
          resourceCatalog,
          server,
          storyWorkspaces,
        )
        installWorldInfoLibraryHttp(webCtx, worldInfoLibrary, server)
        installWorkspaceSettingsHttp(webCtx, workspaceSettings, server)
        installStoryWorkspaceHttp(webCtx, storyWorkspaces, server, resourceCatalog)
        installAgentRpCapabilityPresetHttp(webCtx, ctx, server)
        installRoleplayResourceCatalogHttp(webCtx, resourceCatalog, server)
        installNativeIdentityHttp(webCtx, new NativeIdentityStore(webCtx.credentials), server)
        installImageGenerationHttp(webCtx, generatedImageLibrary, webCtx.credentials, server)
        installTavernGenerationHttp(webCtx, server)
        installTavernModelListHttp(webCtx, server)
        installStExtensionGenerationHttp(webCtx, server, stExtensionGeneration)
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
