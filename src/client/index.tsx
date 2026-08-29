/** Roleplay browser shell and native SillyTavern migration affordances. */

import type { Context, Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AssistantActionOwnerProps, CommandRowProps, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconEditOutline16, IconEllipsisOutline16,
  IconLoadingOutline16, IconPlayOutline16, IconRefreshOutline16, IconSparkle16, IconWarningOutline16,
  Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  AGENT_RP_ST_EXTENSION_SERVICE,
  AGENT_RP_WORKBENCH_SECTION_SLOT,
} from '../client-extension-v0.ts'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import {
  type CSSProperties, type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef,
  useState, useSyncExternalStore,
} from 'react'
import { installStExtensionHost } from './st-extension-host.ts'
import { createStExtensionGenerationClient } from './st-extension-generation.ts'
import { InstalledStExtensionRegistry } from './st-extension-registry.ts'
import {
  InstalledStExtensionSurface,
  InstalledStExtensionWorkbenchSection,
  installStExtensionSurface,
} from './st-extension-surface.tsx'
import { StoryWorkspaceEditor } from './story-workspace-editor.tsx'
import { createStoryWorkspaceNavigation, type StoryWorkspaceNavigation } from './story-workspace-navigation.ts'
import { installStoryWorkspaceSessionCard } from './story-workspace-session-card.tsx'

interface SidebarDestinationOwnerProps {
  readonly wide: boolean
  readonly width: number
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root'; owner: Record<string, never> }
    'sidebar.destinations': { kind: 'list'; scope: 'root'; owner: SidebarDestinationOwnerProps }
    'conversation.chat.turnActions': { kind: 'list'; scope: 'session'; owner: TurnTailOwnerProps }
  }
}
import { DEFAULT_AGENT_RP_CHARACTER_NAME, type AgentRpProjection } from '../projection-types.ts'
import { resolveLegacySidebarWidth } from './sidebar-slot-compat.ts'
import { resolveRoleplayAvatarSource } from './avatar-source.ts'
import { chatMigrationPermissionOwnerId } from './chat-migration.ts'
import type { ImportedRegexScript, ImportedTavernHelperScript } from '../import/types.ts'
import { parseTavernHelperScripts } from '../import/tavern-helper.ts'
import { importTavernRegex } from '../tavern-regex.ts'
import type {
  TavernHelperMutationRequest,
  TavernMutationCause,
  TavernScriptTreeScope,
} from '../tavern-helper.ts'
import {
  installedStExtensionSettingsIdentity,
  tavernExtensionSettingsIdentity,
  tavernScriptIdentity,
  tavernScriptStorageIdentity,
} from '../tavern-script-identity.ts'
import {
  TAVERN_GENERATION_PATH,
  TAVERN_MODEL_LIST_PATH,
  TAVERN_PROMPT_PREVIEW_PATH,
  type TavernGenerationRequest,
  type TavernGenerationResponse,
  type TavernModelListRequest,
  type TavernModelListResponse,
  type TavernPrompt,
  type TavernPromptPreviewResponse,
} from '../tavern-generation-protocol.ts'
import {
  type TavernPreflightResult,
} from '../tavern-preflight-protocol.ts'
import {
  fetchCachedTavernExecutions,
  fetchTavernExecution,
  TavernExecutionOriginApprovalError,
} from './tavern-preflight.ts'
import {
  advanceTavernTranscript,
  BUILT_IN_TAVERN_SCRIPT_ORIGINS,
  parseTavernResourceBlockedReport,
  resolveTavernScriptExecution,
  shouldResetTavernScriptRuntime,
  tavernScriptFrameNavigation,
  tavernScriptFrameSource,
  tavernScriptRuntimePhase,
  validatedTavernCompatibilityMarkers,
  TavernScriptOriginApprovalError,
  type TavernScriptExecution,
  type TavernTranscriptCursor,
  type TavernResourceBlockedReport,
  type TavernScriptSnapshot,
} from './tavern-runtime.ts'
import { currentTavernPreset, tavernScriptSnapshot } from './tavern-snapshot.ts'
import { TavernScriptStatusList } from './tavern-script-status.tsx'
import { worldInfoFailureReport } from './world-info-failure-report.ts'
import { availableWorldInfoLibraryUploads } from './world-info-library-selection.ts'
import type { PresetConfigurationRequest } from '../preset-configuration-types.ts'
import type { WorldInfoConfigurationRequest, WorldInfoEditableEntry } from '../world-info-configuration-types.ts'
import { exportSillyTavernPresetJson } from '../preset-export.ts'
import {
  attachPresetModule, detachPresetModule, movePresetModule,
} from '../preset-module-assembly.ts'
import { projectPresetPromptSections } from '../preset-sections.ts'
import {
  PRESET_LIBRARY_PATH,
  presetLibraryOptionLabel,
  type PresetLibraryDeleteResponse,
  type PresetLibraryImportResponse,
  type PresetLibraryListResponse,
  type PresetLibraryRenameResponse,
  type PresetLibrarySummary,
} from '../preset-library-http-protocol.ts'
import {
  AI_OUTPUT_PLACEMENT, compileCharacterDisplay, renderCharacterDisplay, splitCharacterDisplay,
  summarizeCharacterRegexScript, USER_INPUT_PLACEMENT, withCurrentCharacterDisplayScripts, type CompiledCharacterDisplay,
  type CharacterDisplaySegment, type CharacterRegexScriptSummary,
} from '../frontend-regex.ts'
import {
  createRoleplayDisplayPlanner,
  ROLEPLAY_STATUS_PLACEHOLDER,
} from '../roleplay-display-plan.ts'
import {
  blockedCardFrameResources, compileCardFrameDocument, inlineCardSanitizerProbeState,
} from './card-frame.ts'
import {
  cardFrameGreetingChoices,
  cardResourceBlockedEvent,
  cardResourceTypeLabel,
  CharacterDisplay,
} from './card-display.tsx'
import { captureCardFrameAppearance } from './card-frame-appearance.ts'
import { retainedCardFrameMessageIds } from './card-frame-retention.ts'
import {
  characterLibraryChangedEvent,
  characterLibraryJson,
  fetchCharacterRuntimeDetail,
  fetchCharacterWorldInfoPage,
  notifyCharacterLibraryChanged,
  updateCharacterEdits,
  updateCharacterRemoteResource,
  updateCharacterRemoteResourcePolicy,
  updateCharacterWorldBinding,
} from './character-library-client.ts'
import { CharacterContentEditor } from './character-content-editor.tsx'
import {
  parseCardCapabilityRequest, parseCardChatSendCapabilityRequest,
  parseCardExternalWindowCapabilityRequest,
  parseCardExternalWindowControlRequest, parseCardExternalWindowDeliveryReport,
  parseCardNativeIdentityCapabilityRequest,
  parseCardResourceBlockedReport, parseCardRuntimeReport,
  parseCardUserMessageAppendCapabilityRequest,
  parseCardVariableReplaceRequest,
} from './card-capability.ts'
import { CardPlayerActionCoordinator } from './card-player-action.ts'
import {
  collectAgentRpBrowserCompatibilitySnapshot,
  installAgentRpBrowserCompatibilityDiagnostic,
} from './compatibility-diagnostic.ts'
import { resolveAssistantActionMessage } from './generation-action-target.ts'
import {
  collectAgentRpCopiedDiagnostic,
  serializeAgentRpCopiedDiagnostic,
} from './debug-diagnostic-report.ts'
import {
  AgentRpRuntimeDiagnosticRegistry,
  createAgentRpRuntimeDiagnosticSource,
  installAgentRpRuntimeDiagnostic,
  type AgentRpRuntimeCardFrameFacts,
  type AgentRpRuntimeDiagnosticContribution,
  type AgentRpRuntimeDiagnosticSource,
} from './runtime-diagnostic.ts'
import { summarizeWorldEngineResources } from '../world-engine-diagnostic.ts'
import { installAgentRpNativeBack } from './native-back.ts'
import { installAgentRpNativeShare } from './native-share.ts'
import { loadAgentRpTurnHealth } from './roleplay-turn-health.ts'
import type { AgentRpTurnHealthDiagnostic } from '../roleplay-turn-health-protocol.ts'
import {
  createSessionLaunchNoticeSource,
  type SessionLaunchNoticeSource,
} from './session-launch-notice.ts'
import {
  classifySillyTavernJsonFile,
  selectSillyTavernDraft,
  type DraftAttachmentLike,
  type SillyTavernJsonKind,
} from './import-hint.ts'
import { parseTavernSlashCommand } from './tavern-slash.ts'
import { parseComputedColor, roleplayContrastOverride, type RoleplayContrastPalette } from './theme-contrast.ts'
import {
  executeTavernStorageRequest,
  readTavernExtensionSettings,
  writeTavernExtensionSettings,
} from './tavern-storage.ts'
import {
  parseTavernExternalWindowCapabilityRequest,
  parseTavernExtensionSettingsCapabilityRequest,
  parseTavernNativeIdentityCapabilityRequest,
  parseTavernPopupCapabilityRequest,
  parseTavernStorageCapabilityRequest,
  tavernMutationMatchesCapability,
  validTavernStorageCapabilityResult,
  type TavernPopupOptions,
  type TavernPopupType,
} from './tavern-capability.ts'
import {
  enqueueExternalWindowRequest,
  openExternalWindowBroker,
  type ExternalWindowBroker,
  type ExternalWindowPhase,
} from './external-window.ts'
import {
  deliverNativeIdentityResult,
  nativeIdentityApprovalKey,
  nativeIdentityApprovalsChangedEvent,
  readApprovedNativeIdentities,
  writeApprovedNativeIdentities,
  type NativeIdentityRuntimeRequest,
} from './native-identity.ts'
import { NativeIdentitySettingsPanel, useNativeIdentityDiagnosticState } from './native-identity-ui.tsx'
import {
  approvedTavernScriptOrigins,
  normalizedTavernModelOrigin,
  normalizedTavernScriptOrigin,
  parseTavernScriptOriginApprovalKey,
  pendingTavernScriptResourcePermissions,
  readApprovedTavernScriptCustomGenerations,
  readApprovedTavernScriptFrames,
  readApprovedTavernScriptFonts,
  readApprovedTavernScriptGenerations,
  readApprovedTavernScriptImages,
  readApprovedTavernScriptModels,
  readApprovedTavernScriptOrigins,
  readApprovedTavernScriptStyles,
  tavernResourcePreflightApprovals,
  tavernPreflightLaunchPhase,
  tavernPermissionPlan,
  tavernPermissionOwnerId,
  tavernScriptFrameApprovalKey,
  tavernScriptImageApprovalKey,
  tavernScriptInteractionApprovalKey,
  tavernScriptOriginApprovalKey,
  tavernScriptStyleApprovalKey,
  summarizeTavernPermissionPlan,
  writeApprovedTavernScriptCustomGenerations,
  writeApprovedTavernScriptFrames,
  writeApprovedTavernScriptFonts,
  writeApprovedTavernScriptGenerations,
  writeApprovedTavernScriptImages,
  writeApprovedTavernScriptModels,
  writeApprovedTavernScriptOrigins,
  writeApprovedTavernScriptStyles,
  type TavernScriptResourcePermission,
} from './tavern-permission.ts'
import { fetchTavernPreflight } from './tavern-preflight.ts'
import { RoleplayResourceCenter } from './resource-center.tsx'
import {
  deleteRegexPack,
  importRegexPackFile,
  listRegexPacks,
} from './regex-pack-library-client.ts'
import type { RegexPackLibrarySummary } from '../regex-pack-library-protocol.ts'
import { fetchRoleplayResourceDetail } from './roleplay-resource-detail.ts'
import {
  agentRpSessionResourcePermissionsChangedEvent,
  readAgentRpSessionResourcePermissions,
  withAgentRpSessionCardPermissions,
  writeAgentRpSessionResourcePermissions,
  type AgentRpSessionResourcePermissions,
} from './session-permission.ts'
import {
  CHARACTER_LIBRARY_PATH,
  characterLibraryImageUrl,
  type CharacterLibraryCollection,
  type CharacterLibraryDeleteResponse,
  type CharacterLibraryDetail,
  type CharacterLibraryImportResult,
  type CharacterLibraryRegexScript,
  type CharacterLibrarySummary,
  type CharacterRemoteResourceApproval,
} from '../character-library-protocol.ts'
import { cardRemoteResourceApprovalKey } from '../card-remote-resource.ts'
import {
  CARD_GREETING_CAPABILITY_MANIFEST,
  CARD_FRONTEND_CAPABILITY_MANIFEST,
  NATIVE_WORLD_ENGINE_MANIFEST,
  TAVERN_LEGACY_ADAPTER_MANIFEST,
  boundedAgentRpCapabilityResultError,
  mergeAgentRpCapabilityPlanSummaries,
  resolveAgentRpCapabilityPlan,
  summarizeAgentRpCapabilityPlan,
} from '../extension-capability.ts'
import {
  PERSONA_LIBRARY_PATH,
  type PersonaLibraryEntry,
  type PersonaLibrarySaveRequest,
  type SessionPersonaSnapshot,
} from '../persona-library-protocol.ts'
import {
  SILLYTAVERN_CHAT_PATH,
  type SillyTavernChatUploadResponse,
} from '../sillytavern-chat-protocol.ts'
import { SILLYTAVERN_CHAT_EXPORT_PATH } from '../sillytavern-chat-export-protocol.ts'
import {
  AGENT_RP_MEMORY_PATH,
  type AgentRpMemoryCommandRequest,
  type AgentRpMemoryResponse,
  type AgentRpMemoryView,
} from '../memory-protocol.ts'
import { executeAgentRpCommand } from './agent-rp-command.ts'
import type { RoleplayStateCommandRequest } from '../roleplay-state.ts'
import {
  AGENT_RP_SESSION_PATH,
  type AgentRpSessionLaunchRequest,
  type AgentRpSessionLaunchResponse,
} from '../session-launch-protocol.ts'
import {
  AGENT_RP_CAPABILITY_PRESETS_PATH,
  isAgentRpCapabilityPresetId,
  type AgentRpCapabilityPresetListResponse,
  type AgentRpCapabilityPresetSummary,
} from '../agent-capability-preset-protocol.ts'
import type { RoleplayActorResourceDetail } from '../roleplay-resource-catalog-protocol.ts'
import { characterLibraryRoleplayResourceId } from '../roleplay-resource-library-ids.ts'
import {
  characterExperienceSelection,
  characterExperienceLaunchRequest,
  experiencePreflightResources,
  sceneExperienceSelection,
  sceneExperienceLaunchRequest,
} from './roleplay-experience-request.ts'
import {
  WORLD_INFO_LIBRARY_PATH,
  type WorldInfoLibraryListResponse,
  type WorldInfoLibraryLaunchRequest,
  type WorldInfoLibraryUpload,
  type WorldInfoLibraryUploadResponse,
} from '../world-info-library-protocol.ts'
import {
  AGENT_RP_WORKSPACE_SETTINGS_PATH,
  DEFAULT_AGENT_RP_SETTINGS,
  allowsAgentRpEntry,
  normalizeAgentRpSettings,
  setAgentRpWorkspaceEntry,
  type AgentRpSettings, type ImageGenerationProfile, type ImageGenerationSettings,
} from '../workspace-settings.ts'
import {
  availableModelCatalog,
  resolveStateVerificationReasoningChoices,
  updateStateVerificationSettings,
  type AvailableModelCatalog,
  type CurrentModelCapabilities,
} from './state-verification-reasoning.ts'
import {
  AGENT_RP_IMAGE_PATH,
  decodeImageGenerationRecord,
  generatedImageAssetUrl,
  generatedImageJobUrl,
  parseImageGenerationRequest,
  type GeneratedImageJob,
  type ImageCredentialInfo,
  type ImageProviderTestResult,
  type ImageGenerationMode,
  type ImageGenerationRequest,
} from '../image-generation-protocol.ts'
import {
  RP_DISTRIBUTION_BRIDGE_PATH,
  type RpDistributionAssetKind,
  type RpDistributionAssetImportResponse,
  type RpDistributionChatImportResponse,
  type RpDistributionProbeResponse,
  type RpDistributionTransferResponse,
} from '../rp-distribution-bridge-protocol.ts'
import { installRoleplayArtifactTail } from './roleplay-artifact-tail.tsx'

interface WorkspaceListSource {
  readonly getSnapshot: () => { readonly items: readonly WorkspaceView[] }
  readonly subscribe: (listener: () => void) => () => void
}

interface WorkspaceSettingsSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly value: AgentRpSettings
  readonly error?: string
}

interface WorkspaceSettingsSource {
  readonly getSnapshot: () => WorkspaceSettingsSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly set: (settings: AgentRpSettings) => Promise<void>
}

function createWorkspaceSettingsSource(): WorkspaceSettingsSource {
  const listeners = new Set<() => void>()
  let snapshot: WorkspaceSettingsSnapshot = { status: 'loading', value: DEFAULT_AGENT_RP_SETTINGS }
  const publish = (next: WorkspaceSettingsSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const decode = (value: unknown): AgentRpSettings => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Agent RP 设置响应无效')
    return normalizeAgentRpSettings((value as { readonly settings?: unknown }).settings)
  }
  const load = async (): Promise<void> => {
    try {
      const response = await fetch(AGENT_RP_WORKSPACE_SETTINGS_PATH, { headers: { accept: 'application/json' } })
      const value = await response.json() as unknown
      if (!response.ok) throw new Error((value as { readonly error?: string }).error ?? `设置读取失败（${response.status}）`)
      publish({ status: 'ready', value: decode(value) })
    } catch (reason: unknown) {
      publish({ status: 'error', value: DEFAULT_AGENT_RP_SETTINGS, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  void load()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set(settings) {
      const response = await fetch(AGENT_RP_WORKSPACE_SETTINGS_PATH, {
        method: 'PUT',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const value = await response.json() as unknown
      if (!response.ok) throw new Error((value as { readonly error?: string }).error ?? `设置保存失败（${response.status}）`)
      publish({ status: 'ready', value: decode(value) })
    },
  }
}

class ImageControlTransportError extends Error {}

function imageControlUrl(path: string): string {
  const { hostname, port, protocol } = window.location
  if (protocol !== 'http:') return path
  const alternate = hostname === '127.0.0.1' ? 'localhost' : hostname === 'localhost' ? '127.0.0.1' : undefined
  return alternate === undefined ? path : `http://${alternate}:${port || '80'}${path}`
}

async function imageControlFetch(
  action: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
  retryLabel = '重试状态',
): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException(`${action}超时`, 'TimeoutError'))
  }, timeoutMs)
  try {
    return await fetch(imageControlUrl(path), { ...init, credentials: 'omit', signal: controller.signal })
  } catch (error: unknown) {
    const timedOut = controller.signal.aborted
    throw new ImageControlTransportError(timedOut
      ? `${action}等待本机 DSH 超时；无需重复输入密钥，请稍后再点“${retryLabel}”`
      : `${action}没有连上本机 DSH；无需重复输入密钥，请再次点“${retryLabel}”`, { cause: error })
  } finally {
    window.clearTimeout(timer)
  }
}

async function imageCredentialInfo(provider: ImageGenerationSettings['provider']): Promise<ImageCredentialInfo> {
  const response = await imageControlFetch(
    '读取图片密钥状态',
    `${AGENT_RP_IMAGE_PATH}/credential?provider=${encodeURIComponent(provider)}`,
    { headers: { accept: 'application/json' } },
  )
  const value = await response.json() as { readonly error?: string; readonly credential?: ImageCredentialInfo }
  if (!response.ok || value.credential === undefined) {
    throw new Error(value.error ?? `图片密钥状态读取失败（${response.status}）`)
  }
  return value.credential
}

async function updateImageCredential(
  provider: ImageGenerationSettings['provider'],
  change: { readonly value: string } | { readonly clear: true },
  previous?: ImageCredentialInfo,
): Promise<ImageCredentialInfo> {
  let response: Response
  try {
    response = await imageControlFetch(
      '保存图片密钥',
      `${AGENT_RP_IMAGE_PATH}/credential?provider=${encodeURIComponent(provider)}`,
      {
        method: 'PUT',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(change),
      },
    )
  } catch (error: unknown) {
    if (!(error instanceof ImageControlTransportError)) throw error
    try {
      const observed = await imageCredentialInfo(provider)
      if ('clear' in change && !observed.configured) return observed
      if ('value' in change && previous?.configured !== true && observed.configured) return observed
    } catch (_statusUnavailable) {
      // The original transport error is more useful than a second failed probe.
    }
    throw error
  }
  const value = await response.json() as { readonly error?: string; readonly credential?: ImageCredentialInfo }
  if (!response.ok || value.credential === undefined) {
    throw new Error(value.error ?? `图片密钥保存失败（${response.status}）`)
  }
  return value.credential
}

async function testConfiguredImageProvider(settings: ImageGenerationSettings): Promise<ImageProviderTestResult> {
  const response = await imageControlFetch('测试图片服务', `${AGENT_RP_IMAGE_PATH}/test`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  }, 18_000, '测试连接')
  const value = await response.json() as { readonly error?: string; readonly test?: ImageProviderTestResult }
  if (!response.ok || value.test === undefined) throw new Error(value.error ?? `图片服务连接测试失败（${response.status}）`)
  return value.test
}

interface ImportHintProps {
  readonly sessionId: SessionId
  readonly input: {
    readonly draft: string
    readonly attachmentIds?: readonly string[]
    readonly imageIds?: readonly string[]
  }
  readonly inputActions: {
    readonly setDraft: (text: string) => void
  }
}

interface DraftResolver {
  readonly draftAttachments: (ids: readonly string[]) => readonly DraftRuntimeAttachment[]
  readonly releaseDraftAttachment?: (id: string) => void
}

interface DraftRuntimeAttachment extends DraftAttachmentLike {
  readonly id: string
  readonly file: File
}

interface PreparedChatMigration {
  readonly importId: string
  /** Runtime permission owner: retained card id when present, otherwise the imported chat identity. */
  readonly permissionOwnerId: string
  readonly character?: CharacterLibraryDetail
}

type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & {
  readonly runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry
  readonly workspaceSettings: WorkspaceSettingsSource
  readonly loadAvatar: (attachmentId: string) => Promise<string | undefined>
  readonly renameSession: (sessionId: SessionId, title: string) => Promise<void>
  readonly configurePreset: (sessionId: SessionId, request: PresetConfigurationRequest) => Promise<void>
  readonly importPresetFile: (file: File) => Promise<PresetLibrarySummary>
  readonly importPreset: (sessionId: SessionId, file: File) => Promise<void>
  readonly managePresetLibrary: (sessionId: SessionId, request: PresetLibraryRequest) => Promise<void>
  readonly configureWorldInfo: (sessionId: SessionId, request: WorldInfoConfigurationRequest) => Promise<void>
  readonly importWorldInfo: (sessionId: SessionId, file: File) => Promise<void>
  readonly attachWorldInfo: (sessionId: SessionId, importId: string) => Promise<void>
  readonly listWorldInfos: () => Promise<readonly WorldInfoLibraryUpload[]>
  readonly listCharacters: (collection?: CharacterLibraryCollection) => Promise<readonly CharacterLibrarySummary[]>
  readonly readCharacter: (id: string) => Promise<CharacterLibraryDetail>
  readonly setCharacterArchived: (id: string, archived: boolean) => Promise<CharacterLibraryDetail>
  readonly deleteCharacter: (id: string) => Promise<void>
  readonly importCharacterFile: (file: File) => Promise<CharacterLibraryImportResult>
  readonly prepareChatMigration: (
    sessionId: SessionId,
    chatFile: File,
    cardFile?: File,
    characterId?: string,
  ) => Promise<PreparedChatMigration>
  readonly prepareRpDistributionChatMigration: (
    sessionId: SessionId,
    target: string,
    remoteSessionId: string,
  ) => Promise<PreparedChatMigration>
  readonly launchPreparedChatMigration: (
    sessionId: SessionId,
    prepared: PreparedChatMigration,
    presetId?: string,
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ) => Promise<void>
  readonly exportChat: (sessionId: SessionId) => Promise<void>
  readonly listMemory: (sessionId: SessionId) => Promise<readonly AgentRpMemoryView[]>
  readonly manageMemory: (sessionId: SessionId, request: AgentRpMemoryCommandRequest) => Promise<void>
  readonly manageState: (sessionId: SessionId, request: RoleplayStateCommandRequest) => Promise<void>
  readonly manageTurnMode: (sessionId: SessionId, mode: AgentRpProjection['turnMode']) => Promise<void>
  readonly startCharacterSession: (
    sessionId: SessionId,
    character: CharacterLibraryDetail,
    greetingIndex: number,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    memory?: 'copy-active',
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ) => Promise<void>
  readonly listPresets: () => Promise<readonly PresetLibrarySummary[]>
  readonly listRegexPacks: () => Promise<readonly RegexPackLibrarySummary[]>
  readonly importRegexPackFile: (file: File) => Promise<RegexPackLibrarySummary>
  readonly deleteRegexPack: (id: string) => Promise<void>
  readonly listAgentCapabilityPresets: () => Promise<readonly AgentRpCapabilityPresetSummary[]>
  readonly listPersonas: () => Promise<readonly PersonaLibraryEntry[]>
  readonly savePersona: (request: PersonaLibrarySaveRequest) => Promise<PersonaLibraryEntry>
  readonly deletePersona: (id: string) => Promise<PersonaLibraryEntry>
  readonly applyPersona: (sessionId: SessionId, persona?: SessionPersonaSnapshot) => Promise<void>
  readonly loadModelCapabilities: (sessionId: SessionId) => Promise<CurrentModelCapabilities>
}

type ComposerDockProps = PropsRuntime<'conversation.composer.dock'>

type GenerationTailProps = Pick<TurnTailOwnerProps, 'seq' | 'turn'> & {
  readonly sessionId: SessionId
  readonly runGeneration: (
    sessionId: SessionId,
    request: { readonly operation: 'regenerate' | 'continue'; readonly replySeq: number }
      | { readonly operation: 'select'; readonly replySeq: number; readonly versionIndex: number },
  ) => Promise<void>
  readonly rewriteTurn: (sessionId: SessionId, turn: number, draft: string) => Promise<void>
  readonly runImageGeneration: RunImageGeneration
  readonly useChat: PropsRuntime<'conversation.composer.dock'>['useChat']
  readonly useProjection: PropsRuntime<'conversation.composer.dock'>['useProjection']
  readonly useSession: PropsRuntime<'conversation.composer.dock'>['useSession']
}

type AssistantGenerationActionsProps = AssistantActionOwnerProps
  & Omit<GenerationTailProps, 'seq' | 'turn'>

const color = 'var(--dsw-alias-state-business-primary, #6f78e8)'
const statusPlaceholder = ROLEPLAY_STATUS_PLACEHOLDER
const openRoleplaySessionToolsEvent = 'dsh-agent-rp-open-session-tools'

function elapsedStartupMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function useLiveStartupElapsed(startedAt: number, active: boolean): number {
  const [elapsed, setElapsed] = useState(() => elapsedStartupMilliseconds(startedAt))
  useEffect(() => {
    const update = (): void => { setElapsed(elapsedStartupMilliseconds(startedAt)) }
    update()
    if (!active) return
    const timer = window.setInterval(update, 250)
    return () => { window.clearInterval(timer) }
  }, [active, startedAt])
  return elapsed
}

function useAgentRpRuntimeDiagnosticContribution(
  registry: AgentRpRuntimeDiagnosticRegistry,
  label: string,
  contribution: AgentRpRuntimeDiagnosticContribution | undefined,
): void {
  const source = useRef<AgentRpRuntimeDiagnosticSource>()
  source.current ??= createAgentRpRuntimeDiagnosticSource(label)
  useEffect(() => {
    if (contribution === undefined) registry.remove(source.current!)
    else registry.publish(source.current!, contribution)
  })
  useEffect(() => () => { registry.remove(source.current!) }, [registry])
}

type RoleplayViewMode = 'immersive' | 'debug'

type RoleplayBackgroundChoice = 'auto' | 'off' | number
type RoleplayExpressionChoice = 'default' | number

const roleplayViewListeners = new Map<SessionId, Set<() => void>>()
const roleplayBackgroundListeners = new Map<SessionId, Set<() => void>>()
const roleplayExpressionListeners = new Map<SessionId, Set<() => void>>()

function roleplayViewKey(sessionId: SessionId): string {
  return `dsh.agent-rp.view.${sessionId}`
}

function readRoleplayViewMode(sessionId: SessionId): RoleplayViewMode {
  return localStorage.getItem(roleplayViewKey(sessionId)) === 'debug' ? 'debug' : 'immersive'
}

function setRoleplayViewMode(sessionId: SessionId, mode: RoleplayViewMode): void {
  if (mode === 'immersive') localStorage.removeItem(roleplayViewKey(sessionId))
  else localStorage.setItem(roleplayViewKey(sessionId), mode)
  for (const listener of roleplayViewListeners.get(sessionId) ?? []) listener()
}

function useRoleplayViewMode(sessionId: SessionId): RoleplayViewMode {
  return useSyncExternalStore(callback => {
    const listeners = roleplayViewListeners.get(sessionId) ?? new Set<() => void>()
    listeners.add(callback)
    roleplayViewListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) roleplayViewListeners.delete(sessionId)
    }
  }, () => readRoleplayViewMode(sessionId), () => 'immersive')
}

function roleplayBackgroundKey(sessionId: SessionId): string {
  return `dsh.agent-rp.background.${sessionId}`
}

function readRoleplayBackground(sessionId: SessionId): RoleplayBackgroundChoice {
  const value = localStorage.getItem(roleplayBackgroundKey(sessionId))
  if (value === 'off') return 'off'
  if (value !== null && /^\d+$/u.test(value)) return Number(value)
  return 'auto'
}

function setRoleplayBackground(sessionId: SessionId, choice: RoleplayBackgroundChoice): void {
  if (choice === 'auto') localStorage.removeItem(roleplayBackgroundKey(sessionId))
  else localStorage.setItem(roleplayBackgroundKey(sessionId), String(choice))
  for (const listener of roleplayBackgroundListeners.get(sessionId) ?? []) listener()
}

function useRoleplayBackground(sessionId: SessionId | undefined): RoleplayBackgroundChoice {
  return useSyncExternalStore(callback => {
    if (sessionId === undefined) return () => {}
    const listeners = roleplayBackgroundListeners.get(sessionId) ?? new Set<() => void>()
    listeners.add(callback)
    roleplayBackgroundListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) roleplayBackgroundListeners.delete(sessionId)
    }
  }, () => sessionId === undefined ? 'auto' : readRoleplayBackground(sessionId), () => 'auto')
}

function roleplayExpressionKey(sessionId: SessionId): string {
  return `dsh.agent-rp.expression.${sessionId}`
}

function readRoleplayExpression(sessionId: SessionId): RoleplayExpressionChoice {
  const value = localStorage.getItem(roleplayExpressionKey(sessionId))
  return value !== null && /^\d+$/u.test(value) ? Number(value) : 'default'
}

function setRoleplayExpression(sessionId: SessionId, choice: RoleplayExpressionChoice): void {
  if (choice === 'default') localStorage.removeItem(roleplayExpressionKey(sessionId))
  else localStorage.setItem(roleplayExpressionKey(sessionId), String(choice))
  for (const listener of roleplayExpressionListeners.get(sessionId) ?? []) listener()
}

function useRoleplayExpression(sessionId: SessionId | undefined): RoleplayExpressionChoice {
  return useSyncExternalStore(callback => {
    if (sessionId === undefined) return () => {}
    const listeners = roleplayExpressionListeners.get(sessionId) ?? new Set<() => void>()
    listeners.add(callback)
    roleplayExpressionListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(callback)
      if (listeners.size === 0) roleplayExpressionListeners.delete(sessionId)
    }
  }, () => sessionId === undefined ? 'default' : readRoleplayExpression(sessionId), () => 'default')
}

const roleplayPresetPreferenceKey = 'dsh.agent-rp.preset'

function readRoleplayPresetPreference(): string {
  const value = localStorage.getItem(roleplayPresetPreferenceKey)
  return value !== null && /^[a-z0-9-]{8,80}$/u.test(value) ? value : ''
}

function writeRoleplayPresetPreference(presetId: string): void {
  localStorage.setItem(roleplayPresetPreferenceKey, presetId)
}

async function renamePresetLibraryEntry(id: string, name: string): Promise<PresetLibrarySummary> {
  const response = await fetch(`${PRESET_LIBRARY_PATH}?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const value = await response.json() as Partial<PresetLibraryRenameResponse> & { readonly error?: string }
  if (!response.ok || value.entry === undefined) throw new Error(value.error ?? `预设改名失败（${response.status}）`)
  return value.entry
}

async function deletePresetLibraryEntry(id: string): Promise<void> {
  const response = await fetch(`${PRESET_LIBRARY_PATH}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { accept: 'application/json' },
  })
  const value = await response.json() as Partial<PresetLibraryDeleteResponse> & { readonly error?: string }
  if (!response.ok || value.format !== 0 || value.id !== id) {
    throw new Error(value.error ?? `预设移除失败（${response.status}）`)
  }
  if (readRoleplayPresetPreference() === id) writeRoleplayPresetPreference('')
}

function usePresetPreference(
  listPresets: HeaderProps['listPresets'],
  enabled = true,
): {
  readonly entries: readonly PresetLibrarySummary[] | undefined
  readonly error?: string
  readonly presetId: string
  readonly selectPreset: (presetId: string) => void
  readonly selectImportedPreset: (entry: PresetLibrarySummary) => void
  readonly renamePreset: (id: string, name: string) => Promise<PresetLibrarySummary>
} {
  const [entries, setEntries] = useState<readonly PresetLibrarySummary[]>()
  const [error, setError] = useState<string>()
  const [presetId, setPresetId] = useState(readRoleplayPresetPreference)
  useEffect(() => {
    if (!enabled) {
      setEntries([])
      setError(undefined)
      return
    }
    let current = true
    setEntries(undefined)
    setError(undefined)
    void listPresets().then(value => {
      if (!current) return
      setEntries(value)
      setPresetId(selectedId => {
        if (value.some(entry => entry.id === selectedId)) return selectedId
        writeRoleplayPresetPreference('')
        return ''
      })
    }, reason => {
      if (!current) return
      setEntries([])
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [enabled, listPresets])
  return {
    entries,
    ...(error === undefined ? {} : { error }),
    presetId,
    selectPreset(value) {
      writeRoleplayPresetPreference(value)
      setPresetId(value)
    },
    selectImportedPreset(entry) {
      setEntries(current => [entry, ...(current ?? []).filter(candidate => candidate.id !== entry.id)])
      writeRoleplayPresetPreference(entry.id)
      setPresetId(entry.id)
    },
    async renamePreset(id, name) {
      const entry = await renamePresetLibraryEntry(id, name)
      setEntries(current => (current ?? []).map(candidate => candidate.id === id ? entry : candidate))
      return entry
    },
  }
}

const roleplayAgentCapabilityPresetPreferenceKey = 'dsh.agent-rp.agent-capability-preset'

function readRoleplayAgentCapabilityPresetPreference(): string {
  const value = localStorage.getItem(roleplayAgentCapabilityPresetPreferenceKey)
  return isAgentRpCapabilityPresetId(value) ? value : 'agent-rp'
}

function useAgentCapabilityPresetPreference(
  listPresets: HeaderProps['listAgentCapabilityPresets'],
): {
  readonly entries: readonly AgentRpCapabilityPresetSummary[] | undefined
  readonly error?: string
  readonly presetId: string
  readonly selectPreset: (id: string) => void
} {
  const [entries, setEntries] = useState<readonly AgentRpCapabilityPresetSummary[]>()
  const [error, setError] = useState<string>()
  const [presetId, setPresetId] = useState(readRoleplayAgentCapabilityPresetPreference)
  useEffect(() => {
    let current = true
    setEntries(undefined)
    setError(undefined)
    void listPresets().then(value => {
      if (!current) return
      setEntries(value)
      setPresetId(selected => {
        const resolved = value.some(entry => entry.id === selected)
          ? selected : value.find(entry => entry.managed)?.id ?? value[0]?.id ?? 'agent-rp'
        localStorage.setItem(roleplayAgentCapabilityPresetPreferenceKey, resolved)
        return resolved
      })
    }, reason => {
      if (!current) return
      setEntries([])
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listPresets])
  return {
    entries,
    ...(error === undefined ? {} : { error }),
    presetId,
    selectPreset(id) {
      if (!isAgentRpCapabilityPresetId(id)) return
      localStorage.setItem(roleplayAgentCapabilityPresetPreferenceKey, id)
      setPresetId(id)
    },
  }
}

interface CharacterRuntimeDetail {
  readonly status: 'loading' | 'ready' | 'error'
  readonly detail?: CharacterLibraryDetail
  readonly displayRegexScripts?: readonly ImportedRegexScript[]
  readonly error?: string
}

function useCharacterDetail(libraryId: string | undefined): CharacterRuntimeDetail | undefined {
  const [loaded, setLoaded] = useState<CharacterRuntimeDetail>()
  useEffect(() => {
    let current = true
    let revision = 0
    if (libraryId === undefined) {
      setLoaded(undefined)
      return () => { current = false }
    }
    const load = (): void => {
      const requestedRevision = ++revision
      setLoaded({ status: 'loading' })
      void fetchCharacterRuntimeDetail(libraryId).then(value => {
        if (current && requestedRevision === revision) {
          setLoaded({ status: 'ready', detail: value.entry, displayRegexScripts: value.displayRegexScripts })
        }
      }, reason => {
        if (current && requestedRevision === revision) {
          setLoaded({ status: 'error', error: reason instanceof Error ? reason.message : String(reason) })
        }
      })
    }
    load()
    const changed = (event: Event): void => {
      const id = (event as CustomEvent<{ readonly id?: unknown }>).detail?.id
      if (id === libraryId) load()
    }
    window.addEventListener(characterLibraryChangedEvent, changed)
    return () => { current = false; window.removeEventListener(characterLibraryChangedEvent, changed) }
  }, [libraryId])
  return loaded
}

function backgroundAssets(detail: CharacterLibraryDetail | undefined) {
  return detail?.imageAssets.filter(asset => asset.type === 'background') ?? []
}

function selectedBackground(
  detail: CharacterLibraryDetail | undefined,
  choice: RoleplayBackgroundChoice,
) {
  if (choice === 'off') return undefined
  const backgrounds = backgroundAssets(detail)
  return choice === 'auto'
    ? backgrounds.find(asset => asset.name.trim().toLocaleLowerCase() === 'main') ?? backgrounds[0]
    : backgrounds.find(asset => asset.index === choice)
}

function compactCharacterDisplayText(value: string): string {
  const segments = splitCharacterDisplay(value)
  const text = segments.filter((segment): segment is Extract<CharacterDisplaySegment, { readonly kind: 'markdown' }> =>
    segment.kind === 'markdown').map(segment => {
    const source = marked.parse(segment.text, { async: false, breaks: true, gfm: true }) as string
    const document = new DOMParser().parseFromString(source, 'text/html')
    document.querySelectorAll('style,script,noscript,template,svg').forEach(element => { element.remove() })
    document.querySelectorAll('br').forEach(element => { element.replaceWith('\n') })
    document.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,section,article').forEach(element => {
      element.append('\n')
    })
    return document.body.textContent ?? ''
  }).join('\n')
  const summary = text.split(/\r?\n/gu).map(line => line.replace(/[\t ]+/gu, ' ').trim()).filter(Boolean).join(' · ')
  const hasFrontend = segments.some(segment => segment.kind !== 'markdown')
  if (!hasFrontend) return summary
  return summary === '' ? '包含轻前端界面，展开预览' : `${summary} · 包含轻前端界面`
}

function DisclosureChevron({ expanded, size = 15 }: { readonly expanded: boolean; readonly size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width={size} height={size} style={{
    display: 'block', flex: 'none', transform: expanded ? 'rotate(180deg)' : undefined,
    transition: 'transform 140ms ease',
  }}>
    <path d="M3.5 6 8 10.25 12.5 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
  </svg>
}

function SelectChevron() {
  return <span aria-hidden="true" style={{
    alignItems: 'center', display: 'flex', opacity: .72, pointerEvents: 'none',
    position: 'absolute', right: '12px', top: 0, bottom: 0,
  }}><DisclosureChevron expanded={false} size={14} /></span>
}

function CharacterWorldInfoSection({ detail }: { readonly detail: CharacterLibraryDetail }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState(detail.worldInfo?.entries ?? [])
  const [total, setTotal] = useState(detail.worldInfo?.entries.length ?? detail.worldInfoCount)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const loadingRef = useRef(false)
  if (detail.worldInfoCount === 0) return null
  const loadMore = (): void => {
    if (loadingRef.current || entries.length >= total) return
    loadingRef.current = true
    setLoading(true)
    setError(undefined)
    void fetchCharacterWorldInfoPage(detail.id, entries.length).then(page => {
      setEntries(current => [...current, ...page.entries])
      setTotal(page.total)
      loadingRef.current = false
      setLoading(false)
    }, reason => {
      loadingRef.current = false
      setLoading(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return <section style={{
    background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
    borderRadius: '10px', margin: '4px 0 12px', overflow: 'hidden',
  }}>
    <button type="button" aria-expanded={open} onClick={() => {
      const next = !open
      setOpen(next)
      if (next && entries.length === 0) loadMore()
    }} title="查看角色卡内置世界书" style={{
      alignItems: 'center', background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer',
      display: 'flex', font: 'inherit', gap: '9px', padding: '10px 11px', textAlign: 'left', width: '100%',
    }}>
      <strong style={{ fontSize: '12px' }}>世界书</strong>
      <span style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`, borderRadius: '999px',
        color, fontSize: '10px', padding: '2px 7px',
      }}>{detail.worldInfoCount} 条</span>
      <span style={{ fontSize: '10px', marginLeft: 'auto', opacity: .46 }}>原卡 · 只读</span>
      <DisclosureChevron expanded={open} />
    </button>
    {open && <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'grid', gap: '6px', padding: '8px' }}>
      {entries.map((entry, index) => {
        const title = entry.name?.trim() || entry.comment?.trim() || `条目 ${index + 1}`
        const activation = !entry.enabled ? '已停用' : entry.constant ? '常驻'
          : entry.keys.length === 0 ? '无关键词' : `${entry.useRegex ? '正则' : '关键词'} · ${entry.keys.length}`
        return <details key={`${entry.sourceId}-${index}`} style={{
          background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #171719) 56%, transparent)',
          border: '1px solid var(--dsw-alias-border-l2, #39393c)', borderRadius: '8px',
        }}>
          <summary style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', gap: '8px', listStyle: 'none', padding: '8px 9px' }}>
            <span title={title} style={{ flex: 1, fontSize: '11px', fontWeight: 620, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            <span style={{ fontSize: '10px', opacity: entry.enabled ? .52 : .32 }}>{activation}</span>
          </summary>
          <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', padding: '8px 9px 9px' }}>
            {!entry.constant && entry.keys.length > 0 && <div style={{ fontSize: '10px', lineHeight: 1.55, marginBottom: '6px', opacity: .5 }}>
              {entry.keys.join(' · ')}
            </div>}
            <div style={{ fontSize: '11px', lineHeight: 1.6, opacity: .7, whiteSpace: 'pre-wrap' }}>{entry.content || '无内容'}</div>
          </div>
        </details>
      })}
      {loading && <div role="status" style={{ fontSize: '11px', opacity: .52, padding: '10px', textAlign: 'center' }}>正在读取世界书…</div>}
      {error !== undefined && <div role="alert" style={{ alignItems: 'center', color: '#e88989', display: 'flex', fontSize: '11px', gap: '8px', justifyContent: 'center', padding: '8px' }}>
        <span>{error}</span>
        <button type="button" onClick={loadMore} style={miniButtonStyle}>重试</button>
      </div>}
      {!loading && error === undefined && entries.length < total && <button type="button" onClick={loadMore} style={{
        ...secondaryButtonStyle, justifySelf: 'center', margin: '4px 0 2px', minWidth: '150px',
      }}>继续显示（{entries.length}/{total}）</button>}
    </div>}
  </section>
}

function replySceneNote(value: string): string {
  return splitCharacterDisplay(value.replaceAll(statusPlaceholder, ''))
    .filter((segment): segment is Extract<CharacterDisplaySegment, { readonly kind: 'markdown' }> => segment.kind === 'markdown')
    .map(segment => segment.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 4_000)
}

function RewriteTurnDialog({ initialText, busy, error, onClose, onRewrite }: {
  readonly initialText: string
  readonly busy: boolean
  readonly error?: string
  readonly onClose: () => void
  readonly onRewrite: (text: string) => void
}) {
  const [text, setText] = useState(initialText)
  const submit = (): void => {
    if (!busy && text.trim() !== '') onRewrite(text)
  }
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="修改这轮输入" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.56)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '16px', position: 'fixed', zIndex: 1100,
  }} onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
      borderRadius: '14px', boxShadow: '0 18px 70px rgba(0,0,0,.38)', maxWidth: '620px', padding: '18px', width: '100%',
    }}>
      <h2 style={{ fontSize: '15px', margin: 0 }}>修改这轮输入</h2>
      <p style={{ fontSize: '12px', lineHeight: 1.6, margin: '7px 0 12px', opacity: .62 }}>
        会保留当前对话，并从修改后的输入创建一个新分支。
      </p>
      <textarea autoFocus aria-label="修改后的输入" disabled={busy} maxLength={8_000} value={text} onChange={event => { setText(event.target.value) }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit() }} style={{
          background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
          borderRadius: '10px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', fontSize: '13px',
          lineHeight: 1.65, minHeight: '132px', padding: '10px 12px', resize: 'vertical', width: '100%',
        }} />
      {error !== undefined && <p role="alert" style={{ color: '#dc7777', fontSize: '12px', margin: '9px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
        <button type="button" disabled={busy} onClick={onClose} style={{ ...generationButtonStyle, fontSize: '12px', minHeight: '30px' }}>取消</button>
        <button type="button" disabled={busy || text.trim() === ''} onClick={submit} style={{
          ...generationButtonStyle, background: `color-mix(in srgb, ${color} 18%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 48%, transparent)`, fontSize: '12px', minHeight: '30px', opacity: 1,
        }}>{busy ? '正在创建…' : '创建新分支'}</button>
      </div>
    </section>
  </div>
}

function GenerationTail({
  runGeneration, rewriteTurn, runImageGeneration, seq: replySeq,
  sessionId, turn, useChat, useProjection, useSession,
}: GenerationTailProps) {
  const projection = useProjection('agentRp') as AgentRpProjection | undefined
  const running = useSession(snapshot => snapshot.running)
  const replyText = useChat(snapshot => {
    const node = snapshot.legacy.nodes.find(candidate => candidate.kind === 'assistant' && candidate.seq === replySeq)
    return node?.kind === 'assistant' ? node.blocks
      .filter((block): block is Extract<typeof block, { readonly kind: 'text' }> => block.kind === 'text')
      .map(block => block.text)
      .join('\n') : ''
  })
  const editableUserText = useChat(snapshot => {
    if (turn.start === undefined || turn.end === undefined) return undefined
    const node = snapshot.legacy.nodes.find(candidate => candidate.kind === 'user'
      && candidate.seq > turn.start!.seq && candidate.seq < turn.end!.seq)
    if (node?.kind !== 'user' || node.content.length === 0 || node.content.some(block => block.type !== 'text')) return undefined
    return node.content.map(block => block.type === 'text' ? block.text : '').join('\n')
  })
  const [busy, setBusy] = useState<'regenerate' | 'continue' | 'select-previous' | 'select-next' | 'rewrite'>()
  const [error, setError] = useState<string>()
  const [drawOpen, setDrawOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const group = projection?.generations.find(candidate => candidate.anchorSeq === replySeq)
  if (projection === undefined) return null
  const sessionEventsAvailable = projection.hostCapabilities?.sessionEvents === true
  const currentReply = projection.currentReplySeq === replySeq
  const sceneNote = replySceneNote(replyText)
  const selectedIndex = group?.versions.findIndex(version => version.seq === group.selectedVersionSeq) ?? 0
  const invoke = (
    request: Parameters<GenerationTailProps['runGeneration']>[1],
    pending: Exclude<typeof busy, undefined> = request.operation === 'select' ? 'select-next' : request.operation,
  ): void => {
    setBusy(pending)
    setError(undefined)
    void runGeneration(sessionId, request).then(
      () => { setBusy(undefined) },
      (reason: unknown) => {
        setBusy(undefined)
        setError(reason instanceof Error ? reason.message : '回复操作失败')
      },
    )
  }
  const disabled = running || busy !== undefined
  const unavailableReason = running ? '回复生成期间暂不可用' : busy !== undefined ? '正在处理回复' : undefined
  const statefulRegenerationUnavailable = !sessionEventsAvailable
    && (projection.tavern !== undefined || projection.mvu !== undefined)
  const regenerateDisabled = disabled || statefulRegenerationUnavailable
  const regenerateUnavailableReason = statefulRegenerationUnavailable
    ? '当前 DSH Host 缺少安全插件事件能力，无法重新生成含状态的回复'
    : unavailableReason
  const previousUnavailable = disabled || selectedIndex <= 0
  const nextUnavailable = disabled || group === undefined || selectedIndex >= group.versions.length - 1
  return <span data-agent-rp-generation-actions>
    {currentReply && group !== undefined && group.versions.length > 1 && <span data-agent-rp-version-switcher
      aria-label={`回复版本 ${selectedIndex + 1}/${group.versions.length}`}>
      <Tooltip label={previousUnavailable ? unavailableReason ?? '已经是第一版回复' : '上一版回复'} side="bottom">
        <button type="button" data-agent-rp-generation-action aria-label={busy === 'select-previous' ? '正在切换到上一版回复' : '上一版回复'}
          aria-disabled={previousUnavailable || undefined} data-unavailable={previousUnavailable || undefined}
          onClick={previousUnavailable ? undefined : () => {
            invoke({ operation: 'select', replySeq, versionIndex: selectedIndex - 1 }, 'select-previous')
          }}>
          {busy === 'select-previous' ? <IconLoadingOutline16 className="agent-rp-generation-loading" /> : <IconChevronLeftOutline14 />}
        </button>
      </Tooltip>
      <span data-agent-rp-version-label aria-live="polite">{selectedIndex + 1}/{group.versions.length}</span>
      <Tooltip label={nextUnavailable ? unavailableReason ?? '已经是最后一版回复' : '下一版回复'} side="bottom">
        <button type="button" data-agent-rp-generation-action aria-label={busy === 'select-next' ? '正在切换到下一版回复' : '下一版回复'}
          aria-disabled={nextUnavailable || undefined} data-unavailable={nextUnavailable || undefined}
          onClick={nextUnavailable ? undefined : () => {
            invoke({ operation: 'select', replySeq, versionIndex: selectedIndex + 1 }, 'select-next')
          }}>
          {busy === 'select-next' ? <IconLoadingOutline16 className="agent-rp-generation-loading" /> : <IconChevronRightOutline14 />}
        </button>
      </Tooltip>
    </span>}
    {currentReply && <Tooltip label={regenerateDisabled ? regenerateUnavailableReason ?? '重新生成' : '重新生成'} side="bottom">
      <button type="button" data-agent-rp-generation-action aria-label={busy === 'regenerate' ? '正在重新生成' : '重新生成'}
        aria-disabled={regenerateDisabled || undefined} data-unavailable={regenerateDisabled || undefined}
        onClick={regenerateDisabled ? undefined : () => { invoke({ operation: 'regenerate', replySeq }) }}>
        {busy === 'regenerate' ? <IconLoadingOutline16 className="agent-rp-generation-loading" /> : <IconRefreshOutline16 />}
      </button>
    </Tooltip>}
    {currentReply && <Tooltip label={disabled ? unavailableReason ?? '继续生成' : '继续生成'} side="bottom">
      <button type="button" data-agent-rp-generation-action aria-label={busy === 'continue' ? '正在继续生成' : '继续生成'}
        aria-disabled={disabled || undefined} data-unavailable={disabled || undefined}
        onClick={disabled ? undefined : () => { invoke({ operation: 'continue', replySeq }) }}>
        {busy === 'continue' ? <IconLoadingOutline16 className="agent-rp-generation-loading" /> : <IconPlayOutline16 />}
      </button>
    </Tooltip>}
    {currentReply && <Tooltip label={sceneNote === '' ? '当前回复没有可绘制的场景' : disabled ? unavailableReason ?? '生成插图' : '生成插图'} side="bottom">
      <button type="button" data-agent-rp-generation-action aria-label="生成插图"
        aria-disabled={(disabled || sceneNote === '') || undefined} data-unavailable={(disabled || sceneNote === '') || undefined}
        onClick={disabled || sceneNote === '' ? undefined : () => { setDrawOpen(true) }}>
        <IconSparkle16 />
      </button>
    </Tooltip>}
    <Menu
      open={moreOpen}
      onClose={() => { setMoreOpen(false) }}
      side="top"
      align="end"
      portal
      compact
      items={[{
        id: 'rewrite',
        label: '修改输入',
        icon: <IconEditOutline16 />,
        disabled: disabled || editableUserText === undefined,
      }]}
      onSelect={(id) => {
        setMoreOpen(false)
        if (id !== 'rewrite' || disabled || editableUserText === undefined) return
        setError(undefined)
        setRewriteOpen(true)
      }}
      anchor={<Tooltip label={editableUserText === undefined ? '这一轮含附件或没有可修改的用户消息' : disabled ? unavailableReason ?? '更多操作' : '更多操作'} side="bottom">
        <button type="button" data-agent-rp-generation-action aria-label={busy === 'rewrite' ? '正在修改输入' : '更多操作'}
          aria-haspopup="menu" aria-expanded={moreOpen} aria-disabled={disabled || undefined} data-unavailable={disabled || undefined}
          onClick={disabled ? undefined : () => { setMoreOpen(open => !open) }}>
          {busy === 'rewrite' ? <IconLoadingOutline16 className="agent-rp-generation-loading" /> : <IconEllipsisOutline16 />}
        </button>
      </Tooltip>}
    />
    {error !== undefined && <Tooltip label={error} side="bottom">
      <span data-agent-rp-generation-error role="alert" aria-label={`操作失败：${error}`} tabIndex={0}><IconWarningOutline16 /></span>
    </Tooltip>}
    {currentReply && drawOpen && <ImageGenerationDialog projection={projection} initialMode="scene" initialNote={sceneNote}
      onClose={() => { setDrawOpen(false) }} onGenerate={request => { runImageGeneration(sessionId, request) }} />}
    {rewriteOpen && editableUserText !== undefined && <RewriteTurnDialog initialText={editableUserText}
      busy={busy === 'rewrite'} {...error === undefined ? {} : { error }}
      onClose={() => { if (busy !== 'rewrite') setRewriteOpen(false) }} onRewrite={text => {
        setBusy('rewrite')
        setError(undefined)
        void rewriteTurn(sessionId, turn.turn, text).then(
          () => { setBusy(undefined); setRewriteOpen(false) },
          (reason: unknown) => {
            setBusy(undefined)
            setError(reason instanceof Error ? reason.message : '无法创建改写对话')
          },
        )
      }} />}
  </span>
}

function AssistantGenerationActions({
  messageId, useChat, ...props
}: AssistantGenerationActionsProps) {
  const message = useChat(snapshot => resolveAssistantActionMessage(snapshot, messageId))
  const turn = useChat(snapshot => message === undefined
    ? undefined
    : snapshot.timeline.turns.get(message.turn))
  if (message === undefined || turn === undefined) return null
  return <GenerationTail {...props} useChat={useChat} seq={message.seq} turn={turn} />
}

const generationButtonStyle = {
  background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  borderRadius: '6px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '10px',
  lineHeight: 1, minHeight: '24px', minWidth: '24px', opacity: 0.58, padding: '4px 7px',
} as const

const headerMenuItemStyle = {
  background: 'transparent', border: 0, borderRadius: '7px', color: 'inherit', cursor: 'pointer',
  font: 'inherit', fontSize: '12px', padding: '8px 9px', textAlign: 'left', whiteSpace: 'nowrap',
} as const

function initials(name: string): string {
  return [...name.trim()].slice(0, 1).join('').toUpperCase() || 'RP'
}

function characterCapabilitySummary(projection: AgentRpProjection): string {
  const parts = [
    projection.worldInfoCount > 0 ? `${projection.worldInfoCount} 条世界书` : undefined,
    (projection.frontend?.regexScripts.length ?? 0) > 0 ? '角色卡正则' : undefined,
    (projection.frontend?.tavernHelperScriptNames.length ?? 0) > 0 ? '酒馆脚本' : undefined,
    projection.mvu === undefined ? undefined : '动态状态',
    projection.preset === undefined ? undefined : `预设 · ${projection.preset.enabledCount} 项启用`,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? '继续这段对话' : parts.join(' · ')
}

function hideWhileMounted(elements: readonly (HTMLElement | null | undefined)[]): () => void {
  const states = elements
    .filter((element): element is HTMLElement => element != null)
    .map(element => ({
      element,
      display: element.style.getPropertyValue('display'),
      priority: element.style.getPropertyPriority('display'),
    }))
  for (const { element } of states) element.style.setProperty('display', 'none', 'important')
  return () => {
    for (const { element, display, priority } of states) {
      if (display === '') element.style.removeProperty('display')
      else element.style.setProperty('display', display, priority)
    }
  }
}

function roleplaySummary(
  summary: SessionSummary | undefined,
  projection: AgentRpProjection | undefined,
): AgentRpProjection | undefined {
  if (summary === undefined || !isAgentRpCapabilityPresetId(sessionAgentPreset(summary))) return undefined
  if (projection !== undefined) {
    // Client HMR can briefly pair a newer UI with the previous Host projection.
    // Keep that rolling upgrade usable until the Host process is restarted.
    const nativeStates = (projection as Partial<AgentRpProjection>).nativeStates
    const turnMode = (projection as Partial<AgentRpProjection>).turnMode
    const regexPacks = (projection as Partial<AgentRpProjection>).regexPacks
    return Array.isArray(nativeStates) && Array.isArray(regexPacks)
      && (turnMode === 'conversation' || turnMode === 'agent')
      ? projection
      : {
          ...projection,
          nativeStates: Array.isArray(nativeStates) ? nativeStates : [],
          regexPacks: Array.isArray(regexPacks) ? regexPacks : [],
          turnMode: turnMode === 'agent' ? 'agent' : 'conversation',
        }
  }
  return {
    turnMode: 'conversation',
    characterName: summary.displayTitle,
    description: '',
    personality: '',
    scenario: '',
    importedMessageCount: 0,
    nativeStates: [],
    worldInfoCount: 0,
    worldInfo: {
      revision: 0,
      activeCount: 0,
      approximateTokens: 0,
      budgetExcludedCount: 0,
      failureCounts: {
        regexRuntimeUnavailable: 0,
        regexInvalid: 0,
        regexExecutionLimit: 0,
        regexResourceLimit: 0,
        decoratorUnsupported: 0,
        templateUnsupported: 0,
        templateError: 0,
      },
      books: [],
    },
    regexPacks: [],
    presetLibrary: [],
    generations: [],
    source: 'preset' as const,
  }
}

function sessionAgentPreset(summary: SessionSummary | undefined): string | undefined {
  const value = summary?.projectionValues?.agentPreset
  return typeof value === 'string' ? value : undefined
}

function roleplayDisplayName(summary: SessionSummary | undefined, projection: AgentRpProjection): string {
  return summary?.title?.trim() || projection.characterName
}

function Avatar({ projection, loadAvatar, imageUrl, libraryAvatarAvailable, size = 40 }: {
  readonly projection: AgentRpProjection
  readonly loadAvatar: HeaderProps['loadAvatar']
  readonly imageUrl?: string
  readonly libraryAvatarAvailable?: boolean
  readonly size?: number
}) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let current = true
    let objectUrl: string | undefined
    const source = resolveRoleplayAvatarSource({
      ...(imageUrl === undefined ? {} : { imageUrl }),
      ...(projection.avatarAttachmentId === undefined ? {} : { attachmentId: projection.avatarAttachmentId }),
      ...(projection.avatarLibraryId === undefined ? {} : { libraryId: projection.avatarLibraryId }),
      ...(libraryAvatarAvailable === undefined ? {} : { libraryAvatarAvailable }),
    })
    if (source.kind === 'direct') {
      setSrc(source.url)
      return () => { current = false }
    }
    if (source.kind === 'fallback') {
      setSrc(undefined)
      return () => { current = false }
    }
    const loading = source.kind === 'attachment'
      ? loadAvatar(source.id)
      : Promise.resolve(`${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(source.id)}/avatar`)
    void loading.then((url: string | undefined) => {
      if (!current) {
        if (url !== undefined) URL.revokeObjectURL(url)
        return
      }
      objectUrl = source.kind === 'attachment' ? url : undefined
      setSrc(url)
    })
    return () => {
      current = false
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [imageUrl, libraryAvatarAvailable, loadAvatar, projection.avatarAttachmentId, projection.avatarLibraryId])
  return <span style={{
    alignItems: 'center',
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    borderRadius: '50%',
    color,
    display: 'inline-flex',
    flex: `0 0 ${size}px`,
    fontSize: `${Math.max(13, Math.round(size * 0.36))}px`,
    fontWeight: 650,
    height: `${size}px`,
    justifyContent: 'center',
    overflow: 'hidden',
    width: `${size}px`,
  }}>
    {src === undefined
      ? initials(projection.characterName)
      : <img src={src} alt="" style={{ height: '100%', objectFit: 'cover', width: '100%' }} />}
  </span>
}

function DetailSection({ title, text }: { readonly title: string; readonly text: string }) {
  if (text.trim() === '') return null
  return <section style={{ marginTop: '18px' }}>
    <h3 style={{ fontSize: '12px', fontWeight: 600, margin: '0 0 7px', opacity: 0.56 }}>{title}</h3>
    <p style={{ fontSize: '13px', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
  </section>
}

function CharacterRemoteResourcesSection({ detail, onChange }: {
  readonly detail: CharacterLibraryDetail
  readonly onChange?: (detail: CharacterLibraryDetail) => void
}) {
  const [workingResource, setWorkingResource] = useState<string>()
  const [error, setError] = useState<string>()
  return <section style={{
    background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
    borderRadius: '10px', margin: '12px 0', overflow: 'hidden',
  }}>
    <div style={{ padding: '10px 11px 8px' }}>
      <strong style={{ display: 'block', fontSize: '12px' }}>外部资源</strong>
      <span style={{ display: 'block', fontSize: '10px', lineHeight: 1.5, marginTop: '3px', opacity: .5 }}>
        卡片进入会话后会按需申请脚本、样式、字体、图片、内嵌页面或数据连接；每类权限可以单独停止
      </span>
    </div>
    <div style={{
      alignItems: 'center', borderTop: '1px solid var(--dsw-alias-border-l2, #34343a)',
      display: 'flex', gap: '9px', padding: '9px 11px',
    }}>
      <span style={{ flex: '1 1 auto', fontSize: '11px', lineHeight: 1.45, minWidth: 0 }}>
        <strong style={{ display: 'block' }}>{detail.remoteResourcePolicy === 'isolated-https' ? '信任此卡界面' : '按需确认'}</strong>
        <span style={{ opacity: .48 }}>{detail.remoteResourcePolicy === 'isolated-https'
          ? '自动允许隔离界面加载 HTTPS 资源；登录与外部 API 仍需确认'
          : '只加载逐项确认过的来源和资源类型'}</span>
      </span>
      <button type="button" data-agent-rp-action="toggle-card-resource-policy"
        disabled={workingResource !== undefined} onClick={() => {
        const policy = detail.remoteResourcePolicy === 'isolated-https' ? 'prompt' : 'isolated-https'
        setWorkingResource('policy')
        setError(undefined)
        void updateCharacterRemoteResourcePolicy(detail.id, policy).then(value => {
          setWorkingResource(undefined)
          onChange?.(value)
          notifyCharacterLibraryChanged(detail.id)
        }, reason => {
          setWorkingResource(undefined)
          setError(reason instanceof Error ? reason.message : String(reason))
        })
      }} style={{ ...miniButtonStyle, flex: 'none', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        {workingResource === 'policy' ? '处理中…' : detail.remoteResourcePolicy === 'isolated-https' ? '恢复按需' : '信任界面'}
      </button>
    </div>
    {detail.remoteResourceOrigins.map(origin => {
      const approved = detail.approvedRemoteResources.filter(resource => resource.origin === origin)
      return <div key={origin} style={{
        borderTop: '1px solid var(--dsw-alias-border-l2, #34343a)', padding: '8px 11px',
      }}>
        <span title={origin} style={{ display: 'block', fontSize: '11px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {new URL(origin).hostname}
        </span>
        {approved.length === 0
          ? <span style={{ display: 'block', fontSize: '10px', marginTop: '4px', opacity: .46 }}>尚未授权；界面实际请求时再确认</span>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              {approved.map(resource => {
                const key = cardRemoteResourceApprovalKey(resource)
                return <button key={key} type="button" disabled={workingResource !== undefined} onClick={() => {
                  setWorkingResource(key)
                  setError(undefined)
                  void updateCharacterRemoteResource(detail.id, origin, resource.type, false).then(value => {
                    setWorkingResource(undefined)
                    onChange?.(value)
                    notifyCharacterLibraryChanged(detail.id)
                  }, reason => {
                    setWorkingResource(undefined)
                    setError(reason instanceof Error ? reason.message : String(reason))
                  })
                }} style={miniButtonStyle}>
                  {workingResource === key ? '处理中…' : `停止${cardResourceTypeLabel[resource.type]}`}
                </button>
              })}
            </div>}
      </div>
    })}
    {error !== undefined && <div role="alert" style={{ color: '#e88989', fontSize: '11px', padding: '0 11px 9px' }}>{error}</div>}
  </section>
}

function CharacterAssetsSection({ detail, sessionId }: {
  readonly detail: CharacterLibraryDetail
  readonly sessionId?: SessionId
}) {
  const backgroundChoice = useRoleplayBackground(sessionId)
  const expressionChoice = useRoleplayExpression(sessionId)
  const backgrounds = backgroundAssets(detail)
  const expressions = detail.imageAssets.filter(asset => asset.type === 'emotion' || asset.type === 'expression')
  if (backgrounds.length + expressions.length === 0) return null
  return <section style={{ marginTop: '20px' }}>
    <h3 style={{ fontSize: '12px', fontWeight: 620, margin: '0 0 9px', opacity: .58 }}>卡片资源</h3>
    {backgrounds.length > 0 && <>
      <div style={{ alignItems: 'center', display: 'flex', fontSize: '12px', marginBottom: '8px' }}>
        <span style={{ opacity: .64 }}>背景</span>
        {sessionId !== undefined && <select aria-label="选择会话背景" value={String(backgroundChoice)} onChange={event => {
          const value = event.target.value
          setRoleplayBackground(sessionId, value === 'auto' || value === 'off' ? value : Number(value))
        }} style={{
          background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
          borderRadius: '7px', color: 'inherit', font: 'inherit', fontSize: '11px', marginLeft: 'auto', padding: '5px 7px',
        }}>
          <option value="auto">跟随角色卡</option>
          <option value="off">不使用背景</option>
          {backgrounds.map(asset => <option key={asset.index} value={asset.index}>{asset.name || `背景 ${asset.index + 1}`}</option>)}
        </select>}
      </div>
      <div style={{ display: 'grid', gap: '7px', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))' }}>
        {backgrounds.map(asset => <figure key={asset.index} style={{ margin: 0, minWidth: 0 }}>
          <img src={characterLibraryImageUrl(detail.id, asset.index)} alt={asset.name || '角色背景'} loading="lazy" style={{
            aspectRatio: '16 / 9', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '8px',
            display: 'block', objectFit: 'cover', width: '100%',
          }} />
          <figcaption style={{ fontSize: '10px', marginTop: '4px', opacity: .48, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.name || `背景 ${asset.index + 1}`}
          </figcaption>
        </figure>)}
      </div>
    </>}
    {expressions.length > 0 && <>
      <div style={{ alignItems: 'center', display: 'flex', fontSize: '12px', margin: backgrounds.length === 0 ? '0 0 8px' : '16px 0 8px' }}>
        <span style={{ opacity: .64 }}>表情资源</span>
        {sessionId !== undefined && <button type="button" onClick={() => { setRoleplayExpression(sessionId, 'default') }} style={{
          background: expressionChoice === 'default' ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
          border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '7px', color: 'inherit',
          cursor: 'pointer', font: 'inherit', fontSize: '10px', marginLeft: 'auto', padding: '4px 7px',
        }}>默认头像</button>}
      </div>
      <div style={{ display: 'grid', gap: '7px', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }}>
        {expressions.map(asset => <button key={asset.index} type="button" aria-label={`使用表情 ${asset.name || asset.index + 1}`}
          aria-pressed={sessionId !== undefined && expressionChoice === asset.index}
          disabled={sessionId === undefined} onClick={() => { if (sessionId !== undefined) setRoleplayExpression(sessionId, asset.index) }} style={{
            background: sessionId !== undefined && expressionChoice === asset.index
              ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
            border: sessionId !== undefined && expressionChoice === asset.index
              ? `1px solid color-mix(in srgb, ${color} 48%, transparent)` : '1px solid transparent',
            borderRadius: '9px', color: 'inherit', cursor: sessionId === undefined ? 'default' : 'pointer',
            font: 'inherit', margin: 0, minWidth: 0, padding: '3px',
          }}>
          <img src={characterLibraryImageUrl(detail.id, asset.index)} alt={asset.name || '角色表情'} loading="lazy" style={{
            aspectRatio: '1', background: 'color-mix(in srgb, currentColor 5%, transparent)',
            border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '8px', display: 'block', objectFit: 'contain', width: '100%',
          }} />
          <figcaption style={{ fontSize: '10px', marginTop: '4px', opacity: .48, overflow: 'hidden', textAlign: 'center', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.name || `表情 ${asset.index + 1}`}
          </figcaption>
        </button>)}
      </div>
    </>}
  </section>
}

interface PendingDisplayExtension {
  readonly file: File
  readonly scriptName: string
  readonly imageOrigins: readonly string[]
}

type IndexedCharacterRegexSummary = CharacterRegexScriptSummary & { readonly index: number }

function regexPlacementLabel(value: number): string {
  switch (value) {
    case 0: return '旧式 Markdown'
    case USER_INPUT_PLACEMENT: return '用户消息'
    case AI_OUTPUT_PLACEMENT: return '角色回复'
    case 3: return '斜杠命令'
    case 4: return '旧式发送'
    case 5: return '世界书'
    case 6: return '推理内容'
    default: return `位置 ${value}`
  }
}

function regexStateLabel(script: CharacterRegexScriptSummary): string {
  switch (script.state) {
    case 'active': return '可运行'
    case 'partial': return '部分兼容'
    case 'disabled': return '卡内已停用'
    case 'unsupported': return '当前位置未接管'
    case 'invalid': return '表达式无效'
  }
}

function CharacterRegexScriptsSection({ scripts, promptRegex, editable }: {
  readonly scripts: readonly IndexedCharacterRegexSummary[]
  readonly promptRegex?: AgentRpProjection['promptRegex']
  readonly editable?: {
    readonly detail: CharacterLibraryDetail
    readonly onChange: (detail: CharacterLibraryDetail) => void
    readonly onError: (message: string) => void
  }
}) {
  const [open, setOpen] = useState(false)
  const [updatingIndex, setUpdatingIndex] = useState<number>()
  const enabled = scripts.filter(script => script.enabled).length
  const warnings = scripts.filter(script => script.state === 'partial'
    || script.state === 'unsupported' || script.state === 'invalid').length
  const traceByIndex = new Map(promptRegex?.scripts
    .filter(script => script.source === 'character').map(script => [script.index, script]))
  return <details open={open} onToggle={event => { setOpen(event.currentTarget.open) }} style={{
    background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
    borderRadius: '10px', margin: '4px 0 12px', overflow: 'hidden',
  }}>
    <summary style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', gap: '9px', listStyle: 'none', padding: '10px 11px' }}>
      <span style={{ fontSize: '12px', fontWeight: 650 }}>角色卡正则</span>
      <span style={{ fontSize: '10px', opacity: .5 }}>{scripts.length === 0 ? '无内置脚本' : `${enabled}/${scripts.length} 条启用`}</span>
      {warnings > 0 && <span style={{ color: '#d9a85f', fontSize: '10px', marginLeft: 'auto' }}>{warnings} 条需留意</span>}
      <DisclosureChevron expanded={open} />
    </summary>
    <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', padding: '4px 11px 10px' }}>
      {scripts.length === 0 && <div style={{ fontSize: '11px', lineHeight: 1.55, opacity: .5, paddingTop: '7px' }}>
        这张角色卡没有自带正则脚本
      </div>}
      {scripts.map(script => {
        const libraryScript = script as Partial<CharacterLibraryRegexScript>
        const trace = traceByIndex.get(script.index)
        const target = script.display && script.prompt ? '显示与生成'
          : script.display ? '界面显示' : script.prompt ? '生成提示' : '无目标'
        const traceLabel = trace === undefined ? undefined : trace.outcome === 'applied'
          ? `上次命中 ${trace.affectedMessages} 条消息`
          : trace.outcome === 'no-match' ? '上次未命中'
            : trace.outcome === 'display-only' ? '仅用于显示'
              : trace.outcome === 'placement' ? '上次消息位置不匹配'
                : trace.outcome === 'depth' ? '上次深度不匹配'
                  : trace.outcome === 'disabled' ? '上次未启用' : '表达式无效'
        return <div key={script.index} style={{
          borderTop: script.index === 0 ? 0 : '1px solid var(--dsw-alias-border-l2, #34343a)', padding: '8px 0 7px',
        }}>
          <div style={{ alignItems: 'baseline', display: 'flex', gap: '8px' }}>
            <span title={script.scriptName} style={{ fontSize: '11px', fontWeight: 620, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {script.scriptName || `未命名脚本 ${script.index + 1}`}
            </span>
            {editable !== undefined && <button type="button" role="switch" aria-checked={script.enabled}
              aria-label={`${script.enabled ? '停用' : '启用'}正则 ${script.scriptName || script.index + 1}`}
              disabled={updatingIndex !== undefined}
              onClick={() => {
                setUpdatingIndex(script.index)
                editable.onError('')
                void updateCharacterEdits(editable.detail.id, {
                  format: 0,
                  operation: 'set-regex-enabled',
                  revision: editable.detail.localRevision,
                  index: script.index,
                  enabled: !script.enabled,
                }).then(entry => {
                  setUpdatingIndex(undefined)
                  editable.onChange(entry)
                  notifyCharacterLibraryChanged(entry.id)
                }, reason => {
                  setUpdatingIndex(undefined)
                  editable.onError(reason instanceof Error ? reason.message : String(reason))
                })
              }} style={{
                alignItems: 'center', background: script.enabled ? 'color-mix(in srgb, var(--dsw-alias-accent, #5b8def) 72%, transparent)' : 'var(--dsw-alias-bg-base, #171719)',
                border: '1px solid var(--dsw-alias-border-l2, #4a4a50)', borderRadius: '999px', cursor: updatingIndex === undefined ? 'pointer' : 'wait',
                display: 'inline-flex', flex: '0 0 auto', height: '20px', marginLeft: 'auto', padding: '2px', width: '34px',
              }}>
              <span aria-hidden="true" style={{
                background: '#fff', borderRadius: '50%', height: '14px', transform: script.enabled ? 'translateX(14px)' : 'translateX(0)',
                transition: 'transform 150ms ease', width: '14px',
              }} />
            </button>}
            <span style={{
              color: script.state === 'active' || script.state === 'disabled' ? 'inherit' : '#d9a85f',
              flex: 'none', fontSize: '10px', marginLeft: editable === undefined ? 'auto' : 0, opacity: script.state === 'active' ? .58 : .82,
            }}>{updatingIndex === script.index ? '保存中…' : regexStateLabel(script)}</span>
          </div>
          <div style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '3px', opacity: .46 }}>
            {[target, script.placement.map(regexPlacementLabel).join('、') || '未设置消息位置',
              script.minDepth === null && script.maxDepth === null ? undefined
                : `深度 ${script.minDepth ?? '不限'}–${script.maxDepth ?? '不限'}`,
              script.runOnEdit ? '编辑时也运行' : undefined].filter(Boolean).join(' · ')}
          </div>
          {traceLabel !== undefined && <div style={{ fontSize: '10px', marginTop: '3px', opacity: .58 }}>{traceLabel}</div>}
          {libraryScript.replacedByDisplayExtension === true && <div style={{ fontSize: '10px', marginTop: '3px', opacity: .52 }}>
            当前由本机显示扩展替代；关闭显示扩展后会继续采用这个开关
          </div>}
          {libraryScript.locallyOverridden === true && <div style={{ fontSize: '10px', marginTop: '3px', opacity: .52 }}>
            本机开关与原卡不同，可在「角色设定」中一并恢复
          </div>}
        </div>
      })}
    </div>
  </details>
}

function inspectDisplayExtension(file: File): Promise<PendingDisplayExtension> {
  if (file.size === 0 || file.size > 256 * 1024) return Promise.reject(new Error('显示扩展文件为空或过大'))
  return file.text().then(source => {
    let value: unknown
    try {
      value = JSON.parse(source.replace(/^\uFEFF/u, ''))
    } catch (error) {
      throw new Error('显示扩展不是有效 JSON', { cause: error })
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('显示扩展必须是一个正则对象')
    const record = value as Record<string, unknown>
    if (typeof record.scriptName !== 'string' || record.scriptName.trim() === ''
      || typeof record.replaceString !== 'string' || record.markdownOnly !== true || record.promptOnly === true
      || !Array.isArray(record.placement) || !record.placement.includes(AI_OUTPUT_PLACEMENT)) {
      throw new Error('这里只接受作用于 AI 消息的纯显示正则')
    }
    const origins = new Set<string>()
    const pattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu
    for (const match of record.replaceString.matchAll(pattern)) {
      const sourceUrl = match[1] ?? match[2] ?? match[3]
      if (sourceUrl === undefined || !/^https:\/\//iu.test(sourceUrl)) continue
      origins.add(new URL(sourceUrl).origin)
    }
    return { file, scriptName: record.scriptName.trim(), imageOrigins: [...origins].sort() }
  })
}

async function updateCharacterDisplayExtension(
  characterId: string,
  extensionId: string,
  operation: 'enable' | 'disable' | 'remove',
): Promise<CharacterLibraryDetail> {
  const response = await fetch(`${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(characterId)}/display-extensions/${encodeURIComponent(extensionId)}/${operation}`, {
    method: 'POST', headers: { accept: 'application/json' },
  })
  const value = await response.json() as { readonly error?: string; readonly entry?: CharacterLibraryDetail }
  if (!response.ok || value.entry === undefined) throw new Error(value.error ?? `显示扩展更新失败（${response.status}）`)
  return value.entry
}

async function uploadCharacterDisplayExtension(
  characterId: string,
  pending: PendingDisplayExtension,
): Promise<CharacterLibraryDetail> {
  const query = new URLSearchParams({
    filename: pending.file.name,
    approvedOrigins: JSON.stringify(pending.imageOrigins),
  })
  const response = await fetch(`${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(characterId)}/display-extensions/import?${query}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': pending.file.type || 'application/json' },
    body: pending.file,
  })
  const value = await response.json() as { readonly error?: string; readonly entry?: CharacterLibraryDetail }
  if (!response.ok || value.entry === undefined) throw new Error(value.error ?? `显示扩展导入失败（${response.status}）`)
  return value.entry
}

function CharacterDisplayExtensionsSection({ detail, onChange, onNotice, onError }: {
  readonly detail: CharacterLibraryDetail
  readonly onChange: (detail: CharacterLibraryDetail) => void
  readonly onNotice: (message: string) => void
  readonly onError: (message: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<PendingDisplayExtension>()
  const [working, setWorking] = useState(false)
  useEffect(() => { setPending(undefined); setWorking(false) }, [detail.id])
  const install = (value: PendingDisplayExtension): void => {
    setWorking(true)
    void uploadCharacterDisplayExtension(detail.id, value).then(entry => {
      onChange(entry)
      notifyCharacterLibraryChanged(entry.id)
      onNotice(`已启用显示扩展「${value.scriptName}」`)
      setPending(undefined)
      setWorking(false)
    }, reason => {
      setWorking(false)
      onError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const select = (file: File): void => {
    onError('')
    void inspectDisplayExtension(file).then(value => {
      if (value.imageOrigins.length === 0) install(value)
      else setPending(value)
    }, reason => { onError(reason instanceof Error ? reason.message : String(reason)) })
  }
  const mutate = (extensionId: string, operation: 'enable' | 'disable' | 'remove'): void => {
    setWorking(true)
    void updateCharacterDisplayExtension(detail.id, extensionId, operation).then(entry => {
      onChange(entry)
      notifyCharacterLibraryChanged(entry.id)
      onNotice(operation === 'remove' ? '已移除显示扩展' : operation === 'enable' ? '已启用显示扩展' : '已停用显示扩展')
      setWorking(false)
    }, reason => {
      setWorking(false)
      onError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return <section style={{
    background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
    borderRadius: '10px', margin: '4px 0 14px', padding: '10px 11px',
  }}>
    <div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: '12px' }}>附加显示正则</strong>
        <span style={{ display: 'block', fontSize: '10px', marginTop: '2px', opacity: .5 }}>卡外单独导入，只改变界面显示</span>
      </div>
      <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file !== undefined) select(file)
      }} />
      <button type="button" disabled={working} onClick={() => { inputRef.current?.click() }} style={{
        background: 'transparent', border: `1px solid color-mix(in srgb, ${color} 42%, transparent)`, borderRadius: '7px',
        color, cursor: working ? 'wait' : 'pointer', font: 'inherit', fontSize: '11px', marginLeft: 'auto', padding: '5px 8px', whiteSpace: 'nowrap',
      }}>＋ 添加</button>
    </div>
    {detail.displayExtensions.length === 0 && pending === undefined && <div style={{ fontSize: '11px', lineHeight: 1.55, marginTop: '8px', opacity: .52 }}>
      暂无附加显示规则
    </div>}
    {detail.displayExtensions.map(extension => <div key={extension.id} style={{
      alignItems: 'center', borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '8px', marginTop: '9px', paddingTop: '9px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {extension.scriptName}{extension.enabled ? '' : ' · 已停用'}
        </div>
        <div style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '2px', opacity: .5 }}>
          {extension.remoteImageOrigins.length === 0 ? '本地显示'
            : `外部图片 · ${extension.remoteImageOrigins.map(origin => new URL(origin).hostname).join('、')}`}
          {extension.replacedCardRegexNames.length === 0 ? '' : ` · 已修复旧规则 ${extension.replacedCardRegexNames.join('、')}`}
        </div>
      </div>
      <button type="button" disabled={working} onClick={() => { mutate(extension.id, extension.enabled ? 'disable' : 'enable') }} style={{
        background: 'transparent', border: 0, color, cursor: working ? 'wait' : 'pointer', font: 'inherit', fontSize: '10px', padding: '3px',
      }}>{extension.enabled ? '停用' : '启用'}</button>
      <button type="button" disabled={working} onClick={() => { mutate(extension.id, 'remove') }} style={{
        background: 'transparent', border: 0, color: 'inherit', cursor: working ? 'wait' : 'pointer', font: 'inherit', fontSize: '10px', opacity: .5, padding: '3px',
      }}>移除</button>
    </div>)}
    {pending !== undefined && <div style={{
      background: 'color-mix(in srgb, #d6a24d 9%, transparent)', border: '1px solid color-mix(in srgb, #d6a24d 35%, transparent)',
      borderRadius: '8px', fontSize: '11px', lineHeight: 1.55, marginTop: '9px', padding: '9px 10px',
    }}>
      <strong style={{ display: 'block' }}>{pending.scriptName} 需要加载外部图片</strong>
      <span style={{ display: 'block', marginTop: '2px', opacity: .68 }}>
        {pending.imageOrigins.map(origin => new URL(origin).hostname).join('、')} 会在显示图片时看到你的网络地址。授权只属于这张角色卡。
      </span>
      <div style={{ display: 'flex', gap: '10px', marginTop: '7px' }}>
        <button type="button" disabled={working} onClick={() => { install(pending) }} style={{
          background: color, border: 0, borderRadius: '7px', color: '#fff', cursor: working ? 'wait' : 'pointer', font: 'inherit', fontSize: '11px', padding: '5px 9px',
        }}>{working ? '正在添加…' : '允许并添加'}</button>
        <button type="button" disabled={working} onClick={() => { setPending(undefined) }} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', opacity: .6, padding: '5px 2px',
        }}>取消</button>
      </div>
    </div>}
  </section>
}

function CharacterLibraryAvatar({ entry, size = 38 }: {
  readonly entry: CharacterLibrarySummary
  readonly size?: number
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [entry.id])
  const image = entry.avatarAvailable && !failed
  return <span aria-hidden="true" style={{
    alignItems: 'center', background: `color-mix(in srgb, ${color} 13%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, borderRadius: `${Math.max(9, Math.round(size * .24))}px`,
    color, display: 'inline-flex', flex: `0 0 ${size}px`, fontSize: `${Math.max(12, Math.round(size * .32))}px`,
    fontWeight: 650, height: `${size}px`, justifyContent: 'center', overflow: 'hidden', width: `${size}px`,
  }}>
    {image
      ? <img src={`${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(entry.id)}/avatar`} alt="" loading="lazy"
          onError={() => { setFailed(true) }} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
      : initials(entry.displayName)}
  </span>
}

const characterLibraryNarrowQuery = '(max-width: 720px)'

const agentRpResponsiveStyle = `
.agent-rp-mobile-only { display: none !important; }
.agent-rp-character-library-back { display: none; }
[data-agent-rp-action='open-workbench'] {
  transition:
    background-color var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease),
    transform var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease);
}
[data-agent-rp-action='open-workbench']:active { transform: scale(.94); }
[data-agent-rp-destination-icon] {
  transition: transform var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease);
}
[data-agent-rp-action='open-workbench'][aria-expanded='true'] [data-agent-rp-destination-icon] {
  transform: scale(1.08);
}
[data-agent-rp-generation-actions] {
  align-items: center;
  display: inline-flex;
  gap: 2px;
  min-width: 0;
}
[data-agent-rp-generation-action],
[data-agent-rp-generation-error] {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 28px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  flex: 0 0 auto;
  height: 28px;
  justify-content: center;
  padding: 6px;
  width: 28px;
}
[data-agent-rp-generation-action] { cursor: pointer; }
[data-agent-rp-generation-action]:hover,
[data-agent-rp-generation-action]:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
[data-agent-rp-generation-action][data-unavailable] {
  cursor: default;
  opacity: .4;
}
[data-agent-rp-generation-action][data-unavailable]:hover {
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
}
[data-agent-rp-generation-action] svg { flex: 0 0 auto; }
[data-conversation-scroll][data-agent-rp-session][data-agent-rp-view='immersive']
  [data-variant='think'] {
  display: none !important;
}
[data-conversation-scroll][data-agent-rp-session][data-agent-rp-assistant-contrast='dark']
  [data-chat-flow-kind='assistant-step'] {
  --dsw-alias-label-primary: #17181d;
  --dsw-alias-label-primary-dimmed: rgba(23, 24, 29, .84);
  --dsw-alias-label-secondary: rgba(23, 24, 29, .74);
  --dsw-alias-label-tertiary: rgba(23, 24, 29, .58);
  --dsw-alias-label-caption: rgba(23, 24, 29, .48);
}
[data-conversation-scroll][data-agent-rp-session][data-agent-rp-assistant-contrast='light']
  [data-chat-flow-kind='assistant-step'],
[data-conversation-scroll][data-agent-rp-session][data-agent-rp-assistant-contrast='light-scrim']
  [data-chat-flow-kind='assistant-step'] {
  --dsw-alias-label-primary: #f9fafb;
  --dsw-alias-label-primary-dimmed: rgba(249, 250, 251, .86);
  --dsw-alias-label-secondary: rgba(249, 250, 251, .76);
  --dsw-alias-label-tertiary: rgba(249, 250, 251, .60);
  --dsw-alias-label-caption: rgba(249, 250, 251, .50);
}
[data-conversation-scroll][data-agent-rp-session][data-agent-rp-assistant-contrast='light-scrim']
  [data-chat-flow-kind='assistant-step'] {
  background: rgba(12, 14, 20, .68);
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 12px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, .18);
  padding: 10px 12px;
}
[data-agent-rp-generation-action] .agent-rp-generation-loading {
  animation: agent-rp-action-spin 900ms linear infinite;
}
[data-agent-rp-version-switcher] {
  align-items: center;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0;
}
[data-agent-rp-version-label] {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  opacity: .72;
  text-align: center;
}
[data-agent-rp-generation-error] {
  color: var(--dsw-alias-state-danger, #dc7777);
  outline: none;
}
@keyframes agent-rp-action-spin { to { transform: rotate(360deg); } }
[data-agent-rp-workbench-dismiss] {
  animation: agent-rp-workbench-mask-in var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease) both;
}
[data-agent-rp-workbench] {
  animation: agent-rp-workbench-panel-in var(--ds-transition-duration-slow, 180ms) var(--ds-ease-in-out, ease) both;
}
@keyframes agent-rp-workbench-mask-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes agent-rp-workbench-panel-in {
  from { opacity: .68; transform: translateX(-14px); }
  to { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-agent-rp-action='open-workbench'],
  [data-agent-rp-destination-icon] { transition: none; }
  [data-agent-rp-workbench-dismiss],
  [data-agent-rp-workbench] { animation: none; }
  [data-agent-rp-generation-action] svg { animation: none !important; }
}
@media (max-width: 720px) {
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) {
    flex-direction: column !important;
    height: calc(100dvh - 16px) !important;
    max-height: calc(100dvh - 16px) !important;
    max-width: calc(100vw - 16px) !important;
    width: calc(100vw - 16px) !important;
  }
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) > nav {
    box-sizing: border-box;
    flex: 0 0 auto !important;
    height: auto !important;
    padding: 12px 12px 0 !important;
    width: 100% !important;
  }
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) > nav > :first-child { display: none !important; }
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) > nav > :last-child {
    align-items: center;
    display: flex !important;
    flex-direction: row !important;
    gap: 4px;
    overflow-x: auto !important;
    padding-bottom: 9px;
    scrollbar-width: none;
    width: 100% !important;
  }
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) > nav > :last-child::-webkit-scrollbar { display: none; }
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) > nav > :last-child > button {
    flex: 0 0 auto !important;
    min-height: 38px;
    white-space: nowrap;
    width: auto !important;
  }
  [role='dialog'][aria-modal='true'][aria-labelledby]:has(> nav > :first-child[id]) > :not(nav) {
    flex: 1 1 auto !important;
    min-height: 0;
    width: 100% !important;
  }
  .agent-rp-header {
    flex: 1 1 auto !important;
    gap: 6px !important;
    margin-right: 0 !important;
    width: 100%;
  }
  .agent-rp-header-meta { flex: 1 1 auto; }
  .agent-rp-header-kind,
  .agent-rp-header-capabilities,
  .agent-rp-header-primary-action { display: none !important; }
  .agent-rp-header-settings { flex: 0 0 auto; margin-left: auto; }
  .agent-rp-mobile-only { display: block !important; }
  .agent-rp-session-menu {
    bottom: max(8px, env(safe-area-inset-bottom)) !important;
    left: 8px !important;
    max-height: min(70dvh, 560px) !important;
    overflow-y: auto !important;
    right: 8px !important;
    top: auto !important;
    width: auto !important;
  }
  [data-agent-rp-workbench-layer] { z-index: 1180 !important; }
  [data-agent-rp-workbench] {
    padding-bottom: env(safe-area-inset-bottom) !important;
    padding-top: env(safe-area-inset-top) !important;
  }
  [data-agent-rp-status] {
    box-sizing: border-box;
    flex-wrap: nowrap !important;
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding: 2px 4px;
    scrollbar-width: none;
  }
  [data-agent-rp-status]::-webkit-scrollbar { display: none; }
  [data-agent-rp-status] > * { flex: 0 0 auto; }
  [data-agent-rp-status-line] {
    max-width: min(68vw, 320px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-agent-rp-startup] { margin-inline: 4px; }
  [data-agent-rp-dialog] {
    align-items: flex-end !important;
    padding: max(8px, env(safe-area-inset-top)) 0 0 !important;
  }
  [data-agent-rp-dialog] > section {
    border-bottom: 0 !important;
    border-radius: 16px 16px 0 0 !important;
    box-sizing: border-box !important;
    max-height: calc(100dvh - max(8px, env(safe-area-inset-top))) !important;
    max-width: 100vw !important;
    padding-bottom: max(16px, env(safe-area-inset-bottom)) !important;
    width: 100vw !important;
  }
  .agent-rp-character-library-dialog {
    border-radius: 0 !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
  }
  .agent-rp-character-library-back {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    height: 36px;
    justify-content: center;
    margin-left: -6px;
    padding: 0;
    width: 36px;
  }
  .agent-rp-character-library-back:hover,
  .agent-rp-character-library-back:focus-visible {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .agent-rp-character-library-detail-close { display: none !important; }
  .agent-rp-character-library-footer {
    padding: 12px 14px max(12px, env(safe-area-inset-bottom)) !important;
  }
  .agent-rp-character-library-cancel { display: none !important; }
  .agent-rp-character-library-start {
    min-height: 44px;
    width: 100%;
  }
  .agent-rp-character-library-toast {
    bottom: calc(68px + env(safe-area-inset-bottom)) !important;
    left: 14px !important;
    right: 14px !important;
  }
  .agent-rp-character-info {
    border-left: 0 !important;
    box-sizing: border-box !important;
    height: 100dvh;
    max-width: 100vw !important;
    padding: max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom)) !important;
    width: 100vw !important;
  }
  .agent-rp-tavern-script-dialog {
    border-radius: 0 !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
  }
}
`

function subscribeCharacterLibraryWidth(listener: () => void): () => void {
  const media = window.matchMedia(characterLibraryNarrowQuery)
  media.addEventListener('change', listener)
  return () => { media.removeEventListener('change', listener) }
}

function useNarrowCharacterLibrary(): boolean {
  return useSyncExternalStore(
    subscribeCharacterLibraryWidth,
    () => window.matchMedia(characterLibraryNarrowQuery).matches,
    () => false,
  )
}

function SillyTavernImportDialog({
  runtimeDiagnostics, listCharacters, listPresets, initialChatFile, initialCardFile, onClose,
  onPrepare, onPrepareRpDistribution, onLaunch, onCompleted,
}: {
  readonly runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry
  readonly listCharacters: HeaderProps['listCharacters']
  readonly listPresets: HeaderProps['listPresets']
  readonly initialChatFile?: File
  readonly initialCardFile?: File
  readonly onClose: () => void
  readonly onPrepare: (chatFile: File, cardFile?: File, characterId?: string) => Promise<PreparedChatMigration>
  readonly onPrepareRpDistribution: (target: string, sessionId: string) => Promise<PreparedChatMigration>
  readonly onLaunch: (
    prepared: PreparedChatMigration,
    presetId?: string,
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ) => Promise<void>
  readonly onCompleted?: () => void
}) {
  const chatRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLInputElement | null>(null)
  const [chatFile, setChatFile] = useState<File | undefined>(initialChatFile)
  const [cardFile, setCardFile] = useState<File | undefined>(initialCardFile)
  const [characters, setCharacters] = useState<readonly CharacterLibrarySummary[]>()
  const [characterError, setCharacterError] = useState<string>()
  const [characterId, setCharacterId] = useState('')
  const [sourceMode, setSourceMode] = useState<'jsonl' | 'rp-distribution'>('jsonl')
  const [rpTarget, setRpTarget] = useState(initialRpDistributionTarget)
  const [rpSessionId, setRpSessionId] = useState('')
  const { entries: presets, error: presetError, presetId, selectPreset } = usePresetPreference(listPresets)
  const [prepared, setPrepared] = useState<PreparedChatMigration>()
  const [busy, setBusy] = useState<'preparing' | 'launching'>()
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [permissionDuration, setPermissionDuration] = useState<PreflightPermissionDuration>('remember')
  const [error, setError] = useState<string>()
  const selectedPresetId = presetId === '' ? undefined : presetId
  const selectedPreset = presets?.find(entry => entry.id === selectedPresetId)
  useEffect(() => {
    if (characters !== undefined || characterError !== undefined) return
    let current = true
    void listCharacters().then(value => {
      if (current) setCharacters(value)
    }, reason => {
      if (current) setCharacterError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [characterError, characters, listCharacters])
  const preparedCharacter = sourceMode === 'jsonl' ? prepared?.character : undefined
  const expectsTavernPreflight = prepared !== undefined && (
    (preparedCharacter?.tavernHelper?.enabledScriptCount ?? 0) > 0
    || (selectedPresetId !== undefined
      && (presets === undefined || (selectedPreset?.tavernHelper?.enabledScriptCount ?? 0) > 0))
  )
  const expectsCardResourcePreflight = (preparedCharacter?.remoteResources.length ?? 0) > 0
  const expectsResourcePreflight = expectsTavernPreflight || expectsCardResourcePreflight
  const launchPreflight = useTavernLaunchPreflight({
    expected: expectsTavernPreflight,
    ...(prepared === undefined ? {} : { permissionOwnerId: prepared.permissionOwnerId }),
    ...(preparedCharacter === undefined ? {} : { characterId: preparedCharacter.id }),
    ...(selectedPresetId === undefined ? {} : { presetId: selectedPresetId }),
  })
  const pendingTavernResources = launchPreflight.pending
  const pendingCardResources = preparedCharacter === undefined
    ? [] : blockedCardFrameResources(preparedCharacter.remoteResources, preparedCharacter)
  const pendingPermissionCount = pendingTavernResources.length + pendingCardResources.length
  const pendingHosts = [...new Set([
    ...pendingTavernResources.map(item => new URL(item.origin).hostname),
    ...pendingCardResources.map(item => new URL(item.origin).hostname),
  ])].sort()
  const launchPhase = tavernPreflightLaunchPhase({
    expected: expectsResourcePreflight,
    loading: launchPreflight.loading,
    settled: launchPreflight.settled,
    pendingPermissions: pendingPermissionCount,
  })
  const working = busy !== undefined || launchPreflight.approving
  useEffect(() => {
    if (preparedCharacter === undefined && permissionDuration === 'trust') setPermissionDuration('remember')
  }, [permissionDuration, preparedCharacter])
  useAgentRpRuntimeDiagnosticContribution(
    runtimeDiagnostics,
    'chat-migration-preflight',
    prepared === undefined ? undefined : {
      kind: 'preflight',
      facts: {
        status: launchPreflight.loading ? 'loading'
          : pendingPermissionCount > 0 ? 'permission-required'
            : launchPreflight.error !== undefined ? 'error' : 'ready',
        launch: launchPhase,
        startReadiness: launchPhase,
        startAction: launchPhase === 'checking' ? 'checking'
          : launchPhase === 'approval-required' ? 'approve-and-start' : 'start',
        permissionDuration,
        scripts: launchPreflight.result?.scripts ?? 0,
        cardResources: preparedCharacter?.remoteResources.length ?? 0,
        pendingCardPermissions: pendingCardResources.length,
        pendingScriptPermissions: pendingTavernResources.length,
        pendingScriptOrigins: pendingTavernResources.filter(item => item.kind === 'script').length,
        pendingImageOrigins: pendingTavernResources.filter(item => item.kind === 'image').length,
        pendingStyleOrigins: pendingTavernResources.filter(item => item.kind === 'style').length,
        pendingFrameOrigins: pendingTavernResources.filter(item => item.kind === 'frame').length,
        pendingPermissions: pendingPermissionCount,
        failed: launchPreflight.result?.failed ?? 0,
      },
    },
  )
  const resetPreparation = (): void => {
    setPrepared(undefined)
    setAutoLaunch(false)
    setError(undefined)
  }
  const approveResources = useCallback(async (): Promise<{
    readonly ready: boolean
    readonly permissions?: AgentRpSessionResourcePermissions
  }> => {
    if (prepared === undefined) throw new Error('迁移来源尚未准备完成')
    let character = preparedCharacter
    const exactCardResources = character === undefined || permissionDuration === 'trust' ? []
      : blockedCardFrameResources(character.remoteResources, { ...character, remoteResourcePolicy: 'prompt' })
    if (character !== undefined && permissionDuration !== 'trust' && character.remoteResourcePolicy === 'isolated-https') {
      character = await updateCharacterRemoteResourcePolicy(character.id, 'prompt')
    }
    const tavern = await launchPreflight.approve(permissionDuration)
    if (!tavern.ready) return { ready: false }
    if (permissionDuration === 'session') {
      return {
        ready: true,
        permissions: {
          tavern: tavern.permissions ?? { scripts: [], images: [], styles: [], fonts: [], frames: [] },
          card: exactCardResources,
        },
      }
    }
    if (character !== undefined) {
      if (permissionDuration === 'trust') {
        character = await updateCharacterRemoteResourcePolicy(character.id, 'isolated-https')
      } else {
        for (const resource of exactCardResources) {
          character = await updateCharacterRemoteResource(character.id, resource.origin, resource.type, true)
        }
      }
      const nextCharacter = character
      setPrepared(current => current === undefined ? current : { ...current, character: nextCharacter })
    }
    return { ready: true }
  }, [launchPreflight, permissionDuration, prepared, preparedCharacter])
  const launchPrepared = useCallback(async (): Promise<void> => {
    if (prepared === undefined || working || launchPhase === 'checking') return
    setBusy('launching')
    setError(undefined)
    try {
      const approval = launchPhase === 'approval-required' ? await approveResources() : { ready: true }
      if (!approval.ready) {
        setBusy(undefined)
        return
      }
      await onLaunch(prepared, selectedPresetId, approval.permissions)
      onCompleted?.()
      onClose()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(undefined)
    }
  }, [approveResources, launchPhase, onClose, onCompleted, onLaunch, prepared, selectedPresetId, working])
  useEffect(() => {
    if (!autoLaunch || prepared === undefined || busy !== undefined || launchPhase === 'checking') return
    setAutoLaunch(false)
    if (launchPhase !== 'approval-required') void launchPrepared()
  }, [autoLaunch, busy, launchPhase, launchPrepared, prepared])
  const prepare = (): void => {
    if (working) return
    setBusy('preparing')
    setError(undefined)
    const operation = sourceMode === 'jsonl'
      ? onPrepare(chatFile!, cardFile, characterId === '' ? undefined : characterId)
      : onPrepareRpDistribution(rpTarget, rpSessionId)
    void operation.then(value => {
      setPrepared(value)
      setBusy(undefined)
      setAutoLaunch(true)
    }, reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(undefined)
    })
  }
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="迁移 SillyTavern 聊天" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.66)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1250,
  }} onMouseDown={event => { if (event.target === event.currentTarget && !working) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,.5)', boxSizing: 'border-box',
      maxHeight: 'calc(100dvh - 24px)', maxWidth: '520px', overflowY: 'auto', padding: 'clamp(18px, 5vw, 24px)',
      width: 'min(94vw, 520px)',
    }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
        <h2 style={{ flex: 1, fontSize: '17px', margin: 0 }}>迁移聊天</h2>
        <button type="button" aria-label="关闭迁移聊天" disabled={working} onClick={onClose} style={{
          alignItems: 'center', background: 'transparent', border: 0, borderRadius: '50%', color: 'inherit',
          cursor: working ? 'default' : 'pointer', display: 'inline-flex', font: 'inherit', fontSize: '22px',
          height: '34px', justifyContent: 'center', opacity: working ? .4 : .7, padding: 0, width: '34px',
        }}>×</button>
      </div>
      <p style={{ fontSize: '13px', lineHeight: 1.65, margin: '9px 0 20px', opacity: .58 }}>
        从 SillyTavern JSONL 或本机模块化 RP 会话创建一段可以继续的新会话
      </p>
      {error !== undefined && <p role="alert" style={{ color: '#e47a7a', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>}
      <input ref={chatRef} type="file" accept=".jsonl,application/x-ndjson" hidden onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file !== undefined) { setChatFile(file); resetPreparation() }
      }} />
      <input ref={cardRef} type="file" accept=".png,.json,.charx,image/png,application/json" hidden onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file !== undefined) { setCardFile(file); setCharacterId(''); resetPreparation() }
      }} />
      <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr', marginBottom: '14px' }}>
        <button type="button" disabled={working} aria-pressed={sourceMode === 'jsonl'} onClick={() => { setSourceMode('jsonl'); resetPreparation() }}
          style={sourceMode === 'jsonl' ? primaryButtonStyle : secondaryButtonStyle}>SillyTavern JSONL</button>
        <button type="button" disabled={working} aria-pressed={sourceMode === 'rp-distribution'} onClick={() => { setSourceMode('rp-distribution'); resetPreparation() }}
          style={sourceMode === 'rp-distribution' ? primaryButtonStyle : secondaryButtonStyle}>模块化 RP 会话</button>
      </div>
      {sourceMode === 'jsonl'
        ? <div style={{ display: 'grid', gap: '8px' }}>
            <button type="button" disabled={working} onClick={() => { chatRef.current?.click() }} style={{ ...secondaryButtonStyle, textAlign: 'left' }}>
              {chatFile === undefined ? '选择聊天记录 JSONL' : `聊天记录 · ${chatFile.name}`}
            </button>
            <div style={{ background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '10px', display: 'grid', gap: '8px', padding: '10px' }}>
              <label htmlFor="agent-rp-chat-migration-character" style={{ fontSize: '11px', fontWeight: 620, opacity: .66 }}>角色卡（可选）</label>
              <select id="agent-rp-chat-migration-character" data-agent-rp-chat-migration-character
                disabled={working} value={cardFile === undefined ? characterId : '__file__'} onChange={event => {
                  if (event.target.value === '__file__') return
                  setCharacterId(event.target.value)
                  setCardFile(undefined)
                  resetPreparation()
                }} style={{
                  background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
                  borderRadius: '8px', color: 'inherit', font: 'inherit', padding: '8px 9px', width: '100%',
                }}>
                <option value="">不绑定角色卡</option>
                {cardFile !== undefined && <option value="__file__">文件 · {cardFile.name}</option>}
                {characters?.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
              </select>
              <div style={{ alignItems: 'center', display: 'flex', gap: '9px' }}>
                <span style={{ flex: 1, fontSize: '10px', lineHeight: 1.45, opacity: .48 }}>
                  {characterError !== undefined ? characterError
                    : characters === undefined ? '正在读取角色库…'
                      : characterId !== '' ? '使用资源中心已有角色卡'
                        : cardFile === undefined ? '也可以从文件导入角色卡' : `文件 · ${cardFile.name}`}
                </span>
                {characterError !== undefined && <button type="button" disabled={working} onClick={() => { setCharacterError(undefined) }} style={generationButtonStyle}>重试</button>}
                <button type="button" data-agent-rp-action="select-chat-migration-character-file" disabled={working}
                  onClick={() => { cardRef.current?.click() }} style={generationButtonStyle}>从文件选择</button>
              </div>
            </div>
          </div>
        : <div style={{ display: 'grid', gap: '10px' }}>
            <label style={{ display: 'grid', fontSize: '12px', gap: '6px' }}>
              模块化 RP 地址
              <input value={rpTarget} disabled={working} onChange={event => { setRpTarget(event.target.value); resetPreparation() }} placeholder="http://127.0.0.1:3092"
                style={settingsFieldStyle} />
            </label>
            <label style={{ display: 'grid', fontSize: '12px', gap: '6px' }}>
              原会话 ID
              <input value={rpSessionId} disabled={working} onChange={event => { setRpSessionId(event.target.value); resetPreparation() }} placeholder="session-…"
                style={settingsFieldStyle} />
            </label>
            <p style={{ fontSize: '11px', lineHeight: 1.55, margin: 0, opacity: .5 }}>
              原会话需要仍在本机模块化 RP 中可读取；迁移不会修改它
            </p>
          </div>}
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 620, marginTop: '16px', opacity: .68 }}>
        对话预设
        <select aria-label="迁移对话预设" disabled={working} value={presetId} onChange={event => { selectPreset(event.target.value) }} style={{
          background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
          borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', display: 'block', font: 'inherit',
          marginTop: '7px', padding: '9px 10px', width: '100%',
        }}>
          <option value="">不使用预设</option>
          {presets?.map(entry => <option key={entry.id} value={entry.id}>{presetLibraryOptionLabel(entry, presets)}</option>)}
        </select>
      </label>
      <div style={{ fontSize: '11px', lineHeight: 1.55, marginTop: '6px', opacity: .5 }}>
        {presetError !== undefined
          ? presetError
          : presets === undefined
          ? '正在读取预设…'
          : presets.length === 0
            ? '预设库暂无内容'
            : (() => {
                const preset = presets.find(entry => entry.id === presetId)
                return preset === undefined
                  ? '迁移后的会话不启用酒馆预设'
                  : `${preset.enabledCount}/${preset.promptCount} 项启用${preset.regexScriptCount === 0 ? '' : ` · ${preset.regexScriptCount} 条正则`}`
              })()}
      </div>
      {prepared !== undefined && expectsResourcePreflight && <div data-agent-rp-chat-migration-preflight={launchPhase}
        data-agent-rp-resource-permission-duration={permissionDuration} style={{
          background: pendingPermissionCount > 0
            ? 'color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 9%, transparent)'
            : 'var(--dsw-alias-bg-layer-1, #202024)',
          border: pendingPermissionCount > 0
            ? '1px solid color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 38%, transparent)'
            : '1px solid var(--dsw-alias-border-l2, #39393c)',
          borderRadius: '10px', fontSize: '11px', lineHeight: 1.55, marginTop: '14px', padding: '10px 11px',
        }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
          <strong style={{ fontSize: '12px' }}>启动权限</strong>
          <span style={{ marginLeft: 'auto', opacity: .56 }}>
            {launchPreflight.loading ? '检查中…'
              : launchPreflight.error !== undefined ? '暂时无法预检'
                : pendingHosts.length > 0 ? `${pendingHosts.length} 个来源待确认`
                  : `${launchPreflight.result?.ready ?? 0}/${launchPreflight.result?.scripts ?? 0} 已准备`}
          </span>
        </div>
        {launchPreflight.error !== undefined && <div style={{ marginTop: '5px', opacity: .58 }}>
          {launchPreflight.error}；未解析的脚本会保持关闭
        </div>}
        {pendingHosts.length > 0 && <>
          <div title={pendingHosts.join('\n')} style={{
            marginTop: '5px', opacity: .66, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{pendingHosts.join('、')}</div>
          <div role="radiogroup" aria-label="启动权限方式" style={{
            display: 'grid', gap: '6px', gridTemplateColumns: preparedCharacter === undefined
              ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', marginTop: '8px',
          }}>
            {([
              ['session', '仅本次'], ['remember', '记住'],
              ...(preparedCharacter === undefined ? [] : [['trust', '信任此卡']] as const),
            ] as readonly (readonly [PreflightPermissionDuration, string])[]).map(([value, label]) => <button
              key={value} type="button" role="radio" aria-checked={permissionDuration === value}
              data-agent-rp-permission-duration={value} onClick={() => { setPermissionDuration(value) }} style={{
                background: permissionDuration === value
                  ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                border: permissionDuration === value
                  ? `1px solid color-mix(in srgb, ${color} 42%, transparent)`
                  : '1px solid var(--dsw-alias-border-l2, #444)',
                borderRadius: '7px', color: 'inherit', cursor: 'pointer', font: 'inherit', minWidth: 0,
                padding: '7px 4px', textAlign: 'center', whiteSpace: 'nowrap',
              }}><strong style={{ display: 'block', fontSize: '11px' }}>{label}</strong></button>)}
          </div>
          <div style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '6px', opacity: .52 }}>
            {permissionDuration === 'session' ? '只允许这次静态发现的精确来源'
              : permissionDuration === 'trust' ? '允许这张卡在隔离界面中加载 HTTPS 资源'
                : '记住所选脚本、来源与资源类型'}</div>
        </>}
        {(launchPreflight.result?.failed ?? 0) > 0 && <div style={{
          color: 'var(--dsw-alias-state-warning, #d5a64c)', marginTop: '5px',
        }}>{launchPreflight.result!.failed} 个脚本无法完成静态解析，开聊后也不会执行</div>}
      </div>}
      <div style={{ display: 'flex', gap: '9px', justifyContent: 'flex-end', marginTop: '22px' }}>
        <button type="button" disabled={working} onClick={onClose} style={secondaryButtonStyle}>取消</button>
        <button type="button" data-agent-rp-start-readiness={prepared === undefined ? 'prepare' : launchPhase}
          disabled={working || launchPhase === 'checking'
            || (sourceMode === 'jsonl' ? chatFile === undefined : rpTarget.trim() === '' || rpSessionId.trim() === '')}
          onClick={prepared === undefined ? prepare : () => { void launchPrepared() }} style={primaryButtonStyle}>
          {busy === 'preparing' ? '正在读取…' : busy === 'launching' || launchPreflight.approving ? '正在创建…'
            : launchPhase === 'checking' ? '检查权限…'
              : prepared !== undefined && launchPhase === 'approval-required' ? '允许并创建' : '创建新会话'}
        </button>
      </div>
    </section>
  </div>
}

function PersonaManagerDialog({ current, listPersonas, savePersona, deletePersona, onApply, onClose }: {
  readonly current?: SessionPersonaSnapshot
  readonly listPersonas: HeaderProps['listPersonas']
  readonly savePersona: HeaderProps['savePersona']
  readonly deletePersona: HeaderProps['deletePersona']
  readonly onApply: (persona?: SessionPersonaSnapshot) => Promise<void>
  readonly onClose: () => void
}) {
  const [entries, setEntries] = useState<readonly PersonaLibraryEntry[]>()
  const [selectedId, setSelectedId] = useState(current?.id ?? '')
  const [editingId, setEditingId] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<'apply' | 'save' | 'delete'>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    void listPersonas().then(value => {
      if (active) setEntries(value)
    }, reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [listPersonas])
  const selected = entries?.find(entry => entry.id === selectedId)
    ?? (current?.id === selectedId ? current : undefined)
  const edit = (persona?: Pick<SessionPersonaSnapshot, 'id' | 'name' | 'description'>): void => {
    setEditing(true)
    setEditingId(persona?.id)
    setName(persona?.name ?? '')
    setDescription(persona?.description ?? '')
    setConfirmDelete(false)
    setError(undefined)
  }
  const apply = (persona?: SessionPersonaSnapshot): void => {
    setBusy('apply')
    setError(undefined)
    void onApply(persona).then(onClose, reason => {
      setBusy(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="管理你的身份" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.58)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1220,
  }} onMouseDown={event => { if (event.target === event.currentTarget && busy === undefined) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
      borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,.42)', maxHeight: 'min(720px, calc(100vh - 36px))',
      overflowY: 'auto', padding: '22px', width: 'min(94vw, 520px)',
    }}>
      <header style={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', margin: 0 }}>你的身份</h2>
          <p style={{ fontSize: '12px', lineHeight: 1.55, margin: '6px 0 0', opacity: .55 }}>更改从下一次回复开始生效，不会改写已有聊天</p>
        </div>
        <button type="button" aria-label="关闭身份管理" disabled={busy !== undefined} onClick={onClose} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '23px', marginLeft: 'auto', padding: '4px',
        }}>×</button>
      </header>
      {current === undefined ? <div style={{
        background: 'var(--dsw-alias-bg-layer-1, #202024)', borderRadius: '10px', fontSize: '12px', lineHeight: 1.6,
        marginTop: '18px', opacity: .62, padding: '11px 12px',
      }}>当前会话没有设置 Persona</div> : <div style={{
        background: `color-mix(in srgb, ${color} 11%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
        borderRadius: '10px', marginTop: '18px', padding: '11px 12px',
      }}>
        <div style={{ fontSize: '11px', opacity: .5 }}>当前会话</div>
        <strong style={{ display: 'block', fontSize: '14px', marginTop: '3px' }}>{current.name}</strong>
        {current.description !== '' && <div style={{ fontSize: '12px', lineHeight: 1.6, marginTop: '5px', opacity: .62, whiteSpace: 'pre-wrap' }}>{current.description}</div>}
      </div>}
      <div style={{ alignItems: 'center', display: 'flex', marginTop: '18px' }}>
        <label htmlFor="agent-rp-persona-manager-select" style={{ fontSize: '12px', fontWeight: 620, opacity: .64 }}>选择已保存的身份</label>
        <button type="button" onClick={() => { edit() }} style={{ background: 'transparent', border: 0, color, cursor: 'pointer', font: 'inherit', fontSize: '12px', marginLeft: 'auto', padding: 0 }}>新建</button>
      </div>
      <select id="agent-rp-persona-manager-select" value={selectedId} disabled={entries === undefined || busy !== undefined} onChange={event => {
        setSelectedId(event.target.value)
        setConfirmDelete(false)
      }} style={{
        background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
        borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', marginTop: '7px', padding: '9px 10px', width: '100%',
      }}>
        <option value="">{entries === undefined ? '正在读取…' : entries.length === 0 ? '还没有保存的身份' : '选择身份'}</option>
        {entries?.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
        {current !== undefined && entries?.some(persona => persona.id === current.id) === false
          && <option value={current.id}>{current.name}（会话快照）</option>}
      </select>
      {selected !== undefined && <div style={{ marginTop: '8px' }}>
        <div style={{ fontSize: '12px', lineHeight: 1.6, opacity: .58, whiteSpace: 'pre-wrap' }}>{selected.description || '只有称呼，没有额外人物设定'}</div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          {entries?.some(entry => entry.id === selected.id) === true && <button type="button" onClick={() => { edit(selected) }} style={{ background: 'transparent', border: 0, color, cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: 0 }}>编辑</button>}
          {entries?.some(entry => entry.id === selected.id) === true && <button type="button" disabled={busy !== undefined} onClick={() => {
            if (!confirmDelete) { setConfirmDelete(true); return }
            setBusy('delete')
            setError(undefined)
            void deletePersona(selected.id).then(() => {
              setEntries(value => (value ?? []).filter(entry => entry.id !== selected.id))
              setSelectedId(current?.id === selected.id ? current.id : '')
              setConfirmDelete(false)
              setBusy(undefined)
            }, reason => {
              setBusy(undefined)
              setError(reason instanceof Error ? reason.message : String(reason))
            })
          }} style={{ background: 'transparent', border: 0, color: confirmDelete ? '#e88989' : 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', opacity: confirmDelete ? 1 : .48, padding: 0 }}>{busy === 'delete' ? '正在移除…' : confirmDelete ? '确认从身份库移除' : '从身份库移除'}</button>}
          {confirmDelete && <button type="button" onClick={() => { setConfirmDelete(false) }} style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', opacity: .48, padding: 0 }}>取消</button>}
        </div>
      </div>}
      {editing ? <div style={{
        background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
        borderRadius: '10px', display: 'grid', gap: '9px', marginTop: '14px', padding: '11px',
      }}>
        <input value={name} maxLength={120} placeholder="称呼（角色会这样称呼你）" onChange={event => { setName(event.target.value) }} style={{
          background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #414147)', borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '8px 9px', width: '100%',
        }} />
        <textarea value={description} maxLength={12000} rows={4} placeholder="身份、外貌、性格，或你与角色的关系" onChange={event => { setDescription(event.target.value) }} style={{
          background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #414147)', borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', lineHeight: 1.55, padding: '8px 9px', resize: 'vertical', width: '100%',
        }} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => { setEditing(false); setEditingId(undefined); setName(''); setDescription('') }} style={{ background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '8px', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '7px 10px' }}>取消编辑</button>
          <button type="button" disabled={busy !== undefined || name.trim() === ''} onClick={() => {
            setBusy('save')
            setError(undefined)
            void savePersona({ format: 0, ...(editingId === undefined ? {} : { id: editingId }), name, description }).then(entry => {
              setEntries(value => [entry, ...(value ?? []).filter(item => item.id !== entry.id)])
              setSelectedId(entry.id)
              setEditing(false)
              setEditingId(undefined)
              setName('')
              setDescription('')
              setBusy(undefined)
              apply({ id: entry.id, name: entry.name, description: entry.description })
            }, reason => {
              setBusy(undefined)
              setError(reason instanceof Error ? reason.message : String(reason))
            })
          }} style={{ background: color, border: 0, borderRadius: '8px', color: '#fff', cursor: 'pointer', font: 'inherit', opacity: name.trim() === '' ? .45 : 1, padding: '7px 11px' }}>{busy === 'save' ? '正在保存…' : '保存并应用'}</button>
        </div>
      </div> : null}
      {error !== undefined && <p role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.55, margin: '12px 0 0' }}>{error}</p>}
      <footer style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '9px', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '14px' }}>
        {current !== undefined && <button type="button" disabled={busy !== undefined} onClick={() => { apply() }} style={{
          background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '9px', color: 'inherit', cursor: 'pointer', font: 'inherit', marginRight: 'auto', padding: '8px 12px',
        }}>清除当前身份</button>}
        <button type="button" disabled={busy !== undefined} onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '9px', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '8px 12px' }}>关闭</button>
        <button type="button" disabled={selected === undefined || busy !== undefined} onClick={() => {
          if (selected !== undefined) apply({ id: selected.id, name: selected.name, description: selected.description })
        }} style={{ background: color, border: 0, borderRadius: '9px', color: '#fff', cursor: 'pointer', font: 'inherit', opacity: selected === undefined ? .45 : 1, padding: '8px 13px' }}>{busy === 'apply' ? '正在应用…' : '应用到本会话'}</button>
      </footer>
    </section>
  </div>
}

type SidebarRoleplayWorkbenchProps = Pick<HeaderProps,
  | 'runtimeDiagnostics'
  | 'listCharacters'
  | 'readCharacter'
  | 'setCharacterArchived'
  | 'deleteCharacter'
  | 'importCharacterFile'
  | 'prepareChatMigration'
  | 'prepareRpDistributionChatMigration'
  | 'launchPreparedChatMigration'
  | 'startCharacterSession'
  | 'listPresets'
  | 'listRegexPacks'
  | 'importRegexPackFile'
  | 'deleteRegexPack'
  | 'listAgentCapabilityPresets'
  | 'importPresetFile'
  | 'listPersonas'
  | 'savePersona'
  | 'deletePersona'
> & {
  readonly listWorldInfos: () => Promise<readonly WorldInfoLibraryUpload[]>
  readonly importWorldInfoFile: (file: File) => Promise<WorldInfoLibraryUpload>
  readonly setWorldInfoDefault: (id: string, enabled: boolean) => Promise<WorldInfoLibraryUpload>
  readonly deleteWorldInfo: (id: string) => Promise<WorldInfoLibraryUpload>
  readonly startWorldInfoSession: (
    sessionId: SessionId,
    worldInfo: WorldInfoLibraryUpload,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ) => Promise<void>
  readonly startStoryWorkspaceSession: (sessionId: SessionId, workspaceId: string, request: string) => Promise<void>
  readonly continueStoryWorkspaceSession: (sessionId: SessionId, workspaceId: string, request: string) => Promise<void>
  readonly renamePreset: (id: string, name: string) => Promise<PresetLibrarySummary>
  readonly deletePreset: (id: string) => Promise<void>
  readonly workspaceSettings: WorkspaceSettingsSource
  readonly workspaceList: WorkspaceListSource
  readonly storyWorkspaceNavigation: StoryWorkspaceNavigation
}

type SidebarRoleplayDestinationProps = PropsRuntime<'sidebar.destinations'>
  & PropsRenderSlots<typeof AGENT_RP_WORKBENCH_SECTION_SLOT>
  & SidebarRoleplayWorkbenchProps
type SidebarRoleplayFooterActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsRenderSlots<typeof AGENT_RP_WORKBENCH_SECTION_SLOT>
  & SidebarRoleplayWorkbenchProps

function RoleplayDestinationIcon({ size }: { readonly size: number }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width={size} height={size} fill="none">
    <path d="M5.25 3.75h9.5A2.5 2.5 0 0 1 17.25 6.25v5A2.5 2.5 0 0 1 14.75 13.75H9l-3.75 2.5.75-2.5h-.75a2.5 2.5 0 0 1-2.5-2.5v-5a2.5 2.5 0 0 1 2.5-2.5Z"
      stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    <path d="M11.7 5.7c.18 1.24.86 1.92 2.1 2.1-1.24.18-1.92.86-2.1 2.1-.18-1.24-.86-1.92-2.1-2.1 1.24-.18 1.92-.86 2.1-2.1Z"
      stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M7.15 7.1v2.2M6.05 8.2h2.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
}

function SidebarRoleplayFooterAction(props: SidebarRoleplayFooterActionProps) {
  const container = useRef<HTMLDivElement>(null)
  const motionFrame = useRef<number>()
  const [width, setWidth] = useState(0)
  const update = useCallback((): number | undefined => {
    const trigger = container.current
    if (trigger === null) return undefined
    const nextWidth = resolveLegacySidebarWidth(trigger)
    setWidth(nextWidth)
    return nextWidth
  }, [])
  const trackSidebarMotion = useCallback((): void => {
    if (motionFrame.current !== undefined) cancelAnimationFrame(motionFrame.current)
    const started = performance.now()
    let previousWidth: number | undefined
    let stableFrames = 0
    const sample = (time: number): void => {
      const nextWidth = update()
      stableFrames = nextWidth === previousWidth ? stableFrames + 1 : 0
      previousWidth = nextWidth
      if ((time - started < 120 || stableFrames < 3) && time - started < 500) {
        motionFrame.current = requestAnimationFrame(sample)
      } else {
        motionFrame.current = undefined
      }
    }
    motionFrame.current = requestAnimationFrame(sample)
  }, [update])
  useLayoutEffect(() => {
    const trigger = container.current
    if (trigger === null) return
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    let ancestor: HTMLElement | null = trigger
    while (observer !== undefined && ancestor !== null && ancestor !== document.body) {
      observer.observe(ancestor)
      ancestor = ancestor.parentElement
    }
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
      if (motionFrame.current !== undefined) cancelAnimationFrame(motionFrame.current)
    }
  }, [update])
  return <div ref={container} data-agent-rp-sidebar-slot="footer-action" onClickCapture={trackSidebarMotion}
    style={{ width: props.wide ? '100%' : 'auto' }}>
    <SidebarRoleplayDestination {...props} width={width} />
  </div>
}

function SidebarRoleplayDestination({
  wide, width, useSessions, renderSlot,
  runtimeDiagnostics,
  listCharacters, readCharacter, setCharacterArchived, deleteCharacter, importCharacterFile,
  prepareChatMigration, prepareRpDistributionChatMigration, launchPreparedChatMigration,
  startCharacterSession,
  listPresets, listRegexPacks, importRegexPackFile, deleteRegexPack,
  listAgentCapabilityPresets, importPresetFile, listPersonas, savePersona, deletePersona,
  listWorldInfos, importWorldInfoFile, setWorldInfoDefault, deleteWorldInfo, renamePreset, deletePreset,
  startWorldInfoSession, startStoryWorkspaceSession, continueStoryWorkspaceSession,
  workspaceSettings, workspaceList,
  storyWorkspaceNavigation,
}: SidebarRoleplayDestinationProps) {
  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [launchComposerOpen, setLaunchComposerOpen] = useState(false)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [resourceCenterOpen, setResourceCenterOpen] = useState(false)
  const [storyWorkspaceOpen, setStoryWorkspaceOpen] = useState(false)
  const [storyWorkspaceInitialId, setStoryWorkspaceInitialId] = useState<string>()
  const [resourceCenterSection, setResourceCenterSection] = useState<'characters' | 'world-info' | 'regex-packs'>('characters')
  const [worldInfoLaunch, setWorldInfoLaunch] = useState<WorldInfoLibraryUpload>()
  const [launchSessionId, setLaunchSessionId] = useState<SessionId | undefined>(undefined)
  const [accessSaving, setAccessSaving] = useState(false)
  const [accessError, setAccessError] = useState<string>()
  const currentSessionId = useSessions(state => state.current)
  const currentSession = useSessions(state => currentSessionId === undefined ? undefined : state.byId[currentSessionId])
  const settingsSnapshot = useSyncExternalStore(
    workspaceSettings.subscribe,
    workspaceSettings.getSnapshot,
    workspaceSettings.getSnapshot,
  )
  const workspaceSnapshot = useSyncExternalStore(
    workspaceList.subscribe,
    workspaceList.getSnapshot,
    workspaceList.getSnapshot,
  )
  const workspace = currentSessionId === undefined
    ? undefined
    : workspaceSnapshot.items.find(item => item.sessionIds.includes(currentSessionId))
  const workspaceEnabled = workspace !== undefined
    && allowsAgentRpEntry(settingsSnapshot.value, workspace.workspaceId)
  const workspaceAccessWritable = workspace !== undefined
    && settingsSnapshot.status === 'ready'
    && !accessSaving
  const blankSessionReady = currentSession?.blank === true
    && workspaceEnabled
  const storyWorkspaceLaunchReady = blankSessionReady
  const unavailableReason = currentSessionId === undefined
    ? '先点侧栏的“新会话”，再从这里选择角色或迁移聊天'
    : !currentSession?.blank
      ? '当前会话已经开始；新建一个空白会话即可开始另一段角色对话'
      : '当前工作区尚未启用 Agent RP 启动入口，可在上方直接启用'
  const toggleWorkspaceAccess = (): void => {
    if (!workspaceAccessWritable || workspace === undefined) return
    setAccessSaving(true)
    setAccessError(undefined)
    void workspaceSettings.set(setAgentRpWorkspaceEntry(
      settingsSnapshot.value,
      workspace.workspaceId,
      !workspaceEnabled,
    )).catch((reason: unknown) => {
      setAccessError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setAccessSaving(false) })
  }
  const closeWorkbench = (): void => { setWorkbenchOpen(false) }
  const openLaunchComposer = (): void => {
    if (!blankSessionReady || currentSessionId === undefined) return
    setLaunchSessionId(currentSessionId)
    closeWorkbench()
    setLaunchComposerOpen(true)
  }
  const openMigration = (): void => {
    if (!blankSessionReady || currentSessionId === undefined) return
    setLaunchSessionId(currentSessionId)
    closeWorkbench()
    setMigrationOpen(true)
  }
  const openResourceCenter = (): void => {
    closeWorkbench()
    setResourceCenterSection('characters')
    setLaunchSessionId(blankSessionReady ? currentSessionId : undefined)
    setResourceCenterOpen(true)
  }
  const openStoryWorkspace = (): void => {
    closeWorkbench()
    setStoryWorkspaceInitialId(undefined)
    setStoryWorkspaceOpen(true)
  }
  const openCurrentSessionTools = (): void => {
    if (currentSessionId === undefined || !isAgentRpCapabilityPresetId(sessionAgentPreset(currentSession))) return
    closeWorkbench()
    window.dispatchEvent(new CustomEvent(openRoleplaySessionToolsEvent, { detail: String(currentSessionId) }))
  }
  const narrowResourceCenter = useNarrowCharacterLibrary()
  useEffect(() => {
    if (!workbenchOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setWorkbenchOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [workbenchOpen])
  useEffect(() => storyWorkspaceNavigation.subscribe(({ workspaceId }) => {
    setWorkbenchOpen(false)
    setStoryWorkspaceInitialId(workspaceId)
    setStoryWorkspaceOpen(true)
  }), [storyWorkspaceNavigation])
  const widestLeftWithUsableContent = Math.max(0, window.innerWidth - 320)
  const drawerLeft = width <= widestLeftWithUsableContent
    ? width
    : Math.min(56, widestLeftWithUsableContent)
  return <>
    <Tooltip label="Agent RP" delayMs={500} disabled={wide}>
      <button type="button" data-agent-rp-action="open-workbench" aria-label="Agent RP" aria-haspopup="dialog"
        aria-expanded={workbenchOpen} onClick={() => { setWorkbenchOpen(true) }} style={{
        alignItems: 'center', background: workbenchOpen ? 'var(--dsw-specific-sidebar-nav-item-active, rgba(255,255,255,.08))' : 'transparent',
        border: 0, borderRadius: wide ? '12px' : '50%', color: 'inherit', cursor: 'pointer', display: 'flex',
        font: 'inherit', fontSize: '14px', gap: wide ? '8px' : 0, height: wide ? '42px' : '36px',
        justifyContent: wide ? 'flex-start' : 'center', margin: wide ? '2px 0' : '4px auto',
        overflow: 'hidden', padding: wide ? '0 8px' : 0, width: wide ? '100%' : '36px',
      }}>
        <span data-agent-rp-destination-icon style={{ color, display: 'inline-flex', flex: 'none' }}>
          <RoleplayDestinationIcon size={wide ? 16 : 18} />
        </span>
        {wide && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Agent RP</span>}
      </button>
    </Tooltip>
    {workbenchOpen && createPortal(<div role="presentation" data-agent-rp-workbench-layer
      style={{ inset: 0, position: 'fixed', zIndex: 1180 }}>
      <button type="button" aria-label="关闭 Agent RP 工作台" data-agent-rp-workbench-dismiss onClick={closeWorkbench} style={{
        background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,.34))', border: 0, cursor: 'default', inset: 0,
        padding: 0, position: 'absolute', width: '100%',
      }} />
      <section role="dialog" aria-modal="true" aria-label="Agent RP 工作台" data-agent-rp-workbench
        style={{
          background: 'var(--dsw-alias-bg-layer-2, #202124)', borderLeft: '1px solid var(--dsw-alias-border-l2, #39393c)',
          bottom: 0, boxShadow: 'var(--dsw-shadow-lv3, 0 12px 40px rgba(0,0,0,.28))', boxSizing: 'border-box',
          color: 'var(--dsw-alias-label-primary, #f4f4f5)', display: 'flex', flexDirection: 'column',
          left: `${drawerLeft}px`, maxWidth: `calc(100vw - ${drawerLeft}px)`, position: 'absolute', top: 0,
          width: `min(460px, calc(100vw - ${drawerLeft}px))`,
        }}>
        <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '10px', padding: '16px 16px 14px' }}>
          <span style={{ color, display: 'inline-flex' }}><RoleplayDestinationIcon size={22} /></span>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: '16px' }}>Agent RP</strong>
            <span style={{ display: 'block', fontSize: '11px', marginTop: '2px', opacity: .52 }}>角色体验工作台</span>
          </div>
          <button type="button" aria-label="关闭 Agent RP 工作台" onClick={closeWorkbench} style={{
            alignItems: 'center', background: 'transparent', border: 0, borderRadius: '50%', color: 'inherit',
            cursor: 'pointer', display: 'inline-flex', font: 'inherit', fontSize: '22px', height: '32px',
            justifyContent: 'center', padding: 0, width: '32px',
          }}>×</button>
        </header>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '18px 16px 24px' }}>
          <div data-agent-rp-workspace-access data-agent-rp-workspace-enabled={workspaceEnabled ? 'true' : 'false'}
            style={{
              alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #292a2e)',
              border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '12px',
              display: 'flex', gap: '12px', justifyContent: 'space-between', padding: '11px 12px',
            }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '11px', opacity: .5 }}>当前工作区</span>
              <strong style={{ display: 'block', fontSize: '13px', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {workspace?.title ?? '尚未加入工作区'}
              </strong>
            </span>
            <button type="button" data-agent-rp-action="toggle-workspace-access" aria-pressed={workspaceEnabled}
              aria-label={workspaceEnabled ? '停用当前工作区的 Agent RP 入口' : '启用当前工作区的 Agent RP 入口'}
              disabled={!workspaceAccessWritable} onClick={toggleWorkspaceAccess} style={{
                background: workspaceEnabled ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                border: `1px solid ${workspaceEnabled ? `color-mix(in srgb, ${color} 46%, transparent)` : 'var(--dsw-alias-border-l2, #4a4a50)'}`,
                borderRadius: '999px', color: 'inherit', cursor: workspaceAccessWritable ? 'pointer' : 'default',
                flex: '0 0 auto', font: 'inherit', fontSize: '11px', minWidth: '58px', opacity: workspaceAccessWritable ? 1 : .5,
                padding: '6px 9px',
              }}>{accessSaving ? '保存中' : settingsSnapshot.status === 'loading' ? '读取中'
                : settingsSnapshot.status === 'error' ? '不可用' : workspaceEnabled ? '已启用' : '未启用'}</button>
          </div>
          {accessError !== undefined && <p role="alert" style={{
            color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '11px', margin: '7px 2px 0',
          }}>{accessError}</p>}
          {isAgentRpCapabilityPresetId(sessionAgentPreset(currentSession)) && <button type="button"
            data-agent-rp-action="open-session-tools" onClick={openCurrentSessionTools} style={{
              alignItems: 'center', background: `color-mix(in srgb, ${color} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`, borderRadius: '12px',
              color: 'inherit', cursor: 'pointer', display: 'flex', font: 'inherit', gap: '11px',
              marginTop: '12px', padding: '12px', textAlign: 'left', width: '100%',
            }}>
            <span aria-hidden="true" style={{ color, fontSize: '19px', lineHeight: 1 }}>✦</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: '13px' }}>当前角色会话</strong>
              <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '3px', opacity: .54 }}>
                角色、身份、世界书、预设与调试视图
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: '16px', opacity: .38 }}>›</span>
          </button>}
          <h2 style={{ fontSize: '13px', margin: '22px 0 10px', opacity: .62 }}>开始</h2>
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
            <button type="button" data-agent-rp-action="open-launch-composer"
              data-agent-rp-source-session={currentSessionId} disabled={!blankSessionReady} onClick={openLaunchComposer} style={{
              background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
              borderRadius: '12px', color: 'inherit', cursor: blankSessionReady ? 'pointer' : 'default', font: 'inherit',
              minHeight: '88px', opacity: blankSessionReady ? 1 : .42, padding: '13px', textAlign: 'left',
            }}><span aria-hidden="true" style={{ color, display: 'block', fontSize: '20px', lineHeight: 1 }}>✦</span>
              <strong style={{ display: 'block', fontSize: '14px', marginTop: '10px' }}>开始游玩</strong>
              <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '4px', opacity: .58 }}>组合角色或场景、身份、世界与提示策略</span>
            </button>
            <button type="button" disabled={!blankSessionReady} onClick={openMigration} style={{
              background: 'var(--dsw-alias-bg-layer-1, #292a2e)', border: '1px solid var(--dsw-alias-border-l2, #444)',
              borderRadius: '12px', color: 'inherit', cursor: blankSessionReady ? 'pointer' : 'default', font: 'inherit',
              minHeight: '88px', opacity: blankSessionReady ? 1 : .42, padding: '13px', textAlign: 'left',
            }}><span aria-hidden="true" style={{ color, display: 'block', fontSize: '18px', lineHeight: 1 }}>↗</span>
              <strong style={{ display: 'block', fontSize: '14px', marginTop: '10px' }}>迁移聊天</strong>
              <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '4px', opacity: .58 }}>从酒馆记录或模块化 RP 接续</span>
            </button>
          </div>
          {!blankSessionReady && <p role="status" style={{
            background: 'var(--dsw-alias-bg-layer-1, #292a2e)', borderRadius: '9px', fontSize: '11px',
            lineHeight: 1.55, margin: '11px 0 0', opacity: .72, padding: '9px 10px',
          }}>{unavailableReason}</p>}
          <h2 style={{ fontSize: '13px', margin: '24px 0 10px', opacity: .62 }}>管理</h2>
          <button type="button" data-agent-rp-action="open-resource-center" onClick={openResourceCenter} style={{
            alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #292a2e)',
            border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '12px', color: 'inherit',
            cursor: 'pointer', display: 'flex', font: 'inherit', gap: '11px', padding: '12px', textAlign: 'left', width: '100%',
          }}>
            <span aria-hidden="true" style={{ color, fontSize: '20px', lineHeight: 1 }}>◇</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: '13px' }}>资源中心</strong>
              <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '3px', opacity: .52 }}>
                角色、世界书、预设与 Persona
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: '16px', opacity: .38 }}>›</span>
          </button>
          <button type="button" data-agent-rp-action="open-story-workspaces" onClick={openStoryWorkspace} style={{
            alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #292a2e)',
            border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '12px', color: 'inherit',
            cursor: 'pointer', display: 'flex', font: 'inherit', gap: '11px', marginTop: '9px', padding: '12px', textAlign: 'left', width: '100%',
          }}>
            <span aria-hidden="true" style={{ color, fontSize: '20px', lineHeight: 1 }}>✎</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: '13px' }}>游玩场地</strong>
              <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '3px', opacity: .52 }}>
                可执行世界、人物认知、故事地图、资料与输出布局
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: '16px', opacity: .38 }}>›</span>
          </button>
          <div data-agent-rp-workbench-extensions style={{ display: 'contents' }}>
            {renderSlot(AGENT_RP_WORKBENCH_SECTION_SLOT, { closeWorkbench })}
          </div>
          <p style={{ fontSize: '11px', lineHeight: 1.6, margin: '12px 2px 0', opacity: .46 }}>
            工作台保持一个全局入口；具体能力按任务分组，不再占用发送栏，也不会为每项兼容功能增加常驻图标
          </p>
        </div>
      </section>
    </div>, document.body)}
    {launchComposerOpen && launchSessionId !== undefined && createPortal(<RoleplayLaunchComposer
      runtimeDiagnostics={runtimeDiagnostics}
      listCharacters={listCharacters}
      readCharacter={readCharacter}
      listWorldInfos={listWorldInfos}
      listPresets={listPresets}
      listRegexPacks={listRegexPacks}
      listAgentCapabilityPresets={listAgentCapabilityPresets}
      listPersonas={listPersonas}
      onClose={() => { setLaunchComposerOpen(false) }}
      onManageResources={section => {
        setLaunchComposerOpen(false)
        setResourceCenterSection(section)
        setResourceCenterOpen(true)
      }}
      onStartCharacter={(character, greetingIndex, persona, presetId, worldInfoIds, regexPackIds, resourcePermissions, agentPresetId) => startCharacterSession(
        launchSessionId, character, greetingIndex, persona, presetId, worldInfoIds,
        undefined, resourcePermissions, agentPresetId, regexPackIds,
      )}
      onStartWorldInfo={(worldInfo, persona, presetId, worldInfoIds, regexPackIds, resourcePermissions, agentPresetId) => startWorldInfoSession(
        launchSessionId, worldInfo, persona, presetId, worldInfoIds,
        resourcePermissions, agentPresetId, regexPackIds,
      )}
    />, document.body)}
    {migrationOpen && launchSessionId !== undefined && createPortal(<SillyTavernImportDialog
      runtimeDiagnostics={runtimeDiagnostics}
      listCharacters={listCharacters}
      listPresets={listPresets}
      onClose={() => { setMigrationOpen(false) }}
      onPrepare={(chatFile, cardFile, characterId) => prepareChatMigration(launchSessionId, chatFile, cardFile, characterId)}
      onPrepareRpDistribution={(target, remoteSessionId) => prepareRpDistributionChatMigration(
        launchSessionId, target, remoteSessionId,
      )}
      onLaunch={(prepared, presetId, resourcePermissions) => launchPreparedChatMigration(
        launchSessionId, prepared, presetId, resourcePermissions,
      )} />, document.body)}
    {resourceCenterOpen && createPortal(<RoleplayResourceCenter
      accent={color}
      narrow={narrowResourceCenter}
      initialSection={resourceCenterSection}
      listCharacters={listCharacters}
      readCharacter={readCharacter}
      updateCharacterWorldBinding={updateCharacterWorldBinding}
      setCharacterArchived={setCharacterArchived}
      deleteCharacter={deleteCharacter}
      importCharacterFile={importCharacterFile}
      listWorldInfos={listWorldInfos}
      importWorldInfoFile={importWorldInfoFile}
      setWorldInfoDefault={setWorldInfoDefault}
      deleteWorldInfo={deleteWorldInfo}
      listPresets={listPresets}
      listRegexPacks={listRegexPacks}
      importPresetFile={importPresetFile}
      renamePreset={renamePreset}
      deletePreset={deletePreset}
      importRegexPackFile={importRegexPackFile}
      deleteRegexPack={deleteRegexPack}
      listPersonas={listPersonas}
      savePersona={savePersona}
      deletePersona={deletePersona}
      {...(launchSessionId === undefined ? {} : {
        onConfigureWorldInfo: (worldInfo: WorldInfoLibraryUpload) => {
          setResourceCenterOpen(false)
          setWorldInfoLaunch(worldInfo)
        },
      })}
      onClose={() => { setWorldInfoLaunch(undefined); setResourceCenterOpen(false) }}
    />, document.body)}
    {storyWorkspaceOpen && createPortal(<StoryWorkspaceEditor
      accent={color}
      {...(storyWorkspaceInitialId === undefined ? {} : { initialWorkspaceId: storyWorkspaceInitialId })}
      {...(storyWorkspaceLaunchReady && currentSessionId !== undefined ? {
        launchSourceSessionId: String(currentSessionId),
        onStartSession: (sourceSessionId: string, workspaceId: string, request: string) => startStoryWorkspaceSession(sourceSessionId as SessionId, workspaceId, request),
      } : {})}
      {...(currentSessionId === undefined || !isAgentRpCapabilityPresetId(sessionAgentPreset(currentSession))
        ? {}
        : {
            sessionId: String(currentSessionId),
            onContinueSession: (targetSessionId: string, workspaceId: string, request: string) => continueStoryWorkspaceSession(
              targetSessionId as SessionId, workspaceId, request,
            ),
          })}
      onClose={() => { setStoryWorkspaceOpen(false); setStoryWorkspaceInitialId(undefined) }}
    />, document.body)}
    {worldInfoLaunch !== undefined && launchSessionId !== undefined && createPortal(<WorldInfoLaunchDialog
      runtimeDiagnostics={runtimeDiagnostics}
      worldInfo={worldInfoLaunch}
      listWorldInfos={listWorldInfos}
      listPresets={listPresets}
      listPersonas={listPersonas}
      onBack={() => {
        setWorldInfoLaunch(undefined)
        setResourceCenterOpen(true)
      }}
      onStart={async (worldInfo, persona, presetId, worldInfoIds, resourcePermissions) => {
        await startWorldInfoSession(
          launchSessionId, worldInfo, persona, presetId, worldInfoIds, resourcePermissions,
        )
        setWorldInfoLaunch(undefined)
        setResourceCenterOpen(false)
      }}
    />, document.body)}
  </>
}

interface WorkspaceSettingsSectionProps extends PropsRuntime<'settings.section'> {
  readonly workspaceSettings: WorkspaceSettingsSource
  readonly workspaceList: WorkspaceListSource
  readonly loadModelCatalog: () => Promise<AvailableModelCatalog>
}

interface RpDistributionBridgeSectionProps extends PropsRuntime<'settings.section'> {
  readonly listCharacters: (collection?: CharacterLibraryCollection) => Promise<readonly CharacterLibrarySummary[]>
  readonly listPresets: () => Promise<readonly PresetLibrarySummary[]>
  readonly listPersonas: () => Promise<readonly PersonaLibraryEntry[]>
  readonly listWorldInfos: () => Promise<readonly WorldInfoLibraryUpload[]>
  readonly probe: (target: string) => Promise<RpDistributionProbeResponse>
  readonly transfer: (
    target: string,
    kind: RpDistributionAssetKind,
    id: string,
  ) => Promise<RpDistributionTransferResponse>
  readonly receive: (
    target: string,
    kind: RpDistributionAssetKind,
    id: string,
  ) => Promise<RpDistributionAssetImportResponse>
}

const settingsFieldStyle = {
  background: 'var(--dsw-alias-bg-layer-1, #202024)',
  border: '1px solid var(--dsw-alias-border-l2, #3d3d43)',
  borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', fontSize: '12px',
  minWidth: 0, padding: '8px 9px', width: '100%',
} as const

function nextImageProfileName(profiles: readonly ImageGenerationProfile[], provider: ImageGenerationSettings['provider']): string {
  const base = provider === 'openai' ? 'OpenAI 配置' : provider === 'dashscope' ? '百炼配置'
    : provider === 'novelai' ? 'NovelAI 配置'
    : provider === 'a1111' ? 'A1111 配置' : 'ComfyUI 配置'
  const names = new Set(profiles.map(profile => profile.name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`.toLowerCase())) suffix += 1
  return `${base} ${suffix}`
}

function ImageGenerationSettingsPanel({ settings, writable, onSave }: {
  readonly settings: AgentRpSettings
  readonly writable: boolean
  readonly onSave: (settings: AgentRpSettings) => void
}) {
  const activeProfile = settings.imageProfiles.find(profile => profile.id === settings.activeImageProfileId)
    ?? settings.imageProfiles[0]!
  const [draft, setDraft] = useState(settings.imageGeneration)
  const [profileName, setProfileName] = useState(activeProfile.name)
  const [credential, setCredential] = useState<ImageCredentialInfo>()
  const [credentialValue, setCredentialValue] = useState('')
  const [credentialPhase, setCredentialPhase] = useState<'loading' | 'ready' | 'unknown'>('loading')
  const [credentialReload, setCredentialReload] = useState(0)
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [testResult, setTestResult] = useState<ImageProviderTestResult>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(settings.imageGeneration)
    setProfileName(activeProfile.name)
    setTestResult(undefined)
    setError(undefined)
    setDeleteArmed(false)
  }, [settings.imageGeneration, activeProfile.id, activeProfile.name])
  useEffect(() => {
    let active = true
    setCredential(undefined)
    setCredentialPhase('loading')
    setCredentialValue('')
    setError(undefined)
    void imageCredentialInfo(draft.provider).then(value => {
      if (!active) return
      setCredential(value)
      setCredentialPhase('ready')
    }, reason => {
      if (!active) return
      setCredentialPhase('unknown')
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [draft.provider, credentialReload])
  const saveCredential = (change: { readonly value: string } | { readonly clear: true }): void => {
    setCredentialBusy(true)
    setError(undefined)
    void updateImageCredential(draft.provider, change, credential).then(value => {
      setCredential(value)
      setCredentialPhase('ready')
      setCredentialValue('')
      setTestResult(undefined)
    }, reason => {
      if (reason instanceof ImageControlTransportError) setCredentialPhase('unknown')
      setError(reason instanceof Error ? reason.message : String(reason))
    })
      .finally(() => { setCredentialBusy(false) })
  }
  const testConnection = (): void => {
    setTestBusy(true)
    setError(undefined)
    setTestResult(undefined)
    void testConfiguredImageProvider(draft).then(setTestResult, reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setTestBusy(false) })
  }
  const editDraft = (update: (current: ImageGenerationSettings) => ImageGenerationSettings): void => {
    setDraft(update)
    setTestResult(undefined)
    setError(undefined)
    setDeleteArmed(false)
  }
  const dirty = profileName.trim() !== activeProfile.name || JSON.stringify(draft) !== JSON.stringify(settings.imageGeneration)
  const selectProfile = (id: string): void => {
    if (dirty) {
      setError('请先保存或还原当前档案，再切换配置')
      return
    }
    const selected = settings.imageProfiles.find(profile => profile.id === id)
    if (selected === undefined) return
    onSave({ ...settings, activeImageProfileId: selected.id, imageGeneration: selected.settings })
  }
  const createProfile = (): void => {
    const profile: ImageGenerationProfile = {
      id: crypto.randomUUID(),
      name: nextImageProfileName(settings.imageProfiles, draft.provider),
      settings: draft,
    }
    onSave({
      ...settings,
      activeImageProfileId: profile.id,
      imageGeneration: profile.settings,
      imageProfiles: [...settings.imageProfiles, profile],
    })
  }
  const saveProfile = (): void => {
    const name = profileName.trim()
    if (name === '') {
      setError('配置名称不能为空')
      return
    }
    if (settings.imageProfiles.some(profile => profile.id !== activeProfile.id
      && profile.name.toLowerCase() === name.toLowerCase())) {
      setError('已有同名的图片配置')
      return
    }
    onSave({
      ...settings,
      imageGeneration: draft,
      imageProfiles: settings.imageProfiles.map(profile => profile.id === activeProfile.id
        ? { ...profile, name, settings: draft } : profile),
    })
  }
  const deleteProfile = (): void => {
    if (settings.imageProfiles.length <= 1) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    const remaining = settings.imageProfiles.filter(profile => profile.id !== activeProfile.id)
    const selected = remaining[0]!
    onSave({
      ...settings,
      activeImageProfileId: selected.id,
      imageGeneration: selected.settings,
      imageProfiles: remaining,
    })
  }
  const restoreProfile = (): void => {
    setDraft(settings.imageGeneration)
    setProfileName(activeProfile.name)
    setTestResult(undefined)
    setError(undefined)
    setDeleteArmed(false)
  }
  const labelStyle = { display: 'grid', fontSize: '12px', gap: '6px', opacity: writable ? 1 : .62 } as const
  return <section style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #34343a)', marginTop: '28px', paddingTop: '24px' }}>
    <h3 style={{ fontSize: '15px', margin: 0 }}>聊天插图</h3>
    <p style={{ fontSize: '12px', lineHeight: 1.6, margin: '7px 0 16px', opacity: .58 }}>
      只在你点“绘图”后调用；图片保存在本机，不会作为图片输入送进角色模型
    </p>
    <div style={{ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: '9px', marginBottom: '15px' }}>
      <label style={{ ...labelStyle, flex: '1 1 190px' }}>配置档案
        <select aria-label="配置档案" value={activeProfile.id} disabled={!writable} onChange={event => {
          selectProfile(event.target.value)
        }} style={settingsFieldStyle}>
          {settings.imageProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>
      <label style={{ ...labelStyle, flex: '1 1 190px' }}>配置名称
        <input aria-label="配置名称" value={profileName} disabled={!writable} maxLength={80} onChange={event => {
          setProfileName(event.target.value)
          setError(undefined)
          setDeleteArmed(false)
        }} style={settingsFieldStyle} />
      </label>
      <div style={{ display: 'flex', gap: '7px' }}>
        <button type="button" disabled={!writable} onClick={createProfile} style={secondaryButtonStyle}>新建副本</button>
        <button type="button" disabled={!writable || settings.imageProfiles.length <= 1}
          onClick={deleteProfile} style={secondaryButtonStyle}>{deleteArmed ? '确认删除' : '删除'}</button>
      </div>
    </div>
    <label style={labelStyle}>图片服务
      <select value={draft.provider} disabled={!writable || credentialBusy} onChange={event => {
        editDraft(current => ({ ...current, provider: event.target.value as ImageGenerationSettings['provider'] }))
      }} style={settingsFieldStyle}>
        <option value="openai">OpenAI Images / 兼容接口</option>
        <option value="dashscope">阿里云百炼 / 千问图片</option>
        <option value="novelai">NovelAI V4.5</option>
        <option value="a1111">A1111 / Forge</option>
        <option value="comfyui">ComfyUI</option>
      </select>
    </label>
    {draft.provider === 'openai' ? <div style={{ display: 'grid', gap: '11px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginTop: '12px' }}>
      <label style={labelStyle}>接口地址
        <input value={draft.openai.endpoint} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, openai: { ...current.openai, endpoint: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      <label style={labelStyle}>模型
        <input value={draft.openai.model} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, openai: { ...current.openai, model: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>尺寸
        <select value={draft.openai.size} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, openai: {
            ...current.openai, size: event.target.value as ImageGenerationSettings['openai']['size'],
          } }))
        }} style={settingsFieldStyle}>
          <option value="1024x1024">1024 × 1024</option>
          <option value="1024x1536">1024 × 1536（竖图）</option>
          <option value="1536x1024">1536 × 1024（横图）</option>
        </select>
      </label>
    </div> : draft.provider === 'dashscope' ? <div style={{ display: 'grid', gap: '11px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginTop: '12px' }}>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>同步接口地址
        <input value={draft.dashscope.endpoint} disabled={!writable}
          placeholder="https://你的业务空间ID.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
          onChange={event => {
            editDraft(current => ({ ...current, dashscope: { ...current.dashscope, endpoint: event.target.value } }))
          }} style={settingsFieldStyle} />
      </label>
      <label style={labelStyle}>模型
        <select value={draft.dashscope.model} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, dashscope: {
            ...current.dashscope,
            model: event.target.value as ImageGenerationSettings['dashscope']['model'],
          } }))
        }} style={settingsFieldStyle}>
          <option value="qwen-image-3.0">千问图片 3.0</option>
          <option value="qwen-image-3.0-pro">千问图片 3.0 Pro</option>
        </select>
      </label>
      <label style={labelStyle}>尺寸
        <select value={draft.dashscope.size} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, dashscope: {
            ...current.dashscope,
            size: event.target.value as ImageGenerationSettings['dashscope']['size'],
          } }))
        }} style={settingsFieldStyle}>
          <option value="auto">自动</option>
          <option value="1024*1024">1024 × 1024（方形）</option>
          <option value="1024*1536">1024 × 1536（竖图）</option>
          <option value="1536*1024">1536 × 1024（横图）</option>
        </select>
      </label>
      <label style={labelStyle}>提示词扩写方式
        <select value={draft.dashscope.promptExtendMode} disabled={!writable || !draft.dashscope.promptExtend}
          onChange={event => {
            editDraft(current => ({ ...current, dashscope: {
              ...current.dashscope,
              promptExtendMode: event.target.value as ImageGenerationSettings['dashscope']['promptExtendMode'],
            } }))
          }} style={settingsFieldStyle}>
          <option value="direct">直接扩写（更快）</option>
          <option value="agent">智能扩写（更充分）</option>
        </select>
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>默认负面提示词（可留空）
        <textarea value={draft.dashscope.negativePrompt} disabled={!writable} rows={3} onChange={event => {
          editDraft(current => ({ ...current, dashscope: { ...current.dashscope, negativePrompt: event.target.value } }))
        }} style={{ ...settingsFieldStyle, resize: 'vertical' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 18px', gridColumn: '1 / -1' }}>
        {([['提示词扩写', 'promptExtend'], ['思考模式', 'enableThinking'], ['添加水印', 'watermark']] as const)
          .map(([label, field]) => <label key={field}
            style={{ alignItems: 'center', display: 'flex', fontSize: '12px', gap: '7px' }}>
            <input type="checkbox" checked={draft.dashscope[field]} disabled={!writable} onChange={event => {
              editDraft(current => ({ ...current, dashscope: { ...current.dashscope, [field]: event.target.checked } }))
            }} />{label}
          </label>)}
      </div>
      <p style={{ fontSize: '11px', gridColumn: '1 / -1', lineHeight: 1.6, margin: '-2px 0 0', opacity: .58 }}>
        接口地址、API Key 和模型必须属于同一地域。推荐从百炼业务空间复制专属接口；生成结果会立即保存到本机，
        不依赖百炼仅保留 24 小时的临时图片链接。
      </p>
    </div> : draft.provider === 'novelai' ? <div style={{ display: 'grid', gap: '11px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginTop: '12px' }}>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>NovelAI 图片接口
        <input value={draft.novelai.endpoint} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, novelai: { ...current.novelai, endpoint: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>V4.5 模型
        <select value={draft.novelai.model} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, novelai: {
            ...current.novelai,
            model: event.target.value as ImageGenerationSettings['novelai']['model'],
          } }))
        }} style={settingsFieldStyle}>
          <option value="nai-diffusion-4-5-full">V4.5 Full</option>
          <option value="nai-diffusion-4-5-curated">V4.5 Curated</option>
        </select>
      </label>
      {([['宽度', 'width'], ['高度', 'height'], ['步数', 'steps'], ['引导强度', 'scale'], ['CFG Rescale', 'cfgRescale']] as const)
        .map(([label, field]) => <label key={field} style={labelStyle}>{label}
          <input type="number" value={draft.novelai[field]} disabled={!writable}
            step={field === 'scale' || field === 'cfgRescale' ? .01 : 1} onChange={event => {
              editDraft(current => ({ ...current, novelai: { ...current.novelai, [field]: Number(event.target.value) } }))
            }} style={settingsFieldStyle} />
        </label>)}
      <label style={labelStyle}>采样器
        <select value={draft.novelai.sampler} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, novelai: { ...current.novelai, sampler: event.target.value } }))
        }} style={settingsFieldStyle}>
          <option value="k_euler">Euler</option>
          <option value="k_euler_ancestral">Euler Ancestral</option>
          <option value="k_dpmpp_2m">DPM++ 2M</option>
          <option value="k_dpmpp_sde">DPM++ SDE</option>
        </select>
      </label>
      <label style={labelStyle}>噪声调度
        <select value={draft.novelai.noiseSchedule} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, novelai: { ...current.novelai, noiseSchedule: event.target.value } }))
        }} style={settingsFieldStyle}>
          <option value="karras">Karras</option>
          <option value="native">Native</option>
          <option value="exponential">Exponential</option>
          <option value="polyexponential">Polyexponential</option>
        </select>
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>默认负面提示词
        <textarea value={draft.novelai.negativePrompt} disabled={!writable} rows={3} onChange={event => {
          editDraft(current => ({ ...current, novelai: { ...current.novelai, negativePrompt: event.target.value } }))
        }} style={{ ...settingsFieldStyle, resize: 'vertical' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 18px', gridColumn: '1 / -1' }}>
        {([['质量增强', 'quality'], ['SMEA', 'smea'], ['SMEA DYN', 'smeaDyn']] as const).map(([label, field]) => <label
          key={field} style={{ alignItems: 'center', display: 'flex', fontSize: '12px', gap: '7px' }}>
          <input type="checkbox" checked={draft.novelai[field]} disabled={!writable || (field === 'smeaDyn' && !draft.novelai.smea)}
            onChange={event => {
              editDraft(current => ({ ...current, novelai: { ...current.novelai, [field]: event.target.checked } }))
            }} />{label}
        </label>)}
      </div>
      <p style={{ fontSize: '11px', gridColumn: '1 / -1', lineHeight: 1.6, margin: '-2px 0 0', opacity: .58 }}>
        当前接入 V4.5 文生图；每次绘图会按 NovelAI 规则消耗 Anlas，暂不包含 Vibe Transfer、角色参考与局部重绘。
      </p>
    </div> : draft.provider === 'a1111' ? <div style={{ display: 'grid', gap: '11px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginTop: '12px' }}>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>接口地址
        <input value={draft.a1111.endpoint} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, a1111: { ...current.a1111, endpoint: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>模型（留空使用 WebUI 当前模型）
        <input value={draft.a1111.model} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, a1111: { ...current.a1111, model: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      {([['宽度', 'width'], ['高度', 'height'], ['步数', 'steps'], ['CFG', 'cfgScale']] as const).map(([label, field]) => <label key={field} style={labelStyle}>{label}
        <input type="number" value={draft.a1111[field]} disabled={!writable} onChange={event => {
          const value = Number(event.target.value)
          editDraft(current => ({ ...current, a1111: { ...current.a1111, [field]: value } }))
        }} style={settingsFieldStyle} />
      </label>)}
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>采样器
        <input value={draft.a1111.sampler} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, a1111: { ...current.a1111, sampler: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>默认负面提示词
        <textarea value={draft.a1111.negativePrompt} disabled={!writable} rows={3} onChange={event => {
          editDraft(current => ({ ...current, a1111: { ...current.a1111, negativePrompt: event.target.value } }))
        }} style={{ ...settingsFieldStyle, resize: 'vertical' }} />
      </label>
    </div> : <div style={{ display: 'grid', gap: '11px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginTop: '12px' }}>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>ComfyUI 服务地址
        <input value={draft.comfyui.endpoint} disabled={!writable} placeholder="http://127.0.0.1:8188" onChange={event => {
          editDraft(current => ({ ...current, comfyui: { ...current.comfyui, endpoint: event.target.value } }))
        }} style={settingsFieldStyle} />
      </label>
      {([['宽度', 'width'], ['高度', 'height']] as const).map(([label, field]) => <label key={field} style={labelStyle}>{label}
        <input type="number" value={draft.comfyui[field]} disabled={!writable} onChange={event => {
          editDraft(current => ({ ...current, comfyui: { ...current.comfyui, [field]: Number(event.target.value) } }))
        }} style={settingsFieldStyle} />
      </label>)}
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>默认负面提示词
        <textarea value={draft.comfyui.negativePrompt} disabled={!writable} rows={3} onChange={event => {
          editDraft(current => ({ ...current, comfyui: { ...current.comfyui, negativePrompt: event.target.value } }))
        }} style={{ ...settingsFieldStyle, resize: 'vertical' }} />
      </label>
      <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>API 格式工作流
        <textarea value={draft.comfyui.workflow} disabled={!writable} rows={12} spellCheck={false}
          placeholder={'在 ComfyUI 中打开“开发者模式”，导出 API 格式工作流，再把正向提示词改成 {{prompt}}'}
          onChange={event => {
            editDraft(current => ({ ...current, comfyui: { ...current.comfyui, workflow: event.target.value } }))
          }} style={{ ...settingsFieldStyle, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', resize: 'vertical' }} />
      </label>
      <p style={{ fontSize: '11px', gridColumn: '1 / -1', lineHeight: 1.6, margin: '-3px 0 0', opacity: .58 }}>
        必填：{'{{prompt}}'}。可选：{'{{negative_prompt}}'}、{'{{width}}'}、{'{{height}}'}、{'{{seed}}'}。
        插件会保留节点和连线，只替换这些占位符。
      </p>
    </div>}
    <div style={{ alignItems: 'end', display: 'grid', gap: '9px', gridTemplateColumns: 'minmax(0, 1fr) auto', marginTop: '15px' }}>
      <label style={labelStyle}>{draft.provider === 'dashscope' ? '百炼 API Key'
        : draft.provider === 'novelai' ? 'NovelAI Access Token' : '服务密钥'}（按图片服务独立保存）
        <input type="password" autoComplete="new-password" value={credentialValue}
          placeholder={credentialPhase === 'loading' ? '正在确认密钥状态…'
            : credentialPhase === 'unknown' ? '密钥状态暂时无法确认'
              : credential?.configured === true ? `已配置${credential.source === undefined ? '' : ` · ${credential.source}`}`
            : draft.provider === 'openai' ? 'OpenAI / 兼容接口密钥'
              : draft.provider === 'dashscope' ? '与接口地址相同地域的百炼 API Key'
                : draft.provider === 'novelai' ? 'NovelAI Access Token（必填）' : '无鉴权可留空'}
          disabled={credentialBusy || credentialPhase !== 'ready' || credential?.writable === false}
          onChange={event => { setCredentialValue(event.target.value); setError(undefined) }}
          style={settingsFieldStyle} />
      </label>
      <div style={{ display: 'flex', gap: '7px' }}>
        {credentialPhase === 'unknown' && <button type="button" disabled={credentialBusy}
          onClick={() => { setCredentialReload(value => value + 1) }} style={secondaryButtonStyle}>重试状态</button>}
        {credential?.configured === true && <button type="button" disabled={credentialBusy || !credential.writable}
          onClick={() => { saveCredential({ clear: true }) }} style={secondaryButtonStyle}>移除密钥</button>}
        <button type="button" disabled={credentialBusy || credentialPhase !== 'ready'
          || credentialValue.trim() === '' || credential?.writable === false}
          onClick={() => { saveCredential({ value: credentialValue }) }} style={secondaryButtonStyle}>
          {credentialBusy ? '正在保存…' : credential?.configured === true ? '更换密钥' : '保存密钥'}
        </button>
      </div>
    </div>
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
      <button type="button" disabled={!writable || testBusy
        || ((draft.provider === 'openai' || draft.provider === 'dashscope' || draft.provider === 'novelai')
          && (credentialPhase !== 'ready' || credential?.configured !== true))}
        onClick={testConnection} style={secondaryButtonStyle}>{testBusy ? '正在测试…' : '测试连接'}</button>
      {dirty && <button type="button" disabled={!writable} onClick={restoreProfile} style={secondaryButtonStyle}>还原</button>}
      <button type="button" disabled={!writable || !dirty} onClick={saveProfile} style={primaryButtonStyle}>保存当前档案</button>
    </div>
    {testResult !== undefined && <p role="status" style={{
      color: testResult.status === 'verified' ? 'var(--dsw-alias-state-success, #5dbb84)' : 'var(--dsw-alias-state-warning, #d6a955)',
      fontSize: '12px', margin: '10px 0 0',
    }}>{testResult.detail}</p>}
    {error !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '12px', margin: '10px 0 0' }}>{error}</p>}
  </section>
}

type ToolStrategyDraft = {
  enabled: boolean
  includeFramework: boolean
  includeAgentRp: boolean
  imageMode: AgentRpSettings['toolGuidance']['imageMode']
  custom: Array<{ id: string; enabled: boolean; text: string }>
}

function TurnWorkerSettingsPanel({ settings, writable, onSave, loadModelCatalog }: {
  readonly settings: AgentRpSettings
  readonly writable: boolean
  readonly onSave: (settings: AgentRpSettings) => void
  readonly loadModelCatalog: () => Promise<AvailableModelCatalog>
}) {
  const enabled = settings.turnWorkers.narrativeReview.enabled
  const selectedModel = settings.turnWorkers.stateVerification.model
  const selectedReasoningEffort = settings.turnWorkers.stateVerification.reasoningEffort
  const [modelCatalog, setModelCatalog] = useState<AvailableModelCatalog>()
  const [modelCatalogError, setModelCatalogError] = useState<string>()
  useEffect(() => {
    let active = true
    setModelCatalogError(undefined)
    void loadModelCatalog().then(value => {
      if (active) setModelCatalog(value)
    }).catch((reason: unknown) => {
      if (active) setModelCatalogError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [loadModelCatalog])
  const modelOptions = (modelCatalog?.groups ?? []).flatMap(group => group.models.map(model => ({
    provider: group.id,
    model: model.id,
    label: `${group.name} · ${model.name}`,
    value: JSON.stringify([group.id, model.id]),
  })))
  const selectedValue = selectedModel === null ? '' : JSON.stringify([selectedModel.provider, selectedModel.model])
  const savedModelIsListed = selectedModel === null || modelOptions.some(option => option.value === selectedValue)
  const resolvedReasoning = resolveStateVerificationReasoningChoices(
    modelCatalog,
    selectedModel,
    selectedReasoningEffort,
  )
  const defaultEffort = resolvedReasoning.reasoning?.defaultEffort
  const defaultEffortName = resolvedReasoning.reasoning?.efforts
    .find(effort => effort.id === defaultEffort)?.name
  return <section style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #34343a)', marginTop: '26px', paddingTop: '23px' }}>
    <div style={{ alignItems: 'flex-start', display: 'flex', gap: '14px', justifyContent: 'space-between' }}>
      <div>
        <h3 style={{ fontSize: '15px', margin: 0 }}>多 Agent 回合</h3>
        <p style={{ fontSize: '12px', lineHeight: 1.65, margin: '6px 0 0', opacity: .58 }}>
          角色 Agent、正文审阅 Worker 与状态结算 Worker 使用彼此隔离的请求，按固定顺序完成一轮
        </p>
      </div>
      <label style={{ alignItems: 'center', cursor: writable ? 'pointer' : 'default', display: 'flex', flex: '0 0 auto', fontSize: '12px', gap: '7px', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={enabled} disabled={!writable} onChange={event => {
          onSave({
            ...settings,
            turnWorkers: {
              ...settings.turnWorkers,
              narrativeReview: { enabled: event.target.checked },
            },
          })
        }} />正文审阅
      </label>
    </div>
    <label style={{ display: 'grid', fontSize: '12px', gap: '6px', marginTop: '14px', opacity: writable ? 1 : .62 }}>状态核验模型
      <select value={selectedValue} disabled={!writable || modelCatalog === undefined} onChange={event => {
        const option = modelOptions.find(candidate => candidate.value === event.target.value)
        if (event.target.value !== '' && option === undefined) return
        onSave({
          ...settings,
          turnWorkers: {
            ...settings.turnWorkers,
            stateVerification: updateStateVerificationSettings(settings.turnWorkers.stateVerification, {
              type: 'model',
              model: option === undefined ? null : { provider: option.provider, model: option.model },
            }, modelCatalog?.current),
          },
        })
      }} style={settingsFieldStyle}>
        <option value="">跟随当前会话模型</option>
        {!savedModelIsListed && selectedModel !== null && <option value={selectedValue}>
          {selectedModel.provider} · {selectedModel.model}（当前不可用）
        </option>}
        {modelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '7px 0 0', opacity: .56 }}>
      该设置只改变独立核验请求；候选结算和角色正文仍使用当前会话模型。选择更快的模型可以缩短有状态回合。状态核验模型不可用时，状态结算 Worker 会保留原状态并写入失败记录。
    </p>
    <label style={{ display: 'grid', fontSize: '12px', gap: '6px', marginTop: '14px', opacity: writable ? 1 : .62 }}>状态核验推理强度
      <select value={selectedReasoningEffort ?? ''} disabled={!writable || modelCatalog === undefined} onChange={event => {
        const reasoningEffort = event.target.value === '' ? null : event.target.value
        const choice = resolvedReasoning.choices.find(candidate => candidate.id === reasoningEffort)
        if (choice?.supported !== true) return
        onSave({
          ...settings,
          turnWorkers: {
            ...settings.turnWorkers,
            stateVerification: updateStateVerificationSettings(settings.turnWorkers.stateVerification, {
              type: 'reasoning-effort',
              reasoningEffort,
            }),
          },
        })
      }} style={settingsFieldStyle}>
        {resolvedReasoning.choices.map((choice) => {
          const effort = choice.id === null
            ? undefined
            : resolvedReasoning.reasoning?.efforts.find(candidate => candidate.id === choice.id)
          const label = choice.id === null
            ? `模型默认${defaultEffort === undefined
              ? ''
              : ` · ${defaultEffortName ?? defaultEffort}（${defaultEffort}）`}`
            : choice.supported
              ? `${effort?.name ?? choice.id} · ${choice.id}`
              : `${choice.id}（当前生效的状态核验模型不支持）`
          return <option key={choice.id ?? 'model-default'} value={choice.id ?? ''} disabled={!choice.supported}>
            {label}
          </option>
        })}
      </select>
    </label>
    <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '7px 0 0', opacity: .56 }}>
      可选强度来自当前生效的状态核验模型。未显式选择状态核验模型时，当前会话模型生效。选择“模型默认”时，独立核验请求不发送 reasoningEffort。玩家修改状态核验模型选择，并且修改前后的生效提供方或模型不同时，推理强度会重置为模型默认；跟随当前会话模型时，会话模型变化不会改写这里保存的推理强度。
    </p>
    {modelCatalog === undefined && modelCatalogError === undefined && <p role="status" style={{ fontSize: '11px', margin: '7px 0 0', opacity: .5 }}>正在读取当前会话可用模型…</p>}
    {modelCatalogError !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-warning, #d6a955)', fontSize: '11px', margin: '7px 0 0' }}>
      暂时无法读取模型列表：{modelCatalogError}
    </p>}
    <div style={{ display: 'grid', gap: '8px', marginTop: '14px' }}>
      {[
        ['1', '角色 Agent · 正文', '使用角色卡、世界书与所选预设完成剧情和工具行动'],
        ['2', '正文审阅 Worker', enabled
          ? '已启用：只审表达，不重新注入酒馆预设；原文与审阅版都可切换'
          : '已关闭：不会产生额外模型请求，可随时启用'],
        ['3', '状态结算 Worker', 'Agent 模式存在结构化状态时自动运行，只读取最终可见正文'],
      ].map(([index, title, detail]) => <div key={index} style={{
        alignItems: 'flex-start', border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '10px',
        display: 'grid', gap: '9px', gridTemplateColumns: '22px minmax(0, 1fr)', padding: '10px 11px',
      }}>
        <span aria-hidden="true" style={{ alignItems: 'center', background: `color-mix(in srgb, ${color} 15%, transparent)`, borderRadius: '999px', color, display: 'flex', fontSize: '11px', height: '22px', justifyContent: 'center' }}>{index}</span>
        <span><strong style={{ display: 'block', fontSize: '12px', fontWeight: 620 }}>{title}</strong>
          <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '3px', opacity: .55 }}>{detail}</span></span>
      </div>)}
    </div>
    {enabled && <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '9px 0 0', opacity: .56 }}>
      每个 Agent 回合会增加一次轻量模型请求；失败时保留角色 Agent 原文并继续后台结算
    </p>}
  </section>
}

function copyToolStrategy(value: AgentRpSettings['toolGuidance']): ToolStrategyDraft {
  return { ...value, custom: value.custom.map(entry => ({ ...entry })) }
}

function nextToolStrategyId(entries: readonly { readonly id: string }[]): string {
  const ids = new Set(entries.map(entry => entry.id.trim().toLowerCase()))
  for (let suffix = 1; ; suffix++) {
    if (!ids.has(`provider-${suffix}`)) return `provider-${suffix}`
  }
}

function ToolStrategySettingsPanel({ settings, writable, onSave }: {
  readonly settings: AgentRpSettings
  readonly writable: boolean
  readonly onSave: (settings: AgentRpSettings) => void
}) {
  const [draft, setDraft] = useState<ToolStrategyDraft>(() => copyToolStrategy(settings.toolGuidance))
  useEffect(() => { setDraft(copyToolStrategy(settings.toolGuidance)) }, [settings.toolGuidance])
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.toolGuidance)
  const ids = draft.custom.map(entry => entry.id.trim())
  const validationError = draft.custom.some(entry => entry.id.trim() === '')
    ? '提供方 ID 不能为空'
    : draft.custom.some(entry => entry.text.trim() === '')
      ? '提供方说明不能为空'
      : new Set(ids).size !== ids.length ? '提供方 ID 不能重复' : undefined
  const mode = draft.includeAgentRp ? draft.imageMode : 'never'
  const modes = [
    { value: 'never', title: '关闭插图', detail: '不向 Agent 提供图片发布能力' },
    { value: 'requested', title: '仅在明确要求时', detail: '玩家本轮提出图片请求才使用' },
    { value: 'auto', title: '按场景判断', detail: '需要插图时由 Agent 自主决定' },
    { value: 'always', title: '每回合尝试', detail: '已配置生图工具时至多尝试一次' },
  ] as const
  const save = (): void => {
    if (validationError !== undefined) return
    onSave({
      ...settings,
      toolGuidance: {
        ...draft,
        custom: draft.custom.map(entry => ({ ...entry, id: entry.id.trim(), text: entry.text.trim() })),
      },
    })
  }
  return <section style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #34343a)', marginTop: '26px', paddingTop: '23px' }}>
    <div style={{ alignItems: 'flex-start', display: 'flex', gap: '14px', justifyContent: 'space-between' }}>
      <div>
        <h3 style={{ fontSize: '15px', margin: 0 }}>Agent 工具策略</h3>
        <p style={{ fontSize: '12px', lineHeight: 1.65, margin: '6px 0 0', opacity: .58 }}>
          决定角色何时使用工具；每次修改从下一回合开始，不改变正在生成的回复
        </p>
      </div>
      <label style={{ alignItems: 'center', cursor: writable ? 'pointer' : 'default', display: 'flex', flex: '0 0 auto', fontSize: '12px', gap: '7px', whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={draft.enabled} disabled={!writable} onChange={event => {
          setDraft(current => ({ ...current, enabled: event.target.checked }))
        }} />启用
      </label>
    </div>
    <div style={{
      display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      marginTop: '14px', opacity: draft.enabled ? 1 : .48,
    }}>
      {modes.map(option => {
        const active = mode === option.value
        return <button key={option.value} type="button" disabled={!writable || !draft.enabled} onClick={() => {
          setDraft(current => ({ ...current, includeAgentRp: true, imageMode: option.value }))
        }} style={{
          background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
          border: `1px solid ${active ? `color-mix(in srgb, ${color} 48%, transparent)` : 'var(--dsw-alias-border-l2, #3d3d43)'}`,
          borderRadius: '10px', color: 'inherit', cursor: writable && draft.enabled ? 'pointer' : 'default',
          minHeight: '74px', padding: '10px 11px', textAlign: 'left', width: '100%',
        }}>
          <strong style={{ display: 'block', fontSize: '12px', fontWeight: 620 }}>{option.title}</strong>
          <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.45, marginTop: '4px', opacity: .55 }}>{option.detail}</span>
        </button>
      })}
    </div>
    {!draft.enabled && <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '9px 0 0', opacity: .56 }}>
      工具策略已停用；Agent RP 的图片发布工具也不会出现在下一次请求中
    </p>}
    <details style={{ border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '10px', marginTop: '13px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 580, padding: '11px 12px' }}>
        第三方工具与兼容设置（高级）
      </summary>
      <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #3d3d43)', padding: '12px' }}>
        <label style={{ alignItems: 'flex-start', cursor: writable ? 'pointer' : 'default', display: 'flex', fontSize: '12px', gap: '8px', lineHeight: 1.5 }}>
          <input type="checkbox" checked={draft.includeFramework} disabled={!writable} onChange={event => {
            setDraft(current => ({ ...current, includeFramework: event.target.checked }))
          }} />
          <span>提供记忆与导入工具的简短使用规则
            <span style={{ display: 'block', fontSize: '11px', marginTop: '2px', opacity: .52 }}>只影响使用时机，不改变 DSH 原有工具权限</span>
          </span>
        </label>
        <div style={{ alignItems: 'center', display: 'flex', gap: '10px', justifyContent: 'space-between', marginTop: '16px' }}>
          <div>
            <strong style={{ display: 'block', fontSize: '12px' }}>工具提供方说明</strong>
            <span style={{ display: 'block', fontSize: '11px', marginTop: '2px', opacity: .52 }}>仅填写某个 MCP 确实需要的特殊调用方法</span>
          </div>
          <button type="button" disabled={!writable || draft.custom.length >= 32} onClick={() => {
            setDraft(current => ({
              ...current,
              custom: [...current.custom, { id: nextToolStrategyId(current.custom), enabled: true, text: '' }],
            }))
          }} style={{ ...secondaryButtonStyle, flex: '0 0 auto', whiteSpace: 'nowrap' }}>添加</button>
        </div>
        <div style={{ display: 'grid', gap: '9px', marginTop: '9px' }}>
          {draft.custom.length === 0 && <p style={{ border: '1px dashed var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '9px', fontSize: '11px', margin: 0, opacity: .5, padding: '12px', textAlign: 'center' }}>
            没有额外说明；工具参数仍以 DSH 实际提供的 schema 为准
          </p>}
          {draft.custom.map((entry, index) => <div key={`${index}:${entry.id}`} style={{ border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '9px', padding: '10px' }}>
            <div style={{ alignItems: 'center', display: 'grid', gap: '8px', gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}>
              <input aria-label={`启用工具提供方说明 ${index + 1}`} type="checkbox" checked={entry.enabled} disabled={!writable} onChange={event => {
                setDraft(current => ({ ...current, custom: current.custom.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item) }))
              }} />
              <input aria-label={`工具提供方 ${index + 1} ID`} value={entry.id} maxLength={80} disabled={!writable} placeholder="例如 comfy-cloud" onChange={event => {
                setDraft(current => ({ ...current, custom: current.custom.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) }))
              }} style={settingsFieldStyle} />
              <button type="button" disabled={!writable} aria-label={`删除工具提供方说明 ${index + 1}`} onClick={() => {
                setDraft(current => ({ ...current, custom: current.custom.filter((_item, itemIndex) => itemIndex !== index) }))
              }} style={{ ...secondaryButtonStyle, whiteSpace: 'nowrap' }}>删除</button>
            </div>
            <textarea aria-label={`工具提供方 ${index + 1} 说明`} value={entry.text} maxLength={12_000} rows={4} disabled={!writable}
              placeholder="只写该工具无法从 schema 得知的必要步骤" onChange={event => {
                setDraft(current => ({ ...current, custom: current.custom.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))
              }} style={{ ...settingsFieldStyle, lineHeight: 1.5, marginTop: '8px', resize: 'vertical', width: '100%' }} />
          </div>)}
        </div>
      </div>
    </details>
    {validationError !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '12px', margin: '9px 0 0' }}>{validationError}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
      {dirty && <button type="button" disabled={!writable} onClick={() => { setDraft(copyToolStrategy(settings.toolGuidance)) }} style={secondaryButtonStyle}>还原</button>}
      <button type="button" disabled={!writable || !dirty || validationError !== undefined} onClick={save} style={primaryButtonStyle}>保存工具策略</button>
    </div>
  </section>
}

function WorkspaceSettingsSection({
  workspaceSettings,
  workspaceList,
  loadModelCatalog,
}: WorkspaceSettingsSectionProps) {
  const snapshot = useSyncExternalStore(
    workspaceSettings.subscribe,
    workspaceSettings.getSnapshot,
    workspaceSettings.getSnapshot,
  )
  const workspaceSnapshot = useSyncExternalStore(
    workspaceList.subscribe,
    workspaceList.getSnapshot,
    workspaceList.getSnapshot,
  )
  const settings = snapshot.value
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const writable = snapshot.status === 'ready' && !saving
  const write = (next: AgentRpSettings): void => {
    setSaving(true)
    setError(undefined)
    void workspaceSettings.set(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setSaving(false) })
  }
  const toggleWorkspace = (workspaceId: string): void => {
    const enabled = allowsAgentRpEntry(settings, workspaceId)
    write(setAgentRpWorkspaceEntry(settings, workspaceId, !enabled))
  }
  const choiceStyle = (active: boolean) => ({
    alignItems: 'center',
    background: active ? `color-mix(in srgb, ${color} 13%, transparent)` : 'transparent',
    border: `1px solid ${active ? `color-mix(in srgb, ${color} 45%, transparent)` : 'var(--dsw-alias-border-l2, #3d3d43)'}`,
    borderRadius: '10px',
    color: 'inherit',
    cursor: writable ? 'pointer' : 'default',
    display: 'flex',
    font: 'inherit',
    gap: '10px',
    padding: '11px 13px',
    textAlign: 'left' as const,
    width: '100%',
  })
  return <section style={{ margin: '0 auto', maxWidth: '720px', padding: '8px 4px 32px' }}>
    <h2 style={{ fontSize: '18px', margin: '0 0 8px' }}>Agent RP 全局设置</h2>
    <p style={{ fontSize: '13px', lineHeight: 1.6, margin: '0 0 22px', opacity: .62 }}>
      这里保留跨工作区规则、身份与图片服务；日常角色入口和当前工作区开关位于侧栏 Agent RP 工作台
    </p>
    <details style={{
      border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '12px', marginBottom: '22px',
    }}>
      <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 620, padding: '13px 14px' }}>
        工作区入口范围（高级）
      </summary>
      <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #3d3d43)', padding: '14px' }}>
        <p style={{ fontSize: '12px', lineHeight: 1.55, margin: '0 0 13px', opacity: .56 }}>
          当前工作区可直接在侧栏工作台切换；这里用于批量管理所有工作区
        </p>
        <div style={{ display: 'grid', gap: '8px' }}>
          <button type="button" disabled={!writable} style={choiceStyle(settings.workspaceMode === 'all')}
            onClick={() => { write({ ...settings, workspaceMode: 'all' }) }}>
            <span aria-hidden="true" style={{ color: settings.workspaceMode === 'all' ? color : 'inherit' }}>
              {settings.workspaceMode === 'all' ? '●' : '○'}
            </span>
            <span><strong style={{ display: 'block', fontSize: '13px' }}>默认全部启用</strong>
              <span style={{ fontSize: '12px', opacity: .55 }}>未来工作区也默认可用，可在下方单独关闭</span></span>
          </button>
          <button type="button" disabled={!writable} style={choiceStyle(settings.workspaceMode === 'selected')}
            onClick={() => { write({ ...settings, workspaceMode: 'selected' }) }}>
            <span aria-hidden="true" style={{ color: settings.workspaceMode === 'selected' ? color : 'inherit' }}>
              {settings.workspaceMode === 'selected' ? '●' : '○'}
            </span>
            <span><strong style={{ display: 'block', fontSize: '13px' }}>仅指定工作区</strong>
              <span style={{ fontSize: '12px', opacity: .55 }}>未来工作区默认关闭，只启用下方勾选项</span></span>
          </button>
        </div>
        <div style={{ marginTop: '18px' }}>
          <h3 style={{ fontSize: '13px', margin: '0 0 9px' }}>工作区</h3>
          {workspaceSnapshot.items.length === 0
            ? <p style={{ fontSize: '12px', margin: 0, opacity: .55 }}>还没有可选的工作区</p>
            : <div style={{ border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '11px', overflow: 'hidden' }}>
              {workspaceSnapshot.items.map((workspace, index) => {
                const checked = allowsAgentRpEntry(settings, workspace.workspaceId)
                return <label key={workspace.workspaceId} style={{
                  alignItems: 'center', borderTop: index === 0 ? 'none' : '1px solid var(--dsw-alias-border-l2, #3d3d43)',
                  cursor: writable ? 'pointer' : 'default', display: 'flex', gap: '11px', padding: '11px 13px',
                }}>
                  <input type="checkbox" checked={checked} disabled={!writable}
                    onChange={() => { toggleWorkspace(workspace.workspaceId) }} />
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '13px', fontWeight: 580 }}>{workspace.title}</strong>
                    <span style={{ display: 'block', fontSize: '11px', marginTop: '2px', opacity: .45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {workspace.path}
                    </span>
                  </span>
                </label>
              })}
            </div>}
          {settings.workspaceMode === 'selected' && settings.workspaceIds.length === 0 && <p style={{
            fontSize: '12px', margin: '10px 0 0', opacity: .58,
          }}>尚未选择工作区，新的角色入口会暂时隐藏</p>}
          {settings.workspaceMode === 'all' && settings.workspaceExcludedIds.length > 0 && <p style={{
            fontSize: '12px', margin: '10px 0 0', opacity: .58,
          }}>{settings.workspaceExcludedIds.length} 个工作区已单独关闭</p>}
        </div>
      </div>
    </details>
    <section style={{
      border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '12px', marginBottom: '22px',
      padding: '14px',
    }}>
      <h3 style={{ fontSize: '13px', margin: '0 0 7px' }}>轻前端资源</h3>
      <label style={{ display: 'grid', fontSize: '12px', gap: '7px', lineHeight: 1.55 }}>
        <span>保持交互的最近消息数</span>
        <select value={settings.lightFrontend.renderDepth} disabled={!writable} onChange={event => {
          write({ ...settings, lightFrontend: { renderDepth: Number(event.target.value) } })
        }} style={{ ...settingsFieldStyle, maxWidth: '220px' }}>
          {[...new Set([4, 8, 12, 24, 48, settings.lightFrontend.renderDepth])]
            .sort((left, right) => left - right)
            .map(value => <option key={value} value={value}>最近 {value} 条消息</option>)}
        </select>
        <span style={{ opacity: .56 }}>
          较早消息仍保留正文，但停止运行其中的交互界面。保留的每个界面仍能同步读取从开场到所属消息的完整历史。
        </span>
      </label>
    </section>
    <section style={{
      border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '12px', marginBottom: '22px',
      padding: '14px',
    }}>
      <h3 style={{ fontSize: '13px', margin: '0 0 7px' }}>诊断 Debug</h3>
      <label style={{
        alignItems: 'flex-start', cursor: writable ? 'pointer' : 'default', display: 'flex', gap: '10px',
      }}>
        <input type="checkbox" checked={settings.debug.enabled} disabled={!writable} onChange={event => {
          write({ ...settings, debug: { enabled: event.target.checked } })
        }} />
        <span>
          <strong style={{ display: 'block', fontSize: '13px', fontWeight: 580 }}>
            在诊断复制中包含详细错误信息
          </strong>
          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.55, marginTop: '3px', opacity: .56 }}>
            开启后，“复制诊断”会包含失败脚本和世界书错误，世界书“复制失败详情”还会包含有长度上限的 EJS 错误名称、消息和调用栈。错误消息可能包含模板运行时值；截断会在报告中明确标记。诊断不会自动上传。
          </span>
        </span>
      </label>
    </section>
    <NativeIdentitySettingsPanel />
    <TurnWorkerSettingsPanel settings={settings} writable={writable} onSave={write} loadModelCatalog={loadModelCatalog} />
    <ToolStrategySettingsPanel settings={settings} writable={writable} onSave={write} />
    <ImageGenerationSettingsPanel settings={settings} writable={writable} onSave={write} />
    {snapshot.status === 'loading' && <p role="status" style={{ fontSize: '12px', marginTop: '14px', opacity: .55 }}>正在读取设置…</p>}
    {snapshot.status === 'error' && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '12px', marginTop: '14px' }}>{snapshot.error}</p>}
    {error !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '12px', marginTop: '14px' }}>{error}</p>}
  </section>
}

const RP_DISTRIBUTION_TARGET_KEY = 'dsh-agent-rp.distribution-target'

function initialRpDistributionTarget(): string {
  try {
    return window.localStorage.getItem(RP_DISTRIBUTION_TARGET_KEY) ?? 'http://127.0.0.1:3092'
  } catch {
    return 'http://127.0.0.1:3092'
  }
}

function validRpDistributionRemoteAssets(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const assets = value as Record<string, unknown>
  return ['characters', 'presets', 'personas', 'worldInfos'].every((key) => {
    const entries = assets[key]
    return Array.isArray(entries) && entries.every(entry => typeof entry === 'object' && entry !== null
      && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).id === 'string'
      && typeof (entry as Record<string, unknown>).name === 'string')
  })
}

function RpDistributionBridgeSection({
  listCharacters,
  listPresets,
  listPersonas,
  listWorldInfos,
  probe,
  transfer,
  receive,
}: RpDistributionBridgeSectionProps) {
  const [target, setTarget] = useState(initialRpDistributionTarget)
  const [connected, setConnected] = useState<RpDistributionProbeResponse>()
  const [characters, setCharacters] = useState<readonly CharacterLibrarySummary[]>([])
  const [presets, setPresets] = useState<readonly PresetLibrarySummary[]>([])
  const [personas, setPersonas] = useState<readonly PersonaLibraryEntry[]>([])
  const [worldInfos, setWorldInfos] = useState<readonly WorldInfoLibraryUpload[]>([])
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const connect = (): void => {
    setBusy('probe')
    setError(undefined)
    setNotice(undefined)
    void Promise.all([
      probe(target),
      Promise.all([listCharacters('active'), listCharacters('archived')]).then(([active, archived]) => [...active, ...archived]),
      listPresets(),
      listPersonas(),
      listWorldInfos(),
    ]).then(([result, nextCharacters, nextPresets, nextPersonas, nextWorldInfos]) => {
      setConnected(result)
      setCharacters(nextCharacters)
      setPresets(nextPresets)
      setPersonas(nextPersonas)
      setWorldInfos(nextWorldInfos)
      setTarget(result.target)
      try { window.localStorage.setItem(RP_DISTRIBUTION_TARGET_KEY, result.target) } catch {}
      setNotice(`已连接：${result.experienceCount} 个体验，${result.capabilityCount} 项能力`)
    }).catch((reason: unknown) => {
      setConnected(undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(undefined) })
  }
  const copy = (kind: RpDistributionAssetKind, id: string, label: string): void => {
    if (connected === undefined) return
    const key = `${kind}:${id}`
    setBusy(key)
    setError(undefined)
    setNotice(undefined)
    void transfer(connected.target, kind, id).then((result) => {
      setNotice(result.compatibilityDifferenceCount === 0
        ? `已复制「${label}」，对方未报告兼容差异`
        : `已复制「${label}」，对方记录了 ${result.compatibilityDifferenceCount} 项兼容差异`)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(undefined) })
  }
  const copyBack = (kind: RpDistributionAssetKind, id: string, label: string): void => {
    if (connected === undefined) return
    const key = `back:${kind}:${id}`
    setBusy(key)
    setError(undefined)
    setNotice(undefined)
    void receive(connected.target, kind, id).then(async (result) => {
      const [nextCharacters, nextPresets, nextPersonas, nextWorldInfos] = await Promise.all([
        Promise.all([listCharacters('active'), listCharacters('archived')]).then(([active, archived]) => [...active, ...archived]),
        listPresets(),
        listPersonas(),
        listWorldInfos(),
      ])
      setCharacters(nextCharacters)
      setPresets(nextPresets)
      setPersonas(nextPersonas)
      setWorldInfos(nextWorldInfos)
      setNotice(`已把「${result.name || label}」复制到 Agent RP`)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(undefined) })
  }
  const group = (
    title: string,
    kind: RpDistributionAssetKind,
    entries: readonly { readonly id: string; readonly name: string }[],
    direction: 'out' | 'back',
  ): JSX.Element => <div style={{ marginTop: '20px' }}>
    <h3 style={{ fontSize: '13px', margin: '0 0 8px' }}>{title}<span style={{ fontWeight: 400, marginLeft: '6px', opacity: .45 }}>{entries.length}</span></h3>
    {entries.length === 0
      ? <p style={{ fontSize: '12px', margin: 0, opacity: .5 }}>
          {direction === 'out' ? 'Agent RP 中还没有可复制的内容' : '模块化 RP 中还没有可复制的内容'}
        </p>
      : <div style={{ border: '1px solid var(--dsw-alias-border-l2, #3d3d43)', borderRadius: '10px', overflow: 'hidden' }}>
        {entries.map((entry, index) => {
          const key = direction === 'out' ? `${kind}:${entry.id}` : `back:${kind}:${entry.id}`
          return <div key={key} style={{
            alignItems: 'center', borderTop: index === 0 ? 'none' : '1px solid var(--dsw-alias-border-l2, #3d3d43)',
            display: 'flex', gap: '12px', padding: '9px 11px',
          }}>
            <span style={{ flex: '1 1 auto', fontSize: '13px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            <button type="button" disabled={busy !== undefined} onClick={() => {
              if (direction === 'out') copy(kind, entry.id, entry.name)
              else copyBack(kind, entry.id, entry.name)
            }} style={{
              background: `color-mix(in srgb, ${color} 11%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`, borderRadius: '7px',
              color: 'inherit', cursor: busy === undefined ? 'pointer' : 'default', font: 'inherit', fontSize: '12px', padding: '5px 9px',
            }}>{busy === key ? '正在复制…' : direction === 'out' ? '复制过去' : '复制回来'}</button>
          </div>
        })}
      </div>}
  </div>
  return <section style={{ margin: '0 auto', maxWidth: '720px', padding: '8px 4px 32px' }}>
    <h2 style={{ fontSize: '18px', margin: '0 0 8px' }}>RP 互通</h2>
    <p style={{ fontSize: '13px', lineHeight: 1.65, margin: '0 0 18px', opacity: .62 }}>
      实验性可选工具：需要在这台电脑上另行安装并启动 <a href="https://github.com/yhny1001/dsh-rp-distribution"
        target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>dsh-rp-distribution</a>。它用于在两套 RP
      运行时之间复制角色卡、预设、Persona、世界书或迁移会话；普通游玩和 Tavern Helper 均不需要它。复制不会修改来源库或现有会话
    </p>
    <div style={{ alignItems: 'end', display: 'grid', gap: '8px', gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
      <label style={{ display: 'grid', fontSize: '12px', gap: '6px' }}>
        模块化 RP 地址
        <input value={target} onChange={event => { setTarget(event.target.value); setConnected(undefined) }}
          placeholder="http://127.0.0.1:3092" style={settingsFieldStyle} />
      </label>
      <button type="button" disabled={busy !== undefined || target.trim() === ''} onClick={connect} style={{
        background: `color-mix(in srgb, ${color} 13%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        borderRadius: '8px', color: 'inherit', cursor: busy === undefined ? 'pointer' : 'default', font: 'inherit', fontSize: '12px', padding: '8px 12px',
      }}>{busy === 'probe' ? '正在连接…' : connected === undefined ? '连接' : '刷新'}</button>
    </div>
    <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '8px 0 0', opacity: .48 }}>
      为避免意外发送角色资料，只接受 localhost、127.0.0.1 或 ::1 地址
    </p>
    {notice !== undefined && <p role="status" style={{ color: 'var(--dsw-alias-state-success, #4fba83)', fontSize: '12px', margin: '13px 0 0' }}>{notice}</p>}
    {error !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '12px', margin: '13px 0 0' }}>{error}</p>}
    {connected !== undefined && <>
      <h3 style={{ fontSize: '14px', margin: '24px 0 0' }}>Agent RP → 模块化 RP</h3>
      {group('角色卡', 'character', characters.map(entry => ({ id: entry.id, name: entry.displayName })), 'out')}
      {group('预设', 'preset', presets, 'out')}
      {group('Persona', 'persona', personas, 'out')}
      {group('世界书', 'world-info', worldInfos, 'out')}
      <h3 style={{ fontSize: '14px', margin: '28px 0 0' }}>模块化 RP → Agent RP</h3>
      {group('角色卡', 'character', connected.remoteAssets.characters, 'back')}
      {group('预设', 'preset', connected.remoteAssets.presets, 'back')}
      {group('Persona', 'persona', connected.remoteAssets.personas, 'back')}
      {group('世界书', 'world-info', connected.remoteAssets.worldInfos, 'back')}
    </>}
  </section>
}

function RoleplayHeader({
  sessionId, useProjection, useSessions, loadAvatar, renameSession, configurePreset, importPresetFile, importPreset, managePresetLibrary,
  configureWorldInfo, importWorldInfo, attachWorldInfo,
  listCharacters, readCharacter, setCharacterArchived, importCharacterFile, listWorldInfos,
  prepareChatMigration, prepareRpDistributionChatMigration, launchPreparedChatMigration,
  startCharacterSession, exportChat,
  listMemory, manageMemory, manageState, manageTurnMode,
  listPresets, listPersonas, savePersona, deletePersona, applyPersona, loadModelCapabilities, runtimeDiagnostics,
  workspaceSettings,
}: HeaderProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const projected = useProjection('agentRp')
  const projection = roleplaySummary(summary, projected)
  const debugEnabled = useSyncExternalStore(
    workspaceSettings.subscribe,
    workspaceSettings.getSnapshot,
    workspaceSettings.getSnapshot,
  ).value.debug.enabled
  const [open, setOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [worldInfoOpen, setWorldInfoOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [personaOpen, setPersonaOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const [turnModeSaving, setTurnModeSaving] = useState(false)
  const [turnModeError, setTurnModeError] = useState<string>()
  const [aliasDraft, setAliasDraft] = useState('')
  const [aliasError, setAliasError] = useState<string>()
  const [renaming, setRenaming] = useState(false)
  const viewMode = useRoleplayViewMode(sessionId)
  const storedCharacterRuntime = useCharacterDetail(projection?.avatarLibraryId)
  const storedCharacterDetail = storedCharacterRuntime?.detail
  const sessionResourcePermissions = useAgentRpSessionResourcePermissions(sessionId)
  const characterDetail = useMemo(() => storedCharacterDetail === undefined ? undefined
    : withAgentRpSessionCardPermissions(storedCharacterDetail, sessionResourcePermissions),
  [sessionResourcePermissions, storedCharacterDetail])
  const expressionChoice = useRoleplayExpression(sessionId)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const settingsRef = useRef<HTMLDetailsElement | null>(null)
  const settingsSummaryRef = useRef<HTMLElement | null>(null)
  const settingsMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const openSessionTools = (event: Event): void => {
      if (!(event instanceof CustomEvent) || event.detail !== String(sessionId)) return
      setSettingsOpen(true)
    }
    window.addEventListener(openRoleplaySessionToolsEvent, openSessionTools)
    return () => { window.removeEventListener(openRoleplaySessionToolsEvent, openSessionTools) }
  }, [sessionId])
  useEffect(() => {
    if (!settingsOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !settingsRef.current?.contains(event.target)
        && !settingsMenuRef.current?.contains(event.target)) setSettingsOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSettingsOpen(false)
      settingsSummaryRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [settingsOpen])
  useLayoutEffect(() => {
    if (viewMode === 'debug') return
    const root = rootRef.current
    const header = root?.closest('header')
    if (root == null || header == null) return
    const actionSiblings = Array.from(root.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element !== root && element instanceof HTMLElement)
    const secondaryTabs = Array.from(header.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')).slice(1)
    return hideWhileMounted([
      header.querySelector<HTMLElement>('nav[aria-label]'),
      ...actionSiblings,
      ...secondaryTabs,
    ])
  }, [projection !== undefined, viewMode])
  if (projection === undefined) return null
  const displayName = roleplayDisplayName(summary, projection)
  const displayProjection = displayName === projection.characterName
    ? projection
    : { ...projection, characterName: displayName }
  const expression = expressionChoice === 'default' ? undefined : characterDetail?.imageAssets.find(asset =>
    (asset.type === 'emotion' || asset.type === 'expression') && asset.index === expressionChoice)
  const expressionUrl = expression === undefined || projection.avatarLibraryId === undefined
    ? undefined
    : characterLibraryImageUrl(projection.avatarLibraryId, expression.index)
  const imported = projection.importedMessageCount > 0
  const displayFrontend = projection.frontend === undefined ? undefined
    : withCurrentCharacterDisplayScripts(projection.frontend, storedCharacterRuntime?.displayRegexScripts)
  const status = displayFrontend === undefined || projection.mvu === undefined
    ? undefined
    : renderCharacterDisplay(statusPlaceholder, {
        name: projection.characterName,
        frontend: displayFrontend,
      }, AI_OUTPUT_PLACEMENT, 0, projection.userName, [
        ...projection.regexPacks.flatMap(pack => pack.scripts),
        ...(projection.preset?.regexScripts ?? []),
      ])
  const statusHtml = status === undefined || status === statusPlaceholder
    ? undefined
    : splitCharacterDisplay(status).find(segment => segment.kind === 'html')?.source
  const statusSource = statusHtml === undefined || projection.mvu === undefined
    ? undefined
    : compileCardFrameDocument(statusHtml, {
      origin: window.location.origin,
      statData: projection.mvu.statData,
      identity: {
        characterName: projection.characterName,
        ...(projection.userName === undefined ? {} : { userName: projection.userName }),
      },
      ...(characterDetail === undefined ? {} : { character: characterDetail }),
      ...(projection.tavern === undefined ? {} : { variableScopes: projection.tavern.scopes }),
    })
  const characterRegexScripts = (projection.frontend?.regexScripts ?? []).map((script, index) => ({
    index,
    ...summarizeCharacterRegexScript(script),
  }))
  const settingsAnchor = settingsSummaryRef.current?.getBoundingClientRect()
  return <>
    <div ref={rootRef} className="agent-rp-header" data-agent-rp-header style={{ alignItems: 'center', display: 'flex', gap: '10px', marginRight: 'auto', minWidth: 0 }}>
      <Avatar projection={displayProjection} loadAvatar={loadAvatar}
        {...(storedCharacterDetail === undefined ? {} : { libraryAvatarAvailable: storedCharacterDetail.avatarAvailable })}
        {...(expressionUrl === undefined ? {} : { imageUrl: expressionUrl })} />
      <div className="agent-rp-header-meta" style={{ minWidth: 0 }}>
        <div style={{ alignItems: 'baseline', display: 'flex', gap: '8px', minWidth: 0 }}>
          <strong style={{ fontSize: '15px', fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </strong>
          <span className="agent-rp-header-kind" style={{ fontSize: '11px', opacity: 0.48, whiteSpace: 'nowrap' }}>{imported ? '已迁移对话' : '角色对话'}</span>
        </div>
        <div className="agent-rp-header-capabilities" style={{ fontSize: '12px', marginTop: '2px', opacity: 0.55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {characterCapabilitySummary(projection)}
        </div>
      </div>
      <button className="agent-rp-header-primary-action" type="button" onClick={() => { setSettingsOpen(false); setOpen(true) }} style={{
        background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '8px',
        color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', marginLeft: '8px', padding: '6px 10px',
      }}>角色信息</button>
      <button className="agent-rp-header-primary-action" type="button" data-agent-rp-action="open-character-library"
        data-agent-rp-source-session={sessionId}
        onClick={() => { setSettingsOpen(false); setLibraryOpen(true) }} style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        borderRadius: '8px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '6px 10px',
      }}>角色库</button>
      <button className="agent-rp-header-primary-action" type="button" onClick={() => { setSettingsOpen(false); setPersonaOpen(true) }} style={{
        background: projection.persona === undefined ? 'transparent' : `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid ${projection.persona === undefined ? 'var(--dsw-alias-border-l2, #444)' : `color-mix(in srgb, ${color} 34%, transparent)`}`,
        borderRadius: '8px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '6px 10px',
      }}>身份{projection.persona === undefined ? '' : ` · ${projection.persona.name}`}</button>
      <details className="agent-rp-header-settings" ref={settingsRef} open={settingsOpen}
        data-agent-rp-surface="session-settings" data-agent-rp-surface-state={settingsOpen ? 'open' : 'closed'}
        onToggle={event => { setSettingsOpen(event.currentTarget.open) }} style={{ position: 'relative' }}>
        <summary ref={settingsSummaryRef} role="button" aria-expanded={settingsOpen} aria-haspopup="menu"
          data-agent-rp-action="toggle-session-settings" style={{
          background: projection.worldInfo.activeCount > 0 ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
          border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '8px', color: 'inherit', cursor: 'pointer',
          fontSize: '12px', listStyle: 'none', padding: '6px 10px', whiteSpace: 'nowrap',
        }}>会话设置</summary>
      </details>
      {settingsOpen && createPortal(<div ref={settingsMenuRef} className="agent-rp-session-menu"
        role="menu" aria-label="角色会话设置" data-agent-rp-native-back-layer style={{
          background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
          borderRadius: '10px', boxShadow: '0 14px 38px rgba(0,0,0,.36)', display: 'grid', gap: '3px',
          maxHeight: `min(70vh, ${Math.max(180, window.innerHeight - (settingsAnchor?.bottom ?? 0) - 16)}px)`,
          minWidth: '188px', overflowY: 'auto', padding: '6px', position: 'fixed',
          right: `${Math.max(8, window.innerWidth - (settingsAnchor?.right ?? window.innerWidth - 8))}px`,
          top: `${Math.min(window.innerHeight - 180, (settingsAnchor?.bottom ?? 8) + 7)}px`, zIndex: 1210,
        }}>
          <button className="agent-rp-mobile-only" type="button" role="menuitem" onClick={() => { setSettingsOpen(false); setOpen(true) }} style={headerMenuItemStyle}>角色信息</button>
          <button className="agent-rp-mobile-only" type="button" role="menuitem" data-agent-rp-action="open-character-library"
            data-agent-rp-source-session={sessionId}
            onClick={() => { setSettingsOpen(false); setLibraryOpen(true) }} style={headerMenuItemStyle}>角色库</button>
          <button className="agent-rp-mobile-only" type="button" role="menuitem" onClick={() => { setSettingsOpen(false); setPersonaOpen(true) }} style={headerMenuItemStyle}>你的身份</button>
          {statusSource !== undefined && <button className="agent-rp-mobile-only" type="button" role="menuitem" onClick={() => { setSettingsOpen(false); setStatusOpen(true) }} style={headerMenuItemStyle}>当前状态{projection.mvu?.lastError === undefined ? '' : ' · 更新失败'}</button>}
          <button type="button" role="menuitem" onClick={() => { setSettingsOpen(false); setMigrationOpen(true) }} style={headerMenuItemStyle}>迁移聊天</button>
          <button type="button" role="menuitem" disabled={exporting} onClick={() => {
            setExporting(true)
            setExportError(undefined)
            void exportChat(sessionId).then(() => { setSettingsOpen(false) }, reason => {
              setExportError(reason instanceof Error ? reason.message : String(reason))
            }).finally(() => { setExporting(false) })
          }} style={headerMenuItemStyle}>{exporting ? '正在导出…' : '导出聊天'}</button>
          <button type="button" role="menuitem"
            disabled={turnModeSaving || projection.hostCapabilities?.sessionEvents !== true}
            aria-label="切换角色回合方式"
            onClick={() => {
              setTurnModeSaving(true)
              setTurnModeError(undefined)
              const next = projection.turnMode === 'agent' ? 'conversation' : 'agent'
              void manageTurnMode(sessionId, next).then(() => { setSettingsOpen(false) }, reason => {
                setTurnModeError(reason instanceof Error ? reason.message : String(reason))
              }).finally(() => { setTurnModeSaving(false) })
            }} style={{
              ...headerMenuItemStyle,
              ...(projection.hostCapabilities?.sessionEvents === true ? {} : { cursor: 'not-allowed', opacity: .46 }),
            }}>
            {turnModeSaving ? '正在切换…' : `回合方式 · ${projection.turnMode === 'agent' ? 'Agent' : '纯对话'}`}
          </button>
          {projection.hostCapabilities?.sessionEvents !== true && <p data-agent-rp-host-capability-note style={{
            fontSize: '11px', lineHeight: 1.45, margin: '0 9px 4px', maxWidth: '230px', opacity: .64,
          }}>
            当前启动的 DSH Host 缺少安全插件事件能力；仅更新版本号可能无效，请从 Agent RP 安装器创建的专用入口启动。{' '}
            <a href="https://github.com/hewzhew/dsh-agent-rp#安装" target="_blank" rel="noreferrer" style={{ color, fontWeight: 600 }}>查看修复方式</a>
          </p>}
          <button type="button" role="menuitem" onClick={() => { setSettingsOpen(false); setMemoryOpen(true) }} style={headerMenuItemStyle}>记忆</button>
          <button type="button" role="menuitem" onClick={() => { setSettingsOpen(false); setStateOpen(true) }} style={headerMenuItemStyle}>
            状态数据{projection.nativeStates.length === 0 ? '' : ` · ${projection.nativeStates.length}`}
          </button>
          <button type="button" role="menuitem" data-agent-rp-action="open-preset-manager"
            onClick={() => { setSettingsOpen(false); setPresetOpen(true) }} style={headerMenuItemStyle}>预设</button>
          <button type="button" role="menuitem" data-agent-rp-action="open-world-info-manager"
            onClick={() => { setSettingsOpen(false); setWorldInfoOpen(true) }} style={headerMenuItemStyle}>
            世界书{projection.worldInfo.activeCount === 0 ? '' : ` · ${projection.worldInfo.activeCount}`}
          </button>
          <button type="button" role="menuitem" data-agent-rp-action="toggle-debug-view"
            aria-pressed={viewMode === 'debug'} onClick={() => {
            setSettingsOpen(false)
            setRoleplayViewMode(sessionId, viewMode === 'immersive' ? 'debug' : 'immersive')
          }} style={headerMenuItemStyle}>{viewMode === 'debug' ? '返回沉浸视图' : '打开调试视图 · 工具与上下文'}</button>
          {viewMode === 'immersive' && <p style={{
            fontSize: '11px', lineHeight: 1.45, margin: '-2px 9px 4px', maxWidth: '230px', opacity: .5,
          }}>显示模型思考、工具调用，以及其他插件提供的会话页签。</p>}
          {exportError !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '11px', lineHeight: 1.45, margin: '4px 8px 3px', maxWidth: '240px' }}>{exportError}</p>}
          {turnModeError !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #d64d5f)', fontSize: '11px', lineHeight: 1.45, margin: '4px 8px 3px', maxWidth: '240px' }}>{turnModeError}</p>}
        </div>, document.body)}
      {statusSource !== undefined && <button className="agent-rp-header-primary-action" type="button" onClick={() => { setStatusOpen(true) }} style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        borderRadius: '8px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '6px 10px',
      }}>当前状态{projection.mvu?.lastError === undefined ? '' : ' · 更新失败'}</button>}
    </div>
    {migrationOpen && <SillyTavernImportDialog
      runtimeDiagnostics={runtimeDiagnostics}
      listCharacters={listCharacters}
      listPresets={listPresets}
      onClose={() => { setMigrationOpen(false) }}
      onPrepare={(chatFile, cardFile, characterId) => prepareChatMigration(sessionId, chatFile, cardFile, characterId)}
      onPrepareRpDistribution={(target, remoteSessionId) => prepareRpDistributionChatMigration(
        sessionId, target, remoteSessionId,
      )}
      onLaunch={(prepared, presetId, resourcePermissions) => launchPreparedChatMigration(
        sessionId, prepared, presetId, resourcePermissions,
      )} />}
    {personaOpen && <PersonaManagerDialog
      {...(projection.persona === undefined ? {} : { current: projection.persona })}
      listPersonas={listPersonas}
      savePersona={savePersona}
      deletePersona={deletePersona}
      onApply={persona => applyPersona(sessionId, persona)}
      onClose={() => { setPersonaOpen(false) }}
    />}
    {memoryOpen && <MemoryManagerDialog
      onClose={() => { setMemoryOpen(false) }}
      load={() => listMemory(sessionId)}
      onManage={request => manageMemory(sessionId, request)}
    />}
    {stateOpen && <RoleplayStateManagerDialog
      states={projection.nativeStates}
      onClose={() => { setStateOpen(false) }}
      onManage={request => manageState(sessionId, request)}
    />}
    {open && <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label={`${displayName}的角色信息`} style={{
      alignItems: 'stretch', background: 'rgba(0,0,0,.48)', display: 'flex', inset: 0,
      justifyContent: 'flex-end', position: 'fixed', zIndex: 1000,
    }} onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <aside className="agent-rp-character-info" style={{
        background: 'var(--dsw-alias-bg-base, #171719)', borderLeft: '1px solid var(--dsw-alias-border-l2, #39393c)',
        boxShadow: '-18px 0 44px rgba(0,0,0,.2)', maxWidth: '92vw', overflowY: 'auto', padding: '24px', width: '380px',
      }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: '13px' }}>
          <Avatar projection={displayProjection} loadAvatar={loadAvatar}
            {...(storedCharacterDetail === undefined ? {} : { libraryAvatarAvailable: storedCharacterDetail.avatarAvailable })}
            {...(expressionUrl === undefined ? {} : { imageUrl: expressionUrl })} size={54} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '18px', margin: 0 }}>{displayName}</h2>
            <div style={{ fontSize: '12px', marginTop: '5px', opacity: 0.52 }}>
              {projection.cardVersion === undefined ? '角色会话' : `角色卡 V${projection.cardVersion}`}
            </div>
          </div>
          <button type="button" aria-label="关闭角色信息" onClick={() => { setOpen(false) }} style={{
            background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '22px', marginLeft: 'auto', padding: '4px',
          }}>×</button>
        </div>
        {projection.mvu?.lastError !== undefined && <p role="alert" style={{
          background: 'color-mix(in srgb, var(--dsw-alias-state-danger, #d64d5f) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-danger, #d64d5f) 30%, transparent)',
          borderRadius: '8px', color: 'var(--dsw-alias-state-danger, #e88989)', fontSize: '12px',
          lineHeight: 1.55, margin: '14px 0 0', padding: '9px 10px',
        }}>最近一次状态更新失败：{projection.mvu.lastError}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '20px' }}>
          {projection.userName !== undefined && <span style={chipStyle}>你是 {projection.userName}</span>}
          <span style={chipStyle}>回合 · {projection.turnMode === 'agent' ? 'Agent 分阶段' : '兼容对话'}</span>
          {sessionAgentPreset(summary) !== undefined && <span style={chipStyle}>Agent 能力 · {sessionAgentPreset(summary)}</span>}
          {projection.importedMessageCount > 0 && <span style={chipStyle}>{projection.importedMessageCount} 条历史消息</span>}
          {projection.worldInfoCount > 0 && <span style={chipStyle}>{projection.worldInfoCount} 条世界书设定</span>}
          {characterRegexScripts.length > 0 && <span style={chipStyle}>角色卡正则 · {characterRegexScripts.length} 条</span>}
          {(projection.frontend?.tavernHelperScriptNames.length ?? 0) > 0 && <span style={chipStyle}>
            酒馆脚本 · {projection.frontend?.tavernHelperScriptNames.length} 个启用 · 隔离运行
          </span>}
          {projection.mvu !== undefined && <span style={chipStyle}>MVU · 已接通{projection.mvu.updateCount === 0 ? '' : ` · ${projection.mvu.updateCount} 次更新`}</span>}
          {(characterDetail?.imageAssets.length ?? 0) > 0 && <span style={chipStyle}>
            卡片资源 · {characterDetail?.imageAssets.length} 张图片
          </span>}
          {projection.preset !== undefined && <span style={chipStyle}>
            预设 · {projection.preset.name} · {projection.preset.enabledCount}/{projection.preset.promptCount} 项启用
          </span>}
        </div>
        {characterRegexScripts.length > 0 && <div style={{ marginTop: '16px' }}>
          <CharacterRegexScriptsSection scripts={characterRegexScripts} promptRegex={projection.promptRegex} />
        </div>}
        <form style={{ marginTop: '20px' }} onSubmit={event => {
          event.preventDefault()
          const alias = aliasDraft.trim()
          if (alias === '') {
            setAliasError('显示名不能为空')
            return
          }
          setRenaming(true)
          setAliasError(undefined)
          void renameSession(sessionId, alias).then(() => {
            setRenaming(false)
          }, error => {
            setRenaming(false)
            setAliasError(error instanceof Error ? error.message : String(error))
          })
        }}>
          <label htmlFor={`agent-rp-alias-${sessionId}`} style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '7px', opacity: 0.56 }}>
            显示名
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input id={`agent-rp-alias-${sessionId}`} value={aliasDraft} placeholder={displayName} onChange={event => { setAliasDraft(event.target.value) }} style={{
              background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
              borderRadius: '8px', color: 'inherit', flex: 1, font: 'inherit', minWidth: 0, padding: '7px 9px',
            }} />
            <button type="submit" disabled={renaming} style={{
              background: `color-mix(in srgb, ${color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
              borderRadius: '8px', color: 'inherit', cursor: renaming ? 'wait' : 'pointer', font: 'inherit', padding: '7px 10px',
            }}>{renaming ? '保存中' : '保存'}</button>
          </div>
          {aliasError !== undefined && <div role="alert" style={{ color: '#e88989', fontSize: '12px', marginTop: '6px' }}>{aliasError}</div>}
          {projection.originalCharacterName !== undefined && <div style={{ fontSize: '11px', lineHeight: 1.5, marginTop: '7px', opacity: 0.48 }}>
            原始卡名：{projection.originalCharacterName}
          </div>}
        </form>
        <DetailSection title="角色简介" text={projection.description} />
        <DetailSection title="性格" text={projection.personality} />
        <DetailSection title="当前场景" text={projection.scenario} />
        <DetailSection title="Agent 回合诊断" text={[
          `回合策略：${projection.turnMode === 'agent' ? '正文完成后独立结算状态' : '兼容正文内的旧式状态更新'}`,
          `Agent 能力预设：${sessionAgentPreset(summary) ?? '未记录'}`,
          projection.lastRequest === undefined
            ? '最近一次模型请求：尚无记录'
            : `最近一次模型工具：${projection.lastRequest.toolNames.length === 0 ? '无' : projection.lastRequest.toolNames.join('、')}`,
        ].join('\n')} />
        {projection.persona !== undefined && <DetailSection title={`Persona · ${projection.persona.name}`} text={
          projection.persona.description || '没有额外人物设定'
        } />}
        {characterDetail !== undefined && <CharacterRemoteResourcesSection detail={characterDetail} />}
        {characterDetail !== undefined && <CharacterAssetsSection detail={characterDetail} sessionId={sessionId} />}
        {projection.preset !== undefined && <DetailSection title="运行预设" text={[
          `${projection.preset.promptCount} 个提示模块，当前启用 ${projection.preset.enabledCount} 个`,
          projection.preset.appliedGeneration.length === 0
            ? '没有可直接映射的生成参数'
            : `已映射：${projection.preset.appliedGeneration.join('、')}`,
          projection.preset.preservedGeneration.length === 0
            ? ''
            : `已保留但当前 Host 未应用：${projection.preset.preservedGeneration.join('、')}`,
          projection.preset.degradedRoleCount === 0
            ? ''
            : `${projection.preset.degradedRoleCount} 项非 system 角色按 Host 兼容模式注入`,
          projection.preset.preservedInChatCount === 0
            ? ''
            : `${projection.preset.preservedInChatCount} 项聊天内注入正在按深度和优先级运行`,
          projection.preset.regexScriptCount === 0 ? '' : `${projection.preset.enabledRegexScriptCount}/${projection.preset.regexScriptCount} 条正则启用`,
          projection.preset.activeDisplayRegexCount === 0 ? '' : `${projection.preset.activeDisplayRegexCount} 条显示规则正在运行`,
          projection.preset.preservedPromptRegexCount === 0 ? '' : `${projection.preset.preservedPromptRegexCount} 条生成规则正在模型消息副本中运行`,
          ...projection.preset.extensionStatus.map(item => `${item.name}：${item.detail}`),
        ].filter(Boolean).join('\n')} />}
        {projection.source === 'sillytavern-chat' && projection.cardVersion === undefined && <p style={{ fontSize: '13px', lineHeight: 1.7, marginTop: '22px', opacity: 0.62 }}>
          当前只迁移了聊天记录，没有对应角色卡；再次迁移时可将角色卡和 JSONL 放在同一条消息中
        </p>}
      </aside>
    </div>}
    {statusOpen && statusSource !== undefined && <RoleplayStatusDialog
      characterName={displayName}
      source={statusSource}
      {...(projection.mvu?.lastError === undefined ? {} : { stateError: projection.mvu.lastError })}
      onClose={() => { setStatusOpen(false) }}
    />}
    {libraryOpen && <CharacterLibraryDialog
      runtimeDiagnostics={runtimeDiagnostics}
      currentCharacterName={projection.characterName}
      {...(projection.avatarLibraryId === undefined ? {} : { currentCharacterId: projection.avatarLibraryId })}
      listCharacters={listCharacters}
      readCharacter={readCharacter}
      setCharacterArchived={setCharacterArchived}
      importCharacterFile={importCharacterFile}
      onClose={() => { setLibraryOpen(false) }}
      onStart={(character, greetingIndex, persona, presetId, worldInfoIds, memory, resourcePermissions) => startCharacterSession(
        sessionId, character, greetingIndex, persona, presetId, worldInfoIds, memory, resourcePermissions,
      )}
      listPresets={listPresets}
      importPresetFile={importPresetFile}
      listWorldInfos={listWorldInfos}
      listPersonas={listPersonas}
      savePersona={savePersona}
      deletePersona={deletePersona}
    />}
    {presetOpen && (projection.preset === undefined
      ? <PresetImportDialog
          entries={projection.presetLibrary}
          onClose={() => { setPresetOpen(false) }}
          onImport={file => importPreset(sessionId, file)}
          onLibrary={request => managePresetLibrary(sessionId, request)}
        />
      : <PresetManagerDialog
          sessionId={sessionId}
          preset={projection.preset}
          lastRequest={projection.lastRequest}
          promptRegex={projection.promptRegex}
          entries={projection.presetLibrary}
          loadModelCapabilities={loadModelCapabilities}
          onClose={() => { setPresetOpen(false) }}
          onImport={file => importPreset(sessionId, file)}
          onSave={request => configurePreset(sessionId, request)}
          onLibrary={request => managePresetLibrary(sessionId, request)}
        />)}
    {worldInfoOpen && <WorldInfoManagerDialog
      debugEnabled={debugEnabled}
      worldInfo={projection.worldInfo}
      onClose={() => { setWorldInfoOpen(false) }}
      listWorldInfos={listWorldInfos}
      onAttach={importId => attachWorldInfo(sessionId, importId)}
      onImport={file => importWorldInfo(sessionId, file)}
      onSave={request => configureWorldInfo(sessionId, request)}
    />}
  </>
}

type NativeRoleplayStateView = AgentRpProjection['nativeStates'][number]

function RoleplayStateManagerDialog({ states, onManage, onClose }: {
  readonly states: readonly NativeRoleplayStateView[]
  readonly onManage: (request: RoleplayStateCommandRequest) => Promise<void>
  readonly onClose: () => void
}) {
  const [editing, setEditing] = useState<NativeRoleplayStateView>()
  const [creating, setCreating] = useState(false)
  const [id, setId] = useState('state:scene')
  const [value, setValue] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const beginEdit = (state: NativeRoleplayStateView): void => {
    setCreating(false)
    setEditing(state)
    setId(state.id)
    setValue(JSON.stringify(state.value, undefined, 2))
    setError(undefined)
  }
  const beginCreate = (): void => {
    setCreating(true)
    setEditing(undefined)
    setId('state:scene')
    setValue('{}')
    setError(undefined)
  }
  const cancelEdit = (): void => {
    setCreating(false)
    setEditing(undefined)
    setError(undefined)
  }
  const save = (): void => {
    let parsed: JsonValue
    try {
      parsed = JSON.parse(value) as JsonValue
    } catch (reason: unknown) {
      setError(`状态内容不是有效 JSON：${reason instanceof Error ? reason.message : String(reason)}`)
      return
    }
    setBusy(true)
    setError(undefined)
    void onManage({
      format: 0,
      operation: 'set',
      id: id.trim(),
      expectedRevision: editing?.revision ?? 0,
      value: parsed,
    }).then(() => {
      setCreating(false)
      setEditing(undefined)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }
  const formVisible = creating || editing !== undefined
  const validId = /^state:[^\s]+$/u.test(id.trim())
  return <div data-agent-rp-dialog data-agent-rp-native-state-manager role="dialog" aria-modal="true" aria-label="状态数据" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '14px', position: 'fixed', zIndex: 1200,
  }} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #3e3e43)',
      borderRadius: '14px', boxShadow: '0 18px 58px rgba(0,0,0,.42)', boxSizing: 'border-box',
      maxHeight: 'min(760px, 88vh)', maxWidth: '720px', overflowY: 'auto', padding: '20px', width: '100%',
    }}>
      <header style={{ alignItems: 'start', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
            <h2 style={{ fontSize: '17px', margin: 0 }}>状态数据</h2>
            <span style={{ fontSize: '11px', opacity: .45 }}>{states.length} 项</span>
          </div>
          <p style={{ fontSize: '12px', lineHeight: 1.55, margin: '5px 0 0', maxWidth: '520px', opacity: .58 }}>
            这是下一轮会读取的结构化事实。修改会保留在会话历史中；角色不会因此获得自行修改状态的权限
          </p>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
          <button type="button" disabled={busy} onClick={() => { if (creating) cancelEdit(); else beginCreate() }} style={{
            ...headerMenuItemStyle, color,
          }}>{creating ? '取消新增' : '新增状态'}</button>
          <button type="button" disabled={busy} onClick={onClose} style={{
            background: 'transparent', border: 0, color: 'inherit', cursor: busy ? 'default' : 'pointer',
            font: 'inherit', fontSize: '18px', opacity: .6, padding: '0 3px',
          }} aria-label="关闭状态数据">×</button>
        </div>
      </header>
      {formVisible && <div style={{
        background: 'var(--dsw-alias-bg-layer-1, #222226)', border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        borderRadius: '11px', display: 'grid', gap: '10px', marginTop: '18px', padding: '13px',
      }}>
        <label style={{ display: 'grid', fontSize: '11px', gap: '6px', opacity: .78 }}>
          状态标识
          <input value={id} disabled={editing !== undefined || busy} maxLength={134} placeholder="state:scene"
            onChange={event => { setId(event.target.value) }} style={settingsFieldStyle} />
        </label>
        <label style={{ display: 'grid', fontSize: '11px', gap: '6px', opacity: .78 }}>
          JSON 内容
          <textarea value={value} disabled={busy} rows={10} spellCheck={false}
            onChange={event => { setValue(event.target.value) }} style={{
              ...settingsFieldStyle, boxSizing: 'border-box', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: '12px', lineHeight: 1.55, resize: 'vertical', width: '100%',
            }} />
        </label>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy} onClick={cancelEdit} style={headerMenuItemStyle}>返回</button>
          <button type="button" disabled={busy || !validId} onClick={save} style={{
            background: color, border: 0, borderRadius: '8px', color: '#fff', cursor: busy || !validId ? 'default' : 'pointer',
            font: 'inherit', fontSize: '12px', opacity: validId ? 1 : .45, padding: '7px 12px',
          }}>{busy ? '正在保存…' : editing === undefined ? '创建状态' : '保存修改'}</button>
        </div>
      </div>}
      {states.length === 0 && !formVisible && <div style={{
        background: 'var(--dsw-alias-bg-layer-1, #222226)', borderRadius: '10px', marginTop: '18px', padding: '22px', textAlign: 'center',
      }}>
        <strong style={{ display: 'block', fontSize: '13px' }}>当前没有原生状态</strong>
        <span style={{ display: 'block', fontSize: '12px', marginTop: '6px', opacity: .52 }}>普通对话不会额外创建状态；需要时再添加即可</span>
      </div>}
      {states.length > 0 && <div style={{ display: 'grid', gap: '10px', marginTop: '18px' }}>
        {states.map(state => <article key={state.id} style={{
          background: 'var(--dsw-alias-bg-layer-1, #222226)', border: '1px solid var(--dsw-alias-border-l2, #3e3e43)',
          borderRadius: '11px', padding: '13px',
        }}>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
            <strong style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '12px' }}>{state.id}</strong>
            <span style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, borderRadius: '999px', fontSize: '10px', padding: '2px 7px' }}>
              v{state.revision}
            </span>
            <span style={{ fontSize: '10px', opacity: .46 }}>
              {state.ownerModuleId === 'roleplay:user' ? '由你管理' : `由 ${state.ownerModuleId} 管理`}
            </span>
            {state.writerModuleId === 'roleplay:user' && state.ownerModuleId !== 'roleplay:user'
              && <span style={{ fontSize: '10px', opacity: .46 }}>· 上次由你纠正</span>}
            <button type="button" disabled={busy} onClick={() => { beginEdit(state) }} style={{ ...headerMenuItemStyle, marginLeft: 'auto' }}>编辑</button>
          </div>
          <pre style={{
            fontSize: '11px', lineHeight: 1.55, margin: '10px 0 0', maxHeight: '180px', opacity: .7,
            overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{JSON.stringify(state.value, undefined, 2)}</pre>
        </article>)}
      </div>}
      {error !== undefined && <p role="alert" style={{
        color: 'var(--dsw-alias-state-danger, #e06470)', fontSize: '12px', lineHeight: 1.5, margin: '14px 0 0',
      }}>{error}</p>}
    </section>
  </div>
}

const memoryKindLabels: Record<AgentRpMemoryView['kind'], string> = {
  fact: '事实',
  promise: '约定',
  relationship: '关系',
  preference: '偏好',
  event: '共同经历',
}

function MemoryManagerDialog({ load, onManage, onClose }: {
  readonly load: () => Promise<readonly AgentRpMemoryView[]>
  readonly onManage: (request: AgentRpMemoryCommandRequest) => Promise<void>
  readonly onClose: () => void
}) {
  const [memories, setMemories] = useState<readonly AgentRpMemoryView[]>()
  const [editing, setEditing] = useState<AgentRpMemoryView>()
  const [kind, setKind] = useState<AgentRpMemoryView['kind']>('fact')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [forgetting, setForgetting] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = (): Promise<void> => load().then(setMemories)
  useEffect(() => {
    let current = true
    void load().then(value => { if (current) setMemories(value) }, reason => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [])
  const beginCorrection = (memory: AgentRpMemoryView): void => {
    setCreating(false)
    setEditing(memory)
    setKind(memory.kind)
    setSubject(memory.subject)
    setText(memory.text)
    setForgetting(undefined)
    setError(undefined)
  }
  const beginCreation = (): void => {
    setCreating(true)
    setEditing(undefined)
    setKind('fact')
    setSubject('')
    setText('')
    setForgetting(undefined)
    setError(undefined)
  }
  const run = (request: AgentRpMemoryCommandRequest): void => {
    setBusy(true)
    setError(undefined)
    void onManage(request).then(refresh).then(() => {
      setEditing(undefined)
      setCreating(false)
      setForgetting(undefined)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleMemories = (memories ?? []).filter(memory => normalizedQuery === ''
    || `${memory.subject}\n${memory.text}\n${memoryKindLabels[memory.kind]}`.toLocaleLowerCase().includes(normalizedQuery))
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="角色记忆" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1200,
  }} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #3e3e43)',
      borderRadius: '14px', boxShadow: '0 18px 58px rgba(0,0,0,.42)', maxHeight: 'min(720px, 86vh)',
      maxWidth: '640px', overflowY: 'auto', padding: '20px', width: '100%',
    }}>
      <header style={{ alignItems: 'start', display: 'flex', gap: '16px', justifyContent: 'space-between' }}>
        <div>
          <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
            <h2 style={{ fontSize: '17px', margin: 0 }}>角色记忆</h2>
            {memories !== undefined && <span style={{ fontSize: '11px', opacity: .45 }}>{memories.length} 条有效</span>}
          </div>
          <p style={{ fontSize: '12px', lineHeight: 1.55, margin: '5px 0 0', opacity: .58 }}>
            这些内容会在之后的回复中继续生效。纠正和忘记都会保留在本机会话历史中
          </p>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
          <button type="button" disabled={busy} onClick={() => {
            if (creating) setCreating(false)
            else beginCreation()
          }} style={{ ...headerMenuItemStyle, color }}>{creating ? '取消新增' : '新增记忆'}</button>
          <button type="button" disabled={busy} onClick={onClose} style={{
            background: 'transparent', border: 0, color: 'inherit', cursor: busy ? 'default' : 'pointer',
            font: 'inherit', fontSize: '18px', opacity: .6, padding: '0 3px',
          }} aria-label="关闭记忆管理">×</button>
        </div>
      </header>
      {memories === undefined && error === undefined && <p role="status" style={{ fontSize: '13px', margin: '24px 0 4px', opacity: .58 }}>正在读取记忆…</p>}
      {creating && <div style={{
        background: 'var(--dsw-alias-bg-layer-1, #222226)', border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        borderRadius: '11px', display: 'grid', gap: '9px', marginTop: '18px', padding: '13px',
      }}>
        <strong style={{ fontSize: '13px' }}>新增一条有效记忆</strong>
        <div style={{ display: 'grid', gap: '9px', gridTemplateColumns: '120px minmax(0, 1fr)' }}>
          <select value={kind} onChange={event => { setKind(event.target.value as AgentRpMemoryView['kind']) }} style={settingsFieldStyle}>
            {Object.entries(memoryKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={subject} maxLength={120} placeholder="主题，例如：称呼" onChange={event => { setSubject(event.target.value) }} aria-label="新增记忆主题" style={settingsFieldStyle} />
        </div>
        <textarea value={text} maxLength={1000} rows={4} placeholder="写下希望角色长期记住的内容" onChange={event => { setText(event.target.value) }} aria-label="新增记忆内容" style={{ ...settingsFieldStyle, lineHeight: 1.55, resize: 'vertical' }} />
        <button type="button" disabled={busy || subject.trim() === '' || text.trim() === ''} onClick={() => { run({
          format: 0, operation: 'add', kind, subject: subject.trim(), text: text.trim(),
        }) }} style={{
          background: color, border: 0, borderRadius: '8px', color: '#fff', cursor: busy ? 'default' : 'pointer',
          font: 'inherit', fontSize: '12px', justifySelf: 'end', padding: '7px 12px',
          opacity: subject.trim() === '' || text.trim() === '' ? .45 : 1,
        }}>{busy ? '正在保存…' : '保存记忆'}</button>
      </div>}
      {memories?.length === 0 && !creating && <div style={{
        background: 'var(--dsw-alias-bg-layer-1, #222226)', borderRadius: '10px', marginTop: '18px', padding: '20px', textAlign: 'center',
      }}>
        <strong style={{ display: 'block', fontSize: '13px' }}>还没有持久记忆</strong>
        <span style={{ display: 'block', fontSize: '12px', marginTop: '6px', opacity: .52 }}>角色在确实值得长期保留时才会记下来</span>
      </div>}
      {memories !== undefined && memories.length > 5 && <input type="search" value={query} aria-label="搜索角色记忆"
        placeholder="搜索主题或内容" onChange={event => { setQuery(event.target.value) }} style={{
          ...settingsFieldStyle, boxSizing: 'border-box', marginTop: '16px', width: '100%',
        }} />}
      {memories !== undefined && memories.length > 0 && visibleMemories.length === 0 && <p style={{
        fontSize: '12px', margin: '18px 0 2px', opacity: .55, textAlign: 'center',
      }}>没有找到匹配的记忆</p>}
      {memories !== undefined && memories.length > 0 && <div style={{ display: 'grid', gap: '10px', marginTop: '18px' }}>
        {visibleMemories.map(memory => <article key={memory.id} style={{
          background: 'var(--dsw-alias-bg-layer-1, #222226)', border: '1px solid var(--dsw-alias-border-l2, #3e3e43)',
          borderRadius: '11px', padding: '13px',
        }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: '7px' }}>
            <strong style={{ fontSize: '13px' }}>{memory.subject}</strong>
            <span style={{
              background: `color-mix(in srgb, ${color} 13%, transparent)`, borderRadius: '999px',
              fontSize: '10px', opacity: .82, padding: '2px 7px',
            }}>{memoryKindLabels[memory.kind]}</span>
            {memory.source !== 'character' && <span style={{ fontSize: '10px', marginLeft: 'auto', opacity: .45 }}>
              {memory.source === 'user' ? '由你保存' : '从上一段带来'}
            </span>}
          </div>
          {editing?.id === memory.id
            ? <div style={{ display: 'grid', gap: '9px', marginTop: '12px' }}>
                <div style={{ display: 'grid', gap: '9px', gridTemplateColumns: '120px minmax(0, 1fr)' }}>
                  <select value={kind} onChange={event => { setKind(event.target.value as AgentRpMemoryView['kind']) }} style={settingsFieldStyle}>
                    {Object.entries(memoryKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <input value={subject} maxLength={120} onChange={event => { setSubject(event.target.value) }} aria-label="记忆主题" style={settingsFieldStyle} />
                </div>
                <textarea value={text} maxLength={1000} rows={4} onChange={event => { setText(event.target.value) }} aria-label="记忆内容" style={{ ...settingsFieldStyle, lineHeight: 1.55, resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button type="button" disabled={busy} onClick={() => { setEditing(undefined) }} style={headerMenuItemStyle}>取消</button>
                  <button type="button" disabled={busy || subject.trim() === '' || text.trim() === ''} onClick={() => { run({
                    format: 0, operation: 'correct', id: memory.id, kind, subject: subject.trim(), text: text.trim(),
                  }) }} style={{
                    background: color, border: 0, borderRadius: '8px', color: '#fff', cursor: busy ? 'default' : 'pointer',
                    font: 'inherit', fontSize: '12px', padding: '7px 12px',
                  }}>{busy ? '正在保存…' : '保存纠正'}</button>
                </div>
              </div>
            : <>
                <p style={{ fontSize: '13px', lineHeight: 1.65, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{memory.text}</p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button type="button" disabled={busy} onClick={() => { beginCorrection(memory) }} style={headerMenuItemStyle}>纠正</button>
                  <button type="button" disabled={busy} onClick={() => {
                    if (forgetting === memory.id) run({ format: 0, operation: 'forget', id: memory.id })
                    else { setForgetting(memory.id); setEditing(undefined) }
                  }} style={{ ...headerMenuItemStyle, color: forgetting === memory.id ? 'var(--dsw-alias-state-danger, #e06470)' : 'inherit' }}>
                    {forgetting === memory.id ? '确认忘记' : '忘记'}
                  </button>
                </div>
              </>}
        </article>)}
      </div>}
      {error !== undefined && <p role="alert" style={{ color: 'var(--dsw-alias-state-danger, #e06470)', fontSize: '12px', lineHeight: 1.5, margin: '14px 0 0' }}>{error}</p>}
    </section>
  </div>
}

type WorldInfoProjection = AgentRpProjection['worldInfo']
type WorldInfoBookProjection = WorldInfoProjection['books'][number]
type WorldInfoEntryProjection = WorldInfoBookProjection['entries'][number]

function worldInfoEntryTitle(entry: WorldInfoEntryProjection): string {
  return entry.name?.trim() || entry.comment?.trim() || entry.keys[0] || (entry.constant ? '常驻设定' : `条目 ${entry.sourceId}`)
}

function worldInfoReason(entry: WorldInfoEntryProjection): { readonly title: string; readonly detail: string } {
  switch (entry.reason) {
    case 'active-constant': return { title: '正在生效', detail: '这是常驻条目，会进入下一次回复的提示' }
    case 'active-keyword': return {
      title: '正在生效',
      detail: `当前对话命中了${entry.matchedKeys.length === 0 ? '关键词' : `“${entry.matchedKeys.join('”“')}”`}`,
    }
    case 'disabled': return { title: '已关闭', detail: '打开条目后才会参与匹配' }
    case 'deleted': return { title: '已从本会话移除', detail: '原始卡片仍完整保留，可以随时恢复' }
    case 'empty-content': return { title: '没有内容', detail: '条目正文为空，不会进入提示' }
    case 'compatibility-unsupported': return {
      title: '等待兼容能力',
      detail: `原文件希望启用，但当前还不能完整执行${entry.compatibilityBlockers.map(worldInfoCompatibilityLabel).join('、') || '这项扩展行为'}；不会用近似结果替代`,
    }
    case 'decorator-unsupported': return { title: '暂不执行', detail: '正文含有酒馆装饰器；内容已保留，但当前运行层不会执行' }
    case 'template-unsupported': return { title: 'EJS 尚未就绪', detail: '正文含有 EJS，但当前运行实例没有载入隔离执行环境' }
    case 'template-error': return {
      title: 'EJS 本轮未生效',
      detail: entry.template === 'execution-limit' ? '模板超过执行步数限制，已只跳过这一条'
        : entry.template === 'memory-limit' ? '模板超过内存限制，已只跳过这一条'
          : entry.template === 'output-limit' || entry.template === 'source-limit' ? '模板或输出过长，已只跳过这一条'
            : entry.template === 'syntax-error' ? '模板语法无法解析，已只跳过这一条'
              : '模板执行失败，已只跳过这一条',
    }
    case 'regex-runtime-unavailable': return { title: '正则运行时不可用', detail: '本次检查没有启动隔离正则运行时；该条目已跳过，重新启动 DSH 后可再检查' }
    case 'regex-invalid': return { title: '表达式无效', detail: '该条目的正则关键词无法解析，已跳过且不会影响其他条目' }
    case 'regex-execution-limit': return { title: '已安全中止', detail: '该条目的正则匹配超过执行上限，已在隔离环境中停止' }
    case 'regex-resource-limit': return { title: '超过安全上限', detail: '该条目的正则输入或累计评估量超过本轮上限' }
    case 'primary-unmatched': return { title: '等待关键词', detail: entry.keys.length === 0 ? '没有可用于激活的主关键词' : '当前已发送的对话没有命中主关键词' }
    case 'secondary-unmatched': return { title: '次要条件未满足', detail: '主关键词已经出现，但次要关键词规则尚未满足' }
    case 'budget-excluded': return { title: '达到本书上限', detail: '条目已匹配，但作者为这本世界书设置的 token 上限优先保留了其他条目' }
    case 'session-budget-excluded': return { title: '达到手动上限', detail: '条目已匹配，但玩家为这段会话设置的世界书上下文上限优先保留了其他条目' }
  }
}

function worldInfoCompatibilityLabel(value: WorldInfoEntryProjection['compatibilityBlockers'][number]): string {
  switch (value) {
    case 'entry-advanced-matching': return '高级匹配'
    case 'entry-probability': return '概率触发'
    case 'entry-unsupported-position': return '扩展注入位置'
    case 'lorebook-recursion': return '递归触发'
    case 'timed-effects': return '定时、粘滞或冷却效果'
    case 'vector-matching': return '向量匹配'
  }
}

function editableFromProjection(entry: WorldInfoEntryProjection): WorldInfoEditableEntry {
  return {
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.comment === undefined ? {} : { comment: entry.comment }),
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    content: entry.content,
    enabled: entry.enabled,
    insertionOrder: entry.insertionOrder,
    selective: entry.selective,
    constant: entry.constant,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    secondaryLogic: entry.secondaryLogic,
    ...(entry.scanDepth === undefined ? {} : { scanDepth: entry.scanDepth }),
    position: entry.position,
    ...(entry.injectionDepth === undefined ? {} : { injectionDepth: entry.injectionDepth }),
    ...(entry.injectionRole === undefined ? {} : { injectionRole: entry.injectionRole }),
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
    ignoreBudget: entry.ignoreBudget,
  }
}

function WorldInfoLibraryAttachDialog({ books, listWorldInfos, onAttach, onClose }: {
  readonly books: AgentRpProjection['worldInfo']['books']
  readonly listWorldInfos: HeaderProps['listWorldInfos']
  readonly onAttach: (importId: string) => Promise<void>
  readonly onClose: () => void
}) {
  const narrow = useNarrowCharacterLibrary()
  const [uploads, setUploads] = useState<readonly WorldInfoLibraryUpload[]>()
  const [loadingError, setLoadingError] = useState<string>()
  const [attachingId, setAttachingId] = useState<string>()
  const [attachError, setAttachError] = useState<string>()
  useEffect(() => {
    if (uploads !== undefined || loadingError !== undefined) return
    let current = true
    void listWorldInfos().then(value => {
      if (current) setUploads(value)
    }, reason => {
      if (current) setLoadingError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listWorldInfos, loadingError, uploads])
  const available = uploads === undefined ? undefined : availableWorldInfoLibraryUploads(uploads, books)
  const attach = (entry: WorldInfoLibraryUpload): void => {
    setAttachingId(entry.id)
    setAttachError(undefined)
    void onAttach(entry.id).then(onClose, reason => {
      setAttachingId(undefined)
      setAttachError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return <div data-agent-rp-dialog data-agent-rp-surface="world-info-library-attach"
    role="dialog" aria-modal="true" aria-label="从资源中心添加世界书" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.66)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: narrow ? 0 : '20px', position: 'fixed', zIndex: 1004,
  }} onMouseDown={event => { if (event.target === event.currentTarget && attachingId === undefined) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: narrow ? 0 : '1px solid var(--dsw-alias-border-l2, #39393c)',
      borderRadius: narrow ? 0 : '14px', boxShadow: '0 24px 90px rgba(0,0,0,.45)', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', height: narrow ? '100dvh' : undefined,
      maxHeight: narrow ? '100dvh' : 'min(620px, calc(100vh - 40px))', maxWidth: '560px',
      overflow: 'hidden', width: narrow ? '100vw' : 'min(560px, calc(100vw - 40px))',
    }}>
      <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '10px', padding: narrow ? 'max(12px, env(safe-area-inset-top)) 16px 12px' : '16px 18px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: '17px', margin: 0 }}>从资源中心添加</h2>
          <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: .5 }}>添加一份当前内容快照；不会修改资源中心原文件</span>
        </div>
        <button type="button" aria-label="关闭资源中心世界书选择" disabled={attachingId !== undefined}
          onClick={onClose} style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '23px', padding: '3px 6px' }}>×</button>
      </header>
      <div style={{ display: 'grid', flex: 1, gap: '8px', minHeight: '220px', overflowY: 'auto', padding: '13px' }}>
        {loadingError !== undefined
          ? <div role="alert" style={{ alignItems: 'center', color: '#e88989', display: 'flex', fontSize: '12px', gap: '10px', lineHeight: 1.5, padding: '10px' }}>
              <span style={{ flex: 1 }}>{loadingError}</span>
              <button type="button" onClick={() => { setLoadingError(undefined) }} style={generationButtonStyle}>重试</button>
            </div>
          : available === undefined
            ? <div style={{ fontSize: '12px', opacity: .52, padding: '12px' }}>正在读取世界书资源…</div>
            : available.length === 0
              ? <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '220px', padding: '20px', textAlign: 'center' }}>
                  <strong style={{ fontSize: '14px' }}>{uploads?.length === 0 ? '资源中心还没有世界书' : '资源中心里的世界书都已加入本会话'}</strong>
                  <span style={{ fontSize: '11px', lineHeight: 1.55, marginTop: '7px', opacity: .5 }}>{uploads?.length === 0 ? '可以关闭这里，再从文件导入一本世界书' : '同一份资源不会重复出现在会话中'}</span>
                </div>
              : available.map(entry => <div key={entry.id} data-agent-rp-world-info-library-option={entry.id} style={{
                  alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
                  borderRadius: '10px', display: 'flex', gap: '10px', padding: '10px 11px',
                }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</strong>
                    <span style={{ display: 'block', fontSize: '10px', marginTop: '4px', opacity: .48 }}>
                      {entry.entryCount} 条目{entry.defaultForNewSessions ? ' · 新会话默认' : ''}{entry.degradations.length === 0 ? '' : ` · ${entry.degradations.length} 项兼容提醒`}
                    </span>
                  </span>
                  <button type="button" data-agent-rp-action="attach-world-info-library" disabled={attachingId !== undefined}
                    onClick={() => { attach(entry) }} style={generationButtonStyle}>{attachingId === entry.id ? '添加中…' : '添加'}</button>
                </div>)}
        {attachError !== undefined && <div role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.5, padding: '2px 4px' }}>{attachError}</div>}
      </div>
    </section>
  </div>
}

function WorldInfoManagerDialog({ debugEnabled, worldInfo, listWorldInfos, onAttach, onClose, onImport, onSave }: {
  readonly debugEnabled: boolean
  readonly worldInfo: WorldInfoProjection
  readonly listWorldInfos: HeaderProps['listWorldInfos']
  readonly onAttach: (importId: string) => Promise<void>
  readonly onClose: () => void
  readonly onImport: (file: File) => Promise<void>
  readonly onSave: (request: WorldInfoConfigurationRequest) => Promise<void>
}) {
  const narrow = useNarrowCharacterLibrary()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const allEntries = worldInfo.books.flatMap(book => book.entries)
  const first = worldInfo.books.flatMap(book => book.entries.map(entry => `${book.id}\u0000${entry.index}`))[0]
  const [selectedKey, setSelectedKey] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<WorldInfoEditableEntry>()
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string>()
  const [copyFailureNotice, setCopyFailureNotice] = useState<string>()
  const [budgetDraft, setBudgetDraft] = useState(worldInfo.tokenBudget === undefined ? '' : String(worldInfo.tokenBudget))
  useEffect(() => { setBudgetDraft(worldInfo.tokenBudget === undefined ? '' : String(worldInfo.tokenBudget)) }, [worldInfo.tokenBudget])
  useEffect(() => {
    if (!narrow && selectedKey === undefined && first !== undefined) setSelectedKey(first)
  }, [first, narrow, selectedKey])
  const pair = selectedKey === undefined ? undefined : worldInfo.books
    .flatMap(book => book.entries.map(entry => ({ book, entry })))
    .find(({ book, entry }) => `${book.id}\u0000${entry.index}` === selectedKey)
  useEffect(() => {
    if (pair === undefined || editing) return
    setDraft(editableFromProjection(pair.entry))
  }, [pair?.book.id, pair?.entry.index, pair?.entry.modified, pair?.entry.deleted, editing])
  const book = pair?.book
  const entry = pair?.entry
  const reason = entry === undefined ? undefined : worldInfoReason(entry)
  const hasOverrides = worldInfo.books.some(item => item.entries.some(candidate => candidate.modified || candidate.deleted))
  const enabledCount = allEntries.filter(candidate => candidate.enabled && !candidate.deleted).length
  const blockedCount = allEntries.filter(candidate => !candidate.deleted
    && (candidate.compatibilityBlockers.length > 0 || candidate.hasDecorators)).length
  const failureReport = worldInfoFailureReport(worldInfo.books, { includeDebugErrors: debugEnabled })
  useEffect(() => { setCopyFailureNotice(undefined) }, [failureReport])
  const mutate = (request: WorldInfoConfigurationRequest, after?: () => void): void => {
    setSaving(true)
    setError(undefined)
    void onSave(request).then(() => {
      setSaving(false)
      after?.()
    }, (saveError: unknown) => {
      setSaving(false)
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    })
  }
  const importFile = (file: File): void => {
    setImporting(true)
    setError(undefined)
    void onImport(file).then(() => {
      setImporting(false)
    }, (importError: unknown) => {
      setImporting(false)
      setError(importError instanceof Error ? importError.message : String(importError))
    })
  }
  return <><div data-agent-rp-dialog data-agent-rp-surface="world-info-manager"
    role="dialog" aria-modal="true" aria-label="世界书" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.55)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: narrow ? 0 : '20px', position: 'fixed', zIndex: 1002,
  }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
      borderRadius: narrow ? 0 : '16px', boxShadow: '0 24px 90px rgba(0,0,0,.38)', display: 'flex', flexDirection: 'column',
      height: narrow ? '100dvh' : undefined, maxHeight: narrow ? '100dvh' : 'calc(100vh - 40px)', maxWidth: '1080px',
      overflow: 'hidden', width: narrow ? '100vw' : 'min(1080px, calc(100vw - 40px))',
    }}>
      <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '17px 20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', margin: 0 }}>世界书</h2>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: .52 }}>
            {worldInfo.books.length} 本 · {allEntries.length} 条 · {enabledCount} 条启用 · 本轮生效 {worldInfo.activeCount} 条{blockedCount === 0 ? '' : ` · ${blockedCount} 条等待兼容`} · 约 {worldInfo.approximateTokens}{worldInfo.tokenBudget === undefined ? '' : `/${worldInfo.tokenBudget}`} tokens
            {worldInfo.budgetExcludedCount > 0 ? ` · ${worldInfo.budgetExcludedCount} 条达到手动上限` : ''}
          </div>
        </div>
        <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file !== undefined) importFile(file)
        }} />
        <button type="button" data-agent-rp-action="open-world-info-library-attach" disabled={importing}
          onClick={() => { setLibraryOpen(true) }} style={{ ...generationButtonStyle, marginLeft: 'auto' }}>
          从资源中心添加
        </button>
        <button type="button" data-agent-rp-action="import-world-info-file" disabled={importing}
          onClick={() => { importInputRef.current?.click() }} style={generationButtonStyle}>
          {importing ? '导入中…' : '从文件导入'}
        </button>
        {failureReport !== undefined && <button type="button" data-agent-rp-world-info-copy-failures
          title={debugEnabled
            ? '复制包含世界书标识、失败类别和 EJS 运行时错误的详情；发送前请检查内容'
            : '复制包含世界书名、条目标识和稳定失败类别的详情；开启全局 Debug 后可包含 EJS 运行时错误'}
          onClick={() => {
            if (navigator.clipboard === undefined) {
              setCopyFailureNotice('无法复制')
              return
            }
            setCopyFailureNotice('正在复制…')
            void navigator.clipboard.writeText(failureReport).then(() => {
              setCopyFailureNotice('失败详情已复制')
            }, () => {
              setCopyFailureNotice('复制失败')
            })
          }} style={generationButtonStyle}>{copyFailureNotice ?? '复制失败详情'}</button>}
        {hasOverrides && <button type="button" disabled={saving} onClick={() => {
          mutate({ operation: 'reset-all', revision: worldInfo.revision }, () => { setEditing(false) })
        }} style={generationButtonStyle}>全部恢复原始设置</button>}
        <button type="button" aria-label="关闭世界书" data-agent-rp-action="close-world-info-manager"
          onClick={onClose} style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '23px', padding: '3px 6px' }}>×</button>
      </header>
      <details style={{ borderBottom: '1px solid var(--dsw-alias-border-l2, #39393c)', flex: '0 0 auto', padding: '0 20px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12px', listStylePosition: 'inside', padding: '10px 0', opacity: .72 }}>
          世界书上下文 · {worldInfo.tokenBudget === undefined ? '未设额外上限' : `手动上限 ${worldInfo.tokenBudget} tokens`}
        </summary>
        <div style={{ alignItems: narrow ? 'stretch' : 'center', display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: '10px', padding: '0 0 13px' }}>
          <div style={{ flex: '1 1 auto', fontSize: '11px', lineHeight: 1.55, opacity: .56 }}>
            默认由当前模型和 DSH 管理最终容量，不会额外截断已激活条目。只有需要主动限制世界书占用时才设置；留空或填 0 可关闭。
          </div>
          <form onSubmit={event => {
            event.preventDefault()
            const tokenBudget = budgetDraft.trim() === '' ? 0 : Number(budgetDraft)
            if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 0 || tokenBudget > 100_000) {
              setError('世界书上下文上限需要是 0 到 100000 的整数；留空或填 0 表示关闭')
              return
            }
            mutate({ operation: 'set-budget', revision: worldInfo.revision, tokenBudget })
          }} style={{ alignItems: 'center', display: 'flex', gap: '6px', width: narrow ? '100%' : undefined }}>
            <label htmlFor="agent-rp-world-info-budget" style={{ fontSize: '11px', opacity: .58, whiteSpace: 'nowrap' }}>手动上限</label>
            <input id="agent-rp-world-info-budget" inputMode="numeric" min={0} max={100000} placeholder="不限制" step={1} type="number" value={budgetDraft} onChange={event => { setBudgetDraft(event.currentTarget.value) }} style={{
              background: 'var(--dsw-alias-bg-layer-1, #222226)', border: '1px solid var(--dsw-alias-border-l2, #414146)', borderRadius: '8px',
              color: 'inherit', flex: narrow ? '1 1 auto' : undefined, font: 'inherit', fontSize: '12px', minWidth: 0, padding: '6px 8px', width: narrow ? 'auto' : '90px',
            }} />
            <button type="submit" disabled={saving || budgetDraft === (worldInfo.tokenBudget === undefined ? '' : String(worldInfo.tokenBudget))} style={generationButtonStyle}>应用</button>
          </form>
        </div>
      </details>
      {allEntries.length === 0 && <div style={{ alignItems: 'center', display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', minHeight: '300px', padding: '30px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', opacity: .38 }}>◇</div>
        <h3 style={{ fontSize: '16px', margin: '14px 0 0' }}>还没有世界书</h3>
        <p style={{ fontSize: '13px', lineHeight: 1.65, margin: '8px 0 0', maxWidth: '430px', opacity: .58 }}>
          导入 SillyTavern World Info JSON 后会立即用于这段角色对话，不需要发送消息，也不会交给模型判断
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '18px' }}>
          <button type="button" data-agent-rp-action="open-world-info-library-attach" disabled={importing}
            onClick={() => { setLibraryOpen(true) }} style={primaryButtonStyle}>从资源中心添加</button>
          <button type="button" data-agent-rp-action="import-world-info-file" disabled={importing}
            onClick={() => { importInputRef.current?.click() }} style={secondaryButtonStyle}>
            {importing ? '正在导入…' : '从文件导入'}
          </button>
        </div>
        {error !== undefined && <div role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.55, marginTop: '14px' }}>{error}</div>}
      </div>}
      {allEntries.length > 0 && <>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {(!narrow || pair === undefined) && <nav aria-label="世界书条目" data-agent-rp-world-info-pane="list" style={{
          borderRight: '1px solid var(--dsw-alias-border-l2, #39393c)', boxSizing: 'border-box',
          flex: narrow ? '1 1 auto' : '0 0 320px', maxWidth: narrow ? undefined : '330px', minWidth: 0,
          overflowY: 'auto', padding: '12px 10px 18px', width: narrow ? '100%' : undefined,
        }}>
          {worldInfo.books.map(item => {
            const itemEntries = item.entries.filter(candidate => !candidate.deleted)
            const itemEnabled = itemEntries.filter(candidate => candidate.enabled).length
            const itemBlocked = itemEntries.filter(candidate => candidate.compatibilityBlockers.length > 0 || candidate.hasDecorators).length
            return <section key={item.id} data-agent-rp-world-info-book={item.id} style={{ marginBottom: '15px' }}>
            <div style={{ fontSize: '11px', padding: '4px 8px 7px' }}>
              <div style={{ alignItems: 'baseline', display: 'flex', fontWeight: 650, gap: '6px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                <span style={{ marginLeft: 'auto', opacity: .5, whiteSpace: 'nowrap' }}>{item.source === 'character' ? '角色卡' : '外部'}</span>
              </div>
              <div style={{ marginTop: '4px', opacity: .48 }}>{itemEnabled}/{itemEntries.length} 条启用{itemBlocked === 0 ? '' : ` · ${itemBlocked} 条等待兼容`}</div>
              <div data-agent-rp-world-info-book-actions style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '7px' }}>
                <button type="button" disabled={saving || itemEntries.length === 0 || itemEnabled === itemEntries.length} onClick={() => {
                  mutate({ operation: 'set-book-enabled', revision: worldInfo.revision, bookId: item.id, enabled: true })
                }} style={{ ...generationButtonStyle, fontSize: '10px', padding: '4px 7px' }}>整本启用</button>
                <button type="button" disabled={saving || itemEnabled === 0} onClick={() => {
                  mutate({ operation: 'set-book-enabled', revision: worldInfo.revision, bookId: item.id, enabled: false })
                }} style={{ ...generationButtonStyle, fontSize: '10px', padding: '4px 7px' }}>整本关闭</button>
                {item.entries.some(candidate => candidate.modified || candidate.deleted) && <button type="button" disabled={saving} onClick={() => {
                  mutate({ operation: 'reset-book', revision: worldInfo.revision, bookId: item.id })
                }} style={{ ...generationButtonStyle, fontSize: '10px', padding: '4px 7px' }}>恢复原文件</button>}
              </div>
            </div>
            <div style={{ display: 'grid', gap: '5px' }}>
              {item.entries.map(candidate => {
                const key = `${item.id}\u0000${candidate.index}`
                return <button key={key} type="button" aria-current={key === selectedKey} onClick={() => {
                  setSelectedKey(key); setEditing(false); setError(undefined)
                }} style={{
                  alignItems: 'center', background: key === selectedKey ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                  border: key === selectedKey ? `1px solid color-mix(in srgb, ${color} 34%, transparent)` : '1px solid transparent',
                  borderRadius: '9px', color: 'inherit', cursor: 'pointer', display: 'grid', font: 'inherit',
                  gridTemplateColumns: '8px minmax(0, 1fr)', gap: '8px', padding: '9px 8px', textAlign: 'left',
                }}>
                  <span aria-hidden="true" style={{
                    background: candidate.active ? '#75c79a' : candidate.deleted || !candidate.enabled ? '#6d6d72' : '#c5a769',
                    borderRadius: '50%', height: '7px', width: '7px',
                  }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '12px', fontWeight: 580, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{worldInfoEntryTitle(candidate)}</span>
                    <span style={{ display: 'block', fontSize: '10px', marginTop: '3px', opacity: .45 }}>{worldInfoReason(candidate).title}{candidate.modified ? ' · 已修改' : ''}</span>
                  </span>
                </button>
              })}
            </div>
          </section>
          })}
        </nav>}
        {pair !== undefined && book !== undefined && entry !== undefined && reason !== undefined && <main data-agent-rp-world-info-pane="detail" style={{
          boxSizing: 'border-box', flex: '1 1 auto', minWidth: 0, overflowY: 'auto', padding: narrow ? '16px 16px 24px' : '22px 24px 28px',
        }}>
          {narrow && <button type="button" data-agent-rp-action="back-world-info-list" onClick={() => { setSelectedKey(undefined); setEditing(false); setError(undefined) }} style={{
            ...generationButtonStyle, marginBottom: '16px', padding: '7px 10px',
          }}>‹ 返回条目列表</button>}
          {!editing && <>
            <div style={{ alignItems: 'flex-start', display: 'flex', gap: '12px' }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: '17px', margin: 0 }}>{worldInfoEntryTitle(entry)}</h3>
                <div style={{ fontSize: '11px', marginTop: '5px', opacity: .48 }}>{book.name} · #{entry.sourceId} · 顺序 {entry.insertionOrder}</div>
              </div>
              <span style={{
                background: entry.active ? 'rgba(76,178,119,.13)' : 'var(--dsw-alias-bg-layer-1, #222226)',
                border: `1px solid ${entry.active ? 'rgba(91,200,139,.33)' : 'var(--dsw-alias-border-l2, #414146)'}`,
                borderRadius: '999px', fontSize: '11px', marginLeft: 'auto', padding: '5px 9px', whiteSpace: 'nowrap',
              }}>{reason.title}</span>
            </div>
            <p style={{ fontSize: '12px', lineHeight: 1.6, margin: '14px 0 0', opacity: .6 }}>{reason.detail}</p>
            {(entry.matchedKeys.length > 0 || entry.matchedSecondaryKeys.length > 0) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
              {[...entry.matchedKeys, ...entry.matchedSecondaryKeys].map((key, index) => <span key={`${key}-${index}`} style={{ ...chipStyle, color: '#91d8ae' }}>命中 · {key}</span>)}
            </div>}
            <section style={{ background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)', borderRadius: '11px', marginTop: '18px', padding: '14px 15px' }}>
              <div style={{ fontSize: '11px', fontWeight: 650, opacity: .48 }}>设定正文</div>
              <div style={{ fontSize: '13px', lineHeight: 1.72, marginTop: '8px', maxHeight: '240px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{entry.content || '（空）'}</div>
            </section>
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: '17px' }}>
              <DetailSection title="主关键词" text={entry.constant ? '常驻，无需关键词' : entry.keys.join('、') || '未设置'} />
              {entry.selective && <DetailSection title="次要关键词" text={entry.secondaryKeys.join('、') || '未设置'} />}
              <DetailSection title="注入位置" text={entry.position === 'before_char' ? '角色设定之前'
                : entry.position === 'after_char' ? '角色设定之后'
                  : `对话深度 ${entry.injectionDepth ?? 4} · ${entry.injectionRole === 'assistant' ? '助手'
                    : entry.injectionRole === 'user' ? '用户' : '系统'}`} />
              <DetailSection title="估算占用" text={`约 ${entry.approximateTokens} tokens${book.tokenBudget === undefined ? '' : ` · 本书预算 ${book.tokenBudget}`}`} />
            </div>
            {(entry.useRegex || entry.hasDecorators || entry.compatibilityBlockers.length > 0 || book.recursiveScanning || book.degradations.length > 0) && <details style={{ fontSize: '12px', lineHeight: 1.65, marginTop: '17px', opacity: .68 }}>
              <summary style={{ cursor: 'pointer' }}>兼容性信息</summary>
              <div style={{ marginTop: '7px' }}>{[
                entry.useRegex ? '正则关键词在受限 QuickJS 环境中执行' : '',
                entry.hasDecorators ? '装饰器已保留，当前不执行' : '',
                ...entry.compatibilityBlockers.map(value => `${worldInfoCompatibilityLabel(value)}已保留，等待原生兼容`),
                book.recursiveScanning ? '递归扫描已保留，当前不执行' : '',
                ...book.degradations,
              ].filter(Boolean).join('\n')}</div>
            </details>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '22px' }}>
              {!entry.deleted && <button type="button" disabled={saving} onClick={() => {
                mutate({ operation: 'toggle', revision: worldInfo.revision, bookId: book.id, entryIndex: entry.index, enabled: !entry.enabled })
              }} style={generationButtonStyle}>{entry.enabled ? '关闭条目' : '打开条目'}</button>}
              {!entry.deleted && <button type="button" disabled={saving} onClick={() => { setDraft(editableFromProjection(entry)); setEditing(true) }} style={generationButtonStyle}>编辑</button>}
              <button type="button" disabled={saving} onClick={() => {
                mutate({ operation: 'delete', revision: worldInfo.revision, bookId: book.id, entryIndex: entry.index, deleted: !entry.deleted })
              }} style={generationButtonStyle}>{entry.deleted ? '恢复条目' : '从本会话移除'}</button>
              {(entry.modified || entry.deleted) && <button type="button" disabled={saving} onClick={() => {
                mutate({ operation: 'reset-entry', revision: worldInfo.revision, bookId: book.id, entryIndex: entry.index })
              }} style={{ ...generationButtonStyle, marginLeft: 'auto' }}>恢复原始条目</button>}
            </div>
          </>}
          {editing && draft !== undefined && <WorldInfoEntryEditor
            draft={draft}
            saving={saving}
            onCancel={() => { setEditing(false); setError(undefined) }}
            onSave={value => mutate({
              operation: 'edit', revision: worldInfo.revision, bookId: book.id, entryIndex: entry.index, entry: value,
            }, () => { setEditing(false) })}
          />}
          {error !== undefined && <div role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.55, marginTop: '14px' }}>{error}</div>}
        </main>}
      </div>
      </>}
    </section>
  </div>
  {libraryOpen && <WorldInfoLibraryAttachDialog
    books={worldInfo.books}
    listWorldInfos={listWorldInfos}
    onAttach={onAttach}
    onClose={() => { setLibraryOpen(false) }}
  />}
  </>
}

function WorldInfoEntryEditor({ draft, saving, onCancel, onSave }: {
  readonly draft: WorldInfoEditableEntry
  readonly saving: boolean
  readonly onCancel: () => void
  readonly onSave: (value: WorldInfoEditableEntry) => void
}) {
  const [value, setValue] = useState(draft)
  const validPlacement = value.position !== 'at_depth' || (
    Number.isSafeInteger(value.injectionDepth) && (value.injectionDepth ?? -1) >= 0
    && (value.injectionDepth ?? Number.POSITIVE_INFINITY) <= 10_000
    && (value.injectionRole === 'system' || value.injectionRole === 'user' || value.injectionRole === 'assistant')
  )
  const inputStyle = {
    background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #414146)',
    borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '8px 9px', width: '100%',
  } as const
  const list = (source: string): readonly string[] => source.split(/[,，\n]/u).map(item => item.trim()).filter(Boolean)
  return <form onSubmit={event => { event.preventDefault(); onSave(value) }}>
    <div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
      <div>
        <h3 style={{ fontSize: '17px', margin: 0 }}>编辑世界书条目</h3>
        <div style={{ fontSize: '11px', marginTop: '5px', opacity: .48 }}>修改只作用于当前会话，原文件不会被覆盖</div>
      </div>
      <button type="button" onClick={onCancel} style={{ ...generationButtonStyle, marginLeft: 'auto' }}>取消</button>
      <button type="submit" disabled={saving || value.content.trim() === '' || !validPlacement} style={{ ...generationButtonStyle, opacity: value.content.trim() === '' || !validPlacement ? .35 : 1 }}>{saving ? '保存中…' : '保存'}</button>
    </div>
    <div style={{ display: 'grid', gap: '13px', marginTop: '19px' }}>
      <label style={{ fontSize: '12px' }}>名称
        <input value={value.name ?? ''} onChange={event => { setValue(current => ({ ...current, name: event.target.value })) }} style={{ ...inputStyle, marginTop: '6px' }} placeholder="可选；留白时显示首个关键词" />
      </label>
      <label style={{ fontSize: '12px' }}>设定正文
        <textarea value={value.content} rows={8} onChange={event => { setValue(current => ({ ...current, content: event.target.value })) }} style={{ ...inputStyle, lineHeight: 1.65, marginTop: '6px', resize: 'vertical' }} />
      </label>
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <label style={{ fontSize: '12px' }}>主关键词
          <textarea value={value.keys.join('\n')} rows={3} disabled={value.constant} onChange={event => { setValue(current => ({ ...current, keys: list(event.target.value) })) }} style={{ ...inputStyle, lineHeight: 1.5, marginTop: '6px', opacity: value.constant ? .45 : 1, resize: 'vertical' }} placeholder="每行或逗号分隔" />
        </label>
        <label style={{ fontSize: '12px' }}>次要关键词
          <textarea value={value.secondaryKeys.join('\n')} rows={3} disabled={!value.selective || value.constant} onChange={event => { setValue(current => ({ ...current, secondaryKeys: list(event.target.value) })) }} style={{ ...inputStyle, lineHeight: 1.5, marginTop: '6px', opacity: !value.selective || value.constant ? .45 : 1, resize: 'vertical' }} placeholder="每行或逗号分隔" />
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 20px' }}>
        {([
          ['enabled', '启用条目'], ['constant', '常驻'], ['selective', '使用次要关键词'],
          ['caseSensitive', '区分大小写'], ['matchWholeWords', '完整词匹配'], ['ignoreBudget', '忽略预算'],
        ] as const).map(([key, label]) => <label key={key} style={{ alignItems: 'center', display: 'flex', fontSize: '12px', gap: '7px' }}>
          <input type="checkbox" checked={value[key]} onChange={event => { setValue(current => ({ ...current, [key]: event.target.checked })) }} />{label}
        </label>)}
      </div>
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <label style={{ fontSize: '12px' }}>注入位置
          <select value={value.position} onChange={event => { setValue(current => {
            const position = event.target.value as WorldInfoEditableEntry['position']
            if (position === 'at_depth') return { ...current, position, injectionDepth: current.injectionDepth ?? 4, injectionRole: current.injectionRole ?? 'system' }
            const next = { ...current, position }; delete next.injectionDepth; delete next.injectionRole; return next
          }) }} style={{ ...inputStyle, marginTop: '6px' }}>
            <option value="before_char">角色设定之前</option><option value="after_char">角色设定之后</option><option value="at_depth">对话历史内</option>
          </select>
        </label>
        {value.position === 'at_depth' && <>
          <label style={{ fontSize: '12px' }}>历史深度
            <input type="number" min={0} max={10000} step={1} value={value.injectionDepth ?? ''} onChange={event => {
              const source = event.target.value
              setValue(current => {
                if (source !== '') return { ...current, injectionDepth: Number(source) }
                const next = { ...current }; delete next.injectionDepth; return next
              })
            }} style={{ ...inputStyle, marginTop: '6px' }} />
          </label>
          <label style={{ fontSize: '12px' }}>消息角色
            <select value={value.injectionRole ?? 'system'} onChange={event => { setValue(current => ({ ...current, injectionRole: event.target.value as NonNullable<WorldInfoEditableEntry['injectionRole']> })) }} style={{ ...inputStyle, marginTop: '6px' }}>
              <option value="system">系统</option><option value="user">用户</option><option value="assistant">助手</option>
            </select>
          </label>
        </>}
        <label style={{ fontSize: '12px' }}>次要条件
          <select disabled={!value.selective} value={value.secondaryLogic} onChange={event => { setValue(current => ({ ...current, secondaryLogic: event.target.value as WorldInfoEditableEntry['secondaryLogic'] })) }} style={{ ...inputStyle, marginTop: '6px', opacity: value.selective ? 1 : .45 }}>
            <option value="and-any">任意命中</option><option value="and-all">全部命中</option><option value="not-any">全部不出现</option><option value="not-all">不是全部出现</option>
          </select>
        </label>
        <label style={{ fontSize: '12px' }}>顺序
          <input type="number" value={value.insertionOrder} onChange={event => { setValue(current => ({ ...current, insertionOrder: Number(event.target.value) })) }} style={{ ...inputStyle, marginTop: '6px' }} />
        </label>
        <label style={{ fontSize: '12px' }}>扫描深度
          <input type="number" min={0} value={value.scanDepth ?? ''} placeholder="继承世界书" onChange={event => { setValue(current => {
            const next = { ...current }; if (event.target.value === '') delete next.scanDepth; else next.scanDepth = Number(event.target.value); return next
          }) }} style={{ ...inputStyle, marginTop: '6px' }} />
        </label>
      </div>
    </div>
  </form>
}

function tavernHelperSummaryText(summary: NonNullable<CharacterLibrarySummary['tavernHelper']>): string {
  return [
    summary.format === 'entries' ? '条目数组' : '对象格式',
    `${summary.enabledScriptCount}/${summary.scriptCount} 条脚本启用`,
    `${summary.variableCount} 个变量`,
    summary.ignoredFieldCount === 0 ? undefined : `${summary.ignoredFieldCount} 个扩展字段未接管`,
  ].filter((value): value is string => value !== undefined).join(' · ')
}

function presetTavernHelperSummaryText(summary: NonNullable<PresetLibrarySummary['tavernHelper']>): string {
  const missing = summary.expectedScriptCount === undefined
    ? 0 : Math.max(0, summary.expectedScriptCount - summary.scriptCount)
  return [
    summary.format === 'entries' ? '条目数组' : summary.format === 'object' ? '对象格式' : undefined,
    missing > 0 ? `旧导入缺少 ${missing} 个脚本，建议重新导入`
      : `${summary.enabledScriptCount}/${summary.scriptCount} 条脚本启用`,
    summary.variableCount === undefined ? undefined : `${summary.variableCount} 个变量`,
    summary.ignoredFieldCount === undefined || summary.ignoredFieldCount === 0
      ? undefined : `${summary.ignoredFieldCount} 个扩展字段未接管`,
  ].filter((value): value is string => value !== undefined).join(' · ')
}

function characterDegradationLabel(value: CharacterLibraryDetail['degradations'][number]): string {
  switch (value) {
    case 'character-assets': return '外部角色资源'
    case 'future-card-version': return '未来版本字段'
    case 'group-greetings': return '群聊开场'
    case 'lorebook-decorators': return '世界书装饰器'
    case 'lorebook-position': return '世界书特殊插入位置'
    case 'lorebook-regex': return '世界书正则'
    case 'lorebook-recursion': return '世界书递归'
    case 'remote-assets': return '远程资源'
  }
}

type TavernPreflightLoadState = {
  readonly selectionKey: string
  readonly status: 'loading'
} | {
  readonly selectionKey: string
  readonly status: 'ready'
  readonly result: TavernPreflightResult
} | {
  readonly selectionKey: string
  readonly status: 'error'
  readonly error: string
}

type PreflightPermissionDuration = 'session' | 'remember' | 'trust'

interface PreflightApprovalResult {
  readonly ready: boolean
  readonly character: CharacterLibraryDetail
  readonly resourcePermissions?: AgentRpSessionResourcePermissions
}

interface TavernPreflightApprovalOutcome {
  readonly ready: boolean
  readonly permissions?: AgentRpSessionResourcePermissions['tavern']
}

/** Share one exact Tavern resource plan across every way a roleplay Session can start. */
function useTavernLaunchPreflight(input: {
  readonly expected: boolean
  readonly permissionOwnerId?: string
  readonly characterId?: string
  readonly presetId?: string
  readonly resources?: readonly import('../roleplay-resource-catalog-protocol.ts').RoleplayResourceSelection[]
}) {
  const [approvedScripts, setApprovedScripts] = useState(readApprovedTavernScriptOrigins)
  const [approvedImages, setApprovedImages] = useState(readApprovedTavernScriptImages)
  const [approvedStyles, setApprovedStyles] = useState(readApprovedTavernScriptStyles)
  const [approvedFonts, setApprovedFonts] = useState(readApprovedTavernScriptFonts)
  const [approvedFrames, setApprovedFrames] = useState(readApprovedTavernScriptFrames)
  const [loadState, setLoadState] = useState<TavernPreflightLoadState>()
  const [approving, setApproving] = useState(false)
  const resourceKey = input.permissionOwnerId === undefined ? undefined : JSON.stringify([
    input.permissionOwnerId, input.resources ?? null, input.characterId ?? null, input.presetId ?? null,
  ])
  const [sessionApproval, setSessionApproval] = useState<{
    readonly resourceKey: string
    readonly permissions: AgentRpSessionResourcePermissions['tavern']
  }>()
  const sessionPermissions = resourceKey !== undefined && sessionApproval?.resourceKey === resourceKey
    ? sessionApproval.permissions : { scripts: [], images: [], styles: [], fonts: [], frames: [] }
  const effectiveScripts = new Set([...approvedScripts, ...sessionPermissions.scripts])
  const effectiveImages = new Set([...approvedImages, ...sessionPermissions.images])
  const effectiveStyles = new Set([...approvedStyles, ...sessionPermissions.styles])
  const effectiveFonts = new Set([...approvedFonts, ...sessionPermissions.fonts])
  const effectiveFrames = new Set([...approvedFrames, ...sessionPermissions.frames])
  const approvals = input.permissionOwnerId === undefined ? []
    : tavernResourcePreflightApprovals(
        effectiveScripts, effectiveStyles, input.permissionOwnerId, input.presetId,
      )
  const selectionKey = !input.expected || input.permissionOwnerId === undefined
    || (input.resources === undefined && input.characterId === undefined && input.presetId === undefined)
    || input.resources?.length === 0 ? undefined : JSON.stringify([
      input.permissionOwnerId, input.resources ?? null, input.characterId ?? null, input.presetId ?? null, approvals,
    ])
  const current = loadState?.selectionKey === selectionKey ? loadState : undefined
  const result = current?.status === 'ready' ? current.result : undefined
  const loading = selectionKey !== undefined && (current === undefined || current.status === 'loading')
  const error = current?.status === 'error' ? current.error : undefined
  useEffect(() => {
    if (selectionKey === undefined) {
      setLoadState(undefined)
      return
    }
    // An approval stage already fetched this exact plan so the next render can
    // reveal nested CSS/font permissions without repeating the Host request.
    if (loadState?.selectionKey === selectionKey) return
    const controller = new AbortController()
    setLoadState({ selectionKey, status: 'loading' })
    const request = input.resources === undefined ? {
      format: 0 as const,
      ...(input.characterId === undefined ? {} : { characterId: input.characterId }),
      ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
      scriptApprovals: approvals,
    } : { format: 1 as const, resources: input.resources, scriptApprovals: approvals }
    void fetchTavernPreflight(request, controller.signal).then(value => {
      if (!controller.signal.aborted) setLoadState({ selectionKey, status: 'ready', result: value })
    }, reason => {
      if (!controller.signal.aborted) setLoadState({
        selectionKey,
        status: 'error',
        error: reason instanceof Error ? reason.message : String(reason),
      })
    })
    return () => { controller.abort() }
  }, [selectionKey])
  const pending = input.permissionOwnerId === undefined ? [] : pendingTavernScriptResourcePermissions({
    characterId: input.permissionOwnerId,
    ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
    entries: result?.entries.map(entry => ({
      scope: entry.scope,
      scriptId: entry.scriptId,
      scriptOrigins: entry.requestedScriptOrigin === undefined ? [] : [entry.requestedScriptOrigin],
      imageOrigins: entry.remoteImageOrigins,
      styleOrigins: entry.remoteStyleOrigins,
      fontOrigins: entry.remoteFontOrigins,
      frameOrigins: entry.remoteFrameOrigins,
    })) ?? [],
    approvedScripts: effectiveScripts,
    approvedImages: effectiveImages,
    approvedStyles: effectiveStyles,
    approvedFonts: effectiveFonts,
    approvedFrames: effectiveFrames,
    trustedScriptOrigins: BUILT_IN_TAVERN_SCRIPT_ORIGINS,
  })
  const approve = async (
    duration: PreflightPermissionDuration,
  ): Promise<TavernPreflightApprovalOutcome> => {
    setApproving(true)
    try {
      const scripts = pending.filter(permission => permission.kind === 'script')
      const images = pending.filter(permission => permission.kind === 'image')
      const styles = pending.filter(permission => permission.kind === 'style')
      const fonts = pending.filter(permission => permission.kind === 'font')
      const frames = pending.filter(permission => permission.kind === 'frame')
      const add = (current: ReadonlySet<string>, values: readonly { readonly approvalKey: string }[]): Set<string> => {
        const next = new Set(current)
        for (const value of values) next.add(value.approvalKey)
        return next
      }
      let nextScripts = add(effectiveScripts, scripts)
      let nextImages = add(effectiveImages, images)
      let nextStyles = add(effectiveStyles, styles)
      let nextFonts = add(effectiveFonts, fonts)
      let nextFrames = add(effectiveFrames, frames)
      let exactSessionPermissions: AgentRpSessionResourcePermissions['tavern'] | undefined
      if (duration === 'session') {
        exactSessionPermissions = {
          scripts: [...new Set([...sessionPermissions.scripts, ...scripts.map(value => value.approvalKey)])],
          images: [...new Set([...sessionPermissions.images, ...images.map(value => value.approvalKey)])],
          styles: [...new Set([...sessionPermissions.styles, ...styles.map(value => value.approvalKey)])],
          fonts: [...new Set([...sessionPermissions.fonts, ...fonts.map(value => value.approvalKey)])],
          frames: [...new Set([...sessionPermissions.frames, ...frames.map(value => value.approvalKey)])],
        }
        if (resourceKey !== undefined) setSessionApproval({ resourceKey, permissions: exactSessionPermissions })
      } else {
        // A player may change “仅本次” to a remembered choice between CSS
        // discovery stages. Persist the whole effective grant, not only the
        // newly visible origins, so the final Session never loses stage one.
        if (nextScripts.size !== approvedScripts.size) {
          writeApprovedTavernScriptOrigins(nextScripts)
          setApprovedScripts(nextScripts)
        }
        if (nextImages.size !== approvedImages.size) {
          writeApprovedTavernScriptImages(nextImages)
          setApprovedImages(nextImages)
        }
        if (nextStyles.size !== approvedStyles.size) {
          writeApprovedTavernScriptStyles(nextStyles)
          setApprovedStyles(nextStyles)
        }
        if (nextFonts.size !== approvedFonts.size) {
          writeApprovedTavernScriptFonts(nextFonts)
          setApprovedFonts(nextFonts)
        }
        if (nextFrames.size !== approvedFrames.size) {
          writeApprovedTavernScriptFrames(nextFrames)
          setApprovedFrames(nextFrames)
        }
        if (sessionApproval?.resourceKey === resourceKey) setSessionApproval(undefined)
      }
      if (input.permissionOwnerId === undefined || selectionKey === undefined
        || !pending.some(permission => permission.kind === 'script' || permission.kind === 'style')) {
        return { ready: true, ...(exactSessionPermissions === undefined ? {} : { permissions: exactSessionPermissions }) }
      }
      const nextApprovals = tavernResourcePreflightApprovals(
        nextScripts, nextStyles, input.permissionOwnerId, input.presetId,
      )
      const nextSelectionKey = JSON.stringify([
        input.permissionOwnerId, input.resources ?? null, input.characterId ?? null, input.presetId ?? null,
        nextApprovals,
      ])
      const request = input.resources === undefined ? {
        format: 0 as const,
        ...(input.characterId === undefined ? {} : { characterId: input.characterId }),
        ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
        scriptApprovals: nextApprovals,
      } : { format: 1 as const, resources: input.resources, scriptApprovals: nextApprovals }
      try {
        const nextResult = await fetchTavernPreflight(request, new AbortController().signal)
        setLoadState({ selectionKey: nextSelectionKey, status: 'ready', result: nextResult })
        const nextPending = pendingTavernScriptResourcePermissions({
          characterId: input.permissionOwnerId,
          ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
          entries: nextResult.entries.map(entry => ({
            scope: entry.scope, scriptId: entry.scriptId,
            scriptOrigins: entry.requestedScriptOrigin === undefined ? [] : [entry.requestedScriptOrigin],
            imageOrigins: entry.remoteImageOrigins, styleOrigins: entry.remoteStyleOrigins,
            fontOrigins: entry.remoteFontOrigins, frameOrigins: entry.remoteFrameOrigins,
          })),
          approvedScripts: nextScripts, approvedImages: nextImages, approvedStyles: nextStyles,
          approvedFonts: nextFonts, approvedFrames: nextFrames,
          trustedScriptOrigins: BUILT_IN_TAVERN_SCRIPT_ORIGINS,
        })
        return {
          ready: nextPending.length === 0,
          ...(exactSessionPermissions === undefined ? {} : { permissions: exactSessionPermissions }),
        }
      } catch (reason: unknown) {
        setLoadState({
          selectionKey: nextSelectionKey, status: 'error',
          error: reason instanceof Error ? reason.message : String(reason),
        })
        return { ready: false, ...(exactSessionPermissions === undefined ? {} : { permissions: exactSessionPermissions }) }
      }
    } finally {
      setApproving(false)
    }
  }
  return {
    approve,
    approving,
    error,
    loading,
    pending,
    result,
    settled: !input.expected || result !== undefined || error !== undefined,
  }
}

function AdditionalWorldInfoSelection({
  listWorldInfos,
  selectedWorldInfoIds,
  onChange,
  excludedIds = [],
  embedded = false,
}: {
  readonly listWorldInfos: HeaderProps['listWorldInfos']
  readonly selectedWorldInfoIds: readonly string[] | undefined
  readonly onChange: (ids: readonly string[]) => void
  readonly excludedIds?: readonly string[]
  readonly embedded?: boolean
}) {
  const [worldInfos, setWorldInfos] = useState<readonly WorldInfoLibraryUpload[]>()
  const [worldInfoOpen, setWorldInfoOpen] = useState(false)
  const [worldInfoError, setWorldInfoError] = useState<string>()
  useEffect(() => {
    if (worldInfos !== undefined || worldInfoError !== undefined) return
    let current = true
    void listWorldInfos().then(value => {
      if (current) setWorldInfos(value)
    }, reason => {
      if (current) setWorldInfoError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listWorldInfos, worldInfoError, worldInfos])
  const availableWorldInfos = worldInfos?.filter(entry => !excludedIds.includes(entry.id))
  const selection = selectedWorldInfoIds ?? []
  useEffect(() => {
    if (selectedWorldInfoIds !== undefined || availableWorldInfos === undefined) return
    const defaults = availableWorldInfos.filter(entry => entry.defaultForNewSessions).slice(0, 16).map(entry => entry.id)
    onChange(defaults)
  }, [availableWorldInfos, onChange, selectedWorldInfoIds])
  return <div style={{ marginTop: embedded ? 0 : '18px' }}>
    <button type="button" aria-expanded={worldInfoOpen} data-agent-rp-world-info-selection={selection.length}
      onClick={() => { setWorldInfoOpen(value => !value) }} style={{
        alignItems: 'center', background: embedded ? 'transparent' : 'var(--dsw-alias-bg-layer-1, #202024)',
        border: embedded ? 0 : '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '10px', color: 'inherit',
        cursor: 'pointer', display: 'flex', font: 'inherit', gap: '9px', padding: embedded ? 0 : '10px 11px',
        textAlign: 'left', width: '100%',
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: '12px' }}>附加世界书</strong>
        <span style={{ display: 'block', fontSize: '11px', marginTop: '3px', opacity: .5 }}>
          {selectedWorldInfoIds === undefined ? '正在读取默认设置…'
            : selection.length === 0 ? '不额外加载' : `已选择 ${selection.length} 本`}
        </span>
      </span>
      <DisclosureChevron expanded={worldInfoOpen} />
    </button>
    {worldInfoOpen && <div style={{
      border: '1px solid var(--dsw-alias-border-l2, #39393c)', borderRadius: '10px',
      display: 'grid', gap: '7px', marginTop: '7px', maxHeight: '260px', overflowY: 'auto', padding: '9px',
    }}>
      {worldInfoError !== undefined
        ? <div role="alert" style={{ alignItems: 'center', color: '#e88989', display: 'flex', fontSize: '11px', gap: '8px', lineHeight: 1.5 }}>
            <span style={{ flex: 1 }}>{worldInfoError}</span>
            <button type="button" onClick={() => { setWorldInfoError(undefined) }} style={{
              background: 'transparent', border: '1px solid currentColor', borderRadius: '7px', color: 'inherit',
              cursor: 'pointer', font: 'inherit', padding: '4px 7px', whiteSpace: 'nowrap',
            }}>重试</button>
          </div>
        : availableWorldInfos === undefined
          ? <div style={{ fontSize: '11px', opacity: .5 }}>正在读取世界书库…</div>
          : availableWorldInfos.length === 0
            ? <div style={{ fontSize: '11px', opacity: .5 }}>
                {worldInfos?.length === 0 ? '世界书库暂无内容，可从资源中心导入' : '没有其他可附加的世界书'}
              </div>
            : availableWorldInfos.map(entry => {
                const order = selection.indexOf(entry.id)
                const checked = order >= 0
                const disabled = !checked && selection.length >= 16
                return <label key={entry.id} data-agent-rp-world-info-option={entry.id} style={{
                  alignItems: 'center', background: checked ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
                  borderRadius: '8px', cursor: disabled ? 'default' : 'pointer', display: 'flex', gap: '9px',
                  opacity: disabled ? .42 : 1, padding: '8px 9px',
                }}>
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={event => {
                    onChange(event.target.checked
                      ? [...selection, entry.id]
                      : selection.filter(id => id !== entry.id))
                  }} style={{ accentColor: color, margin: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</strong>
                    <span style={{ display: 'block', fontSize: '10px', marginTop: '3px', opacity: .48 }}>
                      {entry.entryCount} 条目{entry.defaultForNewSessions ? ' · 新会话默认' : ''}{entry.degradations.length === 0 ? '' : ` · ${entry.degradations.length} 项兼容提醒`}
                    </span>
                  </span>
                  {checked && <span aria-label={`加载顺序 ${order + 1}`} style={{
                    alignItems: 'center', background: `color-mix(in srgb, ${color} 18%, transparent)`,
                    borderRadius: '999px', display: 'inline-flex', fontSize: '10px', height: '20px',
                    justifyContent: 'center', minWidth: '20px', padding: '0 5px',
                  }}>{order + 1}</span>}
                </label>
              })}
      <div style={{ fontSize: '10px', lineHeight: 1.5, opacity: .46, padding: '1px 3px' }}>
        标记为新会话默认的世界书会自动选中，也可以在这里临时取消；最多 16 本
      </div>
    </div>}
  </div>
}

type RoleplayLaunchMode = 'character' | 'world-info'

/** Compose peer RP resources for one new Session without turning any one library into their owner. */
function RoleplayLaunchComposer({
  runtimeDiagnostics, listCharacters, readCharacter, listWorldInfos, listPresets, listRegexPacks,
  listAgentCapabilityPresets, listPersonas,
  onClose, onManageResources, onStartCharacter, onStartWorldInfo,
}: {
  readonly runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry
  readonly listCharacters: HeaderProps['listCharacters']
  readonly readCharacter: HeaderProps['readCharacter']
  readonly listWorldInfos: HeaderProps['listWorldInfos']
  readonly listPresets: HeaderProps['listPresets']
  readonly listRegexPacks: HeaderProps['listRegexPacks']
  readonly listAgentCapabilityPresets: HeaderProps['listAgentCapabilityPresets']
  readonly listPersonas: HeaderProps['listPersonas']
  readonly onClose: () => void
  readonly onManageResources: (section: 'characters' | 'world-info' | 'regex-packs') => void
  readonly onStartCharacter: (
    character: CharacterLibraryDetail,
    greetingIndex: number,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    regexPackIds?: readonly string[],
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
  ) => Promise<void>
  readonly onStartWorldInfo: (
    worldInfo: WorldInfoLibraryUpload,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    regexPackIds?: readonly string[],
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
  ) => Promise<void>
}) {
  const narrow = useNarrowCharacterLibrary()
  const [mode, setMode] = useState<RoleplayLaunchMode>('character')
  const [characters, setCharacters] = useState<readonly CharacterLibrarySummary[]>()
  const [characterId, setCharacterId] = useState('')
  const [character, setCharacter] = useState<CharacterLibraryDetail>()
  const characterRequest = useRef(0)
  const [actorDetail, setActorDetail] = useState<RoleplayActorResourceDetail>()
  const [worldInfos, setWorldInfos] = useState<readonly WorldInfoLibraryUpload[]>()
  const [primaryWorldInfoId, setPrimaryWorldInfoId] = useState('')
  const [selectedWorldInfoIds, setSelectedWorldInfoIds] = useState<readonly string[]>()
  const [regexPacks, setRegexPacks] = useState<readonly RegexPackLibrarySummary[]>()
  const [selectedRegexPackIds, setSelectedRegexPackIds] = useState<readonly string[]>([])
  const [personas, setPersonas] = useState<readonly PersonaLibraryEntry[]>()
  const [personaId, setPersonaId] = useState('')
  const [greetingIndex, setGreetingIndex] = useState(0)
  const [permissionDuration, setPermissionDuration] = useState<PreflightPermissionDuration>('remember')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  const { entries: presets, error: presetError, presetId, selectPreset } = usePresetPreference(listPresets)
  const {
    entries: agentCapabilityPresets,
    error: agentCapabilityPresetError,
    presetId: agentCapabilityPresetId,
    selectPreset: selectAgentCapabilityPreset,
  } = useAgentCapabilityPresetPreference(listAgentCapabilityPresets)
  const selectedPresetId = presetId === '' ? undefined : presetId
  const selectedPreset = presets?.find(entry => entry.id === selectedPresetId)
  const selectedAgentCapabilityPreset = agentCapabilityPresets?.find(entry => entry.id === agentCapabilityPresetId)
  const primaryWorldInfo = worldInfos?.find(entry => entry.id === primaryWorldInfoId)
  const selectedPersona = personas?.find(entry => entry.id === personaId)

  useEffect(() => {
    let current = true
    void listCharacters('active').then(entries => {
      if (!current) return
      setCharacters(entries)
      setCharacterId(value => value !== '' && entries.some(entry => entry.id === value) ? value : entries[0]?.id ?? '')
    }, reason => {
      if (!current) return
      setCharacters([])
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listCharacters])
  useEffect(() => {
    let current = true
    void listWorldInfos().then(entries => {
      if (!current) return
      setWorldInfos(entries)
      setPrimaryWorldInfoId(value => value !== '' && entries.some(entry => entry.id === value)
        ? value : entries.find(entry => entry.defaultForNewSessions)?.id ?? entries[0]?.id ?? '')
    }, reason => {
      if (!current) return
      setWorldInfos([])
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listWorldInfos])
  useEffect(() => {
    let current = true
    void listRegexPacks().then(entries => {
      if (current) setRegexPacks(entries)
    }, reason => {
      if (!current) return
      setRegexPacks([])
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listRegexPacks])
  useEffect(() => {
    let current = true
    void listPersonas().then(entries => {
      if (current) setPersonas(entries)
    }, reason => {
      if (!current) return
      setPersonas([])
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [listPersonas])
  useEffect(() => {
    const request = ++characterRequest.current
    if (characterId === '') {
      setCharacter(undefined)
      return
    }
    setCharacter(undefined)
    setGreetingIndex(0)
    void readCharacter(characterId).then(entry => {
      if (characterRequest.current !== request) return
      setCharacter(entry)
      setPermissionDuration(entry.remoteResourcePolicy === 'isolated-https' ? 'trust' : 'remember')
    }, reason => {
      if (characterRequest.current !== request) return
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [characterId, readCharacter])
  useEffect(() => {
    const controller = new AbortController()
    if (characterId === '') {
      setActorDetail(undefined)
      return () => { controller.abort() }
    }
    setActorDetail(undefined)
    setGreetingIndex(0)
    void fetchRoleplayResourceDetail({
      kind: 'actor', id: characterLibraryRoleplayResourceId(characterId),
    }, controller.signal).then(response => {
      if (response.detail.kind !== 'actor') throw new Error('角色资源没有可用的开场详情')
      setActorDetail(response.detail)
    }, reason => {
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [characterId])
  useEffect(() => {
    if (mode === 'world-info' && permissionDuration === 'trust') setPermissionDuration('remember')
  }, [mode, permissionDuration])
  useEffect(() => {
    if (mode !== 'world-info' || primaryWorldInfoId === '' || selectedWorldInfoIds?.includes(primaryWorldInfoId) !== true) return
    setSelectedWorldInfoIds(selectedWorldInfoIds.filter(id => id !== primaryWorldInfoId))
  }, [mode, primaryWorldInfoId, selectedWorldInfoIds])

  const effectiveCharacter = mode === 'character' ? character : undefined
  const experienceSelection = mode === 'character'
    ? characterId === '' ? undefined : characterExperienceSelection({
      characterId,
      greetingIndex,
      ...(selectedPersona === undefined ? {} : { persona: selectedPersona }),
      ...(selectedPresetId === undefined ? {} : { presetId: selectedPresetId }),
      worldInfoIds: selectedWorldInfoIds ?? [],
      regexPackIds: selectedRegexPackIds,
    })
    : primaryWorldInfoId === '' ? undefined : sceneExperienceSelection({
      primaryWorldInfoId,
      ...(selectedPersona === undefined ? {} : { persona: selectedPersona }),
      ...(selectedPresetId === undefined ? {} : { presetId: selectedPresetId }),
      supportingWorldInfoIds: selectedWorldInfoIds ?? [],
      regexPackIds: selectedRegexPackIds,
    })
  const experienceResources = experienceSelection === undefined
    ? undefined : experiencePreflightResources(experienceSelection)
  const expectsTavernPreflight = (effectiveCharacter?.tavernHelper?.enabledScriptCount ?? 0) > 0
    || (selectedPresetId !== undefined
      && (presets === undefined || (selectedPreset?.tavernHelper?.enabledScriptCount ?? 0) > 0))
  const expectsCardResourcePreflight = (effectiveCharacter?.remoteResources.length ?? 0) > 0
  const expectsResourcePreflight = expectsTavernPreflight || expectsCardResourcePreflight
  const launchPreflight = useTavernLaunchPreflight({
    expected: expectsTavernPreflight,
    permissionOwnerId: effectiveCharacter?.id ?? DEFAULT_AGENT_RP_CHARACTER_NAME,
    ...(effectiveCharacter === undefined ? {} : { characterId: effectiveCharacter.id }),
    ...(selectedPresetId === undefined ? {} : { presetId: selectedPresetId }),
    ...(experienceResources === undefined ? {} : { resources: experienceResources }),
  })
  const pendingScriptResources = launchPreflight.pending
  const pendingCardResources = effectiveCharacter === undefined
    ? [] : blockedCardFrameResources(effectiveCharacter.remoteResources, effectiveCharacter)
  const pendingPermissions = pendingScriptResources.length + pendingCardResources.length
  const pendingHosts = [...new Set([
    ...pendingScriptResources.map(item => new URL(item.origin).hostname),
    ...pendingCardResources.map(item => new URL(item.origin).hostname),
  ])].sort()
  const launchPhase = tavernPreflightLaunchPhase({
    expected: expectsResourcePreflight,
    loading: launchPreflight.loading,
    settled: launchPreflight.settled,
    pendingPermissions,
  })
  const ready = mode === 'character'
    ? character !== undefined && actorDetail !== undefined && actorDetail.openings[greetingIndex] !== undefined
    : primaryWorldInfo !== undefined
  const busy = starting || launchPreflight.approving
  useAgentRpRuntimeDiagnosticContribution(
    runtimeDiagnostics,
    'launch-composer-preflight',
    ready ? {
      kind: 'preflight',
      facts: {
        status: launchPreflight.loading ? 'loading'
          : pendingPermissions > 0 ? 'permission-required'
            : launchPreflight.error !== undefined ? 'error' : 'ready',
        launch: launchPhase,
        startReadiness: launchPhase,
        startAction: launchPhase === 'checking' ? 'checking'
          : launchPhase === 'approval-required' ? 'approve-and-start' : 'start',
        permissionDuration,
        scripts: launchPreflight.result?.scripts ?? 0,
        cardResources: effectiveCharacter?.remoteResources.length ?? 0,
        pendingCardPermissions: pendingCardResources.length,
        pendingScriptPermissions: pendingScriptResources.length,
        pendingScriptOrigins: pendingScriptResources.filter(item => item.kind === 'script').length,
        pendingImageOrigins: pendingScriptResources.filter(item => item.kind === 'image').length,
        pendingStyleOrigins: pendingScriptResources.filter(item => item.kind === 'style').length,
        pendingFrameOrigins: pendingScriptResources.filter(item => item.kind === 'frame').length,
        pendingPermissions,
        failed: launchPreflight.result?.failed ?? 0,
      },
    } : undefined,
  )
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [busy, onClose])

  const approveCharacterResources = async (): Promise<PreflightApprovalResult> => {
    if (character === undefined) throw new Error('请先选择角色')
    let detail = character
    const exactCardResources = permissionDuration === 'trust' ? [] : blockedCardFrameResources(
      detail.remoteResources, { ...detail, remoteResourcePolicy: 'prompt' },
    )
    if (permissionDuration !== 'trust' && detail.remoteResourcePolicy === 'isolated-https') {
      detail = await updateCharacterRemoteResourcePolicy(detail.id, 'prompt')
      setCharacter(detail)
    }
    const tavern = await launchPreflight.approve(permissionDuration)
    if (!tavern.ready) return { ready: false, character: detail }
    if (permissionDuration === 'session') return {
      ready: true,
      character: detail,
      resourcePermissions: {
        tavern: tavern.permissions ?? { scripts: [], images: [], styles: [], fonts: [], frames: [] },
        card: exactCardResources,
      },
    }
    if (permissionDuration === 'trust') {
      detail = await updateCharacterRemoteResourcePolicy(detail.id, 'isolated-https')
      setCharacter(detail)
    } else {
      for (const resource of exactCardResources) {
        detail = await updateCharacterRemoteResource(detail.id, resource.origin, resource.type, true)
        setCharacter(detail)
      }
    }
    return { ready: true, character: detail }
  }
  const start = (): void => {
    if (!ready || busy || launchPhase === 'checking') return
    setStarting(true)
    setError(undefined)
    const persona = selectedPersona === undefined ? undefined : {
      id: selectedPersona.id, name: selectedPersona.name, description: selectedPersona.description,
    }
    const additionalWorldInfoIds = (selectedWorldInfoIds ?? [])
      .filter(id => mode !== 'world-info' || id !== primaryWorldInfoId)
    void (async (): Promise<boolean> => {
      if (mode === 'character') {
        if (character === undefined) throw new Error('请先选择角色')
        const approval = launchPhase === 'approval-required'
          ? await approveCharacterResources() : { ready: true, character }
        if (!approval.ready) return false
        await onStartCharacter(
          approval.character, greetingIndex, persona, selectedPresetId,
          additionalWorldInfoIds, selectedRegexPackIds, approval.resourcePermissions, agentCapabilityPresetId,
        )
        return true
      }
      if (primaryWorldInfo === undefined) throw new Error('请先选择世界')
      const tavern = launchPhase === 'approval-required'
        ? await launchPreflight.approve(permissionDuration) : undefined
      if (tavern !== undefined && !tavern.ready) return false
      await onStartWorldInfo(
        primaryWorldInfo, persona, selectedPresetId, additionalWorldInfoIds, selectedRegexPackIds,
        tavern?.permissions === undefined ? undefined : { tavern: tavern.permissions, card: [] },
        agentCapabilityPresetId,
      )
      return true
    })().then(started => {
      setStarting(false)
      if (started) onClose()
    }, reason => {
      setStarting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const fieldStyle: CSSProperties = {
    appearance: 'none', background: 'var(--dsw-alias-bg-layer-1, #202024)',
    border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '9px', boxSizing: 'border-box',
    color: 'inherit', font: 'inherit', minHeight: '40px', padding: '9px 36px 9px 10px', width: '100%',
  }
  const resourcePanelStyle: CSSProperties = {
    background: 'var(--dsw-alias-bg-layer-1, #202024)',
    border: '1px solid var(--dsw-alias-border-l2, #39393c)', borderRadius: '12px', padding: '13px',
  }

  return <div data-agent-rp-dialog data-agent-rp-surface="launch-composer" role="dialog" aria-modal="true"
    aria-label="开始游玩" style={{
      alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0, justifyContent: 'center',
      padding: narrow ? 0 : '24px', position: 'fixed', zIndex: 1260,
    }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: narrow ? 0 : '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: narrow ? 0 : '16px', boxShadow: narrow ? undefined : '0 24px 80px rgba(0,0,0,.5)',
      display: 'flex', flexDirection: 'column', height: narrow ? '100dvh' : 'min(760px, calc(100vh - 48px))',
      maxWidth: '780px', overflow: 'hidden', width: narrow ? '100vw' : 'min(780px, calc(100vw - 48px))',
    }}>
      <header style={{
        alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '12px',
        padding: narrow ? 'max(12px, env(safe-area-inset-top)) 14px 12px' : '16px 20px',
      }}>
        <span aria-hidden="true" style={{ color, display: 'inline-flex' }}><RoleplayDestinationIcon size={22} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: '17px', margin: 0 }}>开始游玩</h2>
          <span style={{ display: 'block', fontSize: '11px', marginTop: '3px', opacity: .5 }}>组合本次会话使用的独立资源</span>
        </div>
        <button type="button" aria-label="返回 Agent RP 工作台" disabled={busy} onClick={onClose} style={{
          alignItems: 'center', background: 'transparent', border: 0, borderRadius: '50%', color: 'inherit',
          cursor: busy ? 'default' : 'pointer', display: 'inline-flex', font: 'inherit', fontSize: '23px', height: '36px',
          justifyContent: 'center', opacity: busy ? .45 : 1, padding: 0, width: '36px',
        }}>×</button>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: narrow ? '18px 15px 24px' : '22px 24px 28px' }}>
        <section>
          <span style={{ display: 'block', fontSize: '11px', fontWeight: 620, marginBottom: '8px', opacity: .52 }}>故事起点</span>
          <div role="radiogroup" aria-label="游玩方式" style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {([['character', '角色对话', '以角色和开场白进入故事'], ['world-info', '世界场景', '不依赖角色卡进入世界']] as const)
              .map(([value, title, description]) => <button key={value} type="button" role="radio"
                aria-checked={mode === value} data-agent-rp-launch-mode={value} onClick={() => { setMode(value); setError(undefined) }} style={{
                  background: mode === value ? `color-mix(in srgb, ${color} 13%, transparent)` : 'var(--dsw-alias-bg-layer-1, #202024)',
                  border: mode === value ? `1px solid color-mix(in srgb, ${color} 42%, transparent)` : '1px solid var(--dsw-alias-border-l2, #39393c)',
                  borderRadius: '11px', color: 'inherit', cursor: 'pointer', font: 'inherit', minWidth: 0,
                  padding: narrow ? '11px' : '12px 13px', textAlign: 'left',
                }}>
                <strong style={{ display: 'block', fontSize: '13px' }}>{title}</strong>
                <span style={{ display: 'block', fontSize: '10px', lineHeight: 1.45, marginTop: '4px', opacity: .5 }}>{description}</span>
              </button>)}
          </div>
        </section>

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', marginTop: '16px' }}>
          <section data-agent-rp-launch-resource="primary" style={{ ...resourcePanelStyle, gridColumn: narrow ? undefined : '1 / -1' }}>
            <label htmlFor="agent-rp-launch-primary" style={{ display: 'block', fontSize: '12px', fontWeight: 620, marginBottom: '7px' }}>
              {mode === 'character' ? '角色' : '主世界'}
            </label>
            <div style={{ position: 'relative' }}>
              {mode === 'character' ? <select id="agent-rp-launch-primary" value={characterId}
                onChange={event => { setCharacterId(event.target.value); setError(undefined) }} style={fieldStyle}>
                <option value="">{characters === undefined ? '正在读取角色…' : characters.length === 0 ? '角色库暂无内容' : '选择角色'}</option>
                {characters?.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
              </select> : <select id="agent-rp-launch-primary" value={primaryWorldInfoId}
                onChange={event => { setPrimaryWorldInfoId(event.target.value); setError(undefined) }} style={fieldStyle}>
                <option value="">{worldInfos === undefined ? '正在读取世界…' : worldInfos.length === 0 ? '世界书库暂无内容' : '选择主世界'}</option>
                {worldInfos?.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>}
              <SelectChevron />
            </div>
            <div style={{ alignItems: 'center', display: 'flex', gap: '10px', marginTop: '10px', minHeight: '40px' }}>
              {mode === 'character' && character !== undefined && <>
                <CharacterLibraryAvatar entry={character} size={40} />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{character.displayName}</strong>
                  <span style={{ display: 'block', fontSize: '10px', marginTop: '3px', opacity: .5 }}>{actorDetail?.openings.length ?? '…'} 个开场 · {character.worldInfoCount} 条内置世界书</span>
                </span>
              </>}
              {mode === 'world-info' && primaryWorldInfo !== undefined && <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primaryWorldInfo.name}</strong>
                <span style={{ display: 'block', fontSize: '10px', marginTop: '3px', opacity: .5 }}>{primaryWorldInfo.entryCount} 条世界条目</span>
              </span>}
              {mode === 'character' && characterId !== '' && (character === undefined || actorDetail === undefined) && <span style={{ fontSize: '11px', opacity: .5 }}>正在读取角色设定…</span>}
              {mode === 'character' && characters?.length === 0 && <span style={{ alignItems: 'center', display: 'flex', flex: 1, gap: '10px', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', opacity: .52 }}>先添加一张角色卡，之后就能在这里直接选择</span>
                <button type="button" onClick={() => { onManageResources('characters') }} style={{
                  background: 'transparent', border: 0, color, cursor: 'pointer', flex: '0 0 auto', font: 'inherit', fontSize: '11px', padding: '4px 0', whiteSpace: 'nowrap',
                }}>前往资源中心</button>
              </span>}
              {mode === 'world-info' && worldInfos?.length === 0 && <span style={{ alignItems: 'center', display: 'flex', flex: 1, gap: '10px', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', opacity: .52 }}>先导入一本世界书，场景模式才有故事起点</span>
                <button type="button" onClick={() => { onManageResources('world-info') }} style={{
                  background: 'transparent', border: 0, color, cursor: 'pointer', flex: '0 0 auto', font: 'inherit', fontSize: '11px', padding: '4px 0', whiteSpace: 'nowrap',
                }}>导入世界书</button>
              </span>}
            </div>
            {mode === 'character' && actorDetail !== undefined && <div style={{ marginTop: '10px' }}>
              <label htmlFor="agent-rp-launch-greeting" style={{ display: 'block', fontSize: '11px', marginBottom: '6px', opacity: .55 }}>开场白</label>
              <div style={{ position: 'relative' }}>
                <select id="agent-rp-launch-greeting" value={greetingIndex} onChange={event => { setGreetingIndex(Number(event.target.value)) }} style={fieldStyle}>
                  {actorDetail.openings.map((opening, index) => <option key={opening.id} value={index}>{opening.label}</option>)}
                </select>
                <SelectChevron />
              </div>
              <p style={{ display: '-webkit-box', fontSize: '10px', lineHeight: 1.5, margin: '7px 1px 0', opacity: .48, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
                {compactCharacterDisplayText(actorDetail.openings[greetingIndex]?.preview ?? '') || '无开场白'}
                {actorDetail.openings[greetingIndex]?.truncated === true ? '…' : ''}
              </p>
            </div>}
          </section>

          <section data-agent-rp-launch-resource="persona" style={resourcePanelStyle}>
            <label htmlFor="agent-rp-launch-persona" style={{ display: 'block', fontSize: '12px', fontWeight: 620, marginBottom: '7px' }}>你的身份</label>
            <div style={{ position: 'relative' }}>
              <select id="agent-rp-launch-persona" value={personaId} onChange={event => { setPersonaId(event.target.value) }} style={fieldStyle}>
                <option value="">暂不设置 Persona</option>
                {personas?.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
              <SelectChevron />
            </div>
            <p style={{ display: '-webkit-box', fontSize: '10px', lineHeight: 1.5, margin: '7px 1px 0', opacity: .48, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
              {selectedPersona?.description || (personas === undefined ? '正在读取 Persona…' : '本次可以不使用固定身份')}
            </p>
          </section>

          <section data-agent-rp-launch-resource="preset" style={resourcePanelStyle}>
            <label htmlFor="agent-rp-launch-preset" style={{ display: 'block', fontSize: '12px', fontWeight: 620, marginBottom: '7px' }}>提示策略</label>
            <div style={{ position: 'relative' }}>
              <select id="agent-rp-launch-preset" value={presetId} onChange={event => { selectPreset(event.target.value) }} style={fieldStyle}>
                <option value="">不使用预设</option>
                {presets?.map(entry => <option key={entry.id} value={entry.id}>{presetLibraryOptionLabel(entry, presets)}</option>)}
              </select>
              <SelectChevron />
            </div>
            <p style={{ fontSize: '10px', lineHeight: 1.5, margin: '7px 1px 0', opacity: .48 }}>
              {presetError ?? (presets === undefined ? '正在读取预设…' : selectedPreset === undefined
                ? '使用 Agent RP 的基础提示策略'
                : `${selectedPreset.enabledCount}/${selectedPreset.promptCount} 个提示模块启用`)}
            </p>
          </section>

          <section data-agent-rp-launch-resource="agent-capability" style={{ ...resourcePanelStyle, gridColumn: narrow ? undefined : '1 / -1' }}>
            <label htmlFor="agent-rp-launch-agent-capability" style={{ display: 'block', fontSize: '12px', fontWeight: 620, marginBottom: '7px' }}>Agent 能力</label>
            <div style={{ position: 'relative' }}>
              <select id="agent-rp-launch-agent-capability" value={agentCapabilityPresetId}
                disabled={agentCapabilityPresets === undefined || agentCapabilityPresets.length === 0}
                onChange={event => { selectAgentCapabilityPreset(event.target.value) }} style={fieldStyle}>
                {agentCapabilityPresets?.map(entry => <option key={entry.id} value={entry.id}>
                  {entry.name}{entry.managed ? '（内置）' : ''}
                </option>)}
              </select>
              <SelectChevron />
            </div>
            <p style={{ fontSize: '10px', lineHeight: 1.55, margin: '7px 1px 0', opacity: .48 }}>
              {agentCapabilityPresetError ?? (agentCapabilityPresets === undefined ? '正在读取 Agent 能力…'
                : selectedAgentCapabilityPreset === undefined ? '没有可用的 Agent RP 能力预设'
                  : selectedAgentCapabilityPreset.description
                    ?? '决定本会话挂载哪些 DSH 工具、MCP 与运行能力；与上面的提示策略相互独立')}
            </p>
            <p style={{ fontSize: '10px', lineHeight: 1.55, margin: '4px 1px 0', opacity: .4 }}>
              在 DSH「设置 → Agent 预设」复制内置“角色会话”后扩展；自定义 ID 使用 agent-rp-*。
            </p>
          </section>
        </div>

        <section data-agent-rp-launch-resource="world-info" style={{ ...resourcePanelStyle, marginTop: '12px' }}>
          <AdditionalWorldInfoSelection
            listWorldInfos={listWorldInfos}
            selectedWorldInfoIds={selectedWorldInfoIds}
            onChange={setSelectedWorldInfoIds}
            excludedIds={mode === 'world-info' && primaryWorldInfoId !== '' ? [primaryWorldInfoId] : []}
            embedded
          />
        </section>

        <section data-agent-rp-launch-resource="regex" style={{ ...resourcePanelStyle, marginTop: '12px' }}>
          <div style={{ alignItems: 'baseline', display: 'flex', gap: '10px' }}>
            <span style={{ flex: 1 }}>
              <strong style={{ display: 'block', fontSize: '12px' }}>正则包</strong>
              <span style={{ display: 'block', fontSize: '10px', lineHeight: 1.5, marginTop: '3px', opacity: .48 }}>
                全局规则先于预设与角色卡正则执行；选择顺序会固定到本次会话
              </span>
            </span>
            <button type="button" onClick={() => { onManageResources('regex-packs') }} style={{
              background: 'transparent', border: 0, color, cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: 0,
            }}>管理</button>
          </div>
          {regexPacks === undefined
            ? <div style={{ fontSize: '11px', marginTop: '9px', opacity: .5 }}>正在读取正则包…</div>
            : regexPacks.length === 0
              ? <div style={{ fontSize: '11px', marginTop: '9px', opacity: .5 }}>没有独立正则包；可从资源中心导入</div>
              : <div style={{ display: 'grid', gap: '6px', marginTop: '9px', maxHeight: '210px', overflowY: 'auto' }}>
                {regexPacks.map(entry => {
                  const order = selectedRegexPackIds.indexOf(entry.id)
                  const checked = order >= 0
                  const disabled = !checked && selectedRegexPackIds.length >= 16
                  return <label key={entry.id} data-agent-rp-regex-pack-option={entry.id} style={{
                    alignItems: 'center', background: checked ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
                    borderRadius: '8px', cursor: disabled ? 'default' : 'pointer', display: 'flex', gap: '9px',
                    opacity: disabled ? .42 : 1, padding: '8px 9px',
                  }}>
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => {
                      setSelectedRegexPackIds(event.target.checked
                        ? [...selectedRegexPackIds, entry.id]
                        : selectedRegexPackIds.filter(id => id !== entry.id))
                    }} style={{ accentColor: color, margin: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</strong>
                      <span style={{ display: 'block', fontSize: '10px', marginTop: '3px', opacity: .48 }}>
                        {entry.enabledCount}/{entry.scriptCount} 启用 · {entry.displayCount} 显示 · {entry.promptCount} 提示词
                      </span>
                    </span>
                    {checked && <span aria-label={`正则包顺序 ${order + 1}`} style={{
                      alignItems: 'center', background: `color-mix(in srgb, ${color} 18%, transparent)`,
                      borderRadius: '999px', display: 'inline-flex', fontSize: '10px', height: '20px',
                      justifyContent: 'center', minWidth: '20px', padding: '0 5px',
                    }}>{order + 1}</span>}
                  </label>
                })}
              </div>}
        </section>

        {expectsResourcePreflight && <section data-agent-rp-launch-preflight={launchPhase}
          data-agent-rp-resource-permission-duration={permissionDuration} style={{
            ...resourcePanelStyle, background: pendingPermissions > 0
              ? 'color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 9%, transparent)'
              : resourcePanelStyle.background,
            border: pendingPermissions > 0
              ? '1px solid color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 38%, transparent)'
              : resourcePanelStyle.border,
            marginTop: '12px',
          }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
            <strong style={{ fontSize: '12px' }}>启动权限</strong>
            <span style={{ fontSize: '10px', marginLeft: 'auto', opacity: .55 }}>
              {launchPreflight.loading ? '检查中…' : launchPreflight.error !== undefined ? '预检暂不可用'
                : pendingHosts.length > 0 ? `${pendingHosts.length} 个来源待确认` : '已准备'}
            </span>
          </div>
          {pendingHosts.length > 0 && <>
            <div title={pendingHosts.join('\n')} style={{ fontSize: '10px', marginTop: '6px', opacity: .58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingHosts.join('、')}</div>
            <div role="radiogroup" aria-label="启动权限方式" style={{
              display: 'grid', gap: '6px', gridTemplateColumns: `repeat(${mode === 'character' ? 3 : 2}, minmax(0, 1fr))`, marginTop: '8px',
            }}>
              {([['session', '仅本次'], ['remember', '记住'], ...(mode === 'character' ? [['trust', '信任界面']] as const : [])] as const)
                .map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={permissionDuration === value}
                  data-agent-rp-permission-duration={value} onClick={() => { setPermissionDuration(value) }} style={{
                    background: permissionDuration === value ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                    border: permissionDuration === value ? `1px solid color-mix(in srgb, ${color} 42%, transparent)` : '1px solid var(--dsw-alias-border-l2, #444)',
                    borderRadius: '7px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: '7px 5px', whiteSpace: 'nowrap',
                  }}>{label}</button>)}
            </div>
          </>}
          {launchPreflight.error !== undefined && <div style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '6px', opacity: .55 }}>
            {launchPreflight.error}；无法解析的脚本会保持关闭
          </div>}
        </section>}
        {error !== undefined && <p role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.5, margin: '14px 1px 0' }}>{error}</p>}
        <p style={{ fontSize: '10px', lineHeight: 1.6, margin: '16px 1px 0', opacity: .4 }}>本次选择只写入新会话，不修改资源中心里的原文件</p>
      </div>
      <footer style={{
        alignItems: 'center', borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '10px',
        padding: narrow ? '12px 14px max(12px, env(safe-area-inset-bottom))' : '13px 20px',
      }}>
        {!narrow && <button type="button" disabled={busy} onClick={onClose} style={{ ...secondaryButtonStyle, marginRight: 'auto' }}>返回</button>}
        <span style={{ fontSize: '10px', marginRight: narrow ? 0 : 'auto', opacity: .45 }}>
          {mode === 'character' ? '角色模式' : '场景模式'}
        </span>
        <button type="button" data-agent-rp-start-readiness={launchPhase} disabled={!ready || busy || launchPhase === 'checking'}
          onClick={start} style={{
            ...primaryButtonStyle, minHeight: narrow ? '44px' : undefined, opacity: !ready || launchPhase === 'checking' ? .45 : 1,
            width: narrow ? 'min(58vw, 220px)' : undefined, whiteSpace: 'nowrap',
          }}>
          {starting || launchPreflight.approving ? '正在开始…' : launchPhase === 'checking' ? '准备中…' : '开始游玩'}
        </button>
      </footer>
    </section>
  </div>
}

function WorldInfoLaunchDialog({
  runtimeDiagnostics, worldInfo, listWorldInfos, listPresets, listPersonas, onBack, onStart,
}: {
  readonly runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry
  readonly worldInfo: WorldInfoLibraryUpload
  readonly listWorldInfos: HeaderProps['listWorldInfos']
  readonly listPresets: HeaderProps['listPresets']
  readonly listPersonas: HeaderProps['listPersonas']
  readonly onBack: () => void
  readonly onStart: (
    worldInfo: WorldInfoLibraryUpload,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ) => Promise<void>
}) {
  const narrow = useNarrowCharacterLibrary()
  const { entries: presets, error: presetError, presetId, selectPreset } = usePresetPreference(listPresets)
  const [personas, setPersonas] = useState<readonly PersonaLibraryEntry[]>()
  const [personaError, setPersonaError] = useState<string>()
  const [personaId, setPersonaId] = useState('')
  const [selectedWorldInfoIds, setSelectedWorldInfoIds] = useState<readonly string[]>()
  const [starting, setStarting] = useState(false)
  const [permissionDuration, setPermissionDuration] = useState<'session' | 'remember'>('remember')
  const [error, setError] = useState<string>()
  const selectedPresetId = presetId === '' ? undefined : presetId
  const selectedPreset = presets?.find(entry => entry.id === selectedPresetId)
  const expectsTavernPreflight = selectedPresetId !== undefined
    && (presets === undefined || (selectedPreset?.tavernHelper?.enabledScriptCount ?? 0) > 0)
  const launchPreflight = useTavernLaunchPreflight({
    expected: expectsTavernPreflight,
    permissionOwnerId: DEFAULT_AGENT_RP_CHARACTER_NAME,
    ...(selectedPresetId === undefined ? {} : { presetId: selectedPresetId }),
  })
  const pendingPermissions = launchPreflight.pending
  const pendingHosts = [...new Set(pendingPermissions.map(item => new URL(item.origin).hostname))].sort()
  const launchPhase = tavernPreflightLaunchPhase({
    expected: expectsTavernPreflight,
    loading: launchPreflight.loading,
    settled: launchPreflight.settled,
    pendingPermissions: pendingPermissions.length,
  })
  const busy = starting || launchPreflight.approving
  useEffect(() => {
    let current = true
    void listPersonas().then(value => {
      if (current) setPersonas(value)
    }, reason => {
      if (current) {
        setPersonas([])
        setPersonaError(reason instanceof Error ? reason.message : String(reason))
      }
    })
    return () => { current = false }
  }, [listPersonas])
  const selectedPersona = personas?.find(entry => entry.id === personaId)
  useAgentRpRuntimeDiagnosticContribution(
    runtimeDiagnostics,
    'world-info-launch-preflight',
    selectedPresetId === undefined ? undefined : {
      kind: 'preflight',
      facts: {
        status: launchPreflight.loading ? 'loading'
          : pendingPermissions.length > 0 ? 'permission-required'
            : launchPreflight.error !== undefined ? 'error' : 'ready',
        launch: launchPhase,
        startReadiness: launchPhase,
        startAction: launchPhase === 'checking' ? 'checking'
          : launchPhase === 'approval-required' ? 'approve-and-start' : 'start',
        permissionDuration,
        scripts: launchPreflight.result?.scripts ?? 0,
        cardResources: 0,
        pendingCardPermissions: 0,
        pendingScriptPermissions: pendingPermissions.length,
        pendingScriptOrigins: pendingPermissions.filter(permission => permission.kind === 'script').length,
        pendingImageOrigins: pendingPermissions.filter(permission => permission.kind === 'image').length,
        pendingStyleOrigins: pendingPermissions.filter(permission => permission.kind === 'style').length,
        pendingFrameOrigins: pendingPermissions.filter(permission => permission.kind === 'frame').length,
        pendingPermissions: pendingPermissions.length,
        failed: launchPreflight.result?.failed ?? 0,
      },
    },
  )
  return <div data-agent-rp-dialog data-agent-rp-surface="world-info-launch" role="dialog" aria-modal="true"
    aria-label="配置世界书剧情" style={{
      alignItems: 'center', background: 'rgba(0,0,0,.66)', display: 'flex', inset: 0, justifyContent: 'center',
      padding: narrow ? 0 : '24px', position: 'fixed', zIndex: 1260,
    }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: narrow ? 0 : '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: narrow ? 0 : '16px', boxShadow: narrow ? undefined : '0 24px 80px rgba(0,0,0,.5)',
      display: 'flex', flexDirection: 'column', height: narrow ? '100dvh' : 'min(720px, calc(100vh - 48px))',
      maxWidth: '560px', overflow: 'hidden', width: narrow ? '100vw' : 'min(560px, calc(100vw - 48px))',
    }}>
      <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '10px', padding: narrow ? 'max(12px, env(safe-area-inset-top)) 14px 12px' : '16px 18px' }}>
        <button type="button" aria-label="返回世界书库" disabled={busy} onClick={onBack} style={{
          alignItems: 'center', background: 'transparent', border: 0, borderRadius: '50%', color: 'inherit',
          cursor: busy ? 'default' : 'pointer', display: 'inline-flex', flex: '0 0 auto', font: 'inherit',
          fontSize: '25px', height: '36px', justifyContent: 'center', opacity: busy ? .45 : 1, padding: 0, width: '36px',
        }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: '16px', margin: 0 }}>开始世界书剧情</h2>
          <span style={{ display: 'block', fontSize: '11px', marginTop: '3px', opacity: .5 }}>组合本次新会话使用的资源</span>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: narrow ? '18px 16px 24px' : '20px 22px 26px' }}>
        <div data-agent-rp-world-info-primary={worldInfo.id} style={{
          background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          borderRadius: '12px', padding: '12px 13px',
        }}>
          <span style={{ display: 'block', fontSize: '10px', opacity: .5 }}>主世界书 · 只读</span>
          <strong style={{ display: 'block', fontSize: '14px', marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{worldInfo.name}</strong>
          <span style={{ display: 'block', fontSize: '11px', marginTop: '4px', opacity: .52 }}>
            {worldInfo.entryCount} 条目{worldInfo.degradations.length === 0 ? '' : ` · ${worldInfo.degradations.length} 项兼容提醒`}
          </span>
        </div>
        <label htmlFor="agent-rp-world-info-launch-preset" style={{ display: 'block', fontSize: '12px', fontWeight: 620, margin: '20px 0 7px', opacity: .65 }}>对话预设</label>
        <div style={{ position: 'relative' }}>
          <select id="agent-rp-world-info-launch-preset" value={presetId} onChange={event => { selectPreset(event.target.value) }} style={{
            appearance: 'none', background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
            borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '9px 36px 9px 10px', width: '100%',
          }}>
            <option value="">不使用预设</option>
            {presets?.map(entry => <option key={entry.id} value={entry.id}>{presetLibraryOptionLabel(entry, presets)}</option>)}
          </select>
          <SelectChevron />
        </div>
        <div style={{ fontSize: '11px', lineHeight: 1.55, marginTop: '6px', opacity: .5 }}>
          {presetError !== undefined ? presetError : presets === undefined ? '正在读取预设…'
            : presets.length === 0 ? '预设库暂无内容，可返回资源中心导入'
              : presetId === '' ? '新会话不会启用酒馆预设'
                : (() => {
                    const preset = presets.find(entry => entry.id === presetId)
                    return preset === undefined ? '所选预设已不可用'
                      : `${preset.enabledCount}/${preset.promptCount} 项启用${preset.regexScriptCount === 0 ? '' : ` · ${preset.regexScriptCount} 条正则`}`
                  })()}
        </div>
        {expectsTavernPreflight && <div data-agent-rp-world-info-preflight={launchPhase}
          data-agent-rp-resource-permission-duration={permissionDuration} style={{
            background: pendingHosts.length > 0
              ? 'color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 9%, transparent)'
              : 'var(--dsw-alias-bg-layer-1, #202024)',
            border: pendingHosts.length > 0
              ? '1px solid color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 38%, transparent)'
              : '1px solid var(--dsw-alias-border-l2, #39393c)',
            borderRadius: '10px', fontSize: '11px', lineHeight: 1.55, marginTop: '12px', padding: '10px 11px',
          }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
            <strong style={{ fontSize: '12px' }}>启动权限</strong>
            <span style={{ marginLeft: 'auto', opacity: .56 }}>
              {launchPreflight.loading ? '检查中…'
                : launchPreflight.error !== undefined ? '暂时无法预检'
                  : pendingHosts.length > 0 ? `${pendingHosts.length} 个来源待确认`
                    : `${launchPreflight.result?.ready ?? 0}/${launchPreflight.result?.scripts ?? 0} 已准备`}
            </span>
          </div>
          {launchPreflight.error !== undefined && <div style={{ marginTop: '5px', opacity: .58 }}>
            {launchPreflight.error}；仍可开始，未解析的脚本会保持关闭
          </div>}
          {pendingHosts.length > 0 && <>
            <div title={pendingHosts.join('\n')} style={{
              marginTop: '5px', opacity: .66, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{pendingHosts.join('、')}</div>
            <div role="radiogroup" aria-label="启动权限方式" style={{
              display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: '8px',
            }}>
              {([['session', '仅本次'], ['remember', '记住']] as const).map(([value, label]) => <button
                key={value} type="button" role="radio" aria-checked={permissionDuration === value}
                data-agent-rp-permission-duration={value} onClick={() => { setPermissionDuration(value) }} style={{
                  background: permissionDuration === value
                    ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                  border: permissionDuration === value
                    ? `1px solid color-mix(in srgb, ${color} 42%, transparent)`
                    : '1px solid var(--dsw-alias-border-l2, #444)',
                  borderRadius: '7px', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '7px 6px',
                  textAlign: 'center', whiteSpace: 'nowrap',
                }}><strong style={{ display: 'block', fontSize: '11px' }}>{label}</strong></button>)}
            </div>
            <div style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '6px', opacity: .52 }}>
              {permissionDuration === 'session' ? '只允许这次发现的资源，之后仍会询问'
                : '记住这个预设中已确认的精确来源'}
            </div>
          </>}
          {(launchPreflight.result?.failed ?? 0) > 0 && <div style={{
            color: 'var(--dsw-alias-state-warning, #d5a64c)', marginTop: '5px',
          }}>{launchPreflight.result!.failed} 个脚本无法完成静态解析，开聊后也不会执行</div>}
        </div>}
        <AdditionalWorldInfoSelection
          listWorldInfos={listWorldInfos}
          selectedWorldInfoIds={selectedWorldInfoIds}
          onChange={setSelectedWorldInfoIds}
          excludedIds={[worldInfo.id]}
        />
        <label htmlFor="agent-rp-world-info-launch-persona" style={{ display: 'block', fontSize: '12px', fontWeight: 620, margin: '20px 0 7px', opacity: .65 }}>你的身份（Persona）</label>
        <div style={{ position: 'relative' }}>
          <select id="agent-rp-world-info-launch-persona" value={personaId} onChange={event => { setPersonaId(event.target.value) }} style={{
            appearance: 'none', background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
            borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '9px 36px 9px 10px', width: '100%',
          }}>
            <option value="">暂不设置</option>
            {personas?.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          <SelectChevron />
        </div>
        <div style={{ fontSize: '11px', lineHeight: 1.55, marginTop: '6px', opacity: .5 }}>
          {personaError !== undefined ? personaError : personas === undefined ? '正在读取身份…'
            : selectedPersona === undefined ? '可以用已有 Persona 进入这段剧情'
              : selectedPersona.description || '只有称呼，没有额外人物设定'}
        </div>
        {error !== undefined && <p role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.5, margin: '16px 0 0' }}>{error}</p>}
        <p style={{ fontSize: '10px', lineHeight: 1.6, margin: '18px 1px 0', opacity: .42 }}>
          这些资源只组合到新会话，不会修改资源中心里的原文件
        </p>
      </div>
      <footer style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex', gap: '9px', padding: narrow ? '12px 14px max(12px, env(safe-area-inset-bottom))' : '13px 18px' }}>
        {!narrow && <button type="button" disabled={busy} onClick={onBack} style={{ ...secondaryButtonStyle, marginRight: 'auto' }}>返回</button>}
        <button type="button" data-agent-rp-start-readiness={launchPhase}
          disabled={busy || launchPhase === 'checking'} onClick={() => {
          setStarting(true)
          setError(undefined)
          const persona = selectedPersona === undefined ? undefined : {
            id: selectedPersona.id, name: selectedPersona.name, description: selectedPersona.description,
          }
          void (async (): Promise<void> => {
            const tavern = launchPhase === 'approval-required'
              ? await launchPreflight.approve(permissionDuration) : undefined
            if (tavern !== undefined && !tavern.ready) {
              setStarting(false)
              return
            }
            await onStart(
              worldInfo,
              persona,
              selectedPresetId,
              selectedWorldInfoIds,
              tavern?.permissions === undefined ? undefined : { tavern: tavern.permissions, card: [] },
            )
          })().catch(reason => {
            setStarting(false)
            setError(reason instanceof Error ? reason.message : String(reason))
          })
        }} style={{ ...primaryButtonStyle, minHeight: narrow ? '44px' : undefined, width: narrow ? '100%' : undefined }}>
          {starting || launchPreflight.approving ? '正在开始…'
            : launchPhase === 'checking' ? '准备中…' : '开始剧情'}
        </button>
      </footer>
    </section>
  </div>
}

function CharacterLibraryDialog({
  currentCharacterName, currentCharacterId, listCharacters, readCharacter, setCharacterArchived, importCharacterFile,
  listPresets, importPresetFile, listWorldInfos, listPersonas, savePersona, deletePersona,
  onClose, onStart, runtimeDiagnostics,
}: {
  readonly runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry
  readonly currentCharacterName: string
  readonly currentCharacterId?: string
  readonly listCharacters: HeaderProps['listCharacters']
  readonly readCharacter: HeaderProps['readCharacter']
  readonly setCharacterArchived: HeaderProps['setCharacterArchived']
  readonly importCharacterFile: HeaderProps['importCharacterFile']
  readonly listPresets: HeaderProps['listPresets']
  readonly importPresetFile: HeaderProps['importPresetFile']
  readonly listWorldInfos: HeaderProps['listWorldInfos']
  readonly listPersonas: HeaderProps['listPersonas']
  readonly savePersona: HeaderProps['savePersona']
  readonly deletePersona: HeaderProps['deletePersona']
  readonly onClose: () => void
  readonly onStart: (
    character: CharacterLibraryDetail, greetingIndex: number, persona?: SessionPersonaSnapshot, presetId?: string,
    worldInfoIds?: readonly string[],
    memory?: 'copy-active',
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ) => Promise<void>
}) {
  const narrow = useNarrowCharacterLibrary()
  const [collection, setCollection] = useState<CharacterLibraryCollection>('active')
  const [characterQuery, setCharacterQuery] = useState('')
  const [entries, setEntries] = useState<readonly CharacterLibrarySummary[]>()
  const [selected, setSelected] = useState<CharacterLibraryDetail>()
  const [greetingIndex, setGreetingIndex] = useState(0)
  const [expandedGreetingIndex, setExpandedGreetingIndex] = useState<number | undefined>(0)
  const {
    entries: presets, error: presetError, presetId, selectPreset, selectImportedPreset, renamePreset,
  } = usePresetPreference(listPresets)
  const [personas, setPersonas] = useState<readonly PersonaLibraryEntry[]>()
  const [selectedWorldInfoIds, setSelectedWorldInfoIds] = useState<readonly string[]>()
  const [personaId, setPersonaId] = useState('')
  const [editingPersona, setEditingPersona] = useState(false)
  const [personaEditorId, setPersonaEditorId] = useState<string>()
  const [personaName, setPersonaName] = useState('')
  const [personaDescription, setPersonaDescription] = useState('')
  const [copyActiveMemory, setCopyActiveMemory] = useState(false)
  const [savingPersona, setSavingPersona] = useState(false)
  const [confirmingPersonaId, setConfirmingPersonaId] = useState<string>()
  const [removingPersonaId, setRemovingPersonaId] = useState<string>()
  const [loadingId, setLoadingId] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [preflightPermissionDuration, setPreflightPermissionDuration] = useState<PreflightPermissionDuration>('remember')
  const [updating, setUpdating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importingPreset, setImportingPreset] = useState(false)
  const [renamingPreset, setRenamingPreset] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const [actionNotice, setActionNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const presetInputRef = useRef<HTMLInputElement | null>(null)
  const selectionRequestRef = useRef(0)
  const selectedPresetId = presetId === '' ? undefined : presetId
  const selectedPresetSummary = presets?.find(entry => entry.id === selectedPresetId)
  useEffect(() => {
    if (actionNotice === undefined) return
    const timeout = window.setTimeout(() => { setActionNotice(undefined) }, 2400)
    return () => { window.clearTimeout(timeout) }
  }, [actionNotice])
  useEffect(() => {
    if (selected === undefined) return
    setPreflightPermissionDuration(selected.remoteResourcePolicy === 'isolated-https' ? 'trust' : 'remember')
  }, [selected?.id, selected?.remoteResourcePolicy])
  const expectsTavernPreflight = (selected?.tavernHelper?.enabledScriptCount ?? 0) > 0
    || (selectedPresetId !== undefined
      && (presets === undefined || (selectedPresetSummary?.tavernHelper?.enabledScriptCount ?? 0) > 0))
  const expectsCardResourcePreflight = (selected?.remoteResources.length ?? 0) > 0
  const expectsResourcePreflight = expectsTavernPreflight || expectsCardResourcePreflight
  const launchPreflight = useTavernLaunchPreflight({
    expected: expectsTavernPreflight,
    ...(selected === undefined ? {} : { permissionOwnerId: selected.id, characterId: selected.id }),
    ...(selectedPresetId === undefined ? {} : { presetId: selectedPresetId }),
  })
  const tavernPreflight = launchPreflight.result
  const tavernPreflightLoading = launchPreflight.loading
  const tavernPreflightError = launchPreflight.error
  const approvingPreflight = launchPreflight.approving
  useEffect(() => {
    let current = true
    selectionRequestRef.current += 1
    setEntries(undefined)
    setSelected(undefined)
    setExpandedGreetingIndex(undefined)
    setError(undefined)
    void listCharacters(collection).then(value => {
      if (!current) return
      setEntries(value)
      const preferred = collection === 'active'
        ? value.find(entry => entry.displayName === currentCharacterName) ?? value[0]
        : value[0]
      if (preferred === undefined) return
      const request = ++selectionRequestRef.current
      setLoadingId(preferred.id)
      void readCharacter(preferred.id).then(detail => {
        if (!current || selectionRequestRef.current !== request) return
        setSelected(detail)
        setGreetingIndex(0)
        setExpandedGreetingIndex(0)
        setLoadingId(undefined)
      }, readError => {
        if (!current || selectionRequestRef.current !== request) return
        setLoadingId(undefined)
        setError(readError instanceof Error ? readError.message : String(readError))
      })
    }, listError => {
      if (!current) return
      setEntries([])
      setError(listError instanceof Error ? listError.message : String(listError))
    })
    return () => { current = false }
  }, [collection, currentCharacterName, listCharacters, readCharacter])
  useEffect(() => {
    let current = true
    void listPersonas().then(value => {
      if (!current) return
      setPersonas(value)
      setPersonaId('')
    }, listError => {
      if (!current) return
      setPersonas([])
      setError(listError instanceof Error ? listError.message : String(listError))
    })
    return () => { current = false }
  }, [listPersonas])
  useEffect(() => {
    if (selected?.id !== currentCharacterId) setCopyActiveMemory(false)
  }, [currentCharacterId, selected?.id])
  const choose = (entry: CharacterLibrarySummary): void => {
    const request = ++selectionRequestRef.current
    setLoadingId(entry.id)
    setError(undefined)
    void readCharacter(entry.id).then(detail => {
      if (selectionRequestRef.current !== request) return
      setSelected(detail)
      setGreetingIndex(0)
      setExpandedGreetingIndex(0)
      setLoadingId(undefined)
    }, readError => {
      if (selectionRequestRef.current !== request) return
      setLoadingId(undefined)
      setError(readError instanceof Error ? readError.message : String(readError))
    })
  }
  const updateArchiveState = (): void => {
    if (selected === undefined) return
    const archived = collection === 'active'
    const displayName = selected.displayName
    setUpdating(true)
    setError(undefined)
    void setCharacterArchived(selected.id, archived).then(() => listCharacters(collection)).then(value => {
      setEntries(value)
      const normalizedQuery = characterQuery.trim().toLocaleLowerCase()
      const next = value.find(entry => normalizedQuery === '' || [entry.displayName, entry.name, entry.originalFilename]
        .some(text => text.toLocaleLowerCase().includes(normalizedQuery)))
      if (next === undefined) {
        setSelected(undefined)
        setExpandedGreetingIndex(undefined)
        setLoadingId(undefined)
        setUpdating(false)
        setActionNotice(`${archived ? '已移入收纳箱' : '已移回角色库'}「${displayName}」`)
        return
      }
      setLoadingId(next.id)
      return readCharacter(next.id).then(detail => {
        setSelected(detail)
        setGreetingIndex(0)
        setExpandedGreetingIndex(0)
        setLoadingId(undefined)
        setUpdating(false)
        setActionNotice(`${archived ? '已移入收纳箱' : '已移回角色库'}「${displayName}」`)
      })
    }).catch(updateError => {
      setLoadingId(undefined)
      setUpdating(false)
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    })
  }
  const importCharacterSelection = (file: File): void => {
    setImporting(true)
    setDraggingFile(false)
    setError(undefined)
    setActionNotice(undefined)
    void importCharacterFile(file).then(result => listCharacters('active').then(value => ({ result, value }))).then(({ result, value }) => {
      const { entry, outcome } = result
      setCollection('active')
      setCharacterQuery('')
      setEntries(value)
      setSelected(entry)
      setGreetingIndex(0)
      setExpandedGreetingIndex(0)
      setLoadingId(undefined)
      setImporting(false)
      setActionNotice(outcome === 'created' ? '已加入角色库'
        : outcome === 'restored' ? '已恢复到角色库' : '角色库中已有这张卡')
    }).catch(importError => {
      setImporting(false)
      setError(importError instanceof Error ? importError.message : String(importError))
    })
  }
  const importFile = (file: File): void => {
    setDraggingFile(false)
    if (!/\.json$/iu.test(file.name)) {
      importCharacterSelection(file)
      return
    }
    setImporting(true)
    setError(undefined)
    setActionNotice(undefined)
    void classifySillyTavernJsonFile(file).then(kind => {
      if (kind === 'preset') {
        setImporting(false)
        importPresetSelection(file)
        return
      }
      if (kind === 'world-info') {
        setImporting(false)
        setError('识别到世界书 JSON；请从 Agent RP「资源中心 → 世界书」导入')
        return
      }
      importCharacterSelection(file)
    }, reason => {
      setImporting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const importPresetSelection = (file: File): void => {
    setImportingPreset(true)
    setError(undefined)
    setActionNotice(undefined)
    void importPresetFile(file).then(entry => {
      selectImportedPreset(entry)
      setImportingPreset(false)
      setActionNotice('预设已导入并选中')
    }, importError => {
      setImportingPreset(false)
      setError(importError instanceof Error ? importError.message : String(importError))
    })
  }
  const normalizedCharacterQuery = characterQuery.trim().toLocaleLowerCase()
  const visibleEntries = (entries ?? []).filter(entry => normalizedCharacterQuery === ''
    || [entry.displayName, entry.name, entry.originalFilename]
      .some(text => text.toLocaleLowerCase().includes(normalizedCharacterQuery)))
  const duplicateNames = new Set((entries ?? [])
    .filter((entry, index, all) => all.findIndex(candidate => candidate.displayName === entry.displayName) !== index)
    .map(entry => entry.displayName))
  const greetingSummaries = useMemo(() => selected?.greetings.map((greeting, index) =>
    compactCharacterDisplayText(selected.renderedGreetings[index] ?? greeting)) ?? [], [selected])
  const pendingPreflightScriptResources = launchPreflight.pending
  const pendingPreflightScripts = pendingPreflightScriptResources.filter(permission => permission.kind === 'script')
  const pendingPreflightImages = pendingPreflightScriptResources.filter(permission => permission.kind === 'image')
  const pendingPreflightStyles = pendingPreflightScriptResources.filter(permission => permission.kind === 'style')
  const pendingPreflightFonts = pendingPreflightScriptResources.filter(permission => permission.kind === 'font')
  const pendingPreflightFrames = pendingPreflightScriptResources.filter(permission => permission.kind === 'frame')
  const pendingCardResources = selected === undefined
    ? [] : blockedCardFrameResources(selected.remoteResources, selected)
  const pendingPreflightPermissions = pendingPreflightScripts.length
    + pendingPreflightImages.length + pendingPreflightStyles.length + pendingPreflightFonts.length
    + pendingPreflightFrames.length
    + pendingCardResources.length
  const pendingPreflightHosts = [...new Set([
    ...pendingPreflightScriptResources.map(item => new URL(item.origin).hostname),
    ...pendingCardResources.map(resource => new URL(resource.origin).hostname),
  ])].sort()
  const failedPreflightEntries = tavernPreflight?.entries.filter(entry => entry.status === 'resolution-error') ?? []
  const preflightLaunchPhase = tavernPreflightLaunchPhase({
    expected: expectsResourcePreflight,
    loading: tavernPreflightLoading,
    settled: launchPreflight.settled,
    pendingPermissions: pendingPreflightPermissions,
  })
  const resourcePreflightStatus = tavernPreflightLoading ? 'loading'
    : pendingPreflightPermissions > 0 ? 'permission-required'
      : tavernPreflightError !== undefined ? 'error' : 'ready'
  const preflightChecking = preflightLaunchPhase === 'checking'
  useAgentRpRuntimeDiagnosticContribution(
    runtimeDiagnostics,
    'character-library-preflight',
    selected === undefined ? undefined : {
      kind: 'preflight',
      facts: {
        status: resourcePreflightStatus,
        launch: preflightLaunchPhase,
        startReadiness: preflightLaunchPhase,
        startAction: preflightChecking ? 'checking'
          : preflightLaunchPhase === 'approval-required' ? 'approve-and-start' : 'start',
        permissionDuration: preflightPermissionDuration,
        scripts: tavernPreflight?.scripts ?? 0,
        cardResources: selected.remoteResources.length,
        pendingCardPermissions: pendingCardResources.length,
        pendingScriptPermissions: pendingPreflightScripts.length
          + pendingPreflightImages.length + pendingPreflightStyles.length + pendingPreflightFonts.length
          + pendingPreflightFrames.length,
        pendingScriptOrigins: pendingPreflightScripts.length,
        pendingImageOrigins: pendingPreflightImages.length,
        pendingStyleOrigins: pendingPreflightStyles.length,
        pendingFrameOrigins: pendingPreflightFrames.length,
        pendingPermissions: pendingPreflightPermissions,
        failed: tavernPreflight?.failed ?? 0,
      },
    },
  )
  const approvePreflightResources = async (
    duration: PreflightPermissionDuration,
  ): Promise<PreflightApprovalResult> => {
    if (selected === undefined) throw new Error('请先选择角色卡')
    let detail = selected
    const exactCardResources = duration === 'trust' ? [] : blockedCardFrameResources(
      selected.remoteResources, { ...selected, remoteResourcePolicy: 'prompt' },
    )
    if (duration !== 'trust' && detail.remoteResourcePolicy === 'isolated-https') {
      detail = await updateCharacterRemoteResourcePolicy(detail.id, 'prompt')
      setSelected(current => current?.id === detail.id ? detail : current)
    }
    const tavernPermissions = await launchPreflight.approve(duration)
    if (!tavernPermissions.ready) return { ready: false, character: detail }
    if (duration === 'session') {
      return {
        ready: true,
        character: detail,
        resourcePermissions: {
          tavern: tavernPermissions.permissions ?? { scripts: [], images: [], styles: [], fonts: [], frames: [] },
          card: exactCardResources,
        },
      }
    }
    if (duration === 'trust') {
      detail = await updateCharacterRemoteResourcePolicy(detail.id, 'isolated-https')
      setSelected(current => current?.id === detail.id ? detail : current)
    } else {
      for (const resource of exactCardResources) {
        detail = await updateCharacterRemoteResource(detail.id, resource.origin, resource.type, true)
        setSelected(current => current?.id === detail.id ? detail : current)
      }
    }
    setActionNotice(duration === 'trust' ? '已信任这张卡的界面资源' : '已记住确认过的权限')
    return { ready: true, character: detail }
  }
  const startSelectedCharacter = (): void => {
    if (selected === undefined || starting || approvingPreflight || preflightChecking) return
    setStarting(true)
    setError(undefined)
    void (async (): Promise<boolean> => {
      const approval = preflightLaunchPhase === 'approval-required'
        ? await approvePreflightResources(preflightPermissionDuration) : { ready: true, character: selected }
      if (!approval.ready) return false
      const persona = personas?.find(entry => entry.id === personaId)
      await onStart(approval.character, greetingIndex, persona === undefined ? undefined : {
        id: persona.id, name: persona.name, description: persona.description,
      }, presetId === '' ? undefined : presetId,
      selectedWorldInfoIds,
      copyActiveMemory ? 'copy-active' : undefined,
      approval.resourcePermissions)
      return true
    })().then(started => {
      setStarting(false)
      if (started) onClose()
    }, startError => {
      setStarting(false)
      setError(startError instanceof Error ? startError.message : String(startError))
    })
  }
  return <div className="agent-rp-character-library-overlay" data-agent-rp-dialog data-agent-rp-character-launcher
    data-agent-rp-selected-character-id={selected?.id ?? ''}
    data-agent-rp-selected-preset-id={selectedPresetId ?? ''}
    data-agent-rp-surface="character-library" role="dialog" aria-modal="true" aria-label="开始角色对话" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.52)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: 'clamp(8px, 3vw, 24px)', position: 'fixed', zIndex: 1001,
  }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="agent-rp-character-library-dialog" style={{
      background: 'var(--dsw-alias-bg-base, #171719)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
      borderRadius: '16px', boxShadow: '0 22px 80px rgba(0,0,0,.36)', display: 'grid',
      gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(260px, 320px) minmax(0, 1fr)',
      gridTemplateRows: narrow ? 'minmax(240px, .8fr) minmax(0, 1.2fr)' : undefined,
      height: 'min(680px, calc(100vh - clamp(16px, 6vw, 48px)))',
      maxWidth: '1180px', overflow: 'hidden', position: 'relative', width: 'min(1180px, calc(100vw - clamp(16px, 6vw, 48px)))',
    }}>
      <div style={{
        borderBottom: narrow ? '1px solid var(--dsw-alias-border-l2, #39393c)' : undefined,
        borderRight: narrow ? undefined : '1px solid var(--dsw-alias-border-l2, #39393c)',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: narrow ? '14px 14px 10px' : '22px 20px 14px' }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
            <button type="button" className="agent-rp-character-library-back" aria-label="返回对话"
              title="返回对话" onClick={onClose}>
              <IconChevronLeftOutline14 size={18} />
            </button>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>{collection === 'active' ? '选择角色' : '收纳箱'}</h2>
              <span style={{ display: 'block', fontSize: '10px', marginTop: '3px', opacity: .48 }}>
                {collection === 'active' ? '选择一张角色卡开始新的对话' : '已收起的角色仍完整保存在本机'}
              </span>
            </div>
            <button type="button"
              data-agent-rp-action={collection === 'active' ? 'open-character-archive' : 'close-character-archive'}
              onClick={() => { setCollection(collection === 'active' ? 'archived' : 'active'); setCharacterQuery('') }} style={{
                background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '8px',
                color: 'inherit', cursor: 'pointer', flex: '0 0 auto', font: 'inherit', fontSize: '11px', padding: '6px 9px',
              }}>{collection === 'active' ? '收纳箱' : '返回选择'}</button>
          </div>
          <input ref={fileInputRef} type="file" accept=".png,.json,.charx,image/png,application/json,application/zip" hidden onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) importFile(file)
          }} />
          <div data-agent-rp-character-toolbar style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <input type="search" value={characterQuery} aria-label={collection === 'active' ? '搜索角色' : '搜索收纳箱'}
              placeholder={collection === 'active' ? '搜索角色或文件名' : '搜索已收起的角色'} onChange={event => {
                const value = event.target.value
                const normalized = value.trim().toLocaleLowerCase()
                const matches = (entry: Pick<CharacterLibrarySummary, 'displayName' | 'name' | 'originalFilename'>): boolean => normalized === ''
                  || [entry.displayName, entry.name, entry.originalFilename]
                    .some(text => text.toLocaleLowerCase().includes(normalized))
                const next = (entries ?? []).find(matches)
                setCharacterQuery(value)
                if (next === undefined) {
                  selectionRequestRef.current += 1
                  setSelected(undefined)
                  setExpandedGreetingIndex(undefined)
                  setLoadingId(undefined)
                } else if (selected === undefined || !matches(selected)) {
                  choose(next)
                }
              }} style={{
                background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
                borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', flex: '1 1 auto', font: 'inherit',
                fontSize: '12px', minWidth: 0, outline: 'none', padding: '8px 10px',
              }} />
            {collection === 'active' && <button type="button" disabled={importing} title="导入 PNG、JSON 或 CHARX 角色卡"
              data-agent-rp-action="import-character" onClick={() => { fileInputRef.current?.click() }}
              onDragEnter={event => { event.preventDefault(); setDraggingFile(true) }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingFile(true) }}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false) }}
              onDrop={event => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file === undefined) setDraggingFile(false)
                else importFile(file)
              }} style={{
                background: `color-mix(in srgb, ${color} ${draggingFile ? 20 : 11}%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color} ${draggingFile ? 75 : 38}%, transparent)`,
                borderRadius: '9px', color: 'inherit', cursor: importing ? 'wait' : 'pointer', flex: '0 0 auto',
                font: 'inherit', fontSize: '12px', fontWeight: 620, opacity: importing ? .58 : 1, padding: '8px 10px',
              }}>{importing ? '导入中…' : draggingFile ? '松开导入' : '＋ 导入'}</button>}
          </div>
        </div>
        <div style={{ display: 'grid', gap: '6px', minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: '4px 10px 18px' }}>
          {entries === undefined && <div style={{ fontSize: '13px', opacity: .55, padding: '16px 10px' }}>正在读取角色…</div>}
          {entries?.length === 0 && <div style={{ fontSize: '13px', lineHeight: 1.65, opacity: .62, padding: '16px 10px' }}>
            {collection === 'active' ? '角色库还是空的。导入一张角色卡后，它会自动保存在这里' : '收纳箱还是空的'}
          </div>}
          {entries !== undefined && entries.length > 0 && visibleEntries.length === 0 && <div style={{ fontSize: '13px', lineHeight: 1.65, opacity: .62, padding: '16px 10px' }}>
            没有找到匹配的角色
          </div>}
          {visibleEntries.map(entry => <button key={entry.id} type="button" aria-pressed={selected?.id === entry.id}
            data-agent-rp-character-id={entry.id}
            onClick={() => { choose(entry) }} style={{
              alignItems: 'center',
              background: selected?.id === entry.id ? `color-mix(in srgb, ${color} 15%, transparent)` : 'transparent',
              border: selected?.id === entry.id ? `1px solid color-mix(in srgb, ${color} 36%, transparent)` : '1px solid transparent',
              borderRadius: '10px', color: 'inherit', cursor: 'pointer', display: 'flex', font: 'inherit', gap: '10px', padding: '9px', textAlign: 'left',
            }}>
            <CharacterLibraryAvatar entry={entry} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div title={entry.displayName} style={{
                display: '-webkit-box', fontSize: '13px', fontWeight: 620, lineHeight: 1.35,
                overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
              }}>
                {entry.displayName}{loadingId === entry.id ? ' · 读取中' : ''}
              </div>
              <div style={{ fontSize: '11px', marginTop: '5px', opacity: .5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {duplicateNames.has(entry.displayName) ? `同名 · ${entry.originalFilename} · ${new Date(entry.importedAt).toLocaleString('zh-CN', { hour12: false })} · ` : ''}
                V{entry.cardVersion} · {entry.greetingCount} 个开场{entry.worldInfoCount === 0 ? '' : ` · ${entry.worldInfoCount} 条世界书`}
                {entry.regexScriptCount === 0 ? '' : ` · ${entry.regexScriptCount} 条正则`}
                {entry.imageAssetCount === 0 ? '' : ` · ${entry.imageAssetCount} 张图片`}
              </div>
            </div>
          </button>)}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <header style={{ alignItems: 'center', display: 'flex', padding: '18px 20px 12px' }}>
          {selected !== undefined && <CharacterLibraryAvatar entry={selected} size={42} />}
          <div style={{ marginLeft: selected === undefined ? 0 : '11px', minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: '17px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected?.displayName ?? (collection === 'active' ? '选择角色' : '选择已收起角色')}
            </strong>
            {selected !== undefined && <span title={selected.originalFilename} style={{ display: 'block', fontSize: '11px', marginTop: '3px', opacity: .46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.originalFilename}</span>}
          </div>
          {selected !== undefined && <button type="button" disabled={updating} onClick={updateArchiveState} style={{
            background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '8px',
            color: 'inherit', cursor: updating ? 'wait' : 'pointer', flex: '0 0 auto', font: 'inherit', fontSize: '12px',
            marginLeft: 'auto', padding: '6px 10px', whiteSpace: 'nowrap',
          }}>{updating ? '处理中…' : collection === 'active' ? '移到收纳箱' : '移回角色库'}</button>}
          <button className="agent-rp-character-library-detail-close" type="button" aria-label="关闭开始角色对话"
            data-agent-rp-action="close-character-library" onClick={onClose} style={{
            background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '23px', marginLeft: selected === undefined ? 'auto' : '8px', padding: '4px 6px',
          }}>×</button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: '4px 20px 22px' }}>
          {selected === undefined && entries !== undefined && <div style={{
            alignItems: 'center', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center',
            margin: '0 auto', maxWidth: '380px', minHeight: '240px', textAlign: 'center',
          }}>
            <div aria-hidden="true" style={{
              alignItems: 'center', background: `color-mix(in srgb, ${color} 13%, transparent)`, borderRadius: '18px',
              color, display: 'flex', fontSize: '24px', height: '54px', justifyContent: 'center', width: '54px',
            }}>✦</div>
            <strong style={{ fontSize: '17px', marginTop: '16px' }}>{collection === 'archived'
              ? '收纳箱还是空的'
              : entries.length === 0 ? '从一张角色卡开始' : '没有匹配的角色'}</strong>
            <p style={{ fontSize: '13px', lineHeight: 1.65, margin: '8px 0 0', opacity: .58 }}>
              {collection === 'archived'
                ? '放进收纳箱的角色仍完整保留在本机，随时可以移回角色库'
                : entries.length === 0
                  ? '支持 SillyTavern 的 PNG、JSON 和 CHARX。原始文件保存在本机；开始对话后，角色设定会提供给模型'
                  : '换个关键词，或清空左侧搜索框'}
            </p>
            {collection === 'active' && entries.length === 0 && <button type="button" disabled={importing}
              onClick={() => { fileInputRef.current?.click() }} style={{
                background: color, border: 0, borderRadius: '9px', color: '#fff', cursor: importing ? 'wait' : 'pointer',
                font: 'inherit', fontWeight: 620, marginTop: '18px', opacity: importing ? .58 : 1, padding: '9px 15px',
              }}>{importing ? '正在导入…' : '导入角色卡'}</button>}
          </div>}
          {selected !== undefined && <>
            <CharacterContentEditor
              detail={selected}
              color={color}
              onChange={entry => {
                setSelected(entry)
                setEntries(current => current?.map(item => item.id === entry.id ? entry : item))
                setGreetingIndex(current => Math.min(current, Math.max(0, entry.greetings.length - 1)))
                notifyCharacterLibraryChanged(entry.id)
              }}
              onNotice={message => { setActionNotice(message); setError(undefined) }}
              onError={message => { setError(message === '' ? undefined : message) }}
            />
            <CharacterWorldInfoSection key={selected.id} detail={selected} />
            <CharacterRegexScriptsSection scripts={selected.regexScripts} {...(typeof (selected.localRevision as number | undefined) !== 'number' ? {} : { editable: {
              detail: selected,
              onChange: entry => {
                setSelected(entry)
                setEntries(current => current?.map(item => item.id === entry.id ? entry : item))
                setActionNotice('角色卡正则开关已保存')
              },
              onError: message => { setError(message === '' ? undefined : message) },
            } })} />
            {selected.tavernHelper !== undefined && <div style={{
              background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #39393c)',
              borderRadius: '10px', fontSize: '11px', lineHeight: 1.55, margin: '4px 0 12px', padding: '9px 11px',
            }}>
              <strong style={{ display: 'block', fontSize: '12px', marginBottom: '2px' }}>Tavern Helper</strong>
              <span style={{ opacity: .58 }}>{tavernHelperSummaryText(selected.tavernHelper)} · 脚本在隔离运行时中执行</span>
            </div>}
            {expectsResourcePreflight && <div
              data-agent-rp-resource-preflight={resourcePreflightStatus}
              data-agent-rp-resource-preflight-scripts={tavernPreflight?.scripts ?? 0}
              data-agent-rp-resource-preflight-card-resources={selected.remoteResources.length}
              data-agent-rp-resource-preflight-card-permissions={pendingCardResources.length}
              data-agent-rp-resource-preflight-script-permissions={pendingPreflightScripts.length + pendingPreflightImages.length + pendingPreflightStyles.length + pendingPreflightFonts.length + pendingPreflightFrames.length}
              data-agent-rp-resource-preflight-script-origins={pendingPreflightScripts.length}
              data-agent-rp-resource-preflight-image-origins={pendingPreflightImages.length}
              data-agent-rp-resource-preflight-style-origins={pendingPreflightStyles.length}
              data-agent-rp-resource-preflight-font-origins={pendingPreflightFonts.length}
              data-agent-rp-resource-preflight-frame-origins={pendingPreflightFrames.length}
              data-agent-rp-resource-preflight-permissions={pendingPreflightPermissions}
              data-agent-rp-resource-preflight-failed={tavernPreflight?.failed ?? 0}
              data-agent-rp-resource-launch={preflightLaunchPhase}
              data-agent-rp-resource-permission-duration={preflightPermissionDuration}
              style={{
                background: pendingPreflightHosts.length === 0
                  ? 'var(--dsw-alias-bg-layer-1, #202024)'
                  : 'color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 9%, transparent)',
                border: pendingPreflightHosts.length === 0
                  ? '1px solid var(--dsw-alias-border-l2, #39393c)'
                  : '1px solid color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 38%, transparent)',
                borderRadius: '10px', fontSize: '11px', lineHeight: 1.55, margin: '4px 0 12px', padding: '10px 11px',
              }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
                <strong style={{ fontSize: '12px' }}>界面资源</strong>
                <span style={{ marginLeft: 'auto', opacity: .56 }}>
                  {tavernPreflightLoading ? '检查中…'
                    : tavernPreflightError !== undefined ? '暂时无法预检'
                      : pendingPreflightHosts.length > 0 ? `${pendingPreflightHosts.length} 个来源待确认`
                        : expectsTavernPreflight ? `${tavernPreflight?.ready ?? 0}/${tavernPreflight?.scripts ?? 0} 已准备`
                          : `${selected.remoteResources.length} 项已准备`}
                </span>
              </div>
              {tavernPreflightError !== undefined && <div style={{ marginTop: '5px', opacity: .58 }}>
                {tavernPreflightError}；仍可开聊，未解析的脚本会保持关闭
              </div>}
              {pendingPreflightHosts.length > 0 && <>
                <div title={pendingPreflightHosts.join('\n')} style={{
                  marginTop: '5px', opacity: .66, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{pendingPreflightHosts.join('、')}</div>
                <div role="radiogroup" aria-label="界面权限方式" style={{
                  display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: '8px',
                }}>
                  {([['session', '仅本次'], ['remember', '记住'], ['trust', '信任界面']] as const).map(([value, label]) => <button
                      key={value} type="button" role="radio" aria-checked={preflightPermissionDuration === value}
                      data-agent-rp-permission-duration={value}
                      onClick={() => { setPreflightPermissionDuration(value) }} style={{
                        background: preflightPermissionDuration === value
                          ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
                        border: preflightPermissionDuration === value
                          ? `1px solid color-mix(in srgb, ${color} 42%, transparent)`
                          : '1px solid var(--dsw-alias-border-l2, #444)',
                        borderRadius: '7px', color: 'inherit', cursor: 'pointer', font: 'inherit', padding: '7px 6px',
                        textAlign: 'center', whiteSpace: 'nowrap',
                      }}>
                      <strong style={{ display: 'block', fontSize: '11px' }}>{label}</strong>
                    </button>)}
                </div>
                <div style={{ fontSize: '10px', lineHeight: 1.5, marginTop: '6px', opacity: .52 }}>
                  {preflightPermissionDuration === 'session'
                    ? '只允许这次发现的资源，之后仍会询问'
                    : preflightPermissionDuration === 'remember'
                      ? '记住当前角色与预设中已确认的精确来源'
                      : '自动允许这张卡的隔离界面加载 HTTPS 资源'}
                </div>
              </>}
              {failedPreflightEntries.length > 0 && <div style={{ color: 'var(--dsw-alias-state-warning, #d5a64c)', marginTop: '5px' }}>
                <div>{failedPreflightEntries.length} 个脚本无法准备，开聊后也不会执行</div>
                {failedPreflightEntries.map(entry => <div key={`${entry.scope}:${entry.scriptId}`} title={entry.scriptName}
                  style={{ marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.scriptName}：{entry.detail ?? '脚本无法完成静态解析'}
                </div>)}
              </div>}
              <div style={{ marginTop: '5px', opacity: .46 }}>模型调用与外部 API 仍在实际触发时单独确认</div>
            </div>}
            {selected.degradations.some(value => value !== 'lorebook-regex') && <div style={{
              borderLeft: '2px solid color-mix(in srgb, #d6a24d 70%, transparent)', fontSize: '11px', lineHeight: 1.55,
              margin: '4px 0 12px', opacity: .62, padding: '2px 0 2px 10px',
            }}>
              兼容提醒 · 原卡包含仍需留意的扩展能力（原始内容已保留）：{selected.degradations
                .filter(value => value !== 'lorebook-regex').map(characterDegradationLabel).join('、')}
            </div>}
            {selected.localCorrectionCount > 0 && <div style={{
              borderLeft: `2px solid color-mix(in srgb, ${color} 62%, transparent)`, fontSize: '11px', lineHeight: 1.55,
              margin: '4px 0 12px', opacity: .62, padding: '2px 0 2px 10px',
            }}>
              本机已修正 {selected.localCorrectionCount} 处原文笔误；原始角色卡文件没有改动
            </div>}
            <CharacterDisplayExtensionsSection
              detail={selected}
              onChange={entry => { setSelected(entry) }}
              onNotice={message => { setActionNotice(message); setError(undefined) }}
              onError={message => { setError(message === '' ? undefined : message) }}
            />
            <CharacterRemoteResourcesSection detail={selected} onChange={entry => { setSelected(entry) }} />
            <CharacterAssetsSection detail={selected} />
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 620, margin: '8px 0 8px', opacity: .65 }}>选择开场</label>
            <div style={{ display: 'grid', gap: '8px' }}>
              {selected.greetings.map((greeting, index) => {
                const active = greetingIndex === index
                const expanded = expandedGreetingIndex === index
                const summary = greetingSummaries[index] ?? ''
                return <div key={index} style={{
                  background: greetingIndex === index ? `color-mix(in srgb, ${color} 13%, transparent)` : 'var(--dsw-alias-bg-layer-1, #202024)',
                  border: greetingIndex === index ? `1px solid color-mix(in srgb, ${color} 38%, transparent)` : '1px solid var(--dsw-alias-border-l2, #39393c)',
                  borderRadius: '10px', color: 'inherit', overflow: 'hidden',
                }}>
                  <button type="button" aria-expanded={expanded} aria-pressed={active} onClick={() => {
                    if (active) {
                      setExpandedGreetingIndex(current => current === index ? undefined : index)
                      return
                    }
                    setGreetingIndex(index)
                    setExpandedGreetingIndex(index)
                  }} style={{
                    background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', display: 'block',
                    font: 'inherit', lineHeight: 1.6, padding: '10px 12px', textAlign: 'left', width: '100%',
                  }}>
                    <span style={{ alignItems: 'center', display: 'flex', fontSize: '11px', fontWeight: 620, gap: '8px', justifyContent: 'space-between', opacity: .56 }}>
                      <span>{index === 0 ? '默认开场' : `备选开场 ${index}`}{active ? ' · 已选择' : ''}</span>
                      <span style={{ alignItems: 'center', display: 'flex', flex: 'none', fontWeight: 400, gap: '4px' }}>
                        {expanded ? '收起' : '展开'}<DisclosureChevron expanded={expanded} />
                      </span>
                    </span>
                    {!expanded && <span style={{
                      display: '-webkit-box', fontSize: '12px', lineHeight: 1.55, marginTop: '5px', opacity: .72,
                      overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
                    }}>{summary === '' ? '无开场白' : summary}</span>}
                  </button>
                  {expanded && <div style={{
                    borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', padding: '10px 12px',
                  }}>
                    {greeting.trim() === '' ? <span style={{ fontSize: '13px', opacity: .58 }}>无开场白</span>
                      : <CharacterDisplay
                          compilation={compileCharacterDisplay(selected.renderedGreetings[index] ?? greeting)}
                          statData={undefined}
                          characterName={selected.displayName}
                          character={selected}
                          preview
                        />}
                  </div>}
                </div>
              })}
            </div>
            <div style={{ alignItems: 'center', display: 'flex', margin: '20px 0 8px' }}>
              <label htmlFor="agent-rp-session-preset" style={{ fontSize: '12px', fontWeight: 620, opacity: .65 }}>对话预设</label>
              <input ref={presetInputRef} type="file" accept=".json,application/json" hidden onChange={event => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file !== undefined) importPresetSelection(file)
              }} />
              <button type="button" disabled={importingPreset} onClick={() => { presetInputRef.current?.click() }} style={{
                background: 'transparent', border: 0, color, cursor: importingPreset ? 'wait' : 'pointer',
                font: 'inherit', fontSize: '12px', marginLeft: 'auto', padding: 0,
              }}>{importingPreset ? '正在导入…' : '导入预设'}</button>
              {presetId !== '' && <button type="button" disabled={renamingPreset} onClick={() => {
                const preset = presets?.find(entry => entry.id === presetId)
                if (preset === undefined) return
                const name = window.prompt('预设名称', preset.name)?.trim()
                if (name === undefined || name === '' || name === preset.name) return
                setRenamingPreset(true)
                setError(undefined)
                void renamePreset(preset.id, name).then(entry => {
                  setRenamingPreset(false)
                  setActionNotice(`预设已改名为「${entry.name}」`)
                }, reason => {
                  setRenamingPreset(false)
                  setError(reason instanceof Error ? reason.message : String(reason))
                })
              }} style={{
                background: 'transparent', border: 0, color, cursor: renamingPreset ? 'wait' : 'pointer',
                font: 'inherit', fontSize: '12px', marginLeft: '12px', padding: 0,
              }}>{renamingPreset ? '正在改名…' : '改名'}</button>}
            </div>
            <div style={{ position: 'relative' }}>
              <select id="agent-rp-session-preset" value={presetId} onChange={event => { selectPreset(event.target.value) }} style={{
                appearance: 'none', background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
                borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '9px 36px 9px 10px', width: '100%',
              }}>
                <option value="">不使用预设</option>
                {presets?.map(entry => <option key={entry.id} value={entry.id}>{presetLibraryOptionLabel(entry, presets)}</option>)}
              </select>
              <SelectChevron />
            </div>
            <div style={{ fontSize: '11px', lineHeight: 1.55, marginTop: '6px', opacity: .5 }}>
              {presetError !== undefined
                ? presetError
                : presets === undefined
                ? '正在读取预设…'
                : presets.length === 0
                  ? '预设库暂无内容，可在这里导入社区推荐的预设 JSON'
                  : (() => {
                      const preset = presets.find(entry => entry.id === presetId)
                      return preset === undefined
                        ? '新会话不会启用酒馆预设'
                        : `${preset.enabledCount}/${preset.promptCount} 项启用${preset.regexScriptCount === 0 ? '' : ` · ${preset.regexScriptCount} 条正则`} · 开聊后可在「会话设置 → 预设」调整开关`
                    })()}
            </div>
            <AdditionalWorldInfoSelection
              listWorldInfos={listWorldInfos}
              selectedWorldInfoIds={selectedWorldInfoIds}
              onChange={setSelectedWorldInfoIds}
            />
            <div style={{ alignItems: 'center', display: 'flex', margin: '20px 0 7px' }}>
              <label htmlFor="agent-rp-session-persona" style={{ fontSize: '12px', fontWeight: 620, opacity: .65 }}>你的身份（Persona）</label>
              <button type="button" onClick={() => {
                setEditingPersona(value => !value)
                setPersonaEditorId(undefined)
                setPersonaName('')
                setPersonaDescription('')
                setConfirmingPersonaId(undefined)
              }} style={{ background: 'transparent', border: 0, color, cursor: 'pointer', font: 'inherit', fontSize: '12px', marginLeft: 'auto', padding: 0 }}>
                {editingPersona ? '收起' : '新建身份'}
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <select id="agent-rp-session-persona" value={personaId} disabled={removingPersonaId !== undefined} onChange={event => {
                setPersonaId(event.target.value)
                setConfirmingPersonaId(undefined)
              }} style={{
                appearance: 'none', background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
                borderRadius: '9px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '9px 36px 9px 10px', width: '100%',
              }}>
                <option value="">暂不设置</option>
                {personas?.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
              </select>
              <SelectChevron />
            </div>
            {personaId !== '' && (() => {
              const persona = personas?.find(entry => entry.id === personaId)
              if (persona === undefined) return null
              const confirming = confirmingPersonaId === persona.id
              const removing = removingPersonaId === persona.id
              return <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '12px', lineHeight: 1.6, opacity: .58, whiteSpace: 'pre-wrap' }}>
                  {persona.description || '只有称呼，没有额外人物设定'}
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '7px' }}>
                  <button type="button" disabled={removing} onClick={() => {
                    setEditingPersona(true)
                    setPersonaEditorId(persona.id)
                    setPersonaName(persona.name)
                    setPersonaDescription(persona.description)
                    setConfirmingPersonaId(undefined)
                  }} style={{ background: 'transparent', border: 0, color, cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: 0 }}>编辑</button>
                  <button type="button" disabled={removing} onClick={() => {
                    if (!confirming) {
                      setConfirmingPersonaId(persona.id)
                      return
                    }
                    setRemovingPersonaId(persona.id)
                    setError(undefined)
                    void deletePersona(persona.id).then(() => {
                      setPersonas(current => (current ?? []).filter(entry => entry.id !== persona.id))
                      setPersonaId('')
                      setConfirmingPersonaId(undefined)
                      setRemovingPersonaId(undefined)
                      if (personaEditorId === persona.id) {
                        setEditingPersona(false)
                        setPersonaEditorId(undefined)
                        setPersonaName('')
                        setPersonaDescription('')
                      }
                      setActionNotice(`已移除身份「${persona.name}」`)
                    }, removeError => {
                      setRemovingPersonaId(undefined)
                      setError(removeError instanceof Error ? removeError.message : String(removeError))
                    })
                  }} style={{ background: 'transparent', border: 0, color: confirming ? '#e88989' : 'inherit', cursor: removing ? 'wait' : 'pointer', font: 'inherit', fontSize: '11px', opacity: confirming ? 1 : .48, padding: 0 }}>
                    {removing ? '正在移除…' : confirming ? '确认移除' : '移除'}
                  </button>
                  {confirming && <button type="button" onClick={() => { setConfirmingPersonaId(undefined) }} style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', opacity: .48, padding: 0 }}>取消</button>}
                </div>
              </div>
            })()}
            {editingPersona && <div style={{ background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '10px', display: 'grid', gap: '9px', marginTop: '10px', padding: '11px' }}>
              <input value={personaName} maxLength={120} placeholder="称呼（角色会这样称呼你）" onChange={event => { setPersonaName(event.target.value) }} style={{
                background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #414147)', borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', padding: '8px 9px', width: '100%',
              }} />
              <textarea value={personaDescription} maxLength={12000} rows={4} placeholder="你的身份、外貌、性格或与角色的关系；留白也可以" onChange={event => { setPersonaDescription(event.target.value) }} style={{
                background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #414147)', borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', font: 'inherit', lineHeight: 1.55, padding: '8px 9px', resize: 'vertical', width: '100%',
              }} />
              <button type="button" disabled={savingPersona || personaName.trim() === ''} onClick={() => {
                setSavingPersona(true)
                setError(undefined)
                const editingId = personaEditorId
                void savePersona({
                  format: 0,
                  ...(editingId === undefined ? {} : { id: editingId }),
                  name: personaName,
                  description: personaDescription,
                }).then(entry => {
                  setPersonas(current => [entry, ...(current ?? []).filter(item => item.id !== entry.id)])
                  setPersonaId(entry.id)
                  setEditingPersona(false)
                  setPersonaEditorId(undefined)
                  setSavingPersona(false)
                  setActionNotice(`${editingId === undefined ? '已保存并选中' : '已更新'}身份「${entry.name}」`)
                }, saveError => {
                  setSavingPersona(false)
                  setError(saveError instanceof Error ? saveError.message : String(saveError))
                })
              }} style={{ background: color, border: 0, borderRadius: '8px', color: '#fff', cursor: 'pointer', font: 'inherit', justifySelf: 'end', opacity: personaName.trim() === '' ? .45 : 1, padding: '7px 11px' }}>
                {savingPersona ? '正在保存…' : personaEditorId === undefined ? '保存并选中' : '更新并选中'}
              </button>
            </div>}
            {currentCharacterId !== undefined && selected.id === currentCharacterId && <label style={{
              alignItems: 'flex-start', background: 'var(--dsw-alias-bg-layer-1, #202024)',
              border: '1px solid var(--dsw-alias-border-l2, #3b3b41)', borderRadius: '10px', cursor: 'pointer',
              display: 'flex', gap: '10px', marginTop: '18px', padding: '11px 12px',
            }}>
              <input type="checkbox" checked={copyActiveMemory} onChange={event => { setCopyActiveMemory(event.target.checked) }}
                style={{ accentColor: color, margin: '2px 0 0' }} />
              <span>
                <span style={{ display: 'block', fontSize: '12px', fontWeight: 620 }}>带上当前会话的有效记忆（如果有）</span>
                <span style={{ display: 'block', fontSize: '11px', lineHeight: 1.5, marginTop: '4px', opacity: .5 }}>
                  只复制角色仍记得的事，不复制聊天记录或修改过程
                </span>
              </span>
            </label>}
          </>}
          {error !== undefined && <div role="alert" style={{ color: '#e88989', fontSize: '12px', lineHeight: 1.55, marginTop: '14px' }}>{error}</div>}
        </div>
        <footer className="agent-rp-character-library-footer" style={{
          alignItems: 'center', borderTop: '1px solid var(--dsw-alias-border-l2, #39393c)', display: 'flex',
          gap: '10px', justifyContent: 'flex-end', padding: '14px 20px',
        }}>
          <button className="agent-rp-character-library-cancel" type="button" onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '9px',
            color: 'inherit', cursor: 'pointer', flex: '0 0 auto', font: 'inherit', padding: '8px 13px', whiteSpace: 'nowrap',
          }}>取消</button>
          <button className="agent-rp-character-library-start" type="button" data-agent-rp-start-readiness={preflightLaunchPhase}
            data-agent-rp-start-action={preflightChecking ? 'checking'
              : preflightLaunchPhase === 'approval-required' ? 'approve-and-start' : 'start'}
            disabled={collection === 'archived' || selected === undefined || starting || approvingPreflight
              || importingPreset || preflightChecking} onClick={startSelectedCharacter} style={{
            background: color, border: 0, borderRadius: '9px', color: '#fff',
            cursor: starting || approvingPreflight || preflightChecking ? 'wait' : 'pointer',
            flex: '0 0 auto', font: 'inherit', fontWeight: 620,
            opacity: collection === 'archived' || selected === undefined || preflightChecking ? .45 : 1,
            padding: '8px 18px', whiteSpace: 'nowrap',
          }}>{starting ? '正在开始…'
              : approvingPreflight ? '准备中…'
                : preflightChecking ? '准备中…' : '开始'}</button>
        </footer>
      </div>
      {actionNotice !== undefined && <div className="agent-rp-character-library-toast" role="status" style={{
        background: 'var(--dsw-alias-bg-layer-2, #29292d)', border: '1px solid var(--dsw-alias-border-l2, #444)',
        borderRadius: '9px', bottom: '72px', boxShadow: '0 10px 32px rgba(0,0,0,.3)', fontSize: '12px',
        left: narrow ? '14px' : '340px', lineHeight: 1.45, padding: '8px 11px', pointerEvents: 'none',
        position: 'absolute', right: '20px', textAlign: 'center', zIndex: 2,
      }}>{actionNotice}</div>}
    </section>
  </div>
}

type PresetProjection = NonNullable<AgentRpProjection['preset']>
type PresetPromptProjection = PresetProjection['prompts'][number]
type PresetLibraryEntry = AgentRpProjection['presetLibrary'][number]
type PresetLibraryRequest = { readonly operation: 'list' }
  | { readonly operation: 'select' | 'delete'; readonly id: string }
  | { readonly operation: 'rename'; readonly id: string; readonly name: string }
  | { readonly operation: 'save'; readonly name: string }

function roleLabel(role: PresetPromptProjection['role']): string {
  switch (role) {
    case 'system': return '系统'
    case 'user': return '用户'
    case 'assistant': return '助手'
  }
}

function PresetManagerDialog({
  sessionId, preset, lastRequest, promptRegex, entries, loadModelCapabilities, onClose, onImport, onSave, onLibrary,
}: {
  readonly sessionId: SessionId
  readonly preset: PresetProjection
  readonly lastRequest?: AgentRpProjection['lastRequest']
  readonly promptRegex?: AgentRpProjection['promptRegex']
  readonly entries: AgentRpProjection['presetLibrary']
  readonly loadModelCapabilities: (sessionId: SessionId) => Promise<CurrentModelCapabilities>
  readonly onClose: () => void
  readonly onImport: (file: File) => Promise<void>
  readonly onSave: (request: PresetConfigurationRequest) => Promise<void>
  readonly onLibrary: (request: PresetLibraryRequest) => Promise<void>
}) {
  const [prompts, setPrompts] = useState(() => preset.prompts.map(prompt => ({ ...prompt })))
  const [regexScripts, setRegexScripts] = useState(() => preset.regexScripts.map(script => ({ ...script })))
  const [temperature, setTemperature] = useState(preset.generation.temperature?.toString() ?? '')
  const [maxTokens, setMaxTokens] = useState(preset.generation.maxTokens?.toString() ?? '')
  const [reasoningEffort, setReasoningEffort] = useState(preset.generation.reasoningEffort ?? '')
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<'prompts' | 'regex'>('prompts')
  const [promptView, setPromptView] = useState<'current' | 'catalog'>('current')
  const [collapsedPromptSections, setCollapsedPromptSections] = useState<ReadonlySet<string>>(() => new Set(
    projectPresetPromptSections(preset.prompts).slice(1).map(group => group.key),
  ))
  const [editingPromptId, setEditingPromptId] = useState<string>()
  const [promptFilter, setPromptFilter] = useState<'all' | 'enabled' | 'modified'>('all')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [modelCapabilities, setModelCapabilities] = useState<{
    readonly status: 'loading' | 'ready' | 'error'
    readonly value?: CurrentModelCapabilities
    readonly error?: string
  }>({ status: 'loading' })
  const importInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadModelCapabilities(sessionId).then(value => {
      if (!cancelled) setModelCapabilities({ status: 'ready', value })
    }, reason => {
      if (!cancelled) setModelCapabilities({
        status: 'error', error: reason instanceof Error ? reason.message : String(reason),
      })
    })
    return () => { cancelled = true }
  }, [loadModelCapabilities, sessionId])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const attached = prompts.filter(prompt => prompt.attached)
  const catalog = prompts.filter(prompt => !prompt.attached)
  const attachedPositionById = new Map(attached.map((prompt, position) => [prompt.identifier, position]))
  const promptModified = (prompt: PresetPromptProjection): boolean => !prompt.imported
    || prompt.name !== prompt.importedName
    || prompt.role !== prompt.importedRole
    || prompt.content !== prompt.importedContent
    || prompt.injectionPosition !== prompt.importedInjectionPosition
    || prompt.injectionDepth !== prompt.importedInjectionDepth
    || prompt.injectionOrder !== prompt.importedInjectionOrder
    || prompt.attached !== prompt.importedAttached
    || (prompt.attached && prompt.enabled !== prompt.importedEnabled)
    || (prompt.attached && attachedPositionById.get(prompt.identifier) !== prompt.importedPosition)
  const promptSections = projectPresetPromptSections(prompts)
  const visiblePromptSections = promptSections.flatMap((group) => {
    const filteredPrompts = group.prompts.filter(prompt => promptFilter === 'all'
      || (promptFilter === 'enabled' && prompt.enabled)
      || (promptFilter === 'modified' && promptModified(prompt)))
    const groupMatches = normalizedQuery === '' || group.title.toLocaleLowerCase().includes(normalizedQuery)
    const matchingPrompts = groupMatches ? filteredPrompts : filteredPrompts.filter(prompt =>
      prompt.name.toLocaleLowerCase().includes(normalizedQuery)
      || prompt.identifier.toLocaleLowerCase().includes(normalizedQuery))
    return matchingPrompts.length === 0 ? [] : [{
      ...group,
      prompts: matchingPrompts,
      enabledCount: matchingPrompts.filter(prompt => prompt.enabled).length,
    }]
  })
  const visibleCatalog = catalog.filter(prompt => normalizedQuery === ''
    || prompt.name.toLocaleLowerCase().includes(normalizedQuery)
    || prompt.identifier.toLocaleLowerCase().includes(normalizedQuery))
  const visibleRegex = regexScripts.filter(script => normalizedQuery === ''
    || script.scriptName.toLocaleLowerCase().includes(normalizedQuery))
  const promptRegexByIndex = new Map(promptRegex?.scripts
    .filter(script => script.source === 'preset').map(script => [script.index, script]))
  const enabledCount = attached.filter(prompt => prompt.enabled).length
  const editingPrompt = prompts.find(prompt => prompt.identifier === editingPromptId)
  const reasoning = modelCapabilities.value?.reasoning
  const selectedReasoning = reasoning?.efforts.find(effort => effort.id === reasoningEffort)
  const unsupportedReasoning = reasoningEffort !== '' && reasoningEffort !== 'auto'
    && modelCapabilities.status === 'ready' && reasoning !== undefined && selectedReasoning === undefined
  const selectedReasoningLabel = selectedReasoning?.name
    ?? (reasoningEffort === '' ? '' : reasoningEffort.charAt(0).toLocaleUpperCase() + reasoningEffort.slice(1))
  const currentReasoningLabel = modelCapabilities.value?.current.reasoningEffort === undefined
    ? '模型默认等级'
    : reasoning?.efforts.find(effort => effort.id === modelCapabilities.value?.current.reasoningEffort)?.name
      ?? modelCapabilities.value.current.reasoningEffort
  const modelLabel = modelCapabilities.value === undefined
    ? undefined
    : modelCapabilities.value.modelName ?? modelCapabilities.value.current.model
  const preservedSampling = preset.preservedGeneration.filter(value => !value.startsWith('reasoning_effort'))
  const togglePromptSection = (key: string): void => {
    setCollapsedPromptSections((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const setPrompt = (identifier: string, update: (prompt: PresetPromptProjection) => PresetPromptProjection): void => {
    setPrompts(current => current.map(prompt => prompt.identifier === identifier ? update(prompt) : prompt))
  }
  const setPromptContent = (identifier: string, content: string): void => {
    setPrompt(identifier, prompt => ({
      ...prompt,
      content,
      contentModified: content !== prompt.importedContent,
    }))
  }
  const addPrompt = (): void => {
    const identifier = crypto.randomUUID()
    const prompt: PresetPromptProjection = {
      identifier,
      name: '新提示模块',
      importedName: '新提示模块',
      role: 'system',
      importedRole: 'system',
      content: '',
      importedContent: '',
      imported: false,
      contentModified: false,
      injectionPosition: 0,
      injectionDepth: 4,
      injectionOrder: 100,
      marker: false,
      systemPrompt: false,
      forbidOverrides: false,
      attached: true,
      importedAttached: false,
      enabled: false,
      importedEnabled: false,
      toggleable: true,
      editable: true,
      deletable: true,
    }
    setPrompts(current => [
      ...current.filter(item => item.attached),
      prompt,
      ...current.filter(item => !item.attached),
    ])
    setEditingPromptId(identifier)
  }
  const exportCopy = (): void => {
    const resolvedTemperature = temperature.trim() === '' ? undefined : Number(temperature)
    const resolvedMaxTokens = maxTokens.trim() === '' ? undefined : Number(maxTokens)
    if (resolvedTemperature !== undefined && (!Number.isFinite(resolvedTemperature) || resolvedTemperature < 0 || resolvedTemperature > 2)) {
      setError('温度需填写 0 到 2 之间的数字')
      return
    }
    if (resolvedMaxTokens !== undefined && (!Number.isSafeInteger(resolvedMaxTokens) || resolvedMaxTokens < 1)) {
      setError('最大输出需填写正整数')
      return
    }
    setError(undefined)
    const exportJson = exportSillyTavernPresetJson({
      prompts: prompts.map(prompt => ({
        identifier: prompt.identifier,
        name: prompt.name,
        role: prompt.role,
        content: prompt.content,
        marker: prompt.marker,
        systemPrompt: prompt.systemPrompt,
        forbidOverrides: prompt.forbidOverrides,
        ...(prompt.injectionPosition === undefined ? {} : { injectionPosition: prompt.injectionPosition }),
        ...(prompt.injectionDepth === undefined ? {} : { injectionDepth: prompt.injectionDepth }),
        ...(prompt.injectionOrder === undefined ? {} : { injectionOrder: prompt.injectionOrder }),
      })),
      order: prompts.filter(prompt => prompt.attached).map(prompt => ({ identifier: prompt.identifier, enabled: prompt.enabled })),
      generation: {
        ...(preset.generation.topP === undefined ? {} : { topP: preset.generation.topP }),
        ...(preset.generation.topK === undefined ? {} : { topK: preset.generation.topK }),
        ...(preset.generation.topA === undefined ? {} : { topA: preset.generation.topA }),
        ...(preset.generation.minP === undefined ? {} : { minP: preset.generation.minP }),
        ...(preset.generation.frequencyPenalty === undefined ? {} : { frequencyPenalty: preset.generation.frequencyPenalty }),
        ...(preset.generation.presencePenalty === undefined ? {} : { presencePenalty: preset.generation.presencePenalty }),
        ...(preset.generation.repetitionPenalty === undefined ? {} : { repetitionPenalty: preset.generation.repetitionPenalty }),
        ...(resolvedTemperature === undefined ? {} : { temperature: resolvedTemperature }),
        ...(resolvedMaxTokens === undefined ? {} : { maxTokens: resolvedMaxTokens }),
        ...(reasoningEffort === '' ? {} : { reasoningEffort }),
      },
      formats: preset.formats,
      regexScripts: regexScripts.map(({ index: _index, ...script }) => script),
    })
    const blob = new Blob([exportJson], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${preset.name.replace(/[\\/:*?"<>|]+/gu, '_')} · Agent RP 副本.json`
    anchor.click()
    anchor.remove()
    setTimeout(() => { URL.revokeObjectURL(url) }, 0)
  }
  const attachModule = (identifier: string): void => {
    setPrompts(current => attachPresetModule(current, identifier))
  }
  const detachModule = (identifier: string): void => {
    setPrompts(current => detachPresetModule(current, identifier))
  }
  const move = (identifier: string, direction: -1 | 1): void => {
    setPrompts(current => movePresetModule(current, identifier, direction))
  }
  const save = async (close = true): Promise<boolean> => {
    const resolvedTemperature = temperature.trim() === '' ? null : Number(temperature)
    const resolvedMaxTokens = maxTokens.trim() === '' ? null : Number(maxTokens)
    if (resolvedTemperature !== null && (!Number.isFinite(resolvedTemperature) || resolvedTemperature < 0 || resolvedTemperature > 2)) {
      setError('温度需填写 0 到 2 之间的数字')
      return false
    }
    if (resolvedMaxTokens !== null && (!Number.isSafeInteger(resolvedMaxTokens) || resolvedMaxTokens < 1)) {
      setError('最大输出需填写正整数')
      return false
    }
    setSaving(true)
    setError(undefined)
    try {
      await onSave({
        operation: 'replace',
        revision: preset.revision,
        order: prompts.filter(prompt => prompt.attached).map(prompt => ({
          identifier: prompt.identifier,
          enabled: prompt.enabled,
        })),
        prompts: prompts.map(prompt => ({
          identifier: prompt.identifier,
          name: prompt.name,
          role: prompt.role,
          content: prompt.content,
          ...(prompt.injectionPosition === undefined ? {} : { injectionPosition: prompt.injectionPosition }),
          ...(prompt.injectionDepth === undefined ? {} : { injectionDepth: prompt.injectionDepth }),
          ...(prompt.injectionOrder === undefined ? {} : { injectionOrder: prompt.injectionOrder }),
        })),
        content: [],
        generation: {
          temperature: resolvedTemperature,
          maxTokens: resolvedMaxTokens,
          reasoningEffort: reasoningEffort === '' ? null : reasoningEffort,
        },
        regex: regexScripts.map(script => ({ index: script.index, disabled: script.disabled })),
      })
      if (close) onClose()
      return true
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '预设保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }
  const reset = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await onSave({ operation: 'reset', revision: preset.revision })
      onClose()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '恢复预设默认值失败')
    } finally {
      setSaving(false)
    }
  }
  const saveToLibrary = async (): Promise<void> => {
    const name = window.prompt('新预设名称', `${preset.name} · 副本`)?.trim()
    if (name === undefined || name === '') return
    if (!await save(false)) return
    setSaving(true)
    try {
      await onLibrary({ operation: 'save', name })
      onClose()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '另存预设失败')
    } finally {
      setSaving(false)
    }
  }
  const promptModuleRow = (prompt: PresetPromptProjection): JSX.Element => {
    const attachedIndex = attached.findIndex(item => item.identifier === prompt.identifier)
    return <div className="agent-rp-preset-module" style={{
      alignItems: 'center', background: prompt.enabled ? `color-mix(in srgb, ${color} 9%, transparent)` : 'var(--dsw-alias-bg-layer-1, #202024)',
      border: `1px solid ${prompt.enabled ? `color-mix(in srgb, ${color} 24%, transparent)` : 'var(--dsw-alias-border-l2, #34343a)'}`,
      borderRadius: '10px', display: 'grid', gap: '8px', gridTemplateColumns: 'minmax(0, 1fr) auto', minHeight: '52px', padding: '8px 9px 8px 12px',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ alignItems: 'center', display: 'flex', gap: '7px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', fontWeight: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prompt.name || prompt.identifier}</span>
          <span style={{ flex: '0 0 auto', fontSize: '10px', opacity: 0.48 }}>{prompt.marker ? '结构位' : roleLabel(prompt.role)}</span>
          {promptModified(prompt) && <span style={{ color, flex: '0 0 auto', fontSize: '10px', opacity: 0.82 }}>已修改</span>}
        </div>
        <div title={prompt.identifier} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', marginTop: '3px', opacity: 0.38, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prompt.identifier}</div>
      </div>
      <div className="agent-rp-preset-module-actions" style={{ alignItems: 'center', display: 'flex', gap: '5px' }}>
        {prompt.editable && <button type="button" onClick={() => { setEditingPromptId(prompt.identifier) }} style={miniButtonStyle}>编辑</button>}
        {prompt.imported && prompt.editable && prompt.content !== prompt.importedContent && <button type="button" onClick={() => { setPromptContent(prompt.identifier, prompt.importedContent) }} style={miniButtonStyle}>恢复正文</button>}
        {prompt.attached ? <>
          <button type="button" aria-label={`上移${prompt.name}`} title="上移" disabled={attachedIndex <= 0 || normalizedQuery !== ''} onClick={() => { move(prompt.identifier, -1) }} style={miniButtonStyle}>↑</button>
          <button type="button" aria-label={`下移${prompt.name}`} title="下移" disabled={attachedIndex >= attached.length - 1 || normalizedQuery !== ''} onClick={() => { move(prompt.identifier, 1) }} style={miniButtonStyle}>↓</button>
          {prompt.toggleable ? <PresetSwitch checked={prompt.enabled} label={`${prompt.enabled ? '停用' : '启用'}${prompt.name || prompt.identifier}`} onChange={() => {
            setPrompt(prompt.identifier, value => ({ ...value, enabled: !value.enabled }))
          }} /> : <span style={{ fontSize: '10px', opacity: 0.44, padding: '0 3px' }}>固定</span>}
          <button type="button" title="保留模块定义，但从当前顺序移回可选模块库" onClick={() => { detachModule(prompt.identifier) }} style={miniButtonStyle}>移回模块库</button>
        </> : <button type="button" title="加入当前顺序；加入后默认关闭" onClick={() => { attachModule(prompt.identifier) }} style={miniButtonStyle}>加入当前配置</button>}
      </div>
    </div>
  }
  return <div className="agent-rp-preset-overlay" data-agent-rp-surface="preset-manager"
    role="dialog" aria-modal="true" aria-label={`${preset.name}预设管理`} style={{
    alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1100,
  }} onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <style>{presetManagerResponsiveStyle}</style>
    <section className="agent-rp-preset-dialog" style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column',
      maxHeight: 'min(900px, 92vh)', maxWidth: '920px', overflow: 'hidden', width: 'min(96vw, 920px)',
    }}>
      <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #343438)', display: 'flex', gap: '12px', padding: '18px 20px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '17px', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.name}</h2>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.56 }}>{enabledCount}/{attached.length} 项提示启用 · {catalog.length} 个可选模块 · {regexScripts.filter(script => !script.disabled).length}/{regexScripts.length} 条正则启用</div>
        </div>
        <button type="button" aria-label="关闭预设管理" data-agent-rp-action="close-preset-manager"
          disabled={saving} onClick={onClose} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '22px', marginLeft: 'auto', padding: '4px',
        }}>×</button>
      </header>
      <div className="agent-rp-preset-body" style={{ display: 'grid', flex: '1 1 auto', gap: '14px', gridTemplateColumns: 'minmax(0, 1fr) 230px', minHeight: 0, padding: '16px 20px' }}>
        <div className="agent-rp-preset-list" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '9px' }}>
            {([['prompts', '提示模块'], ['regex', '正则脚本']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setSection(value); setQuery('') }} style={{
              ...miniButtonStyle, background: section === value ? `color-mix(in srgb, ${color} 16%, transparent)` : 'transparent',
              borderColor: section === value ? `color-mix(in srgb, ${color} 42%, transparent)` : miniButtonStyle.border,
              height: '30px', padding: '3px 10px',
            }}>{label}{value === 'regex' ? ` · ${regexScripts.length}` : ''}</button>)}
          </div>
          {section === 'prompts' && <div className="agent-rp-preset-module-tabs" style={{ display: 'grid', gap: '6px', gridTemplateColumns: '1fr 1fr', marginBottom: '9px' }}>
            {([['current', `当前配置 · ${attached.length}`], ['catalog', `可选模块库 · ${catalog.length}`]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setPromptView(value); setQuery(''); setPromptFilter('all') }} style={{
              ...miniButtonStyle,
              background: promptView === value ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--dsw-alias-bg-layer-1, #202024)',
              borderColor: promptView === value ? `color-mix(in srgb, ${color} 38%, transparent)` : miniButtonStyle.border,
              fontSize: '12px', minHeight: '34px', padding: '5px 10px',
            }}>{label}</button>)}
          </div>}
          <input aria-label={section === 'prompts' ? `搜索${promptView === 'current' ? '当前配置' : '可选模块库'}` : '搜索正则脚本'} placeholder={section === 'prompts' ? `搜索${promptView === 'current' ? '当前模块' : '可选模块'}名称或标识…` : '搜索正则脚本名称…'} value={query} onChange={event => { setQuery(event.target.value) }} style={{
            background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
            borderRadius: '9px', color: 'inherit', font: 'inherit', fontSize: '13px', outline: 'none', padding: '9px 11px',
          }} />
          {section === 'prompts' && promptView === 'current' && <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
            {([['all', '全部'], ['enabled', '已启用'], ['modified', '已修改']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setPromptFilter(value) }} style={{
              ...miniButtonStyle,
              background: promptFilter === value ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
              borderColor: promptFilter === value ? `color-mix(in srgb, ${color} 38%, transparent)` : miniButtonStyle.border,
            }}>{label}</button>)}
            <button type="button" onClick={addPrompt} style={{ ...miniButtonStyle, marginLeft: 'auto' }}>＋ 新建模块</button>
          </div>}
          <div style={{ display: 'flex', fontSize: '11px', justifyContent: 'space-between', margin: '10px 3px 7px', opacity: 0.48 }}>
            <span>{section === 'prompts' ? (promptView === 'current' ? '当前提示顺序' : '作者提供的可选模块') : '预设正则'}</span><span>{section === 'prompts' ? (promptView === 'current' ? '顺序与开关' : `${visibleCatalog.length}/${catalog.length}`) : '开关'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
            {section === 'prompts' && promptView === 'current' && visiblePromptSections.map((group) => {
              const collapsed = normalizedQuery === '' && collapsedPromptSections.has(group.key)
              return <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button type="button" aria-expanded={!collapsed} onClick={() => { togglePromptSection(group.key) }} style={{
                  alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #202024)',
                  border: '1px solid var(--dsw-alias-border-l2, #34343a)', borderRadius: '10px', color: 'inherit',
                  cursor: 'pointer', display: 'grid', font: 'inherit', gap: '8px', gridTemplateColumns: '18px minmax(0, 1fr) auto',
                  minHeight: '42px', padding: '8px 11px', textAlign: 'left', width: '100%',
                }}>
                  <span aria-hidden="true" style={{ fontSize: '12px', opacity: 0.58, transform: `rotate(${collapsed ? 0 : 90}deg)`, transition: 'transform .14s ease' }}>›</span>
                  <span style={{ fontSize: '13px', fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.title}</span>
                  <span style={{ fontSize: '10px', opacity: 0.46 }}>{group.enabledCount}/{group.prompts.length} 启用</span>
                </button>
                {!collapsed && group.prompts.map(prompt => <div key={prompt.identifier} style={{ marginLeft: '8px' }}>{promptModuleRow(prompt)}</div>)}
              </section>
            })}
            {section === 'prompts' && promptView === 'catalog' && <div style={{
              background: `color-mix(in srgb, ${color} 6%, var(--dsw-alias-bg-layer-1, #202024))`,
              border: `1px solid color-mix(in srgb, ${color} 18%, var(--dsw-alias-border-l2, #34343a))`, borderRadius: '10px',
              fontSize: '11px', lineHeight: 1.55, marginBottom: '2px', opacity: 0.78, padding: '9px 11px',
            }}>这里保留预设作者提供、尚未装入当前顺序的模块。加入后默认关闭，可在“当前配置”中启用并调整位置。</div>}
            {section === 'prompts' && promptView === 'catalog' && visibleCatalog.map(prompt => <div key={prompt.identifier}>{promptModuleRow(prompt)}</div>)}
            {section === 'regex' && promptRegex !== undefined && <div role="status" style={{
              background: `color-mix(in srgb, ${color} 7%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
              borderRadius: '10px', fontSize: '11px', lineHeight: 1.55, padding: '9px 11px',
            }}>
              上次生成检查了 {promptRegex.messageCount} 条对话，更新模型视图 {promptRegex.replacementCount} 条。这里只记录脚本名和结果
            </div>}
            {section === 'regex' && visibleRegex.map(script => {
              const trace = promptRegexByIndex.get(script.index)
              const traceLabel = script.markdownOnly && !script.promptOnly ? '仅用于显示'
                : trace === undefined ? undefined : trace.outcome === 'applied'
                ? `上次命中 ${trace.affectedMessages} 条`
                : trace.outcome === 'no-match' ? '上次未命中'
                : trace.outcome === 'disabled' ? '上次未启用'
                : trace.outcome === 'display-only' ? '仅用于显示'
                : trace.outcome === 'placement' ? '消息位置不匹配'
                : trace.outcome === 'depth' ? '消息深度不匹配'
                : '表达式无效'
              return <div key={script.index} style={{
              alignItems: 'center', background: !script.disabled ? `color-mix(in srgb, ${color} 9%, transparent)` : 'var(--dsw-alias-bg-layer-1, #202024)',
              border: `1px solid ${!script.disabled ? `color-mix(in srgb, ${color} 24%, transparent)` : 'var(--dsw-alias-border-l2, #34343a)'}`,
              borderRadius: '10px', display: 'grid', gap: '8px', gridTemplateColumns: 'minmax(0, 1fr) auto', minHeight: '52px', padding: '8px 9px 8px 12px',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{script.scriptName}</div>
                <div style={{ fontSize: '10px', marginTop: '3px', opacity: 0.42 }}>{[
                  script.markdownOnly ? '显示' : undefined,
                  script.promptOnly ? '生成时执行' : undefined,
                  script.placement.includes(1) ? '用户消息' : undefined,
                  script.placement.includes(2) ? '角色回复' : undefined,
                ].filter(Boolean).join(' · ') || '普通处理'}</div>
                {traceLabel !== undefined && <div style={{ color: trace?.outcome === 'invalid' ? '#d9a85f' : 'inherit', fontSize: '10px', marginTop: '3px', opacity: 0.58 }}>{traceLabel}</div>}
              </div>
              <PresetSwitch checked={!script.disabled} disabled={saving} label={`${script.disabled ? '启用' : '停用'}${script.scriptName}`} onChange={() => {
                setRegexScripts(current => current.map(item => item.index === script.index ? { ...item, disabled: !item.disabled } : item))
              }} />
            </div>})}
            {((section === 'prompts' && promptView === 'current' && visiblePromptSections.length === 0)
              || (section === 'prompts' && promptView === 'catalog' && visibleCatalog.length === 0)
              || (section === 'regex' && visibleRegex.length === 0)) && <div style={{ fontSize: '13px', opacity: 0.52, padding: '32px 10px', textAlign: 'center' }}>没有匹配的{section === 'prompts' ? '模块' : '正则脚本'}</div>}
          </div>
        </div>
        <aside className="agent-rp-preset-generation" style={{ borderLeft: '1px solid var(--dsw-alias-border-l2, #343438)', paddingLeft: '16px' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 600, margin: '2px 0 13px', opacity: 0.62 }}>生成参数</h3>
          <PresetNumberField label="温度" hint="0—2" value={temperature} onChange={setTemperature} />
          <PresetNumberField label="最大输出" hint="由模型上限约束" value={maxTokens} onChange={setMaxTokens} />
          <label style={fieldLabelStyle}>推理等级
            <select value={reasoningEffort} onChange={event => { setReasoningEffort(event.target.value) }} style={fieldInputStyle}>
              <option value="">跟随会话</option>
              <option value="auto">自动（跟随模型）</option>
              {reasoning?.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
              {reasoningEffort !== '' && reasoningEffort !== 'auto' && selectedReasoning === undefined
                && <option value={reasoningEffort}>导入值 · {selectedReasoningLabel}</option>}
            </select>
          </label>
          {modelCapabilities.status === 'loading' && <p role="status" style={{ fontSize: '11px', lineHeight: 1.55, margin: '-3px 1px 12px', opacity: 0.52 }}>
            正在读取当前模型可用等级…
          </p>}
          {modelCapabilities.status === 'error' && <p role="note" style={{ color: '#d9a85f', fontSize: '11px', lineHeight: 1.55, margin: '-3px 1px 12px' }}>
            暂时无法读取当前模型能力，已保留原预设值
          </p>}
          {unsupportedReasoning && <div role="note" style={{
            background: 'rgba(217,168,95,.1)', border: '1px solid rgba(217,168,95,.28)', borderRadius: '9px',
            color: '#e3b66f', fontSize: '11px', lineHeight: 1.55, margin: '-3px 1px 12px', padding: '8px 9px',
          }}>
            {selectedReasoningLabel} 仍会保留在预设中；{modelLabel} 不支持这个等级，下次回复将沿用会话等级 {currentReasoningLabel}
          </div>}
          {!unsupportedReasoning && modelCapabilities.status === 'ready' && reasoning !== undefined && <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '-3px 1px 12px', opacity: 0.52 }}>
            {modelLabel} 可用：{reasoning.efforts.length === 0 ? '没有可选推理等级' : reasoning.efforts.map(effort => effort.name).join('、')}
          </p>}
          {preservedSampling.length > 0 && <p role="note" style={{ fontSize: '10px', lineHeight: 1.5, margin: '10px 1px 0', opacity: 0.5 }}>
            暂未映射：{preservedSampling.join('、')}；导出副本时仍会保留
          </p>}
          <p style={{ fontSize: '11px', lineHeight: 1.55, margin: '16px 1px 0', opacity: 0.46 }}>
            “保存到此会话”只影响当前角色会话；“保存为可复用预设”会在预设库中新建副本，供之后的会话选择。未填写的参数跟随会话与模型设置
          </p>
          {preset.extensionStatus.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', margin: '12px 1px 0' }}>
            {preset.extensionStatus.map(item => <div key={item.name} style={{ fontSize: '10px', lineHeight: 1.45, opacity: item.state === 'unsupported' ? 0.72 : 0.44 }}>
              <span style={{ color: item.state === 'unsupported' ? '#d9a85f' : item.state === 'active' ? '#7ec89b' : 'inherit' }}>●</span>{' '}{item.name} · {item.detail}
            </div>)}
          </div>}
        </aside>
      </div>
      <footer className="agent-rp-preset-footer" style={{ alignItems: 'center', borderTop: '1px solid var(--dsw-alias-border-l2, #343438)', display: 'flex', gap: '9px', justifyContent: 'flex-end', minHeight: '64px', padding: '12px 20px' }}>
        {error !== undefined && <span role="alert" style={{ color: '#e47a7a', fontSize: '12px', marginRight: 'auto' }}>{error}</span>}
        <button type="button" disabled={saving} onClick={() => { void reset() }} style={{ ...secondaryButtonStyle, marginRight: error === undefined ? 'auto' : undefined }}>恢复预设默认值</button>
        <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file === undefined) return
          setSaving(true)
          setError(undefined)
          void onImport(file).then(onClose, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '预设导入失败')
            setSaving(false)
          })
        }} />
        <button type="button" disabled={saving} onClick={() => { importInputRef.current?.click() }} style={secondaryButtonStyle}>替换预设</button>
        <button type="button" disabled={saving} onClick={() => { setLibraryOpen(true); void onLibrary({ operation: 'list' }) }} style={secondaryButtonStyle}>预设库</button>
        <button type="button" disabled={saving} onClick={() => { setInspectionOpen(true) }} style={secondaryButtonStyle}>运行检查</button>
        <button type="button" disabled={saving} onClick={exportCopy} title={preset.omittedExtensions.length === 0 ? '导出当前配置' : `不包含未执行扩展：${preset.omittedExtensions.join('、')}`} style={secondaryButtonStyle}>导出副本</button>
        <button type="button" disabled={saving} onClick={() => { void saveToLibrary() }} style={secondaryButtonStyle}>保存到预设库</button>
        <button type="button" disabled={saving} onClick={onClose} style={secondaryButtonStyle}>取消</button>
        <button type="button" disabled={saving} onClick={() => { void save() }} style={primaryButtonStyle}>{saving ? '保存中…' : '保存到此会话'}</button>
      </footer>
    </section>
    {editingPrompt !== undefined && <PresetPromptEditorDialog
      prompt={editingPrompt}
      onClose={() => { setEditingPromptId(undefined) }}
      onApply={(value) => {
        setPrompt(editingPrompt.identifier, prompt => ({
          ...prompt,
          name: value.name,
          role: value.role,
          content: value.content,
          injectionPosition: value.injectionPosition,
          injectionDepth: value.injectionDepth,
          injectionOrder: value.injectionOrder,
          contentModified: value.content !== prompt.importedContent,
        }))
        setEditingPromptId(undefined)
      }}
      {...editingPrompt.deletable ? { onDelete: () => {
        setPrompts(current => current.filter(prompt => prompt.identifier !== editingPrompt.identifier))
        setEditingPromptId(undefined)
      } } : {}}
    />}
    {libraryOpen && <PresetLibraryDialog
      entries={entries}
      {...preset.libraryId === undefined ? {} : { activeId: preset.libraryId }}
      onClose={() => { setLibraryOpen(false) }}
      onAction={async request => {
        await onLibrary(request)
        if (request.operation === 'select') onClose()
      }}
    />}
    {inspectionOpen && <PresetRuntimeInspector
      preset={preset}
      lastRequest={lastRequest}
      onClose={() => { setInspectionOpen(false) }}
    />}
  </div>
}

function requestParameterSummary(request: NonNullable<AgentRpProjection['lastRequest']>): readonly string[] {
  const config = request.config
  return [
    `${config.provider} / ${config.model}`,
    config.reasoningEffort === undefined ? undefined : `推理 ${config.reasoningEffort}`,
    config.temperature === undefined ? undefined : `温度 ${config.temperature}`,
    config.maxTokens === undefined ? undefined : `最大输出 ${config.maxTokens}`,
    config.stop === undefined || config.stop.length === 0 ? undefined : `${config.stop.length} 个停止词`,
    request.toolNames.length === 0 ? '未提供工具' : `${request.toolNames.length} 个工具`,
  ].filter((value): value is string => value !== undefined)
}

function requestedReasoningDifference(
  preset: PresetProjection,
  request: NonNullable<AgentRpProjection['lastRequest']>,
  requestMatches: boolean,
): string | undefined {
  const requested = preset.generation.reasoningEffort
  const actual = request.config.reasoningEffort
  if (!requestMatches || requested === undefined || requested === 'auto' || actual === undefined || requested === actual) return undefined
  return `推理等级不同：预设保存的是 ${requested}，这次实际请求使用 ${actual}。当前模型没有采用预设值`
}

function PresetRuntimeInspector({ preset, lastRequest, onClose }: {
  readonly preset: PresetProjection
  readonly lastRequest?: AgentRpProjection['lastRequest']
  readonly onClose: () => void
}) {
  const enabled = preset.prompts.filter(prompt => prompt.attached && prompt.enabled)
  const historyIndex = enabled.findIndex(prompt => prompt.identifier === 'chatHistory' && prompt.marker)
  const requestMatches = lastRequest !== undefined
    && lastRequest.presetName === preset.name && lastRequest.presetRevision === preset.revision
  const reasoningDifference = lastRequest === undefined
    ? undefined
    : requestedReasoningDifference(preset, lastRequest, requestMatches)
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="预设运行检查" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.7)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1250,
  }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: '16px', boxShadow: '0 26px 90px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column',
      maxHeight: '92vh', maxWidth: '1100px', overflow: 'hidden', width: 'min(96vw, 1100px)',
    }}>
      <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #343438)', display: 'flex', gap: '12px', padding: '18px 20px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '17px', margin: 0 }}>运行检查</h2>
          <div style={{ fontSize: '12px', lineHeight: 1.5, marginTop: '4px', opacity: 0.56 }}>已保存的预设顺序与 Host 最近记录的实际系统提示</div>
        </div>
        <button type="button" aria-label="关闭运行检查" onClick={onClose} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '22px', marginLeft: 'auto', padding: '4px',
        }}>×</button>
      </header>
      <div style={{ borderBottom: '1px solid var(--dsw-alias-border-l2, #343438)', padding: '13px 20px' }}>
        {lastRequest === undefined
          ? <div role="status" style={{ background: 'var(--dsw-alias-bg-layer-1, #202024)', borderRadius: '9px', fontSize: '12px', lineHeight: 1.6, padding: '10px 12px' }}>
              这段会话还没有真实模型请求。发送一条消息后，这里才会出现实际系统提示和最终参数
            </div>
          : <>
              <div role="status" style={{ color: requestMatches ? 'inherit' : '#d9a85f', fontSize: '12px', lineHeight: 1.5 }}>
                {requestMatches
                  ? `当前预设版本与最近记录的请求一致 · ${new Date(lastRequest.time).toLocaleString()}`
                  : `当前预设在最近记录的请求之后发生过变化 · 右侧仍显示当时实际使用的内容`}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '9px' }}>
                {requestParameterSummary(lastRequest).map(value => <span key={value} style={chipStyle}>{value}</span>)}
              </div>
              {reasoningDifference !== undefined && <div role="note" style={{
                background: 'rgba(217,168,95,.1)', border: '1px solid rgba(217,168,95,.28)', borderRadius: '9px',
                color: '#e3b66f', fontSize: '11px', lineHeight: 1.55, marginTop: '10px', padding: '8px 10px',
              }}>{reasoningDifference}</div>}
            </>}
      </div>
      <div className="agent-rp-runtime-inspector-body" style={{ display: 'grid', flex: '1 1 auto', gridTemplateColumns: 'minmax(280px, .78fr) minmax(360px, 1.22fr)', minHeight: 0, overflow: 'hidden' }}>
        <section className="agent-rp-runtime-inspector-order" style={{ borderRight: '1px solid var(--dsw-alias-border-l2, #343438)', minHeight: 0, overflowY: 'auto', padding: '17px 18px' }}>
          <div style={{ alignItems: 'baseline', display: 'flex', gap: '8px', marginBottom: '11px' }}>
            <h3 style={{ fontSize: '12px', margin: 0 }}>当前组装顺序</h3>
            <span style={{ fontSize: '10px', opacity: 0.44 }}>{enabled.length} 项启用</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {enabled.map((prompt, index) => {
              const retained = prompt.injectionPosition === 1
              const history = prompt.identifier === 'chatHistory' && prompt.marker
              const placement = retained ? '保留，当前不执行' : history ? '聊天记录位置'
                : historyIndex >= 0 && index > historyIndex ? '历史之后' : '系统提示'
              return <div key={prompt.identifier} style={{
                alignItems: 'center', background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #34343a)',
                borderRadius: '9px', display: 'grid', gap: '9px', gridTemplateColumns: '25px minmax(0, 1fr) auto', padding: '8px 9px',
              }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', opacity: 0.38, textAlign: 'right' }}>{index + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prompt.name || prompt.identifier}</span>
                  <span title={prompt.identifier} style={{ display: 'block', fontFamily: 'ui-monospace, monospace', fontSize: '9px', marginTop: '2px', opacity: 0.34, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prompt.identifier}</span>
                </span>
                <span style={{ color: retained ? '#d9a85f' : 'inherit', fontSize: '9px', opacity: retained ? 0.9 : 0.48, whiteSpace: 'nowrap' }}>{placement}</span>
              </div>
            })}
          </div>
        </section>
        <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: '17px 18px' }}>
          <div style={{ alignItems: 'baseline', display: 'flex', gap: '8px', marginBottom: '11px' }}>
            <h3 style={{ fontSize: '12px', margin: 0 }}>最近记录的实际系统提示</h3>
            {lastRequest !== undefined && <span style={{ fontSize: '10px', opacity: 0.44 }}>{lastRequest.system.length.toLocaleString()} 字符</span>}
          </div>
          <pre style={{
            background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #34343a)', borderRadius: '10px',
            flex: '1 1 auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '11px', lineHeight: 1.62,
            margin: 0, minHeight: '300px', overflow: 'auto', padding: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{lastRequest === undefined ? '尚无真实请求' : lastRequest.system || '这一轮没有系统提示'}</pre>
          <p style={{ fontSize: '10px', lineHeight: 1.5, margin: '9px 1px 0', opacity: 0.42 }}>
            这里只展示 Host 写入会话记录的 system prompt；聊天历史与用户消息不会复制到检查页
          </p>
        </section>
      </div>
    </section>
  </div>
}

function PresetPromptEditorDialog({ prompt, onClose, onApply, onDelete }: {
  readonly prompt: PresetPromptProjection
  readonly onClose: () => void
  readonly onApply: (value: {
    readonly name: string
    readonly role: PresetPromptProjection['role']
    readonly content: string
    readonly injectionPosition: number
    readonly injectionDepth: number
    readonly injectionOrder: number
  }) => void
  readonly onDelete?: () => void
}) {
  const [name, setName] = useState(prompt.name)
  const [role, setRole] = useState(prompt.role)
  const [content, setContent] = useState(prompt.content)
  const [injectionPosition, setInjectionPosition] = useState(prompt.injectionPosition ?? 0)
  const [injectionDepth, setInjectionDepth] = useState(String(prompt.injectionDepth ?? 4))
  const [injectionOrder, setInjectionOrder] = useState(String(prompt.injectionOrder ?? 100))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const resolvedDepth = Number(injectionDepth)
  const resolvedOrder = Number(injectionOrder)
  const validDepth = Object.is(resolvedDepth, prompt.injectionDepth)
    || (Number.isSafeInteger(resolvedDepth) && resolvedDepth >= 0 && resolvedDepth <= 9999)
  const validOrder = Object.is(resolvedOrder, prompt.injectionOrder)
    || (Number.isSafeInteger(resolvedOrder) && resolvedOrder >= 0 && resolvedOrder <= 9999)
  const validInjection = injectionPosition === 0 || (
    validDepth && validOrder
  )
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label={`编辑${prompt.name || prompt.identifier}`} style={{
    alignItems: 'center', background: 'rgba(0,0,0,.7)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1150,
  }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: '14px', boxShadow: '0 24px 80px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column',
      maxHeight: 'min(820px, 90vh)', maxWidth: '760px', overflow: 'hidden', width: 'min(94vw, 760px)',
    }}>
      <header style={{ borderBottom: '1px solid var(--dsw-alias-border-l2, #343438)', display: 'grid', gap: '8px', gridTemplateColumns: 'minmax(0, 1fr) 130px', padding: '14px 18px' }}>
        <label style={{ ...fieldLabelStyle, margin: 0 }}>模块名称
          <input aria-label="模块名称" value={name} onChange={event => { setName(event.target.value) }} style={fieldInputStyle} />
        </label>
        <label style={{ ...fieldLabelStyle, margin: 0 }}>消息角色
          <select aria-label="消息角色" value={role} onChange={event => { setRole(event.target.value as PresetPromptProjection['role']) }} style={fieldInputStyle}>
            <option value="system">系统</option><option value="user">用户</option><option value="assistant">助手</option>
          </select>
        </label>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', gridColumn: '1 / -1', opacity: 0.4 }}>{prompt.identifier}</div>
        <label style={{ ...fieldLabelStyle, margin: 0 }}>插入位置
          <select aria-label="插入位置" value={injectionPosition} onChange={event => { setInjectionPosition(Number(event.target.value)) }} style={fieldInputStyle}>
            <option value={0}>相对（按模块顺序）</option><option value={1}>聊天内（按历史深度）</option>
          </select>
        </label>
        {injectionPosition === 1 && <>
          <label style={{ ...fieldLabelStyle, margin: 0 }}>历史深度
            <input aria-label="历史深度" type="number" min={0} max={9999} value={injectionDepth} onChange={event => { setInjectionDepth(event.target.value) }} style={fieldInputStyle} />
          </label>
          <label style={{ ...fieldLabelStyle, margin: 0 }}>同深度优先级
            <input aria-label="同深度优先级" type="number" min={0} max={9999} value={injectionOrder} onChange={event => { setInjectionOrder(event.target.value) }} style={fieldInputStyle} />
          </label>
          <div style={{ alignSelf: 'end', color: '#8ebf9c', fontSize: '10px', lineHeight: 1.45 }}>生成时按历史深度插入；同深度优先级较高的内容在前</div>
        </>}
      </header>
      <textarea aria-label="提示内容" autoFocus spellCheck={false} value={content} onChange={event => { setContent(event.target.value) }} style={{
        background: 'var(--dsw-alias-bg-layer-1, #202024)', border: 0, color: 'inherit', flex: '1 1 auto',
        font: '13px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace', minHeight: '360px', outline: 'none',
        padding: '16px 18px', resize: 'none', whiteSpace: 'pre-wrap',
      }} />
      <footer style={{ alignItems: 'center', borderTop: '1px solid var(--dsw-alias-border-l2, #343438)', display: 'flex', gap: '9px', justifyContent: 'flex-end', padding: '12px 18px' }}>
        <span style={{ fontSize: '10px', marginRight: 'auto', opacity: 0.42 }}>{content.length.toLocaleString()} 字符</span>
        {onDelete !== undefined && (confirmingDelete
          ? <><span style={{ color: '#e47a7a', fontSize: '11px' }}>永久移除此模块？</span><button type="button" onClick={onDelete} style={{ ...secondaryButtonStyle, borderColor: '#a94f4f', color: '#ef8a8a' }}>确认删除</button></>
          : <button type="button" onClick={() => { setConfirmingDelete(true) }} style={{ ...secondaryButtonStyle, marginRight: 'auto' }}>删除模块</button>)}
        <button type="button" onClick={onClose} style={secondaryButtonStyle}>取消</button>
        <button type="button" disabled={name.trim() === '' || !validInjection} onClick={() => { onApply({
          name: name.trim(), role, content, injectionPosition, injectionDepth: resolvedDepth, injectionOrder: resolvedOrder,
        }) }} style={primaryButtonStyle}>应用修改</button>
      </footer>
    </section>
  </div>
}

function PresetImportDialog({ entries, onClose, onImport, onLibrary }: {
  readonly entries: AgentRpProjection['presetLibrary']
  readonly onClose: () => void
  readonly onImport: (file: File) => Promise<void>
  readonly onLibrary: (request: PresetLibraryRequest) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { void onLibrary({ operation: 'list' }).catch(() => undefined) }, [])
  return <div data-agent-rp-dialog data-agent-rp-surface="preset-manager"
    role="dialog" aria-modal="true" aria-label="导入预设" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1100,
  }} onMouseDown={event => { if (event.target === event.currentTarget && !importing) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,.45)', maxWidth: '480px', padding: '24px', width: 'min(94vw, 480px)',
    }}>
      <h2 style={{ fontSize: '17px', margin: 0 }}>为此角色选择预设</h2>
      <p style={{ fontSize: '13px', lineHeight: 1.65, margin: '9px 0 22px', opacity: 0.58 }}>
        从预设库选取，或导入 SillyTavern Chat Completion 预设 JSON。选中后会为当前会话创建独立副本
      </p>
      {error !== undefined && <p role="alert" style={{ color: '#e47a7a', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>}
      {entries.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '20px', maxHeight: '280px', overflowY: 'auto' }}>
        {entries.map(entry => <PresetLibraryRow key={entry.id} entry={entry} busy={importing} onSelect={() => {
          setImporting(true)
          setError(undefined)
          void onLibrary({ operation: 'select', id: entry.id }).then(onClose, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '预设选择失败')
            setImporting(false)
          })
        }} />)}
      </div>}
      <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file === undefined) return
        setImporting(true)
        setError(undefined)
        void onImport(file).then(onClose, (reason: unknown) => {
          setError(reason instanceof Error ? reason.message : '预设导入失败')
          setImporting(false)
        })
      }} />
      <div style={{ display: 'flex', gap: '9px', justifyContent: 'flex-end' }}>
        <button type="button" data-agent-rp-action="close-preset-manager"
          disabled={importing} onClick={onClose} style={secondaryButtonStyle}>取消</button>
        <button type="button" disabled={importing} onClick={() => { inputRef.current?.click() }} style={primaryButtonStyle}>
          {importing ? '导入中…' : '选择预设文件'}
        </button>
      </div>
    </section>
  </div>
}

function PresetLibraryRow({ entry, active = false, busy = false, onSelect, onRename, onDelete }: {
  readonly entry: PresetLibraryEntry
  readonly active?: boolean
  readonly busy?: boolean
  readonly onSelect: () => void
  readonly onRename?: () => void
  readonly onDelete?: () => void
}) {
  return <div style={{
    alignItems: 'center', background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--dsw-alias-bg-layer-1, #202024)',
    border: `1px solid ${active ? `color-mix(in srgb, ${color} 34%, transparent)` : 'var(--dsw-alias-border-l2, #39393f)'}`,
    borderRadius: '10px', display: 'flex', gap: '10px', padding: '10px 11px',
  }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
      <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.48 }}>
        {entry.enabledCount}/{entry.promptCount} 项启用 · {entry.regexScriptCount} 条正则{active ? ' · 当前来源' : ''}
      </div>
      {entry.tavernHelper !== undefined && <div style={{ fontSize: '10px', marginTop: '3px', opacity: 0.48 }}>
        Tavern Helper · {presetTavernHelperSummaryText(entry.tavernHelper)}
      </div>}
    </div>
    <button type="button" disabled={busy || active} onClick={onSelect} style={{ ...miniButtonStyle, marginLeft: 'auto' }}>{active ? '已选' : '使用'}</button>
    {onRename !== undefined && <button type="button" disabled={busy} onClick={onRename} style={miniButtonStyle}>改名</button>}
    {onDelete !== undefined && <button type="button" disabled={busy} onClick={onDelete} style={miniButtonStyle}>删除</button>}
  </div>
}

function PresetLibraryDialog({ entries, activeId, onClose, onAction }: {
  readonly entries: AgentRpProjection['presetLibrary']
  readonly activeId?: string
  readonly onClose: () => void
  readonly onAction: (request: PresetLibraryRequest) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="预设库" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.66)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '18px', position: 'fixed', zIndex: 1200,
  }} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #151518)', border: '1px solid var(--dsw-alias-border-l2, #38383d)',
      borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,.45)', maxWidth: '560px', padding: '22px', width: 'min(94vw, 560px)',
    }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
        <div><h2 style={{ fontSize: '17px', margin: 0 }}>预设库</h2><p style={{ fontSize: '12px', margin: '6px 0 0', opacity: 0.52 }}>使用预设只会替换当前会话的独立副本</p></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="关闭预设库" style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '22px', marginLeft: 'auto' }}>×</button>
      </div>
      {error !== undefined && <p role="alert" style={{ color: '#e47a7a', fontSize: '12px' }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '18px', maxHeight: '55vh', overflowY: 'auto' }}>
        {entries.map(entry => <PresetLibraryRow key={entry.id} entry={entry} active={entry.id === activeId} busy={busy} onSelect={() => {
          setBusy(true)
          setError(undefined)
          void onAction({ operation: 'select', id: entry.id }).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '预设选择失败')
            setBusy(false)
          })
        }} onRename={() => {
          const name = window.prompt('预设名称', entry.name)?.trim()
          if (name === undefined || name === '' || name === entry.name) return
          setBusy(true)
          setError(undefined)
          void onAction({ operation: 'rename', id: entry.id, name }).then(() => { setBusy(false) }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '改名失败')
            setBusy(false)
          })
        }} onDelete={() => {
          if (!window.confirm(`从预设库删除“${entry.name}”？当前会话不会受影响`)) return
          setBusy(true)
          setError(undefined)
          void onAction({ operation: 'delete', id: entry.id }).then(() => { setBusy(false) }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : '删除失败')
            setBusy(false)
          })
        }} />)}
        {entries.length === 0 && <div style={{ fontSize: '13px', opacity: 0.52, padding: '30px 8px', textAlign: 'center' }}>预设库还是空的，导入一份 JSON 后会自动收藏</div>}
      </div>
    </section>
  </div>
}

function PresetNumberField({ label, hint, value, onChange }: {
  readonly label: string
  readonly hint: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return <label style={fieldLabelStyle}>{label}<span style={{ float: 'right', fontSize: '10px', fontWeight: 400, opacity: 0.45 }}>{hint}</span>
    <input inputMode="decimal" value={value} onChange={event => { onChange(event.target.value) }} style={fieldInputStyle} />
  </label>
}

function PresetSwitch({ checked, disabled = false, label, onChange }: {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly onChange: () => void
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    data-agent-rp-preset-toggle={checked ? 'on' : 'off'} onClick={onChange} style={{
      background: checked ? color : 'color-mix(in srgb, currentColor 10%, transparent)',
      border: `1px solid ${checked ? color : 'color-mix(in srgb, currentColor 36%, transparent)'}`,
      borderRadius: '999px', boxSizing: 'border-box', color: 'inherit', cursor: disabled ? 'default' : 'pointer',
      flex: '0 0 auto', height: '24px', opacity: disabled ? .5 : 1, padding: '2px', position: 'relative', width: '40px',
    }}><span aria-hidden="true" style={{
      background: checked ? '#fff' : 'currentColor', borderRadius: '50%', display: 'block', height: '18px',
      transform: `translateX(${checked ? 16 : 0}px)`, transition: 'transform .14s ease', width: '18px',
    }} /></button>
}

const fieldLabelStyle = { display: 'block', fontSize: '11px', fontWeight: 560, marginBottom: '13px', opacity: 0.72 } as const
const fieldInputStyle = {
  background: 'var(--dsw-alias-bg-layer-1, #202024)', border: '1px solid var(--dsw-alias-border-l2, #3b3b41)',
  borderRadius: '8px', boxSizing: 'border-box', color: 'inherit', display: 'block', font: 'inherit', fontSize: '12px', marginTop: '6px', minWidth: 0, padding: '8px 9px', width: '100%',
} as const
const miniButtonStyle = {
  background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #424248)', borderRadius: '6px', color: 'inherit',
  cursor: 'pointer', font: 'inherit', fontSize: '11px', height: '25px', minWidth: '25px', padding: '2px 6px',
} as const
const secondaryButtonStyle = { ...miniButtonStyle, height: '34px', padding: '5px 14px' } as const
const primaryButtonStyle = {
  ...secondaryButtonStyle, background: color, borderColor: color, color: '#fff', fontWeight: 600,
} as const

const presetManagerResponsiveStyle = `
@media (max-width: 720px) {
  .agent-rp-preset-overlay { padding: 8px !important; }
  .agent-rp-preset-dialog {
    border-radius: 12px !important;
    max-height: calc(100dvh - 16px) !important;
    width: calc(100vw - 16px) !important;
  }
  .agent-rp-preset-body {
    display: flex !important;
    flex-direction: column !important;
    gap: 12px !important;
    padding: 12px 14px !important;
  }
  .agent-rp-preset-generation {
    border-bottom: 1px solid var(--dsw-alias-border-l2, #343438);
    border-left: 0 !important;
    display: grid;
    gap: 0 10px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    order: -1;
    padding: 0 0 11px !important;
  }
  .agent-rp-preset-generation > h3,
  .agent-rp-preset-generation > p { grid-column: 1 / -1; }
  .agent-rp-preset-generation > p { margin-top: 2px !important; }
  .agent-rp-preset-list { flex: 1 1 auto; }
  .agent-rp-preset-module {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .agent-rp-preset-module-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .agent-rp-preset-footer { padding: 10px 14px !important; }
  .agent-rp-runtime-inspector-body {
    display: flex !important;
    flex-direction: column !important;
    overflow-y: auto !important;
  }
  .agent-rp-runtime-inspector-order {
    border-bottom: 1px solid var(--dsw-alias-border-l2, #343438);
    border-right: 0 !important;
    flex: 0 0 auto;
    max-height: 42vh;
  }
}
@media (max-width: 460px) {
  .agent-rp-preset-generation { grid-template-columns: 1fr 1fr; }
  .agent-rp-preset-generation > label:last-of-type { grid-column: 1 / -1; }
  .agent-rp-preset-footer { flex-wrap: wrap; }
  .agent-rp-preset-footer > button:first-of-type { margin-right: auto !important; }
}
@media (max-width: 340px) {
  .agent-rp-preset-module-tabs { grid-template-columns: 1fr !important; }
}
`

type RunImageGeneration = (
  sessionId: SessionId,
  request: Pick<ImageGenerationRequest, 'mode' | 'prompt'>,
) => string

const imageModeLabels: Record<ImageGenerationMode, string> = {
  scene: '当前场景', portrait: '角色立绘', avatar: '角色头像', custom: '自定义描述',
}

function imagePrompt(mode: ImageGenerationMode, projection: AgentRpProjection, note: string): string {
  const detail = [projection.description, projection.personality].map(value => value.trim()).filter(Boolean).join('\n').slice(0, 3_000)
  const extra = note.trim()
  if (mode === 'custom') return extra
  const subject = `角色：${projection.characterName}${detail === '' ? '' : `\n角色设定：${detail}`}`
  if (mode === 'scene') {
    return `叙事插画\n${subject}\n场景：${projection.scenario.trim() || '延续当前对话中的场景'}${extra === '' ? '' : `\n补充：${extra}`}`.slice(0, 8_000)
  }
  if (mode === 'portrait') {
    return `角色立绘，完整人物设计，清楚呈现服装与姿态\n${subject}${extra === '' ? '' : `\n补充：${extra}`}`.slice(0, 8_000)
  }
  return `角色头像，头肩构图，表情自然，面部清晰\n${subject}${extra === '' ? '' : `\n补充：${extra}`}`.slice(0, 8_000)
}

function ImageGenerationDialog({ projection, initialMode = 'scene', initialNote = '', onClose, onGenerate }: {
  readonly projection: AgentRpProjection
  readonly initialMode?: ImageGenerationMode
  readonly initialNote?: string
  readonly onClose: () => void
  readonly onGenerate: (request: Pick<ImageGenerationRequest, 'mode' | 'prompt'>) => void
}) {
  const [mode, setMode] = useState<ImageGenerationMode>(initialMode)
  const [note, setNote] = useState(initialNote)
  const prompt = imagePrompt(mode, projection, note)
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="生成聊天插图" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '20px', position: 'fixed', zIndex: 1000,
  }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #111216)', border: '1px solid var(--dsw-alias-border-l2, #35373d)',
      borderRadius: '14px', boxShadow: '0 20px 64px rgba(0,0,0,.45)', maxWidth: '620px', padding: '20px', width: 'min(94vw, 620px)',
    }}>
      <header style={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '17px', margin: 0 }}>生成聊天插图</h2>
          <p style={{ fontSize: '12px', margin: '5px 0 0', opacity: .55 }}>选择画什么，确认后任务会留在这段聊天里</p>
        </div>
        <button type="button" aria-label="关闭绘图" onClick={onClose} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '21px', opacity: .6,
        }}>×</button>
      </header>
      <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: '18px' }}>
        {(Object.entries(imageModeLabels) as [ImageGenerationMode, string][]).map(([value, label]) => <button
          key={value} type="button" onClick={() => { setMode(value); setNote('') }} style={{
            background: value === mode ? `color-mix(in srgb, ${color} 15%, transparent)` : 'transparent',
            border: `1px solid ${value === mode ? `color-mix(in srgb, ${color} 45%, transparent)` : 'var(--dsw-alias-border-l2, #3d3d43)'}`,
            borderRadius: '9px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '9px 10px',
          }}>{label}</button>)}
      </div>
      <label style={{ display: 'grid', fontSize: '12px', gap: '7px', marginTop: '16px' }}>
        {mode === 'custom' ? '画面描述' : '补充说明（可不填）'}
        <textarea autoFocus value={note} maxLength={8_000} rows={5}
          placeholder={mode === 'custom' ? '写下你想看到的画面…' : '例如：黄昏、暖色灯光、电影感构图'}
          onChange={event => { setNote(event.target.value) }} style={{ ...settingsFieldStyle, lineHeight: 1.6, resize: 'vertical' }} />
      </label>
      <details style={{ fontSize: '11px', marginTop: '12px', opacity: .62 }}>
        <summary style={{ cursor: 'pointer' }}>查看将发送给图片服务的提示词</summary>
        <div style={{ lineHeight: 1.6, marginTop: '7px', maxHeight: '150px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{prompt}</div>
      </details>
      <footer style={{ display: 'flex', gap: '9px', justifyContent: 'flex-end', marginTop: '20px' }}>
        <button type="button" onClick={onClose} style={secondaryButtonStyle}>取消</button>
        <button type="button" disabled={prompt.trim() === ''} onClick={() => {
          onGenerate({ mode, prompt })
          onClose()
        }} style={primaryButtonStyle}>开始绘图</button>
      </footer>
    </section>
  </div>
}

function useGeneratedImageJob(jobId: string, settled: boolean): {
  readonly job?: GeneratedImageJob
  readonly error?: string
  readonly refresh: () => void
} {
  const [revision, setRevision] = useState(0)
  const [job, setJob] = useState<GeneratedImageJob>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(generatedImageJobUrl(jobId), { headers: { accept: 'application/json' } })
        const value = await response.json() as { readonly error?: string; readonly job?: GeneratedImageJob }
        if (!response.ok || value.job === undefined) throw new Error(value.error ?? `图片任务读取失败（${response.status}）`)
        if (!active) return
        setJob(value.job)
        setError(undefined)
        if (!['completed', 'failed', 'cancelled'].includes(value.job.status)) timer = setTimeout(() => { void load() }, 1_000)
      } catch (reason: unknown) {
        if (!active) return
        const message = reason instanceof Error ? reason.message : String(reason)
        if (settled) setError(message)
        else timer = setTimeout(() => { void load() }, 700)
      }
    }
    void load()
    return () => { active = false; if (timer !== undefined) clearTimeout(timer) }
  }, [jobId, revision, settled])
  return {
    ...(job === undefined ? {} : { job }),
    ...(error === undefined ? {} : { error }),
    refresh: () => { setRevision(value => value + 1) },
  }
}

function ImageGenerationCommandCard({ node, sessionId, runImageGeneration }: CommandRowProps & {
  readonly runImageGeneration: RunImageGeneration
}) {
  let request: ImageGenerationRequest | undefined
  try {
    request = node.args === null ? undefined : parseImageGenerationRequest(node.args)
  } catch {
    request = undefined
  }
  const record = decodeImageGenerationRecord(node.outcome?.text)
  const jobId = request?.jobId ?? record?.jobId
  if (jobId === undefined) return <div data-agent-rp-image-card style={{ fontSize: '12px', opacity: .62 }}>无法读取这条绘图记录</div>
  const { job, error, refresh } = useGeneratedImageJob(jobId, node.outcome !== null)
  const resolvedRequest = job?.request ?? request
  const [promptOpen, setPromptOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const status = job?.status ?? (node.outcome === null ? 'queued' : node.outcome.kind === 'error' ? 'failed' : 'running')
  const failure = job?.error ?? (node.outcome?.kind === 'error' ? node.outcome.text : undefined) ?? error
  const title = resolvedRequest === undefined ? '聊天插图' : imageModeLabels[resolvedRequest.mode]
  const retry = (): void => {
    if (resolvedRequest !== undefined) runImageGeneration(sessionId, { mode: resolvedRequest.mode, prompt: resolvedRequest.prompt })
  }
  return <article data-agent-rp-image-card style={{
    background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, #202126) 82%, transparent)',
    border: '1px solid var(--dsw-alias-border-l2, #383a41)', borderRadius: '12px', maxWidth: '680px', overflow: 'hidden', width: '100%',
  }}>
    <header style={{ alignItems: 'center', display: 'flex', gap: '9px', padding: '10px 12px' }}>
      <span aria-hidden="true" style={{ color, fontSize: '15px' }}>✦</span>
      <strong style={{ fontSize: '12px', fontWeight: 620 }}>{title}</strong>
      <span style={{ fontSize: '11px', marginLeft: 'auto', opacity: .52 }}>
        {status === 'completed' ? '已完成' : status === 'failed' ? '生成失败' : status === 'cancelled' ? '已取消' : job?.phase ?? '正在排队'}
      </span>
    </header>
    {(status === 'queued' || status === 'running') && <div style={{ background: 'rgba(127,127,127,.15)', height: '3px' }}>
      <div style={{ background: color, height: '100%', transition: 'width .35s ease', width: `${Math.max(3, (job?.progress ?? 0.02) * 100)}%` }} />
    </div>}
    {status === 'completed' && <img src={generatedImageAssetUrl(jobId)} alt={title} loading="lazy" style={{
      background: 'rgba(0,0,0,.2)', display: 'block', maxHeight: '720px', objectFit: 'contain', width: '100%',
    }} />}
    {(failure !== undefined || status === 'cancelled') && <div role={failure === undefined ? 'status' : 'alert'} style={{
      color: failure === undefined ? 'inherit' : 'var(--dsw-alias-state-danger, #df6f7a)', fontSize: '12px', lineHeight: 1.55, padding: '4px 12px 10px',
    }}>{failure ?? '这次绘图已取消'}</div>}
    <footer style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '7px', padding: '9px 12px 11px' }}>
      {resolvedRequest !== undefined && <button type="button" onClick={() => { setPromptOpen(value => !value) }} style={generationButtonStyle}>
        {promptOpen ? '收起提示词' : '查看提示词'}
      </button>}
      {(status === 'queued' || status === 'running') && <button type="button" disabled={cancelling} onClick={() => {
        setCancelling(true)
        void fetch(`${generatedImageJobUrl(jobId)}/cancel`, { method: 'POST', headers: { accept: 'application/json' } })
          .then(() => { refresh() }).finally(() => { setCancelling(false) })
      }} style={generationButtonStyle}>{cancelling ? '正在取消…' : '取消'}</button>}
      {(status === 'completed' || status === 'failed' || status === 'cancelled') && <button type="button" onClick={retry} style={generationButtonStyle}>重绘</button>}
      {status === 'completed' && <a href={generatedImageAssetUrl(jobId, true)} download style={{ ...generationButtonStyle, textDecoration: 'none' }}>下载</a>}
    </footer>
    {promptOpen && resolvedRequest !== undefined && <div style={{
      borderTop: '1px solid var(--dsw-alias-border-l2, #383a41)', fontSize: '11px', lineHeight: 1.6,
      maxHeight: '180px', overflow: 'auto', padding: '10px 12px', whiteSpace: 'pre-wrap',
    }}>{resolvedRequest.prompt}</div>}
  </article>
}

function RoleplayStatusDialog({ characterName, source, stateError, onClose }: {
  readonly characterName: string
  readonly source: string
  readonly stateError?: string
  readonly onClose: () => void
}) {
  return <div data-agent-rp-dialog role="dialog" aria-modal="true" aria-label="当前状态" style={{
    alignItems: 'center', background: 'rgba(0,0,0,.62)', display: 'flex', inset: 0,
    justifyContent: 'center', padding: '24px', position: 'fixed', zIndex: 1000,
  }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #111216)', border: '1px solid var(--dsw-alias-border-l2, #35373d)',
      borderRadius: '14px', boxShadow: '0 20px 64px rgba(0,0,0,.45)', maxHeight: '88vh',
      maxWidth: '1240px', overflow: 'hidden', position: 'relative', width: 'min(94vw, 1240px)',
    }}>
      <button type="button" aria-label="关闭当前状态" onClick={onClose} style={{
        alignItems: 'center', background: 'rgba(13,17,27,.88)', border: '1px solid rgba(116,143,184,.35)',
        borderRadius: '50%', color: '#edf4ff', cursor: 'pointer', display: 'flex', fontSize: '20px',
        height: '34px', justifyContent: 'center', position: 'absolute', right: '12px', top: '12px', width: '34px', zIndex: 2,
      }}>×</button>
      {stateError !== undefined && <div role="alert" style={{
        background: 'color-mix(in srgb, var(--dsw-alias-state-danger, #d64d5f) 10%, var(--dsw-alias-bg-base, #111216))',
        borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-state-danger, #d64d5f) 26%, transparent)',
        color: 'var(--dsw-alias-state-danger, #e88989)', fontSize: '12px', lineHeight: 1.5,
        padding: '12px 58px 12px 14px',
      }}>最近一次状态更新失败：{stateError}</div>}
      <iframe title={`${characterName}的当前状态`} sandbox="allow-scripts" srcDoc={source} style={{
        background: 'transparent', border: 0, colorScheme: 'dark', display: 'block', height: 'min(760px, 82vh)', width: '100%',
      }} />
    </section>
  </div>
}

type RunTavernMutation = (sessionId: SessionId, request: TavernHelperMutationRequest) => Promise<void>

function tavernMutationCause(value: unknown, sessionId: SessionId): TavernMutationCause | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const cause = value as Record<string, unknown>
  if (cause.format !== 0 || cause.sessionId !== String(sessionId)
    || !Number.isSafeInteger(cause.replySeq) || Number(cause.replySeq) < 0) return undefined
  return { format: 0, sessionId: String(sessionId), replySeq: Number(cause.replySeq) }
}
type RunTavernTrigger = (sessionId: SessionId) => Promise<void>
type RunPresetConfiguration = (sessionId: SessionId, request: PresetConfigurationRequest) => Promise<void>
type RunTavernGeneration = (
  sessionId: SessionId,
  request: Pick<TavernGenerationRequest, 'mode' | 'config'>,
  signal?: AbortSignal,
) => Promise<string>
type RunTavernPromptPreview = (
  sessionId: SessionId,
  request: Pick<TavernGenerationRequest, 'mode' | 'config'>,
  signal?: AbortSignal,
) => Promise<readonly TavernPrompt[]>
type RunTavernModelList = (request: Omit<TavernModelListRequest, 'format'>) => Promise<readonly string[]>

interface QueuedTavernGeneration {
  readonly target: Window
  readonly requestId: string
  readonly mode: 'preset' | 'raw'
  readonly config: Readonly<Record<string, unknown>>
  readonly generationId?: string
}

function activeTavernScripts(
  projection: AgentRpProjection,
  scope: TavernScriptTreeScope,
): readonly ImportedTavernHelperScript[] {
  const replacement = projection.tavern?.scriptTrees?.[scope]
  if (replacement !== undefined) return parseTavernHelperScripts(replacement, `session.${scope}.scriptTrees`)
  return scope === 'preset'
    ? projection.preset?.tavernHelperScripts ?? []
    : scope === 'character' ? projection.frontend?.tavernHelperScripts ?? [] : []
}

function tavernObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function tavernPresetConfiguration(
  projection: AgentRpProjection,
  value: unknown,
  revision: number,
): PresetConfigurationRequest {
  const active = projection.preset
  if (active === undefined) throw new Error('当前会话没有预设')
  const preset = tavernObject(value, '预设')
  const used = Array.isArray(preset.prompts) ? preset.prompts : []
  const unused = Array.isArray(preset.prompts_unused) ? preset.prompts_unused : []
  const currentById = new Map(active.prompts.map(prompt => [prompt.identifier, prompt]))
  const seen = new Set<string>()
  const definitions: NonNullable<Extract<PresetConfigurationRequest, { operation: 'replace' }>['prompts']> = [
    ...used, ...unused,
  ].map((candidate, index) => {
    const item = tavernObject(candidate, `预设提示词 ${index + 1}`)
    const identifier = typeof item.id === 'string' && item.id.trim() !== ''
      ? item.id : typeof item.identifier === 'string' ? item.identifier : ''
    if (identifier.trim() === '' || seen.has(identifier)) throw new Error('预设提示词标识无效或重复')
    seen.add(identifier)
    const current = currentById.get(identifier)
    const role = item.role === 'user' || item.role === 'assistant' || item.role === 'system'
      ? item.role : current?.role ?? 'system'
    const position = typeof item.position === 'object' && item.position !== null && !Array.isArray(item.position)
      ? item.position as Record<string, unknown> : undefined
    const inChat = position?.type === 'in_chat'
    const withPosition = inChat || current?.injectionPosition !== undefined || current === undefined
      ? {
          injectionPosition: inChat ? 1 : 0,
          ...(inChat && Number.isSafeInteger(position?.depth) ? { injectionDepth: Number(position!.depth) } : {}),
          ...(inChat && Number.isSafeInteger(position?.order) ? { injectionOrder: Number(position!.order) } : {}),
        }
      : {}
    return {
      identifier,
      name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name : current?.name ?? identifier,
      role,
      content: typeof item.content === 'string' ? item.content : current?.content ?? '',
      ...withPosition,
    }
  })
  const order = used.map((candidate, index) => {
    const item = tavernObject(candidate, `预设顺序 ${index + 1}`)
    const identifier = typeof item.id === 'string' && item.id.trim() !== ''
      ? item.id : typeof item.identifier === 'string' ? item.identifier : ''
    return { identifier, enabled: item.enabled === true }
  })
  const settings = typeof preset.settings === 'object' && preset.settings !== null && !Array.isArray(preset.settings)
    ? preset.settings as Record<string, unknown> : {}
  const generation: Extract<PresetConfigurationRequest, { operation: 'replace' }>['generation'] = {
    ...(typeof settings.temperature === 'number' && Number.isFinite(settings.temperature)
      && (active.generation.temperature !== undefined || settings.temperature !== 1)
      ? { temperature: settings.temperature } : {}),
    ...(Number.isSafeInteger(settings.max_completion_tokens) && Number(settings.max_completion_tokens) > 0
      && (active.generation.maxTokens !== undefined || settings.max_completion_tokens !== 300)
      ? { maxTokens: Number(settings.max_completion_tokens) } : {}),
    ...(typeof settings.reasoning_effort === 'string' && settings.reasoning_effort.trim() !== ''
      && (active.generation.reasoningEffort !== undefined || settings.reasoning_effort !== 'auto')
      ? { reasoningEffort: settings.reasoning_effort } : {}),
  }
  const extensions = typeof preset.extensions === 'object' && preset.extensions !== null && !Array.isArray(preset.extensions)
    ? preset.extensions as Record<string, unknown> : {}
  const candidates = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
  const regexScripts = candidates.map(importTavernRegex)
  const regex = regexScripts.map((script, index) => ({
    index, disabled: script.disabled, minDepth: script.minDepth, maxDepth: script.maxDepth,
  }))
  return {
    operation: 'replace', revision, order, prompts: definitions, content: [], generation, regex, regexScripts,
  }
}

function runtimeScriptButtons(value: unknown): readonly { readonly name: string; readonly visible: boolean }[] | undefined {
  if (!Array.isArray(value) || value.length > 50) return undefined
  const names = new Set<string>()
  const buttons: { readonly name: string; readonly visible: boolean }[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const button = item as Record<string, unknown>
    if (typeof button.name !== 'string' || button.name.trim() === '' || button.name.length > 200
      || typeof button.visible !== 'boolean' || names.has(button.name)) return undefined
    names.add(button.name)
    buttons.push({ name: button.name, visible: button.visible })
  }
  return buttons
}

interface TavernPopupRequest {
  readonly key: string
  readonly target: Window
  readonly requestId: string
  readonly scriptName: string
  readonly type: TavernPopupType
  readonly content: string
  readonly inputValue: string
  readonly options: TavernPopupOptions
}

interface TavernExternalWindowRequest {
  readonly key: string
  readonly scriptKey: string
  readonly target: Window
  readonly requestId: string
  readonly scriptName: string
  readonly url: string
  readonly hostname: string
}

interface TavernOriginInteractionRequest {
  readonly scriptKey: string
  readonly origin: string
  readonly count: number
}

type TavernRuntimePermissionRequest = {
  readonly kind: TavernScriptResourcePermission['kind']
  readonly key: string
  readonly resource: TavernScriptResourcePermission
} | {
  readonly kind: 'identity'
  readonly key: string
  readonly request: NativeIdentityRuntimeRequest
} | {
  readonly kind: 'external-window'
  readonly key: string
  readonly request: TavernExternalWindowRequest
} | {
  readonly kind: 'generation'
  readonly key: string
  readonly scriptKey: string
  readonly count: number
} | {
  readonly kind: 'custom-generation'
  readonly key: string
  readonly approvalKey: string
  readonly request: TavernOriginInteractionRequest
} | {
  readonly kind: 'model-list'
  readonly key: string
  readonly approvalKey: string
  readonly request: TavernOriginInteractionRequest
}

interface CardExternalWindowRequest {
  readonly key: string
  readonly target: Window
  readonly token: string
  readonly requestId: string
  readonly url: string
  readonly hostname: string
}

function TavernScriptPopup({ request, onResolve }: {
  readonly request: TavernPopupRequest
  readonly onResolve: (value: string | number | boolean | null) => void
}) {
  const [input, setInput] = useState(request.inputValue)
  const options = request.options
  const canDismiss = options.allowEscapeClose !== false
  const inputRows = options.rows ?? 1
  const sanitized = DOMPurify.sanitize(request.content, {
    FORBID_ATTR: ['srcdoc', 'style'],
    FORBID_TAGS: ['base', 'button', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'textarea'],
    USE_PROFILES: { html: true },
  })
  const affirmative = (): void => { onResolve(request.type === 3 ? input : 1) }
  const showOk = options.okButton !== false && request.type !== 4
  const showCancel = (options.cancelButton !== false && (request.type === 2 || request.type === 3))
    || typeof options.cancelButton === 'string'
  const okLabel = typeof options.okButton === 'string'
    ? options.okButton : request.type === 3 ? '保存' : request.type === 2 ? '确定' : '知道了'
  const cancelLabel = typeof options.cancelButton === 'string' ? options.cancelButton : '取消'
  const buttonStyle = {
    background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #4a4c54)', borderRadius: '8px',
    color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '7px 12px',
  } as const
  useEffect(() => {
    if (!canDismiss) return
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') onResolve(null) }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [canDismiss, onResolve])
  return <div role="dialog" aria-modal aria-label={`${request.scriptName} 的酒馆脚本弹窗`}
    data-agent-rp-native-back-layer style={{
    alignItems: 'center', background: 'rgba(0,0,0,.72)', display: 'flex', inset: 0, justifyContent: 'center',
    padding: '18px', position: 'fixed', zIndex: 1250,
  }} onMouseDown={event => { if (canDismiss && event.target === event.currentTarget) onResolve(null) }}>
    <section style={{
      background: 'var(--dsw-alias-bg-base, #121318)', border: '1px solid var(--dsw-alias-border-l2, #3b3d45)',
      borderRadius: '14px', boxShadow: '0 22px 72px rgba(0,0,0,.5)', display: 'grid', gap: '14px',
      maxHeight: 'min(86vh, 840px)', maxWidth: options.wide || options.wider || options.large ? '960px' : '620px',
      overflow: 'auto', padding: '16px', width: options.wide || options.wider || options.large ? 'min(94vw, 960px)' : 'min(92vw, 620px)',
    }}>
      <header style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
        <strong style={{ flex: '1 1 auto', fontSize: '13px' }}>{request.scriptName || '酒馆脚本'}</strong>
        {canDismiss && <button type="button" aria-label="关闭弹窗" onClick={() => { onResolve(null) }} style={{
          ...buttonStyle, border: 0, fontSize: '20px', padding: '0 5px',
        }}>×</button>}
      </header>
      <div title={options.tooltip} style={{
        fontSize: '13px', lineHeight: 1.65, overflowWrap: 'anywhere', textAlign: options.leftAlign === false ? 'center' : 'left',
      }} dangerouslySetInnerHTML={{ __html: sanitized }} />
      {request.type === 3 && (inputRows > 1
        ? <textarea autoFocus maxLength={65_536} rows={inputRows} value={input} placeholder={options.placeholder} onChange={event => { setInput(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); affirmative() } }} style={{
              background: 'var(--dsw-alias-bg-elevated, #202228)', border: '1px solid var(--dsw-alias-border-l2, #4a4c54)',
              borderRadius: '8px', color: 'inherit', font: 'inherit', lineHeight: 1.5, maxHeight: '42vh', minHeight: '88px', padding: '9px', resize: 'vertical',
            }} />
        : <input autoFocus maxLength={65_536} value={input} placeholder={options.placeholder} onChange={event => { setInput(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); affirmative() } }} style={{
              background: 'var(--dsw-alias-bg-elevated, #202228)', border: '1px solid var(--dsw-alias-border-l2, #4a4c54)',
              borderRadius: '8px', color: 'inherit', font: 'inherit', padding: '9px',
            }} />)}
      {(showOk || showCancel || (options.customButtons?.length ?? 0) > 0) && <footer style={{
        display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end',
      }}>
        {options.customButtons?.map((button, index) => <button type="button" key={`${button.result}:${index}`}
          onClick={() => { onResolve(button.result) }} style={buttonStyle}>{button.text}</button>)}
        {showCancel && <button type="button" onClick={() => { onResolve(request.type === 3 ? false : 0) }} style={buttonStyle}>{cancelLabel}</button>}
        {showOk && <button type="button" onClick={affirmative} style={{
          ...buttonStyle, background: 'var(--dsw-alias-primary-bg, #3568d4)', borderColor: 'transparent', color: 'white',
        }}>{okLabel}</button>}
      </footer>}
    </section>
  </div>
}

interface TavernToastMessage {
  readonly id: number
  readonly scriptName: string
  readonly level: 'info' | 'success' | 'warning' | 'error'
  readonly value: string
}

interface TavernScriptFrame {
  readonly key: string
  readonly scope: TavernScriptTreeScope
  readonly script: ImportedTavernHelperScript
  readonly source?: string
  readonly src?: string
  readonly bootSource?: string
  readonly bootVendors?: readonly string[]
  readonly bootstrapSnapshot?: TavernScriptSnapshot
  readonly error?: string
  readonly requestedOrigin?: string
  readonly compatibilityMarkers?: readonly string[]
  readonly remoteImageOrigins?: readonly string[]
  readonly remoteStyleOrigins?: readonly string[]
  readonly remoteFrameOrigins?: readonly string[]
}

type TavernScriptStartupPhase = 'navigation' | 'bootstrap' | 'runtime' | 'script'

type TavernScriptStartupTimes = Partial<Record<TavernScriptStartupPhase, number>>
  & { readonly programDuration?: number; readonly executionDuration?: number }

function tavernStartupRange(
  timings: ReadonlyMap<string, TavernScriptStartupTimes>,
  phase: TavernScriptStartupPhase,
): { readonly first?: number; readonly last?: number } {
  const values = [...timings.values()].flatMap(value => value[phase] === undefined ? [] : [value[phase]])
  return values.length === 0 ? {} : { first: Math.min(...values), last: Math.max(...values) }
}

function tavernDurationRange(
  timings: ReadonlyMap<string, TavernScriptStartupTimes>,
  field: 'programDuration' | 'executionDuration',
): { readonly minimum?: number; readonly maximum?: number } {
  const values = [...timings.values()].flatMap(value => value[field] === undefined ? [] : [value[field]])
  return values.length === 0 ? {} : { minimum: Math.min(...values), maximum: Math.max(...values) }
}

type TavernBlockedResource = Pick<TavernResourceBlockedReport, 'origin' | 'type'>

function TavernScriptToast({ toast, onClose }: {
  readonly toast: TavernToastMessage
  readonly onClose: () => void
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const timer = window.setTimeout(() => { closeRef.current() }, 6_000)
    return () => { window.clearTimeout(timer) }
  }, [toast.id])
  const accent = toast.level === 'error' ? '#d76868'
    : toast.level === 'warning' ? '#d5a64c' : toast.level === 'success' ? '#58ad7b' : '#6d94dc'
  return <button type="button" onClick={onClose} title="点击关闭" style={{
    background: 'var(--dsw-alias-bg-elevated, #202228)', border: `1px solid color-mix(in srgb, ${accent} 58%, transparent)`,
    borderLeft: `4px solid ${accent}`, borderRadius: '10px', boxShadow: '0 12px 34px rgba(0,0,0,.3)', color: 'inherit',
    cursor: 'pointer', display: 'grid', font: 'inherit', gap: '3px', maxWidth: 'min(92vw, 420px)', padding: '10px 12px',
    textAlign: 'left', width: '100%',
  }}>
    <span style={{ fontSize: '10px', opacity: .58 }}>{toast.scriptName || '酒馆脚本'}</span>
    <span style={{ fontSize: '12px', lineHeight: 1.45, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{toast.value}</span>
  </button>
}

function tavernStatusPanelDocument(html: string, token: string, nonce: string): string {
  const sanitized = String(DOMPurify.sanitize(html, {
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'meta', 'object', 'script'],
    FORBID_ATTR: ['srcdoc'],
  }))
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:transparent;color:inherit;color-scheme:dark;margin:0;max-width:100%;min-width:0;padding:0}body{box-sizing:border-box;overflow:auto}</style></head><body>${sanitized}<script nonce="${nonce}">(()=>{'use strict';const token=${JSON.stringify(token)};let queued=false;const report=()=>{queued=false;const root=document.documentElement,body=document.body;parent.postMessage({source:'dsh-agent-rp-status-panel',token,height:Math.max(root.scrollHeight,body.scrollHeight)},'*')};const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(report)};addEventListener('load',queue);new MutationObserver(queue).observe(document.documentElement,{attributes:true,characterData:true,childList:true,subtree:true});if(window.ResizeObserver)new ResizeObserver(queue).observe(document.documentElement);queue()})()</script></body></html>`
}

function TavernStatusPanelFrame({ html, owner }: {
  readonly html: string
  readonly owner: string
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(72)
  const token = useMemo(() => crypto.randomUUID(), [owner])
  const nonce = useMemo(() => crypto.randomUUID().replaceAll('-', ''), [owner])
  const documentSource = useMemo(() => tavernStatusPanelDocument(html, token, nonce), [html, nonce, token])
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== frameRef.current?.contentWindow || typeof event.data !== 'object' || event.data === null) return
      const message = event.data as { readonly source?: unknown; readonly token?: unknown; readonly height?: unknown }
      if (message.source !== 'dsh-agent-rp-status-panel' || message.token !== token
        || typeof message.height !== 'number' || !Number.isFinite(message.height)) return
      setHeight(Math.max(48, Math.min(360, Math.ceil(message.height))))
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [token])
  return <iframe ref={frameRef} title="角色状态面板" sandbox="allow-scripts" srcDoc={documentSource} style={{
    background: 'transparent', border: 0, colorScheme: 'dark', display: 'block', height: `${height}px`,
    maxWidth: '100%', width: '100%',
  }} />
}

function TavernStatusPanels({ projection }: { readonly projection: AgentRpProjection }) {
  const panels = (projection.tavern?.statusPanels ?? []).filter(
    (panel): panel is typeof panel & { readonly html: string } => panel.html !== null,
  )
  if (panels.length === 0) return null
  return <section data-agent-rp-status-panels data-agent-rp-status-panel-count={panels.length} style={{
    background: 'var(--dsw-alias-bg-base, #15161a)', border: '1px solid var(--dsw-alias-border-l2, #363840)',
    borderRadius: '12px', boxShadow: '0 10px 32px rgba(0,0,0,.24)', display: 'grid', gap: '8px',
    maxHeight: 'min(46vh, 520px)', minWidth: 0, overflow: 'auto', padding: '8px', width: '100%',
  }}>
    {panels.map(panel => {
      const owner = tavernScriptIdentity(panel.owner.scriptScope, panel.owner.scriptId)
      return <TavernStatusPanelFrame key={owner} owner={owner} html={panel.html} />
    })}
  </section>
}

function TavernScriptRuntime({
  characterDisplayRegexScripts, ctx, debugEnabled, inputActions, onCompatibilityMarkersChange, onDisplayOverride, projection, runGeneration, runModelList, runMutation,
  runPresetConfiguration, runPromptPreview, runTrigger, sessionId, runtimeDiagnostics,
}: {
  readonly characterDisplayRegexScripts?: readonly ImportedRegexScript[]
  readonly ctx: Context
  readonly debugEnabled: boolean
  readonly inputActions: ComposerDockProps['inputActions']
  readonly onCompatibilityMarkersChange: (markers: readonly string[]) => void
  readonly onDisplayOverride: (scriptId: string, messageId: number, value: string) => void
  readonly projection: AgentRpProjection
  readonly runGeneration: RunTavernGeneration
  readonly runModelList: RunTavernModelList
  readonly runMutation: RunTavernMutation
  readonly runPresetConfiguration: RunPresetConfiguration
  readonly runPromptPreview: RunTavernPromptPreview
  readonly runTrigger: RunTavernTrigger
  readonly sessionId: SessionId
  readonly runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry
}) {
  const scopedScripts = (['global', 'preset', 'character'] as const).flatMap(scope =>
    activeTavernScripts(projection, scope).map(script => ({
      key: tavernScriptIdentity(scope, script.id), scope, script,
    })),
  ).filter(entry => entry.script.enabled && entry.script.content.trim() !== '')
  const scripts = scopedScripts.map(entry => entry.script)
  const scopedScriptByKey = new Map(scopedScripts.map(entry => [entry.key, entry] as const))
  const sessionResourcePermissions = useAgentRpSessionResourcePermissions(sessionId)
  const [approvedOrigins, setApprovedOrigins] = useState(() => new Set([
    ...readApprovedTavernScriptOrigins(), ...sessionResourcePermissions.tavern.scripts,
  ]))
  const [approvedImages, setApprovedImages] = useState(() => new Set([
    ...readApprovedTavernScriptImages(), ...sessionResourcePermissions.tavern.images,
  ]))
  const [approvedStyles, setApprovedStyles] = useState(() => new Set([
    ...readApprovedTavernScriptStyles(), ...sessionResourcePermissions.tavern.styles,
  ]))
  const [approvedFonts, setApprovedFonts] = useState(() => new Set([
    ...readApprovedTavernScriptFonts(), ...sessionResourcePermissions.tavern.fonts,
  ]))
  const [approvedFrames, setApprovedFrames] = useState(() => new Set([
    ...readApprovedTavernScriptFrames(), ...sessionResourcePermissions.tavern.frames,
  ]))
  useEffect(() => {
    const merge = (current: ReadonlySet<string>, granted: readonly string[]): Set<string> =>
      new Set([...current, ...granted])
    setApprovedOrigins(current => merge(current, sessionResourcePermissions.tavern.scripts))
    setApprovedImages(current => merge(current, sessionResourcePermissions.tavern.images))
    setApprovedStyles(current => merge(current, sessionResourcePermissions.tavern.styles))
    setApprovedFonts(current => merge(current, sessionResourcePermissions.tavern.fonts))
    setApprovedFrames(current => merge(current, sessionResourcePermissions.tavern.frames))
  }, [sessionResourcePermissions])
  const nativeIdentityState = useNativeIdentityDiagnosticState()
  const characterApprovalId = tavernPermissionOwnerId(
    projection.avatarLibraryId, projection.tavern?.characterSourceId,
  ) ?? projection.characterName
  const presetApprovalId = tavernPermissionOwnerId(
    projection.preset?.libraryId, projection.tavern?.presetSourceId,
  )
  const characterExecutionLibraryId = projection.avatarLibraryId ?? projection.tavern?.characterSourceId
  const presetExecutionLibraryId = projection.preset?.libraryId ?? projection.tavern?.presetSourceId
  const scriptOrigins = (entry: Pick<TavernScriptFrame, 'scope' | 'script'>): readonly string[] => [...new Set([
    ...BUILT_IN_TAVERN_SCRIPT_ORIGINS,
    ...approvedTavernScriptOrigins(
      approvedOrigins, characterApprovalId, presetApprovalId, entry.scope, entry.script.id,
    ),
  ])].sort()
  const styleOrigins = (entry: Pick<TavernScriptFrame, 'scope' | 'script'>): readonly string[] =>
    approvedTavernScriptOrigins(
      approvedStyles, characterApprovalId, presetApprovalId, entry.scope, entry.script.id,
    )
  const relevantOriginApprovals = [...approvedOrigins].filter(approval => {
    const value = parseTavernScriptOriginApprovalKey(approval)
    return value?.characterId === characterApprovalId && value.presetId === presetApprovalId
  }).sort()
  const planSignature = `${scopedScripts.map(entry => JSON.stringify([entry.scope, entry.script])).join('\u0001')}\u0002${relevantOriginApprovals.join('\u0001')}`
  const signature = `${planSignature}\u0002${[...approvedImages].sort().join('\u0001')}\u0002${[...approvedStyles].sort().join('\u0001')}\u0002${[...approvedFonts].sort().join('\u0001')}\u0002${[...approvedFrames].sort().join('\u0001')}`
  const [frames, setFrames] = useState<readonly TavernScriptFrame[]>([])
  const [readyScriptIds, setReadyScriptIds] = useState<ReadonlySet<string>>(() => new Set())
  const runtimeStartedAt = useRef(performance.now())
  const scriptStartupTimings = useRef(new Map<string, TavernScriptStartupTimes>())
  const [startupTiming, setStartupTiming] = useState<{
    readonly planMs?: number
    readonly firstReadyMs?: number
    readonly settledMs?: number
  }>({})
  const [compatibilityMarkersByScript, setCompatibilityMarkersByScript] = useState<ReadonlyMap<string, readonly string[]>>(
    () => new Map(),
  )
  const [runtimeErrors, setRuntimeErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [blockedResourcesByScript, setBlockedResourcesByScript] = useState<ReadonlyMap<
    string, readonly TavernBlockedResource[]
  >>(() => new Map())
  const [runtimeButtons, setRuntimeButtons] = useState<ReadonlyMap<string, readonly {
    readonly name: string
    readonly visible: boolean
  }[]>>(() => new Map())
  const [externalScriptRequests, setExternalScriptRequests] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [approvedGenerations, setApprovedGenerations] = useState(readApprovedTavernScriptGenerations)
  const [generationRequests, setGenerationRequests] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [approvedCustomGenerations, setApprovedCustomGenerations] = useState(readApprovedTavernScriptCustomGenerations)
  const [customGenerationRequests, setCustomGenerationRequests] = useState<ReadonlyMap<
    string, TavernOriginInteractionRequest
  >>(() => new Map())
  const [approvedModels, setApprovedModels] = useState(readApprovedTavernScriptModels)
  const [modelListRequests, setModelListRequests] = useState<ReadonlyMap<
    string, TavernOriginInteractionRequest
  >>(() => new Map())
  const [surfaceScriptIds, setSurfaceScriptIds] = useState<ReadonlySet<string>>(() => new Set())
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelScriptId, setPanelScriptId] = useState<string>()
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [diagnosticNotice, setDiagnosticNotice] = useState<string>()
  const [popupRequests, setPopupRequests] = useState<readonly TavernPopupRequest[]>([])
  const [externalWindowRequests, setExternalWindowRequests] = useState<ReadonlyMap<string, TavernExternalWindowRequest>>(
    () => new Map(),
  )
  const [approvedNativeIdentities, setApprovedNativeIdentities] = useState(readApprovedNativeIdentities)
  const [nativeIdentityRequests, setNativeIdentityRequests] = useState<ReadonlyMap<string, NativeIdentityRuntimeRequest>>(
    () => new Map(),
  )
  const [externalWindowPhase, setExternalWindowPhase] = useState<ExternalWindowPhase>()
  const [runtimeToasts, setRuntimeToasts] = useState<readonly TavernToastMessage[]>([])
  const toastSequence = useRef(0)
  const frameRefs = useRef(new Map<string, HTMLIFrameElement>())
  const framesRef = useRef(frames)
  framesRef.current = frames
  const frameSources = useRef(new Map<string, string>())
  const readyScriptIdsRef = useRef(readyScriptIds)
  readyScriptIdsRef.current = readyScriptIds
  const scriptBootstrapTimers = useRef(new Map<string, number>())
  const externalWindowBrokers = useRef(new Map<string, ExternalWindowBroker>())
  const failedScriptIds = useRef(new Set<string>())
  const compatibilityMarkerTimers = useRef(new Set<number>())
  const pendingCompatibilitySurface = useRef<{ readonly scriptKey: string; readonly surface: 'mobile-trigger' }>()
  const pendingButtonSurface = useRef<{
    readonly scriptKey: string
    readonly buttonId: string
    readonly timer: number
  }>()
  const surfaceButtonIds = useRef(new Set<string>())
  const generationQueue = useRef(new Map<string, QueuedTavernGeneration[]>())
  const customGenerationQueue = useRef(new Map<string, QueuedTavernGeneration[]>())
  const activeGenerations = useRef(new Map<string, {
    readonly target: Window
    readonly generationId?: string
    readonly controller: AbortController
  }>())
  useEffect(() => {
    const sync = (): void => { setApprovedNativeIdentities(readApprovedNativeIdentities()) }
    window.addEventListener(nativeIdentityApprovalsChangedEvent, sync)
    return () => { window.removeEventListener(nativeIdentityApprovalsChangedEvent, sync) }
  }, [])
  const modelListQueue = useRef(new Map<string, {
    readonly target: Window
    readonly requestId: string
    readonly apiurl: string
    readonly key?: string
  }[]>())
  const runtimeProjection = projection.frontend === undefined ? projection : {
    ...projection,
    frontend: withCurrentCharacterDisplayScripts(projection.frontend, characterDisplayRegexScripts),
  }
  const projectionRef = useRef(runtimeProjection)
  const executionScope = useRef<{ readonly sessionId: SessionId; readonly planSignature: string }>()
  const mutationQueue = useRef(Promise.resolve())
  const presetRevisionRef = useRef(projection.preset?.revision ?? 0)
  const presetSessionRef = useRef(sessionId)
  projectionRef.current = runtimeProjection
  if (presetSessionRef.current !== sessionId) {
    presetSessionRef.current = sessionId
    presetRevisionRef.current = projection.preset?.revision ?? 0
  }
  if ((projection.preset?.revision ?? 0) > presetRevisionRef.current) {
    presetRevisionRef.current = projection.preset?.revision ?? 0
  }
  useEffect(() => {
    const controller = new AbortController()
    const legacySettingsStorage: Pick<Storage, 'getItem'> = (() => {
      try {
        return window.localStorage
      } catch {
        return { getItem: () => null }
      }
    })()
    const extensionSettingsByScope = new Map<TavernScriptTreeScope, Promise<Readonly<Record<string, JsonValue>>>>()
    const extensionSettingsFor = (scope: TavernScriptTreeScope): Promise<Readonly<Record<string, JsonValue>>> => {
      const current = extensionSettingsByScope.get(scope)
      if (current !== undefined) return current
      const loading = readTavernExtensionSettings(
        tavernExtensionSettingsIdentity(characterApprovalId, presetApprovalId, scope),
        legacySettingsStorage,
      )
      extensionSettingsByScope.set(scope, loading)
      return loading
    }
    const previousScope = executionScope.current
    const nextScope = { sessionId, planSignature }
    const resetRuntime = shouldResetTavernScriptRuntime(previousScope, nextScope)
    executionScope.current = nextScope
    if (resetRuntime) {
      setFrames(scopedScripts.map(entry => ({ ...entry })))
      setReadyScriptIds(new Set())
      setCompatibilityMarkersByScript(new Map())
      setRuntimeErrors(new Map())
      setBlockedResourcesByScript(new Map())
      setRuntimeButtons(new Map())
      setExternalScriptRequests(new Map())
      generationQueue.current.clear()
      setGenerationRequests(new Map())
      customGenerationQueue.current.clear()
      setCustomGenerationRequests(new Map())
      for (const active of activeGenerations.current.values()) active.controller.abort()
      activeGenerations.current.clear()
      modelListQueue.current.clear()
      setModelListRequests(new Map())
      setSurfaceScriptIds(new Set())
      setPopupRequests([])
      setExternalWindowRequests(new Map())
      setNativeIdentityRequests(new Map())
      for (const broker of externalWindowBrokers.current.values()) broker.close()
      externalWindowBrokers.current.clear()
      setRuntimeToasts([])
      frameSources.current.clear()
      scriptStartupTimings.current.clear()
      for (const timer of scriptBootstrapTimers.current.values()) window.clearTimeout(timer)
      scriptBootstrapTimers.current.clear()
      failedScriptIds.current.clear()
      for (const timer of compatibilityMarkerTimers.current) window.clearTimeout(timer)
      compatibilityMarkerTimers.current.clear()
      if (pendingButtonSurface.current !== undefined) window.clearTimeout(pendingButtonSurface.current.timer)
      pendingButtonSurface.current = undefined
      surfaceButtonIds.current.clear()
    }
    const installFrame = (entry: TavernScriptFrame): void => {
      if (controller.signal.aborted) return
      const previousBootstrapTimer = scriptBootstrapTimers.current.get(entry.key)
      if (previousBootstrapTimer !== undefined) window.clearTimeout(previousBootstrapTimer)
      scriptBootstrapTimers.current.delete(entry.key)
      const previousSource = frameSources.current.get(entry.key)
      const sourceChanged = previousSource !== undefined && previousSource !== entry.src
      if (entry.src === undefined) frameSources.current.delete(entry.key)
      else frameSources.current.set(entry.key, entry.src)
      if (sourceChanged || entry.error !== undefined) {
        failedScriptIds.current.delete(entry.key)
        setReadyScriptIds(current => {
          if (!current.has(entry.key)) return current
          const next = new Set(current)
          next.delete(entry.key)
          return next
        })
        setCompatibilityMarkersByScript(current => {
          if (!current.has(entry.key)) return current
          const next = new Map(current)
          next.delete(entry.key)
          return next
        })
        setRuntimeErrors(current => {
          if (!current.has(entry.key)) return current
          const next = new Map(current)
          next.delete(entry.key)
          return next
        })
        setBlockedResourcesByScript(current => {
          if (!current.has(entry.key)) return current
          const next = new Map(current)
          next.delete(entry.key)
          return next
        })
      }
      setFrames(current => {
        const next = new Map(current.map(frame => [frame.key, frame] as const))
        next.set(entry.key, entry)
        return scopedScripts.map(script => next.get(script.key) ?? { ...script })
      })
      setExternalScriptRequests(current => {
        const next = new Map(current)
        if (entry.requestedOrigin === undefined) next.delete(entry.key)
        else next.set(entry.key, entry.requestedOrigin)
        return next
      })
      if (entry.src !== undefined && (sourceChanged || !readyScriptIdsRef.current.has(entry.key))) {
        const expectedSource = entry.src
        const timer = window.setTimeout(() => {
          scriptBootstrapTimers.current.delete(entry.key)
          if (controller.signal.aborted || frameSources.current.get(entry.key) !== expectedSource
            || readyScriptIdsRef.current.has(entry.key) || failedScriptIds.current.has(entry.key)) return
          const detail = '酒馆脚本启动超时：隔离运行时未在 15 秒内完成握手'
          setRuntimeErrors(current => new Map(current).set(entry.key, detail))
          ctx.logger.warn(`agent-rp: Tavern Helper script ${JSON.stringify(entry.script.name)} failed: ${detail}`)
        }, 15_000)
        scriptBootstrapTimers.current.set(entry.key, timer)
      }
    }
    const hostExecutionEntries = scopedScripts.flatMap(entry => {
      const hostExecution = entry.scope === 'character' && characterExecutionLibraryId !== undefined
        || entry.scope === 'preset' && presetExecutionLibraryId !== undefined
      return hostExecution ? [{
        scope: entry.scope as 'character' | 'preset',
        scriptId: entry.script.id,
        approvedOrigins: scriptOrigins(entry),
        approvedStyleOrigins: styleOrigins(entry),
      }] : []
    })
    const cachedHostExecutions = hostExecutionEntries.length < 2
      ? Promise.resolve<ReadonlyMap<string, TavernScriptExecution> | undefined>(undefined)
      : fetchCachedTavernExecutions({
          format: 1,
          ...(characterExecutionLibraryId === undefined ? {} : { characterId: characterExecutionLibraryId }),
          ...(presetExecutionLibraryId === undefined ? {} : { presetId: presetExecutionLibraryId }),
          entries: hostExecutionEntries,
        }, controller.signal).then(entries => entries === undefined ? undefined : new Map(entries.map(entry => [
          tavernScriptIdentity(entry.scope, entry.scriptId), entry.execution,
        ]))).catch(() => undefined)
    for (const scopedScript of scopedScripts) {
      void (async (): Promise<TavernScriptFrame> => {
        const { key, scope, script } = scopedScript
        try {
          const approvedScriptOrigins = scriptOrigins(scopedScript)
          const hostExecution = scope === 'character' && characterExecutionLibraryId !== undefined
            || scope === 'preset' && presetExecutionLibraryId !== undefined
          const [execution, extensionSettings] = await Promise.all([
            hostExecution ? cachedHostExecutions.then(cached => cached?.get(key) ?? fetchTavernExecution({
                format: 0,
                ...(characterExecutionLibraryId === undefined ? {} : { characterId: characterExecutionLibraryId }),
                ...(presetExecutionLibraryId === undefined ? {} : { presetId: presetExecutionLibraryId }),
                scope: scope as 'character' | 'preset',
                scriptId: script.id,
                approvedOrigins: approvedScriptOrigins,
                approvedStyleOrigins: styleOrigins(scopedScript),
              }, controller.signal)) : resolveTavernScriptExecution(
              script.content,
              controller.signal,
              approvedScriptOrigins,
            ),
            extensionSettingsFor(scope),
          ])
          const approvedImageOrigins = (execution.remoteImageOrigins ?? []).filter(origin => approvedImages.has(
            tavernScriptImageApprovalKey(
              characterApprovalId, presetApprovalId, scope, script.id, origin,
            ),
          ))
          const approvedFrameOrigins = (execution.remoteFrameOrigins ?? []).filter(origin => approvedFrames.has(
            tavernScriptFrameApprovalKey(
              characterApprovalId, presetApprovalId, scope, script.id, origin,
            ),
          ))
          const approvedStyleOrigins = (execution.remoteStyleOrigins ?? []).filter(origin => approvedStyles.has(
            tavernScriptStyleApprovalKey(
              characterApprovalId, presetApprovalId, scope, script.id, origin,
            ),
          ))
          const approvedFontOrigins = approvedTavernScriptOrigins(
            approvedFonts, characterApprovalId, presetApprovalId, scope, script.id,
          )
          const snapshot = tavernScriptSnapshot(
            projectionRef.current, script, scope, approvedScriptOrigins, sessionId, approvedImageOrigins,
            approvedStyleOrigins, approvedFontOrigins, approvedFrameOrigins, extensionSettings,
          )
          const documentSource = tavernScriptFrameSource(
            script,
            execution,
            snapshot,
            { externalBootstrap: true },
          )
          const navigation = tavernScriptFrameNavigation(documentSource)
          return {
            key, scope, script,
            source: execution.source,
            compatibilityMarkers: execution.compatibilityMarkers,
            remoteImageOrigins: execution.remoteImageOrigins ?? [],
            remoteStyleOrigins: execution.remoteStyleOrigins ?? [],
            remoteFrameOrigins: execution.remoteFrameOrigins ?? [],
            src: navigation.url,
            bootSource: navigation.program,
            bootVendors: navigation.vendors,
            bootstrapSnapshot: snapshot,
          }
        } catch (reason: unknown) {
          return {
            key, scope, script,
            error: reason instanceof Error ? reason.message : String(reason),
            ...(reason instanceof TavernScriptOriginApprovalError
              || reason instanceof TavernExecutionOriginApprovalError ? { requestedOrigin: reason.origin } : {}),
          }
        }
      })().then(installFrame)
    }
    return () => {
      controller.abort()
    }
  }, [sessionId, signature])
  useEffect(() => () => {
    for (const timer of scriptBootstrapTimers.current.values()) window.clearTimeout(timer)
    scriptBootstrapTimers.current.clear()
    for (const timer of compatibilityMarkerTimers.current) window.clearTimeout(timer)
    compatibilityMarkerTimers.current.clear()
    if (pendingButtonSurface.current !== undefined) window.clearTimeout(pendingButtonSurface.current.timer)
    pendingButtonSurface.current = undefined
    surfaceButtonIds.current.clear()
    for (const active of activeGenerations.current.values()) active.controller.abort()
    activeGenerations.current.clear()
    for (const broker of externalWindowBrokers.current.values()) broker.close()
    externalWindowBrokers.current.clear()
  }, [])
  useEffect(() => {
    onCompatibilityMarkersChange([
      ...new Set([...compatibilityMarkersByScript.values()].flat()),
    ].sort())
  }, [compatibilityMarkersByScript, onCompatibilityMarkersChange])
  const syncFrame = (frame: HTMLIFrameElement, entry: TavernScriptFrame): void => {
    const snapshot = tavernScriptSnapshot(
      projectionRef.current, entry.script, entry.scope, scriptOrigins(entry), sessionId,
    )
    frame.contentWindow?.postMessage({
      source: 'dsh-agent-rp-host', action: 'variables-sync',
      scopes: snapshot.scopes, messages: snapshot.messages,
      characterRegexScripts: snapshot.characterRegexScripts,
      globalRegexScripts: snapshot.globalRegexScripts,
      globalScriptTrees: snapshot.globalScriptTrees,
      presetScriptTrees: snapshot.presetScriptTrees,
      characterScriptTrees: snapshot.characterScriptTrees,
      injectedPrompts: snapshot.injectedPrompts,
      displayRegexScripts: snapshot.displayRegexScripts,
      worldbooks: snapshot.worldbooks, worldbookBindings: snapshot.worldbookBindings,
      activeWorldbookEntries: snapshot.activeWorldbookEntries,
      preset: snapshot.preset,
    }, '*')
  }
  const broadcast = (message: object, except?: Window | null): void => {
    for (const frame of frameRefs.current.values()) {
      if (frame.contentWindow !== except) frame.contentWindow?.postMessage({ source: 'dsh-agent-rp-host', ...message }, '*')
    }
  }
  const broadcastExtensionSettings = (
    ownerIdentity: string,
    settings: Readonly<Record<string, JsonValue>>,
    except?: Window | null,
  ): void => {
    for (const [key, frame] of frameRefs.current) {
      const candidate = scopedScriptByKey.get(key)
      if (candidate === undefined || frame.contentWindow === except) continue
      const candidateOwner = tavernExtensionSettingsIdentity(
        characterApprovalId, presetApprovalId, candidate.scope,
      )
      if (candidateOwner === ownerIdentity) {
        frame.contentWindow?.postMessage({
          source: 'dsh-agent-rp-host', action: 'extension-settings-sync', settings,
        }, '*')
      }
    }
  }
  const generationApprovalKey = (scriptKey: string): string => tavernScriptInteractionApprovalKey(
    characterApprovalId, presetApprovalId, 'generation', scriptKey,
  )
  const modelApprovalKey = (scriptKey: string, origin: string): string =>
    tavernScriptInteractionApprovalKey(
      characterApprovalId, presetApprovalId, 'model-list', scriptKey, origin,
    )
  const customGenerationApprovalKey = (scriptKey: string, origin: string): string =>
    tavernScriptInteractionApprovalKey(
      characterApprovalId, presetApprovalId, 'custom-generation', scriptKey, origin,
    )
  const executeGeneration = (
    scriptKey: string,
    target: Window,
    requestId: string,
    mode: 'preset' | 'raw',
    config: Readonly<Record<string, unknown>>,
  ): void => {
    const key = `${scriptKey}\u0000${requestId}`
    const controller = new AbortController()
    const generationId = typeof config.generation_id === 'string' ? config.generation_id : undefined
    activeGenerations.current.set(key, {
      target,
      ...(generationId === undefined ? {} : { generationId }),
      controller,
    })
    void mutationQueue.current.then(() => runGeneration(sessionId, { mode, config }, controller.signal)).then(value => {
      target.postMessage({ source: 'dsh-agent-rp-host', action: 'generation-result', requestId, ok: true, value }, '*')
    }).catch((reason: unknown) => {
      target.postMessage({
        source: 'dsh-agent-rp-host', action: 'generation-result', requestId, ok: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }, '*')
    }).finally(() => {
      activeGenerations.current.delete(key)
    })
  }
  const executePromptPreview = (
    scriptId: string,
    target: Window,
    requestId: string,
    mode: 'preset' | 'raw',
    config: Readonly<Record<string, unknown>>,
  ): void => {
    const key = `${scriptId}\u0000preview:${requestId}`
    const controller = new AbortController()
    const generationId = typeof config.generation_id === 'string' ? config.generation_id : undefined
    activeGenerations.current.set(key, {
      target,
      ...(generationId === undefined ? {} : { generationId }),
      controller,
    })
    void mutationQueue.current.then(() => runPromptPreview(sessionId, { mode, config }, controller.signal)).then(value => {
      target.postMessage({
        source: 'dsh-agent-rp-host', action: 'generation-preview-result', requestId, ok: true, value,
      }, '*')
    }).catch((reason: unknown) => {
      target.postMessage({
        source: 'dsh-agent-rp-host', action: 'generation-preview-result', requestId, ok: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }, '*')
    }).finally(() => {
      activeGenerations.current.delete(key)
    })
  }
  const executeModelList = (
    target: Window,
    requestId: string,
    apiurl: string,
    key?: string,
  ): void => {
    void runModelList({ apiurl, ...(key === undefined ? {} : { key }) }).then(models => {
      target.postMessage({ source: 'dsh-agent-rp-host', action: 'model-list-result', requestId, ok: true, value: models }, '*')
    }).catch((reason: unknown) => {
      target.postMessage({
        source: 'dsh-agent-rp-host', action: 'model-list-result', requestId, ok: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }, '*')
    })
  }
  const cancelGenerations = (scriptKey: string, target: Window, generationId?: string): void => {
    const matches = (request: QueuedTavernGeneration): boolean => request.target === target
      && (generationId === undefined || request.generationId === generationId)
    const reject = (request: QueuedTavernGeneration): void => {
      request.target.postMessage({
        source: 'dsh-agent-rp-host', action: 'generation-result', requestId: request.requestId,
        ok: false, error: '酒馆脚本生成已取消',
      }, '*')
    }
    const localQueue = generationQueue.current.get(scriptKey) ?? []
    const localCancelled = localQueue.filter(matches)
    const localRemaining = localQueue.filter(request => !matches(request))
    for (const request of localCancelled) reject(request)
    if (localRemaining.length === 0) generationQueue.current.delete(scriptKey)
    else generationQueue.current.set(scriptKey, localRemaining)
    if (localCancelled.length > 0) {
      setGenerationRequests(current => {
        const next = new Map(current)
        if (localRemaining.length === 0) next.delete(scriptKey)
        else next.set(scriptKey, localRemaining.length)
        return next
      })
    }
    const changedCustom = new Map<string, number>()
    for (const [approvalKey, queue] of customGenerationQueue.current) {
      const cancelled = queue.filter(matches)
      if (cancelled.length === 0) continue
      const remaining = queue.filter(request => !matches(request))
      for (const request of cancelled) reject(request)
      if (remaining.length === 0) customGenerationQueue.current.delete(approvalKey)
      else customGenerationQueue.current.set(approvalKey, remaining)
      changedCustom.set(approvalKey, remaining.length)
    }
    if (changedCustom.size > 0) {
      setCustomGenerationRequests(current => {
        const next = new Map(current)
        for (const [approvalKey, count] of changedCustom) {
          const existing = next.get(approvalKey)
          if (count === 0 || existing === undefined) next.delete(approvalKey)
          else next.set(approvalKey, { ...existing, count })
        }
        return next
      })
    }
    for (const active of activeGenerations.current.values()) {
      if (active.target === target && (generationId === undefined || active.generationId === generationId)) {
        active.controller.abort()
      }
    }
  }
  useEffect(() => {
    for (const entry of frames) {
      const frame = frameRefs.current.get(entry.key)
      if (frame !== undefined) syncFrame(frame, entry)
    }
  }, [characterDisplayRegexScripts, projection.frontend, projection.mvu, projection.preset, projection.tavern])
  const previousMvu = useRef<{ readonly sessionId: SessionId; readonly value?: string }>()
  useEffect(() => {
    const current = projection.mvu === undefined ? undefined : JSON.stringify({ stat_data: projection.mvu.statData })
    const previous = previousMvu.current
    previousMvu.current = { sessionId, ...(current === undefined ? {} : { value: current }) }
    if (previous === undefined || previous.sessionId !== sessionId) return
    const before = previous.value
    if (current === undefined || current === before) return
    const currentValue = JSON.parse(current) as object
    if (before === undefined) {
      broadcast({ action: 'event', eventType: 'mag_variable_initialized', args: [currentValue, 0] })
      broadcast({ action: 'event', eventType: 'mag_variable_initiailized', args: [currentValue, 0] })
      return
    }
    const beforeValue = JSON.parse(before) as object
    broadcast({ action: 'event', eventType: 'mag_variable_update_ended', args: [currentValue, beforeValue] })
  }, [projection.mvu, sessionId])
  const transcript = useRef<{
    readonly sessionId: SessionId
    readonly cursor: TavernTranscriptCursor | undefined
  }>({ sessionId, cursor: undefined })
  useEffect(() => {
    const messages = projection.tavern?.messages ?? []
    const previous = transcript.current.sessionId === sessionId ? transcript.current.cursor : undefined
    const advanced = advanceTavernTranscript(previous, messages)
    transcript.current = { sessionId, cursor: advanced.cursor }
    for (const message of advanced.appended) {
      if (message.role === 'user') {
        broadcast({ action: 'event', eventType: 'message_sent', args: [message.messageId] })
        continue
      }
      broadcast({ action: 'event', eventType: 'message_received', args: [message.messageId, 'normal'] })
      broadcast({
        action: 'event',
        eventType: 'generation_ended',
        args: [message.messageId],
        mutationCause: { format: 0, sessionId: String(sessionId), replySeq: message.seq },
      })
    }
  }, [projection.tavern?.messages, sessionId])
  useEffect(() => {
    const bridge = (event: MessageEvent<unknown>): void => {
      const entry = framesRef.current.find(
        candidate => frameRefs.current.get(candidate.key)?.contentWindow === event.source,
      )
      if (entry === undefined || typeof event.data !== 'object' || event.data === null) return
      const message = event.data as {
        readonly source?: unknown
        readonly action?: unknown
        readonly capability?: unknown
        readonly requestId?: unknown
        readonly scope?: unknown
        readonly variables?: unknown
        readonly value?: unknown
        readonly eventType?: unknown
        readonly args?: unknown
        readonly origin?: unknown
        readonly type?: unknown
        readonly visible?: unknown
        readonly mode?: unknown
        readonly config?: unknown
        readonly apiurl?: unknown
        readonly key?: unknown
        readonly request?: unknown
        readonly buttons?: unknown
        readonly messageId?: unknown
        readonly preset?: unknown
        readonly generationId?: unknown
        readonly prompts?: unknown
        readonly popupType?: unknown
        readonly content?: unknown
        readonly inputValue?: unknown
        readonly options?: unknown
        readonly level?: unknown
        readonly settings?: unknown
        readonly namespace?: unknown
        readonly operation?: unknown
        readonly index?: unknown
        readonly markers?: unknown
        readonly payload?: unknown
        readonly startupMs?: unknown
        readonly cause?: unknown
      }
      if (message.source === 'dsh-agent-rp-tavern-loader' && message.action === 'bootstrap-request') {
        const current = scriptStartupTimings.current.get(entry.key) ?? {}
        if (current.navigation === undefined) scriptStartupTimings.current.set(entry.key, {
          ...current, navigation: elapsedStartupMilliseconds(runtimeStartedAt.current),
        })
        if (event.origin !== 'null' || entry.bootSource === undefined || entry.bootstrapSnapshot === undefined) return
        ;(event.source as Window).postMessage({
          source: 'dsh-agent-rp-host', action: 'runtime-bootstrap',
          vendors: entry.bootVendors ?? [], program: entry.bootSource, snapshot: entry.bootstrapSnapshot,
        }, '*')
        return
      }
      if (message.source === 'dsh-agent-rp-tavern-loader' && message.action === 'bootstrap-started') {
        const current = scriptStartupTimings.current.get(entry.key) ?? {}
        if (current.bootstrap === undefined) scriptStartupTimings.current.set(entry.key, {
          ...current, bootstrap: elapsedStartupMilliseconds(runtimeStartedAt.current),
        })
        return
      }
      if (message.source === 'dsh-agent-rp-tavern-loader' && message.action === 'bootstrap-finished') {
        if (typeof message.value === 'number' && Number.isFinite(message.value)
          && message.value >= 0 && message.value <= 15_000) {
          const current = scriptStartupTimings.current.get(entry.key) ?? {}
          if (current.programDuration === undefined) scriptStartupTimings.current.set(entry.key, {
            ...current, programDuration: Math.round(message.value),
          })
        }
        return
      }
      if (message.source !== 'dsh-agent-rp-tavern-script') return
      const cause = tavernMutationCause(message.cause, sessionId)
      const requestCause: { readonly cause?: TavernMutationCause } = message.cause === undefined
        ? {}
        : { cause: cause ?? { format: 0, sessionId: '', replySeq: -1 } }
      if (message.action === 'startup-phase' && (message.value === 'runtime' || message.value === 'script')) {
        const phase = message.value
        const current = scriptStartupTimings.current.get(entry.key) ?? {}
        if (current[phase] === undefined) scriptStartupTimings.current.set(entry.key, {
          ...current, [phase]: elapsedStartupMilliseconds(runtimeStartedAt.current),
        })
        return
      }
      if (message.action === 'resource-blocked') {
        const report = parseTavernResourceBlockedReport(message)
        if (report === undefined || report.scriptId !== entry.script.id) return
        setBlockedResourcesByScript(current => {
          const resources = current.get(entry.key) ?? []
          if (resources.length >= 64 || resources.some(resource =>
            resource.type === report.type && resource.origin === report.origin)) return current
          return new Map(current).set(entry.key, [...resources, { type: report.type, origin: report.origin }])
        })
        return
      }
      if (message.action === 'ready') {
        if (typeof message.startupMs === 'number' && Number.isFinite(message.startupMs)
          && message.startupMs >= 0 && message.startupMs <= 15_000) {
          const current = scriptStartupTimings.current.get(entry.key) ?? {}
          if (current.executionDuration === undefined) scriptStartupTimings.current.set(entry.key, {
            ...current, executionDuration: Math.round(message.startupMs),
          })
        }
        const bootstrapTimer = scriptBootstrapTimers.current.get(entry.key)
        if (bootstrapTimer !== undefined) window.clearTimeout(bootstrapTimer)
        scriptBootstrapTimers.current.delete(entry.key)
        setReadyScriptIds(current => new Set(current).add(entry.key))
        if (!failedScriptIds.current.has(entry.key)) {
          setCompatibilityMarkersByScript(current => new Map(current).set(
            entry.key,
            validatedTavernCompatibilityMarkers(message.markers),
          ))
          setRuntimeErrors(current => {
            if (!current.has(entry.key)) return current
            const next = new Map(current)
            next.delete(entry.key)
            return next
          })
        }
        const frame = frameRefs.current.get(entry.key)
        if (frame === undefined) return
        syncFrame(frame, entry)
        frame.contentWindow?.postMessage({ source: 'dsh-agent-rp-host', action: 'script-buttons-request' }, '*')
        frame.contentWindow?.postMessage({ source: 'dsh-agent-rp-host', action: 'event', eventType: 'app_ready', args: [] }, '*')
        frame.contentWindow?.postMessage({ source: 'dsh-agent-rp-host', action: 'event', eventType: 'chat_id_changed', args: [String(sessionId)] }, '*')
        for (const delay of [250, 1_000, 2_500]) {
          const timer = window.setTimeout(() => {
            compatibilityMarkerTimers.current.delete(timer)
            if (failedScriptIds.current.has(entry.key) || frameRefs.current.get(entry.key) !== frame) return
            frame.contentWindow?.postMessage({
              source: 'dsh-agent-rp-host', action: 'compatibility-markers-request',
            }, '*')
          }, delay)
          compatibilityMarkerTimers.current.add(timer)
        }
        if (projectionRef.current.mvu !== undefined) {
          frame.contentWindow?.postMessage({
            source: 'dsh-agent-rp-host', action: 'event', eventType: 'mag_variable_initialized',
            args: [{ stat_data: projectionRef.current.mvu.statData }, 0],
          }, '*')
          frame.contentWindow?.postMessage({
            source: 'dsh-agent-rp-host', action: 'event', eventType: 'mag_variable_initiailized',
            args: [{ stat_data: projectionRef.current.mvu.statData }, 0],
          }, '*')
        }
        return
      }
      if (message.action === 'compatibility-markers') {
        if (failedScriptIds.current.has(entry.key)) return
        setCompatibilityMarkersByScript(current => new Map(current).set(
          entry.key,
          validatedTavernCompatibilityMarkers(message.markers),
        ))
        return
      }
      if (message.action === 'runtime-error') {
        const bootstrapTimer = scriptBootstrapTimers.current.get(entry.key)
        if (bootstrapTimer !== undefined) window.clearTimeout(bootstrapTimer)
        scriptBootstrapTimers.current.delete(entry.key)
        const detail = String(message.value)
        failedScriptIds.current.add(entry.key)
        setRuntimeErrors(current => new Map(current).set(entry.key, detail))
        setCompatibilityMarkersByScript(current => {
          if (!current.has(entry.key)) return current
          const next = new Map(current)
          next.delete(entry.key)
          return next
        })
        ctx.logger.warn(`agent-rp: Tavern Helper script ${JSON.stringify(entry.script.name)} failed: ${detail}`)
        return
      }
      if (message.action === 'toast'
        && (message.level === 'info' || message.level === 'success' || message.level === 'warning' || message.level === 'error')
        && typeof message.value === 'string' && message.value.trim() !== '' && message.value.length <= 8_000) {
        const toast: TavernToastMessage = {
          id: ++toastSequence.current,
          scriptName: entry.script.name,
          level: message.level,
          value: message.value,
        }
        setRuntimeToasts(current => [...current, toast].slice(-4))
        return
      }
      if (message.action === 'script-buttons') {
        const buttons = runtimeScriptButtons(message.buttons)
        if (buttons !== undefined) setRuntimeButtons(current => new Map(current).set(entry.key, buttons))
        return
      }
      if (message.action === 'display-override' && Number.isSafeInteger(message.messageId)
        && typeof message.value === 'string' && message.value.length <= 2 * 1024 * 1024) {
        const messageId = message.messageId as number
        if (messageId >= 0 && messageId < (projectionRef.current.tavern?.messages.length ?? 0)) {
          onDisplayOverride(entry.key, messageId, message.value)
        }
        return
      }
      if (message.action === 'status-panel-replace'
        && (message.value === null || (typeof message.value === 'string'
          && message.value.length > 0 && message.value.length <= 256 * 1024))) {
        const request: Extract<TavernHelperMutationRequest, { operation: 'replace-script-status-panel' }> = {
          format: 0,
          operation: 'replace-script-status-panel',
          scriptScope: entry.scope,
          scriptId: entry.script.id,
          html: message.value,
          ...requestCause,
        }
        mutationQueue.current = mutationQueue.current.then(() => runMutation(sessionId, request)).catch((reason: unknown) => {
          const detail = boundedAgentRpCapabilityResultError(
            'session.variables.replace', 'tavern-script-frame-v0', reason, '状态面板保存失败',
          )
          ctx.logger.warn(`agent-rp: Tavern Helper status panel ${JSON.stringify(entry.script.name)} failed: ${detail}`)
          const toast: TavernToastMessage = {
            id: ++toastSequence.current,
            scriptName: entry.script.name,
            level: 'warning',
            value: detail,
          }
          setRuntimeToasts(current => [...current, toast].slice(-4))
        })
        return
      }
      if (message.action === 'surface' && typeof message.visible === 'boolean') {
        setSurfaceScriptIds(current => {
          if (current.has(entry.key) === message.visible) return current
          const next = new Set(current)
          if (message.visible) next.add(entry.key)
          else next.delete(entry.key)
          return next
        })
        const pending = pendingButtonSurface.current
        if (message.visible && pending?.scriptKey === entry.key) {
          window.clearTimeout(pending.timer)
          pendingButtonSurface.current = undefined
          surfaceButtonIds.current.add(pending.buttonId)
          setPanelScriptId(entry.key)
          setPanelOpen(true)
        }
        return
      }
      if (message.action === 'external-script-request') {
        const origin = normalizedTavernScriptOrigin(message.origin)
        if (origin !== undefined && !approvedOrigins.has(tavernScriptOriginApprovalKey(
          characterApprovalId, presetApprovalId, entry.scope, entry.script.id, origin,
        ))) {
          setExternalScriptRequests(current => new Map(current).set(entry.key, origin))
        }
        return
      }
      if (message.action === 'external-window-delivered'
        && typeof message.requestId === 'string' && message.requestId.length <= 128) {
        externalWindowBrokers.current.get(`${entry.key}:${message.requestId}`)?.acknowledgeDelivery()
        return
      }
      if ((message.action === 'external-window-close' || message.action === 'external-window-focus')
        && typeof message.requestId === 'string' && message.requestId.length <= 128) {
        const requestKey = `${entry.key}:${message.requestId}`
        const broker = externalWindowBrokers.current.get(requestKey)
        if (message.action === 'external-window-focus') {
          broker?.focus()
          return
        }
        setExternalWindowRequests(current => {
          if (!current.has(requestKey)) return current
          const next = new Map(current)
          next.delete(requestKey)
          return next
        })
        if (broker !== undefined) {
          externalWindowBrokers.current.delete(requestKey)
          broker.close()
        } else {
          ;(event.source as Window).postMessage({
            source: 'dsh-agent-rp-host', action: 'external-window-closed', requestId: message.requestId,
          }, '*')
        }
        return
      }
      if (message.action === 'capability-request' && message.capability === 'settings.extension.persist') {
        const target = event.source as Window
        const parsed = parseTavernExtensionSettingsCapabilityRequest(message)
        if (parsed === undefined) {
          if (typeof message.requestId === 'string' && message.requestId.length <= 128) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'settings.extension.persist',
              requestId: message.requestId, ok: false, error: '酒馆扩展设置能力请求无效',
            }, '*')
          }
          return
        }
        const ownerIdentity = tavernExtensionSettingsIdentity(
          characterApprovalId, presetApprovalId, entry.scope,
        )
        void writeTavernExtensionSettings(ownerIdentity, parsed.settings).then(settings => {
          broadcastExtensionSettings(ownerIdentity, settings, target)
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'settings.extension.persist',
            requestId: parsed.requestId, ok: true,
          }, '*')
        }).catch((reason: unknown) => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'settings.extension.persist',
            requestId: parsed.requestId, ok: false,
            error: boundedAgentRpCapabilityResultError(
              'settings.extension.persist', 'tavern-script-frame-v0', reason, '酒馆扩展设置保存失败',
            ),
          }, '*')
        })
        return
      }
      if (message.action === 'capability-request' && message.capability === 'storage.script.persist') {
        const target = event.source as Window
        const parsed = parseTavernStorageCapabilityRequest(message)
        if (parsed === undefined) {
          if (typeof message.requestId === 'string' && message.requestId.length <= 128) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'storage.script.persist',
              requestId: message.requestId, ok: false, error: '持久存储能力请求无效',
            }, '*')
          }
          return
        }
        const storageOwner = tavernScriptStorageIdentity(
          characterApprovalId, presetApprovalId, entry.scope, entry.script.id,
        )
        void executeTavernStorageRequest(storageOwner, parsed.request).then(value => {
          if (!validTavernStorageCapabilityResult(value)) throw new Error('持久存储结果超过安全限制')
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'storage.script.persist',
            requestId: parsed.requestId, ok: true, value,
          }, '*')
        }).catch((reason: unknown) => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'storage.script.persist',
            requestId: parsed.requestId, ok: false,
            error: boundedAgentRpCapabilityResultError(
              'storage.script.persist', 'tavern-script-frame-v0', reason, '持久存储操作失败',
            ),
          }, '*')
        })
        return
      }
      if (message.action === 'capability-request' && message.capability === 'ui.popup.open') {
        const target = event.source as Window
        const parsed = parseTavernPopupCapabilityRequest(message)
        if (parsed === undefined) {
          if (typeof message.requestId === 'string' && message.requestId.length <= 128) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.popup.open',
              requestId: message.requestId, ok: false, error: '弹窗能力请求无效',
            }, '*')
          }
          return
        }
        const request: TavernPopupRequest = {
          key: `${entry.key}:${parsed.requestId}`,
          target,
          requestId: parsed.requestId,
          scriptName: entry.script.name,
          type: parsed.type,
          content: parsed.content,
          inputValue: parsed.inputValue,
          options: parsed.options,
        }
        setPopupRequests(current => {
          if (current.some(candidate => candidate.key === request.key)) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.popup.open',
              requestId: request.requestId, ok: false, error: '弹窗请求标识重复',
            }, '*')
            return current
          }
          if (current.length >= 20) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.popup.open',
              requestId: request.requestId, ok: false, error: '等待处理的酒馆脚本弹窗过多',
            }, '*')
            return current
          }
          return [...current, request]
        })
        return
      }
      if (message.action === 'capability-request' && message.capability === 'ui.external-window.open') {
        const target = event.source as Window
        const parsed = parseTavernExternalWindowCapabilityRequest(message)
        if (parsed === undefined) {
          if (typeof message.requestId === 'string' && message.requestId.length <= 128) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.external-window.open',
              requestId: message.requestId, ok: false, error: '外部窗口能力请求无效',
            }, '*')
          }
          return
        }
        const request: TavernExternalWindowRequest = {
          key: `${entry.key}:${parsed.requestId}`,
          scriptKey: entry.key,
          target,
          requestId: parsed.requestId,
          scriptName: entry.script.name,
          url: parsed.url,
          hostname: new URL(parsed.url).hostname,
        }
        setExternalWindowRequests(current => {
          return enqueueExternalWindowRequest(current, externalWindowBrokers.current, request)
        })
        setPermissionOpen(true)
        return
      }
      if (message.action === 'capability-request' && message.capability === 'identity.native.attest') {
        const target = event.source as Window
        const parsed = parseTavernNativeIdentityCapabilityRequest(message)
        if (parsed === undefined) {
          if (typeof message.requestId === 'string' && message.requestId.length <= 128) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'identity.native.attest',
              requestId: message.requestId, ok: false, error: '本机身份能力请求无效',
            }, '*')
          }
          return
        }
        const application = JSON.stringify([
          'tavern-script', characterApprovalId, presetApprovalId ?? null, entry.scope, entry.script.id,
        ])
        const approval = nativeIdentityApprovalKey(application, parsed.audience, parsed.includeDisplayName)
        const request: NativeIdentityRuntimeRequest = {
          key: `${entry.key}:${parsed.requestId}`,
          target,
          runtime: 'tavern-script-frame-v0',
          requestId: parsed.requestId,
          application,
          applicationName: entry.script.name || '酒馆脚本',
          audience: parsed.audience,
          nonce: parsed.nonce,
          includeDisplayName: parsed.includeDisplayName,
          scriptKey: entry.key,
        }
        if (approvedNativeIdentities.has(approval)) {
          void deliverNativeIdentityResult(request, target)
          return
        }
        setNativeIdentityRequests(current => {
          if (current.has(request.key)) return current
          if (current.size >= 8) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'identity.native.attest',
              requestId: request.requestId, ok: false, error: '等待确认的本机身份请求过多',
            }, '*')
            return current
          }
          return new Map(current).set(request.key, request)
        })
        setPermissionOpen(true)
        return
      }
      if (message.action === 'generation-cancel' && typeof message.generationId === 'string') {
        cancelGenerations(entry.key, event.source as Window, message.generationId)
        return
      }
      if (message.action === 'generation-cancel-all') {
        cancelGenerations(entry.key, event.source as Window)
        return
      }
      if (message.action === 'generation-preview' && typeof message.requestId === 'string'
        && (message.mode === 'preset' || message.mode === 'raw')
        && typeof message.config === 'object' && message.config !== null && !Array.isArray(message.config)) {
        executePromptPreview(
          entry.key,
          event.source as Window,
          message.requestId,
          message.mode,
          message.config as Readonly<Record<string, unknown>>,
        )
        return
      }
      if (message.action === 'generate' && typeof message.requestId === 'string'
        && (message.mode === 'preset' || message.mode === 'raw')
        && typeof message.config === 'object' && message.config !== null && !Array.isArray(message.config)) {
        const target = event.source as Window
        const config = message.config as Readonly<Record<string, unknown>>
        const request: QueuedTavernGeneration = {
          target,
          requestId: message.requestId,
          mode: message.mode,
          config,
          ...(typeof config.generation_id === 'string' ? { generationId: config.generation_id } : {}),
        }
        const customApi = request.config.custom_api
        if (customApi !== undefined) {
          if (typeof customApi !== 'object' || customApi === null || Array.isArray(customApi)) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'generation-result', requestId: request.requestId,
              ok: false, error: 'custom_api 必须是对象',
            }, '*')
            return
          }
          const apiurl = (customApi as Readonly<Record<string, unknown>>).apiurl
          const origin = normalizedTavernModelOrigin(apiurl)
          if (origin === undefined) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'generation-result', requestId: request.requestId,
              ok: false, error: typeof apiurl === 'string' ? 'API 地址只支持 HTTP 或 HTTPS' : 'custom_api.apiurl 不能为空',
            }, '*')
            return
          }
          const approvalKey = customGenerationApprovalKey(entry.key, origin)
          if (approvedCustomGenerations.has(approvalKey)) {
            executeGeneration(entry.key, target, request.requestId, request.mode, request.config)
          } else {
            const queued = customGenerationQueue.current.get(approvalKey) ?? []
            queued.push(request)
            customGenerationQueue.current.set(approvalKey, queued)
            setCustomGenerationRequests(current => new Map(current).set(approvalKey, {
              scriptKey: entry.key, origin, count: queued.length,
            }))
          }
          return
        }
        if (approvedGenerations.has(generationApprovalKey(entry.key))) {
          executeGeneration(entry.key, target, request.requestId, request.mode, request.config)
        } else {
          const queued = generationQueue.current.get(entry.key) ?? []
          queued.push(request)
          generationQueue.current.set(entry.key, queued)
          setGenerationRequests(current => new Map(current).set(entry.key, queued.length))
        }
        return
      }
      if (message.action === 'model-list' && typeof message.requestId === 'string'
        && typeof message.apiurl === 'string' && message.apiurl.length <= 2_048
        && (message.key === undefined || (typeof message.key === 'string' && message.key.length <= 8_192))) {
        const target = event.source as Window
        const origin = normalizedTavernModelOrigin(message.apiurl)
        if (origin === undefined) {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'model-list-result', requestId: message.requestId,
            ok: false, error: 'API 地址只支持 HTTP 或 HTTPS',
          }, '*')
          return
        }
        const approvalKey = modelApprovalKey(entry.key, origin)
        const request = {
          target,
          requestId: message.requestId,
          apiurl: message.apiurl,
          ...(message.key === undefined ? {} : { key: message.key }),
        }
        if (approvedModels.has(approvalKey)) {
          executeModelList(target, request.requestId, request.apiurl, request.key)
        } else {
          const queued = modelListQueue.current.get(approvalKey) ?? []
          queued.push(request)
          modelListQueue.current.set(approvalKey, queued)
          setModelListRequests(current => new Map(current).set(approvalKey, {
            scriptKey: entry.key, origin, count: queued.length,
          }))
        }
        return
      }
      if (message.action === 'event-emit' && typeof message.eventType === 'string' && Array.isArray(message.args)) {
        broadcast({
          action: 'event', eventType: message.eventType, args: message.args,
          ...(cause === undefined ? {} : { mutationCause: cause }),
        }, event.source as Window)
        return
      }
      if (message.action === 'injections-replace' && typeof message.requestId === 'string'
        && Array.isArray(message.prompts)) {
        const target = event.source as Window
        const request: Extract<TavernHelperMutationRequest, { operation: 'replace-script-injections' }> = {
          format: 0,
          operation: 'replace-script-injections',
          scriptScope: entry.scope,
          scriptId: entry.script.id,
          prompts: message.prompts as Extract<TavernHelperMutationRequest, {
            operation: 'replace-script-injections'
          }>['prompts'],
          ...requestCause,
        }
        mutationQueue.current = mutationQueue.current.then(() => runMutation(sessionId, request)).then(() => {
          target.postMessage({ source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: true }, '*')
        }).catch((reason: unknown) => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: false,
            error: boundedAgentRpCapabilityResultError(
              'prompt-injection.session.replace', 'tavern-script-frame-v0', reason, '提示保存失败',
            ),
          }, '*')
        })
        return
      }
      if (message.action === 'trigger-slash' && typeof message.requestId === 'string'
        && typeof message.value === 'string' && message.value.length <= 65_536) {
        const target = event.source as Window
        const resolve = (): void => {
          target.postMessage({ source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: true }, '*')
        }
        const reject = (reason: unknown): void => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: false,
            error: reason instanceof Error ? reason.message : String(reason),
          }, '*')
        }
        const command = parseTavernSlashCommand(message.value)
        if (command?.kind === 'set-input' && !command.trigger) {
          inputActions.setDraft(command.text)
          resolve()
          return
        }
        if (command?.kind === 'send' || command?.kind === 'set-input') {
          const scoped = ctx.sessions.scope(sessionId)
          const conversation = scoped?.get('conversation') as IConversation | undefined
          if (conversation === undefined) reject(new Error('当前角色会话尚未准备好发送消息'))
          else void mutationQueue.current.then(() => conversation.send(command.text)).then(resolve, reject)
          return
        }
        if (command?.kind === 'trigger') {
          void mutationQueue.current.then(() => runTrigger(sessionId)).then(resolve, reject)
          return
        }
        const visibility = message.value.match(/^\/(hide|unhide)\s+(\d+)(?:-(\d+))?\s*$/iu)
        if (visibility?.[1] !== undefined && visibility[2] !== undefined) {
          const start = Number(visibility[2])
          const end = Number(visibility[3] ?? visibility[2])
          const request: TavernHelperMutationRequest = {
            format: 0,
            operation: 'set-chat-hidden',
            start: Math.min(start, end),
            end: Math.max(start, end),
            hidden: visibility[1].toLowerCase() === 'hide',
            ...requestCause,
          }
          mutationQueue.current = mutationQueue.current.then(() => runMutation(sessionId, request)).then(resolve, reject)
          return
        }
        reject(new Error(`当前不支持酒馆命令：${message.value.split(/\s/u, 1)[0] ?? message.value}`))
        return
      }
      if (message.action === 'preset-replace' && typeof message.requestId === 'string') {
        const target = event.source as Window
        mutationQueue.current = mutationQueue.current.then(async () => {
          const revision = presetRevisionRef.current
          const request = tavernPresetConfiguration(projectionRef.current, message.preset, revision)
          await runPresetConfiguration(sessionId, request)
          presetRevisionRef.current = revision + 1
          const current = currentTavernPreset(projectionRef.current)
          broadcast({
            action: 'preset-sync',
            preset: current === undefined ? undefined : {
              ...current,
              revision: presetRevisionRef.current,
              value: message.preset,
            },
          }, target)
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'preset-result', requestId: message.requestId, ok: true,
          }, '*')
        }).catch((reason: unknown) => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'preset-result', requestId: message.requestId, ok: false,
            error: reason instanceof Error ? reason.message : String(reason),
          }, '*')
        })
        return
      }
      if ((message.action === 'worldbook-mutate' || message.action === 'chat-mutate') && typeof message.requestId === 'string') {
        const target = event.source as Window
        if (!tavernMutationMatchesCapability(message.action, message.request)) {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: false,
            error: message.action === 'worldbook-mutate'
              ? boundedAgentRpCapabilityResultError(
                  'world-info.session.mutate', 'tavern-script-frame-v0', '世界书操作不受支持', '世界书保存失败',
                )
              : boundedAgentRpCapabilityResultError(
                  'chat.session.mutate', 'tavern-script-frame-v0', '聊天操作不受支持', '聊天保存失败',
                ),
          }, '*')
          return
        }
        const rawRequest = message.request as TavernHelperMutationRequest
        const request = {
          ...rawRequest,
          ...('operation' in rawRequest && rawRequest.operation === 'replace-message-annotations'
            ? { owner: { scriptScope: entry.scope, scriptId: entry.script.id } }
            : {}),
          ...requestCause,
        } as TavernHelperMutationRequest
        mutationQueue.current = mutationQueue.current.then(() => runMutation(sessionId, request)).then(() => {
          target.postMessage({ source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: true }, '*')
        }).catch((reason: unknown) => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: false,
            error: message.action === 'worldbook-mutate'
              ? boundedAgentRpCapabilityResultError(
                  'world-info.session.mutate', 'tavern-script-frame-v0', reason, '世界书保存失败',
                )
              : boundedAgentRpCapabilityResultError(
                  'chat.session.mutate', 'tavern-script-frame-v0', reason, '聊天保存失败',
                ),
          }, '*')
        })
        return
      }
      if (message.action !== 'variables-replace' || typeof message.requestId !== 'string'
        || (message.scope !== 'global' && message.scope !== 'preset' && message.scope !== 'character'
          && message.scope !== 'chat' && message.scope !== 'message' && message.scope !== 'script')
        || typeof message.variables !== 'object' || message.variables === null || Array.isArray(message.variables)) return
      const target = event.source as Window
      const variables = message.variables as Record<string, JsonValue>
      const request: TavernHelperMutationRequest = message.scope === 'script'
        ? {
            format: 0, scope: 'script', scriptScope: entry.scope, scriptId: entry.script.id, variables,
            ...requestCause,
          }
        : { format: 0, scope: message.scope, variables, ...requestCause }
      mutationQueue.current = mutationQueue.current.then(() => runMutation(sessionId, request)).then(() => {
        target.postMessage({ source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: true }, '*')
      }).catch((reason: unknown) => {
        target.postMessage({
          source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: false,
          error: boundedAgentRpCapabilityResultError(
            'session.variables.replace', 'tavern-script-frame-v0', reason, '变量保存失败',
          ),
        }, '*')
      })
    }
    window.addEventListener('message', bridge)
    return () => { window.removeEventListener('message', bridge) }
  }, [approvedCustomGenerations, approvedGenerations, approvedModels, approvedNativeIdentities, inputActions,
    onDisplayOverride, runGeneration, runModelList, runMutation, runPresetConfiguration, runPromptPreview, runTrigger,
    sessionId])
  useEffect(() => {
    const pending = pendingCompatibilitySurface.current
    if (!panelOpen || pending === undefined || panelScriptId !== pending.scriptKey) return
    const frame = frameRefs.current.get(pending.scriptKey)
    if (frame === undefined) return
    const animation = window.requestAnimationFrame(() => {
      pendingCompatibilitySurface.current = undefined
      frame.contentWindow?.postMessage({
        source: 'dsh-agent-rp-host', action: 'compatibility-surface-open', surface: pending.surface,
      }, '*')
    })
    return () => { window.cancelAnimationFrame(animation) }
  }, [panelOpen, panelScriptId])
  const failures = frames.flatMap(entry => {
    const error = entry.error ?? runtimeErrors.get(entry.key)
    return error === undefined ? [] : [{ script: entry.script, error }]
  })
  const buttons = scopedScripts.flatMap(entry => entry.script.buttonEnabled
    ? (runtimeButtons.get(entry.key) ?? entry.script.buttons).filter(button => button.visible).map(button => ({ entry, button }))
    : [])
  const isMobileFrame = (entry: TavernScriptFrame): boolean => entry.compatibilityMarkers?.includes('__小手机脚本_loaded__') === true
    || compatibilityMarkersByScript.get(entry.key)?.includes('__小手机脚本_loaded__') === true
  const panelFrames = frames.filter(entry => entry.src !== undefined
    && (surfaceScriptIds.has(entry.key) || isMobileFrame(entry)))
  const mobileFrame = panelFrames.find(isMobileFrame)
  const activePanelScriptId = panelFrames.some(entry => entry.key === panelScriptId)
    ? panelScriptId
    : panelFrames[0]?.key
  const activePanelFrame = panelFrames.find(entry => entry.key === activePanelScriptId)
  const panelSurfaceState = !panelOpen ? 'closed' : activePanelFrame !== undefined && isMobileFrame(activePanelFrame)
    ? 'mobile'
    : 'script'
  const activePopup = popupRequests[0]
  const permissionActionStyle = {
    background: 'transparent', border: '1px solid var(--dsw-alias-state-warning, #9f7934)', borderRadius: '9px',
    color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', lineHeight: 1.45, padding: '9px 11px',
    textAlign: 'left', width: '100%',
  } as const
  const frameByScriptKey = new Map(frames.map(frame => [frame.key, frame] as const))
  const runtimeResourcePermissions = pendingTavernScriptResourcePermissions({
    characterId: characterApprovalId,
    ...(presetApprovalId === undefined ? {} : { presetId: presetApprovalId }),
    entries: scopedScripts.map(entry => {
      const frame = frameByScriptKey.get(entry.key)
      const requestedOrigin = externalScriptRequests.get(entry.key)
      return {
        scope: entry.scope,
        scriptId: entry.script.id,
        scriptOrigins: requestedOrigin === undefined ? [] : [requestedOrigin],
        imageOrigins: frame?.remoteImageOrigins ?? [],
        styleOrigins: frame?.remoteStyleOrigins ?? [],
        fontOrigins: (blockedResourcesByScript.get(entry.key) ?? [])
          .filter(resource => resource.type === 'font').map(resource => resource.origin),
        frameOrigins: frame?.remoteFrameOrigins ?? [],
      }
    }),
    approvedScripts: approvedOrigins,
    approvedImages,
    approvedStyles,
    approvedFonts,
    approvedFrames,
    trustedScriptOrigins: BUILT_IN_TAVERN_SCRIPT_ORIGINS,
  })
  const approveRuntimeResource = (permission: typeof runtimeResourcePermissions[number]): void => {
    if (permission.kind === 'script') {
      const next = new Set(approvedOrigins)
      next.add(permission.approvalKey)
      writeApprovedTavernScriptOrigins(next)
      setApprovedOrigins(next)
      return
    }
    if (permission.kind === 'image') {
      const next = new Set(approvedImages)
      next.add(permission.approvalKey)
      writeApprovedTavernScriptImages(next)
      setApprovedImages(next)
      return
    }
    if (permission.kind === 'style') {
      const next = new Set(approvedStyles)
      next.add(permission.approvalKey)
      writeApprovedTavernScriptStyles(next)
      setApprovedStyles(next)
      return
    }
    if (permission.kind === 'font') {
      const next = new Set(approvedFonts)
      next.add(permission.approvalKey)
      writeApprovedTavernScriptFonts(next)
      setApprovedFonts(next)
      return
    }
    const next = new Set(approvedFrames)
    next.add(permission.approvalKey)
    writeApprovedTavernScriptFrames(next)
    setApprovedFrames(next)
  }
  const runtimePermissions = tavernPermissionPlan<TavernRuntimePermissionRequest>([
    ...runtimeResourcePermissions.map(resource => ({
      kind: resource.kind,
      key: resource.approvalKey,
      resource,
    })),
    ...[...nativeIdentityRequests.values()].map(request => ({
      kind: 'identity' as const,
      key: request.key,
      request,
    })),
    ...[...externalWindowRequests.values()].map(request => ({
      kind: 'external-window' as const,
      key: request.key,
      request,
    })),
    ...[...generationRequests].map(([scriptKey, count]) => ({
      kind: 'generation' as const,
      key: generationApprovalKey(scriptKey),
      scriptKey,
      count,
    })),
    ...[...customGenerationRequests].map(([approvalKey, request]) => ({
      kind: 'custom-generation' as const,
      key: approvalKey,
      approvalKey,
      request,
    })),
    ...[...modelListRequests].map(([approvalKey, request]) => ({
      kind: 'model-list' as const,
      key: approvalKey,
      approvalKey,
      request,
    })),
  ])
  const permissionSummary = summarizeTavernPermissionPlan(runtimePermissions)
  const renderPermissionAction = (permission: typeof runtimePermissions[number]) => {
    switch (permission.kind) {
      case 'script':
      case 'image':
      case 'style':
      case 'font':
      case 'frame': {
        const resourcePermission = permission.resource
        const entry = scopedScriptByKey.get(tavernScriptIdentity(
          resourcePermission.scope, resourcePermission.scriptId,
        ))
        const action = resourcePermission.kind === 'script' ? '加载'
          : resourcePermission.kind === 'image' ? '显示'
            : resourcePermission.kind === 'style' ? '使用'
              : resourcePermission.kind === 'font' ? '加载' : '嵌入'
        const resource = resourcePermission.kind === 'script' ? '脚本'
          : resourcePermission.kind === 'image' ? '图片'
            : resourcePermission.kind === 'style' ? '样式'
              : resourcePermission.kind === 'font' ? '字体' : ''
        const title = resourcePermission.kind === 'script'
          ? `允许隔离脚本从 ${resourcePermission.origin} 加载 JavaScript`
          : resourcePermission.kind === 'image'
            ? `允许这个隔离脚本显示来自 ${resourcePermission.origin} 的图片；不会开放脚本网络请求`
            : resourcePermission.kind === 'style'
              ? `允许这个隔离脚本使用来自 ${resourcePermission.origin} 的样式；不会同时开放字体、图片或脚本`
              : resourcePermission.kind === 'font'
                ? `允许这个隔离脚本加载来自 ${resourcePermission.origin} 的字体；不会开放样式、图片或脚本`
              : `允许这个隔离脚本嵌入 ${resourcePermission.origin}；远端页面保留自己的 HTTPS 来源和存储`
        return <button type="button" key={`${permission.kind}:${permission.key}`}
          data-agent-rp-permission-kind={permission.kind} data-agent-rp-permission-lifecycle={permission.lifecycle}
          title={title} onClick={() => { approveRuntimeResource(resourcePermission) }} style={permissionActionStyle}>
          允许 {entry?.script.name || '脚本'} {action} {new URL(resourcePermission.origin).hostname}
          {resource === '' ? '' : ` ${resource}`}
        </button>
      }
      case 'identity': {
        const { request } = permission
        const approval = nativeIdentityApprovalKey(
          request.application, request.audience, request.includeDisplayName,
        )
        return <button type="button" key={`${permission.kind}:${permission.key}`}
          data-agent-rp-permission-kind={permission.kind} data-agent-rp-permission-lifecycle={permission.lifecycle}
          disabled={nativeIdentityState !== 'ready'}
          title={nativeIdentityState === 'ready'
            ? `允许这个隔离脚本向 ${request.audience} 出示五分钟有效的 DSH 本机身份证明；私钥不会离开 Host`
            : '请先在 DSH 设置的 Agent RP 页面创建本机身份'}
          onClick={() => {
            const next = new Set(approvedNativeIdentities)
            next.add(approval)
            writeApprovedNativeIdentities(next)
            setApprovedNativeIdentities(next)
            setNativeIdentityRequests(current => {
              const remaining = new Map(current)
              remaining.delete(request.key)
              return remaining
            })
            const target = request.scriptKey === undefined
              ? request.target : frameRefs.current.get(request.scriptKey)?.contentWindow ?? request.target
            void deliverNativeIdentityResult(request, target)
          }} style={{ ...permissionActionStyle, cursor: nativeIdentityState === 'ready' ? 'pointer' : 'not-allowed',
            opacity: nativeIdentityState === 'ready' ? 1 : .55 }}>允许 {request.applicationName} 向 {new URL(request.audience).hostname}
            证明本机身份{request.includeDisplayName ? '并分享显示名称' : ''}</button>
      }
      case 'external-window': {
        const { request } = permission
        return <button type="button" key={`${permission.kind}:${permission.key}`}
          data-agent-rp-permission-kind={permission.kind} data-agent-rp-permission-lifecycle={permission.lifecycle}
          title={`打开只连接 ${request.hostname} 的隔离登录面板`} onClick={() => {
            const broker = openExternalWindowBroker({
              hostWindow: window,
              url: request.url,
              hostname: request.hostname,
              requesterName: request.scriptName,
              runtime: 'tavern-script-frame-v0',
              requestId: request.requestId,
              resolveTarget: () => frameRefs.current.get(request.scriptKey)?.contentWindow,
              onClosed: () => {
                externalWindowBrokers.current.delete(request.key)
                const target = frameRefs.current.get(request.scriptKey)?.contentWindow ?? request.target
                target.postMessage({
                  source: 'dsh-agent-rp-host', action: 'external-window-closed', requestId: request.requestId,
                }, '*')
              },
              onStateChange: state => { setExternalWindowPhase(state.phase) },
            })
            setExternalWindowRequests(current => {
              const next = new Map(current)
              next.delete(request.key)
              return next
            })
            if (broker === undefined) {
              request.target.postMessage({
                source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.external-window.open',
                requestId: request.requestId, ok: false, error: '无法创建外部登录隔离面板',
              }, '*')
              return
            }
            externalWindowBrokers.current.set(request.key, broker)
            request.target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.external-window.open',
              requestId: request.requestId, ok: true,
            }, '*')
            setPermissionOpen(false)
          }} style={permissionActionStyle}>打开 {request.hostname} 登录页（{request.scriptName || '酒馆脚本'}）</button>
      }
      case 'generation': {
        const script = scopedScriptByKey.get(permission.scriptKey)?.script
        return <button type="button" key={`${permission.kind}:${permission.key}`}
          data-agent-rp-permission-kind={permission.kind} data-agent-rp-permission-lifecycle={permission.lifecycle}
          title="允许这个隔离脚本使用当前 DSH 模型生成文本；生成会消耗模型额度" onClick={() => {
            const next = new Set(approvedGenerations)
            next.add(permission.key)
            writeApprovedTavernScriptGenerations(next)
            setApprovedGenerations(next)
            const queued = generationQueue.current.get(permission.scriptKey) ?? []
            generationQueue.current.delete(permission.scriptKey)
            setGenerationRequests(current => {
              const remaining = new Map(current)
              remaining.delete(permission.scriptKey)
              return remaining
            })
            for (const request of queued) executeGeneration(
              permission.scriptKey, request.target, request.requestId, request.mode, request.config,
            )
          }} style={permissionActionStyle}>允许 {script?.name || '脚本'} 调用模型
          {permission.count > 1 ? ` (${permission.count})` : ''}</button>
      }
      case 'custom-generation': {
        const { approvalKey, request } = permission
        const script = scopedScriptByKey.get(request.scriptKey)?.script
        return <button type="button" key={`${permission.kind}:${permission.key}`}
          data-agent-rp-permission-kind={permission.kind} data-agent-rp-permission-lifecycle={permission.lifecycle}
          title={`允许这个隔离脚本连接 ${request.origin} 并生成文本；生成会消耗该 API 的额度，密钥只转发给该地址`} onClick={() => {
            const next = new Set(approvedCustomGenerations)
            next.add(approvalKey)
            writeApprovedTavernScriptCustomGenerations(next)
            setApprovedCustomGenerations(next)
            const queued = customGenerationQueue.current.get(approvalKey) ?? []
            customGenerationQueue.current.delete(approvalKey)
            setCustomGenerationRequests(current => {
              const remaining = new Map(current)
              remaining.delete(approvalKey)
              return remaining
            })
            for (const item of queued) executeGeneration(
              request.scriptKey, item.target, item.requestId, item.mode, item.config,
            )
          }} style={permissionActionStyle}>允许 {script?.name || '脚本'} 使用 {new URL(request.origin).hostname} 生成
          {request.count > 1 ? ` (${request.count})` : ''}</button>
      }
      case 'model-list': {
        const { approvalKey, request } = permission
        const script = scopedScriptByKey.get(request.scriptKey)?.script
        return <button type="button" key={`${permission.kind}:${permission.key}`}
          data-agent-rp-permission-kind={permission.kind} data-agent-rp-permission-lifecycle={permission.lifecycle}
          title={`允许这个隔离脚本连接 ${request.origin} 并读取模型名称；API 密钥只转发给该地址`} onClick={() => {
            const next = new Set(approvedModels)
            next.add(approvalKey)
            writeApprovedTavernScriptModels(next)
            setApprovedModels(next)
            const queued = modelListQueue.current.get(approvalKey) ?? []
            modelListQueue.current.delete(approvalKey)
            setModelListRequests(current => {
              const remaining = new Map(current)
              remaining.delete(approvalKey)
              return remaining
            })
            for (const item of queued) executeModelList(item.target, item.requestId, item.apiurl, item.key)
          }} style={permissionActionStyle}>允许 {script?.name || '脚本'} 读取 {new URL(request.origin).hostname} 模型
          {request.count > 1 ? ` (${request.count})` : ''}</button>
      }
    }
  }
  const startupPermissionActions = runtimePermissions
    .filter(permission => permission.lifecycle === 'startup').map(renderPermissionAction)
  const interactionPermissionActions = runtimePermissions
    .filter(permission => permission.lifecycle === 'interaction').map(renderPermissionAction)
  const scriptPhases = new Map(frames.map(entry => [entry.key, tavernScriptRuntimePhase({
    hasDocument: entry.src !== undefined,
    permissionRequired: entry.requestedOrigin !== undefined,
    loadError: entry.error !== undefined,
    ready: readyScriptIds.has(entry.key),
    runtimeError: runtimeErrors.has(entry.key),
  })]))
  const readyScriptCount = [...scriptPhases.values()].filter(phase => phase === 'ready').length
  const failedScriptCount = [...scriptPhases.values()].filter(
    phase => phase === 'load-error' || phase === 'runtime-error',
  ).length
  const localScriptStatuses = frames.map(entry => {
    const error = entry.error ?? runtimeErrors.get(entry.key)
    return {
      key: entry.key,
      name: entry.script.name,
      scope: entry.scope,
      phase: scriptPhases.get(entry.key) ?? 'preparing',
      ...(error === undefined ? {} : { error }),
    }
  })
  const scriptPlanReady = scripts.length === 0 || (scriptPhases.size === scripts.length
    && [...scriptPhases.values()].every(phase => phase !== 'preparing'))
  const scriptRuntimeSettled = permissionSummary.startup === 0
    && readyScriptCount + failedScriptCount >= scripts.length
  const navigationTiming = tavernStartupRange(scriptStartupTimings.current, 'navigation')
  const bootstrapTiming = tavernStartupRange(scriptStartupTimings.current, 'bootstrap')
  const runtimeTiming = tavernStartupRange(scriptStartupTimings.current, 'runtime')
  const scriptTiming = tavernStartupRange(scriptStartupTimings.current, 'script')
  const programDuration = tavernDurationRange(scriptStartupTimings.current, 'programDuration')
  const executionDuration = tavernDurationRange(scriptStartupTimings.current, 'executionDuration')
  useEffect(() => {
    setStartupTiming(current => {
      const elapsed = elapsedStartupMilliseconds(runtimeStartedAt.current)
      const next = {
        ...current,
        ...(current.planMs === undefined && scriptPlanReady ? { planMs: elapsed } : {}),
        ...(current.firstReadyMs === undefined && (readyScriptCount > 0 || scripts.length === 0)
          ? { firstReadyMs: elapsed } : {}),
        ...(current.settledMs === undefined && scriptRuntimeSettled ? { settledMs: elapsed } : {}),
      }
      return next.planMs === current.planMs && next.firstReadyMs === current.firstReadyMs
        && next.settledMs === current.settledMs ? current : next
    })
  }, [readyScriptCount, scriptPlanReady, scriptRuntimeSettled, scripts.length])
  const queuedGenerationCount = [...generationRequests.values()].reduce((total, count) => total + count, 0)
    + [...customGenerationRequests.values()].reduce((total, value) => total + value.count, 0)
  const queuedModelListCount = [...modelListRequests.values()].reduce((total, value) => total + value.count, 0)
  const blockedResources = [...blockedResourcesByScript.values()].flat()
  const blockedResourceCounts = (['connect', 'font', 'frame', 'image', 'media', 'script', 'style'] as const)
    .map(type => [type, blockedResources.filter(resource => resource.type === type).length] as const)
  useAgentRpRuntimeDiagnosticContribution(runtimeDiagnostics, 'tavern-runtime', {
    kind: 'tavern',
    scope: String(sessionId),
    facts: {
      scripts: scripts.length,
      frames: frames.length,
      ready: readyScriptCount,
      failed: failedScriptCount,
      pendingPermissions: permissionSummary.total,
      startupPermissions: permissionSummary.startup,
      interactionPermissions: permissionSummary.interaction,
      permissionState: permissionSummary.state,
      permissions: {
        script: permissionSummary.counts.script,
        image: permissionSummary.counts.image,
        style: permissionSummary.counts.style,
        font: permissionSummary.counts.font,
        frame: permissionSummary.counts.frame,
        identity: permissionSummary.counts.identity,
        externalWindow: permissionSummary.counts['external-window'],
        generation: permissionSummary.counts.generation,
        customGeneration: permissionSummary.counts['custom-generation'],
        modelList: permissionSummary.counts['model-list'],
      },
      queuedGenerations: queuedGenerationCount,
      queuedModelLists: queuedModelListCount,
      blockedResources: blockedResources.length,
      blockedResourceOrigins: new Set(blockedResources.map(resource => resource.origin)).size,
      blockedResourceClasses: blockedResources.map(resource => resource.type),
      phases: [...scriptPhases.values()],
      scopes: frames.map(entry => entry.scope),
      externalWindowPhases: externalWindowPhase === undefined ? [] : [externalWindowPhase],
      nativeIdentityPending: nativeIdentityRequests.size,
    },
  })
  if (scripts.length === 0) return null
  return <>
    {runtimeToasts.length > 0 && <div aria-live="polite" style={{
      display: 'grid', gap: '8px', position: 'fixed', right: '14px', top: '14px', width: 'min(92vw, 420px)', zIndex: 1230,
    }}>
      {runtimeToasts.map(toast => <TavernScriptToast key={toast.id} toast={toast} onClose={() => {
        setRuntimeToasts(current => current.filter(message => message.id !== toast.id))
      }} />)}
    </div>}
    {activePopup !== undefined && <TavernScriptPopup key={activePopup.key} request={activePopup} onResolve={value => {
      activePopup.target.postMessage({
        source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.popup.open',
        requestId: activePopup.requestId, ok: true, value,
      }, '*')
      setPopupRequests(current => current.filter(request => request.key !== activePopup.key))
    }} />}
    {permissionOpen && <div role="dialog" aria-modal aria-label="酒馆脚本权限"
      data-agent-rp-surface="tavern-permissions" onMouseDown={event => {
      if (event.target === event.currentTarget) setPermissionOpen(false)
    }} style={{
      alignItems: 'center', background: 'rgba(0,0,0,.72)', display: 'flex', inset: 0, justifyContent: 'center',
      padding: '18px', position: 'fixed', zIndex: 1240,
    }}><section style={{
      background: 'var(--dsw-alias-bg-base, #121318)', border: '1px solid var(--dsw-alias-border-l2, #3b3d45)',
      borderRadius: '14px', boxShadow: '0 22px 72px rgba(0,0,0,.5)', display: 'grid', gap: '12px',
      maxHeight: 'min(82vh, 720px)', maxWidth: '620px', overflow: 'auto', padding: '16px', width: 'min(92vw, 620px)',
    }}>
      <header style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
        <div style={{ flex: '1 1 auto' }}><strong style={{ display: 'block', fontSize: '14px' }}>脚本权限</strong>
          <span style={{ fontSize: '11px', opacity: .58 }}>当前角色卡 · 按脚本分别保存</span></div>
        <button type="button" aria-label="关闭脚本权限" data-agent-rp-action="close-tavern-permissions"
          onClick={() => { setPermissionOpen(false) }} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '20px', padding: '2px 6px',
        }}>×</button>
      </header>
      <p style={{ fontSize: '12px', lineHeight: 1.6, margin: 0, opacity: .7 }}>
        未允许的能力保持关闭，但不会阻止其他脚本启动。本机身份证明由 Host 签名并绑定目标来源；私钥不会交给脚本。
      </p>
      {nativeIdentityRequests.size > 0 && nativeIdentityState !== 'ready' && <p role="status" style={{
        color: 'var(--dsw-alias-state-warning, #d6a955)', fontSize: '12px', lineHeight: 1.55, margin: 0,
      }}>请先在 DSH 设置的 Agent RP 页面创建本机身份，再确认身份请求。</p>}
      {permissionSummary.total === 0
        ? <span style={{ fontSize: '12px', opacity: .62, padding: '8px 0' }}>当前没有待确认权限。</span>
        : <div style={{ display: 'grid', gap: '14px' }}>
            {startupPermissionActions.length > 0 && <section>
              <strong style={{ display: 'block', fontSize: '11px', marginBottom: '7px', opacity: .72 }}>
                启动资源 · {startupPermissionActions.length}
              </strong>
              <div style={{ display: 'grid', gap: '8px' }}>{startupPermissionActions}</div>
            </section>}
            {interactionPermissionActions.length > 0 && <section>
              <strong style={{ display: 'block', fontSize: '11px', marginBottom: '7px', opacity: .72 }}>
                操作请求 · {interactionPermissionActions.length}
              </strong>
              <div style={{ display: 'grid', gap: '8px' }}>{interactionPermissionActions}</div>
            </section>}
          </div>}
    </section></div>}
    <div className="agent-rp-tavern-script-overlay" data-agent-rp-dialog data-agent-rp-surface="tavern-panel"
      data-agent-rp-surface-state={panelSurfaceState} aria-hidden={!panelOpen}
      data-agent-rp-tavern-total={scripts.length} data-agent-rp-tavern-ready={readyScriptCount}
      data-agent-rp-tavern-failed={failedScriptCount} data-agent-rp-tavern-permissions={permissionSummary.total}
      data-agent-rp-tavern-awaiting-authorization={permissionSummary.total}
      data-agent-rp-tavern-startup-permissions={permissionSummary.startup}
      data-agent-rp-tavern-interaction-permissions={permissionSummary.interaction}
      data-agent-rp-tavern-permission-state={permissionSummary.state}
      {...(startupTiming.planMs === undefined ? {} : { 'data-agent-rp-tavern-plan-ms': startupTiming.planMs })}
      {...(startupTiming.firstReadyMs === undefined
        ? {} : { 'data-agent-rp-tavern-first-ready-ms': startupTiming.firstReadyMs })}
      {...(startupTiming.settledMs === undefined
        ? {} : { 'data-agent-rp-tavern-settled-ms': startupTiming.settledMs })}
      {...(navigationTiming.first === undefined ? {} : {
        'data-agent-rp-tavern-navigation-first-ms': navigationTiming.first,
        'data-agent-rp-tavern-navigation-last-ms': navigationTiming.last,
      })}
      {...(bootstrapTiming.first === undefined ? {} : {
        'data-agent-rp-tavern-bootstrap-first-ms': bootstrapTiming.first,
        'data-agent-rp-tavern-bootstrap-last-ms': bootstrapTiming.last,
      })}
      {...(runtimeTiming.first === undefined ? {} : {
        'data-agent-rp-tavern-runtime-first-ms': runtimeTiming.first,
        'data-agent-rp-tavern-runtime-last-ms': runtimeTiming.last,
      })}
      {...(scriptTiming.first === undefined ? {} : {
        'data-agent-rp-tavern-script-first-ms': scriptTiming.first,
        'data-agent-rp-tavern-script-last-ms': scriptTiming.last,
      })}
      {...(programDuration.minimum === undefined ? {} : {
        'data-agent-rp-tavern-program-min-ms': programDuration.minimum,
        'data-agent-rp-tavern-program-max-ms': programDuration.maximum,
      })}
      {...(executionDuration.minimum === undefined ? {} : {
        'data-agent-rp-tavern-execution-min-ms': executionDuration.minimum,
        'data-agent-rp-tavern-execution-max-ms': executionDuration.maximum,
      })}
      data-agent-rp-tavern-permission-script={permissionSummary.counts.script}
      data-agent-rp-tavern-permission-image={permissionSummary.counts.image}
      data-agent-rp-tavern-permission-style={permissionSummary.counts.style}
      data-agent-rp-tavern-permission-font={permissionSummary.counts.font}
      data-agent-rp-tavern-permission-frame={permissionSummary.counts.frame}
      data-agent-rp-tavern-permission-identity={permissionSummary.counts.identity}
      data-agent-rp-tavern-permission-external-window={permissionSummary.counts['external-window']}
      data-agent-rp-tavern-permission-generation={permissionSummary.counts.generation}
      data-agent-rp-tavern-permission-custom-generation={permissionSummary.counts['custom-generation']}
      data-agent-rp-tavern-permission-model-list={permissionSummary.counts['model-list']}
      data-agent-rp-native-identity-pending={nativeIdentityRequests.size}
      {...(externalWindowPhase === undefined ? {} : { 'data-agent-rp-external-window-phase': externalWindowPhase })}
      data-agent-rp-tavern-generation-queued={queuedGenerationCount}
      data-agent-rp-tavern-model-list-queued={queuedModelListCount}
      data-agent-rp-tavern-resource-blocked={blockedResources.length}
      data-agent-rp-tavern-resource-blocked-origins={new Set(blockedResources.map(resource => resource.origin)).size}
      {...Object.fromEntries(blockedResourceCounts.map(([type, count]) => [
        `data-agent-rp-tavern-resource-blocked-${type}`, count,
      ]))}
      {...panelOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': '酒馆脚本面板' } : {}}
      style={panelOpen ? {
        alignItems: 'center', background: 'rgba(0,0,0,.68)', display: 'flex', inset: 0,
        justifyContent: 'center', padding: '20px', position: 'fixed', zIndex: 1100,
      } : {
        height: '1px', left: '-10000px', opacity: 0, overflow: 'hidden', pointerEvents: 'none',
        position: 'fixed', top: 0, width: '1px',
      }} onMouseDown={event => { if (panelOpen && event.target === event.currentTarget) setPanelOpen(false) }}>
      <section className="agent-rp-tavern-script-dialog" style={panelOpen ? {
        background: 'var(--dsw-alias-bg-base, #111216)', border: '1px solid var(--dsw-alias-border-l2, #35373d)',
        borderRadius: '14px', boxShadow: '0 20px 64px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column',
        height: 'min(82vh, 760px)', maxWidth: '1120px', overflow: 'hidden', width: 'min(94vw, 1120px)',
      } : { display: 'contents' }}>
        {panelOpen && <header style={{ alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border-l2, #35373d)', display: 'flex', gap: '8px', padding: '10px 12px' }}>
          <strong style={{ fontSize: '13px', marginRight: '4px' }}>酒馆脚本</strong>
          <div style={{ display: 'flex', flex: '1 1 auto', gap: '6px', minWidth: 0, overflowX: 'auto' }}>
            {panelFrames.map(entry => <button type="button" key={entry.key} onClick={() => { setPanelScriptId(entry.key) }} style={{
              background: entry.key === activePanelScriptId ? 'var(--dsw-alias-bg-elevated, #2a2c32)' : 'transparent',
              border: '1px solid var(--dsw-alias-border-l2, #41434a)', borderRadius: '7px', color: 'inherit', cursor: 'pointer',
              flex: '0 0 auto', font: 'inherit', fontSize: '11px', maxWidth: '240px', overflow: 'hidden', padding: '5px 8px',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{entry.script.name || '未命名脚本'}</button>)}
          </div>
          <button type="button" aria-live="polite" title={debugEnabled
            ? '复制包含失败脚本和世界书错误详情的兼容诊断；发送前请检查内容'
            : '复制不含角色名、正文、脚本源码和 URL 的兼容诊断'} onClick={() => {
            if (navigator.clipboard === undefined) {
              setDiagnosticNotice('无法复制')
              return
            }
            setDiagnosticNotice('正在收集…')
            void loadAgentRpTurnHealth(String(sessionId)).catch(() => ({
              format: 0, status: 'unavailable',
            } as const)).then(turns => {
              const snapshot = runtimeDiagnostics.snapshot()
              const withTurns = snapshot.session === undefined ? snapshot : {
                ...snapshot,
                session: { ...snapshot.session, turns },
              }
              const snapshotWithChecks = collectAgentRpBrowserCompatibilitySnapshot(
                document,
                withTurns,
              )
              const report = serializeAgentRpCopiedDiagnostic(collectAgentRpCopiedDiagnostic(snapshotWithChecks, {
                debugEnabled,
                tavernScripts: localScriptStatuses,
                worldInfoBooks: projection.worldInfo.books,
              }))
              return navigator.clipboard.writeText(report)
            }).then(() => {
              setDiagnosticNotice('诊断已复制')
            }, () => {
              setDiagnosticNotice('复制失败')
            })
          }} style={{
            background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #41434a)', borderRadius: '7px',
            color: 'inherit', cursor: 'pointer', flex: '0 0 auto', font: 'inherit', fontSize: '11px', padding: '5px 8px',
          }}>{diagnosticNotice ?? '复制诊断'}</button>
          <span style={{ flex: '0 0 auto', fontSize: '11px', opacity: .58 }}>{readyScriptIds.size}/{scripts.length} 已启动</span>
          <button type="button" aria-label="关闭酒馆脚本面板" data-agent-rp-action="close-tavern-panel"
            onClick={() => { setPanelOpen(false) }} style={{
            background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '20px', padding: '2px 6px',
          }}>×</button>
        </header>}
        {panelOpen && <TavernScriptStatusList entries={localScriptStatuses} />}
        {frames.flatMap(entry => entry.source === undefined || entry.src === undefined ? [] : [<iframe
          key={entry.key}
          title={entry.script.name || '酒馆脚本'}
          data-agent-rp-tavern-script={entry.script.id}
          data-agent-rp-tavern-script-scope={entry.scope}
          data-agent-rp-tavern-phase={scriptPhases.get(entry.key)}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          src={entry.src}
          style={panelOpen ? {
            background: 'transparent', border: 0, display: entry.key === activePanelScriptId ? 'block' : 'none',
            flex: '1 1 auto', minHeight: 0, width: '100%',
          } : { border: 0, height: '1px', width: '1px' }}
          ref={frame => {
            if (frame === null) frameRefs.current.delete(entry.key)
            else frameRefs.current.set(entry.key, frame)
          }}
        />])}
        {panelOpen && panelFrames.length === 0 && <div style={{
          alignItems: 'center', display: 'flex', flex: '1 1 auto', justifyContent: 'center', minHeight: 0, padding: '24px',
        }}><p style={{ fontSize: '13px', margin: 0, opacity: .72 }}>这些脚本在后台运行，没有单独界面。</p></div>}
      </section>
    </div>
    {mobileFrame !== undefined && <button type="button" title="打开小手机" data-agent-rp-action="open-mobile-surface" onClick={() => {
      pendingCompatibilitySurface.current = { scriptKey: mobileFrame.key, surface: 'mobile-trigger' }
      setPanelScriptId(mobileFrame.key)
      setPanelOpen(true)
    }} style={{
      background: 'var(--dsw-alias-bg-elevated, #25272d)', border: '1px solid var(--dsw-alias-border-l2, #555)',
      borderRadius: '7px', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: '3px 8px',
    }}>小手机</button>}
    <button type="button" data-agent-rp-action="open-tavern-panel" onClick={() => { setPanelOpen(true) }}
      title="打开隔离运行的酒馆脚本界面" style={{
      background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '7px',
      color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '11px', opacity: .72, padding: '3px 7px',
    }}>脚本 {readyScriptIds.size}/{scripts.length}</button>
    {buttons.map(({ entry, button }) => <button type="button" key={`${entry.key}:${button.name}`}
      disabled={!readyScriptIds.has(entry.key) || runtimeErrors.has(entry.key)}
      title={`${entry.script.name} · ${button.name}`} onClick={() => {
        const buttonId = `${entry.key}\u0000${button.name}`
        if (surfaceButtonIds.current.has(buttonId) && surfaceScriptIds.has(entry.key)) {
          setPanelScriptId(entry.key)
          setPanelOpen(true)
        } else {
          if (pendingButtonSurface.current !== undefined) window.clearTimeout(pendingButtonSurface.current.timer)
          const timer = window.setTimeout(() => {
            if (pendingButtonSurface.current?.timer === timer) pendingButtonSurface.current = undefined
          }, 10_000)
          pendingButtonSurface.current = { scriptKey: entry.key, buttonId, timer }
        }
        frameRefs.current.get(entry.key)?.contentWindow?.postMessage({
          source: 'dsh-agent-rp-host', action: 'event', eventType: `${entry.script.id}_${button.name}`, args: [],
        }, '*')
      }} style={{
        background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #444)', borderRadius: '7px',
        color: 'inherit', cursor: readyScriptIds.has(entry.key) ? 'pointer' : 'wait', font: 'inherit',
        fontSize: '11px', opacity: readyScriptIds.has(entry.key) ? .72 : .4, padding: '3px 7px',
      }}>{button.name}</button>)}
    {permissionSummary.total > 0 && <button type="button" data-agent-rp-action="open-tavern-permissions"
      title={permissionSummary.startup > 0
        ? `${permissionSummary.startup} 项启动资源、${permissionSummary.interaction} 项操作请求待确认`
        : `${permissionSummary.interaction} 项操作请求待确认`}
      onClick={() => { setPermissionOpen(true) }} style={{
        background: 'color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 12%, transparent)',
        border: '1px solid var(--dsw-alias-state-warning, #9f7934)', borderRadius: '7px', color: 'inherit',
        cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: '3px 7px',
      }}>{permissionSummary.startup > 0 ? '启动权限' : '操作请求'} {permissionSummary.total}</button>}
    {(readyScriptIds.size < scripts.length || failures.length > 0) && <span
      title={failures.length === 0 ? '正在启动酒馆脚本' : failures.map(entry => `${entry.script.name}：${entry.error}`).join('\n')}
      style={{
      color: 'var(--dsw-alias-state-warning, #d5a64c)', fontSize: '11px', opacity: .72,
    }}>脚本 {readyScriptIds.size}/{scripts.length}</span>}
  </>
}

const chipStyle = {
  background: `color-mix(in srgb, ${color} 10%, transparent)`, borderRadius: '999px',
  color: 'inherit', fontSize: '11px', opacity: 0.76, padding: '5px 9px',
} as const

function roleplayComposerDockComponent(
  ctx: Context,
  runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry,
  workspaceSettings: WorkspaceSettingsSource,
  runImageGeneration: RunImageGeneration,
  runTavernMutation: RunTavernMutation,
  runTavernGeneration: RunTavernGeneration,
  runTavernPromptPreview: RunTavernPromptPreview,
  runTavernModelList: RunTavernModelList,
  runTavernTrigger: RunTavernTrigger,
  runPresetConfiguration: RunPresetConfiguration,
): (props: ComposerDockProps) => JSX.Element | null {
  return function RoleplayComposerDock({
    inputActions, sessionId, useChat, useProjection, useSessions, useSession,
  }: ComposerDockProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const projected = useProjection('agentRp')
  const projection = roleplaySummary(summary, projected)
  const chat = useChat(state => state)
  const agentRpSettings = useSyncExternalStore(
    workspaceSettings.subscribe,
    workspaceSettings.getSnapshot,
    workspaceSettings.getSnapshot,
  ).value
  const debugEnabled = agentRpSettings.debug.enabled
  const cardFrameRenderDepth = agentRpSettings.lightFrontend.renderDepth
  const viewMode = useRoleplayViewMode(sessionId)
  const [drawOpen, setDrawOpen] = useState(false)
  const [displayOverrides, setDisplayOverrides] = useState<ReadonlyMap<number, string>>(() => new Map())
  const [compatibilityMarkers, setCompatibilityMarkers] = useState<readonly string[]>([])
  const [cardExternalWindowRequests, setCardExternalWindowRequests] = useState<ReadonlyMap<string, CardExternalWindowRequest>>(
    () => new Map(),
  )
  const [cardExternalWindowPermissionOpen, setCardExternalWindowPermissionOpen] = useState(false)
  const [cardExternalWindowPhase, setCardExternalWindowPhase] = useState<ExternalWindowPhase>()
  const [turnHealth, setTurnHealth] = useState<AgentRpTurnHealthDiagnostic>({ format: 0, status: 'loading' })
  const [approvedCardNativeIdentities, setApprovedCardNativeIdentities] = useState(readApprovedNativeIdentities)
  const [cardNativeIdentityRequests, setCardNativeIdentityRequests] = useState<ReadonlyMap<string, NativeIdentityRuntimeRequest>>(
    () => new Map(),
  )
  const nativeIdentityState = useNativeIdentityDiagnosticState()
  const approvedCardNativeIdentitiesRef = useRef(approvedCardNativeIdentities)
  approvedCardNativeIdentitiesRef.current = approvedCardNativeIdentities
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [statusPanelHost, setStatusPanelHost] = useState<HTMLElement>()
  const cardExternalWindowBrokers = useRef(new Map<string, ExternalWindowBroker>())
  const cardFramesByTokenRef = useRef(new Map<string, HTMLIFrameElement>())
  const cardFrameDiagnosticSourcesRef = useRef(new Map<string, AgentRpRuntimeDiagnosticSource>())
  const cardFrameDiagnosticFactsRef = useRef(new Map<string, AgentRpRuntimeCardFrameFacts>())
  const storedCharacterRuntime = useCharacterDetail(projection?.avatarLibraryId)
  const storedCharacterDetail = storedCharacterRuntime?.detail
  const sessionResourcePermissions = useAgentRpSessionResourcePermissions(sessionId)
  const characterDetail = useMemo(() => storedCharacterDetail === undefined ? undefined
    : withAgentRpSessionCardPermissions(storedCharacterDetail, sessionResourcePermissions),
  [sessionResourcePermissions, storedCharacterDetail])
  const roleplayExpected = isAgentRpCapabilityPresetId(sessionAgentPreset(summary))
  const turnHealthRevision = [
    projection?.lastRequest?.eventSeq,
    projection?.presentation?.settlementSeq,
  ].map(value => value ?? -1).join(':')
  useEffect(() => {
    if (!roleplayExpected) {
      setTurnHealth({ format: 0, status: 'unavailable' })
      return
    }
    const controller = new AbortController()
    setTurnHealth({ format: 0, status: 'loading' })
    void loadAgentRpTurnHealth(String(sessionId), controller.signal).then(setTurnHealth, () => {
      if (!controller.signal.aborted) setTurnHealth({ format: 0, status: 'unavailable' })
    })
    return () => { controller.abort() }
  }, [roleplayExpected, sessionId, turnHealthRevision])
  const startupStartedAt = useMemo(() => performance.now(), [sessionId])
  const [startupTiming, setStartupTiming] = useState<{
    readonly sessionId: SessionId
    readonly projectionMs?: number
    readonly characterMs?: number
  }>(() => ({ sessionId }))
  const currentStartupTiming = startupTiming.sessionId === sessionId ? startupTiming : { sessionId }
  const waitingForCharacter = projection !== undefined && projection.avatarLibraryId !== undefined
    && (storedCharacterRuntime === undefined || storedCharacterRuntime.status === 'loading')
  const startupActive = roleplayExpected && (projection === undefined || waitingForCharacter)
  const liveStartupElapsed = useLiveStartupElapsed(startupStartedAt, startupActive)
  useEffect(() => {
    if (!roleplayExpected || projection === undefined) return
    setStartupTiming(current => {
      const value = current.sessionId === sessionId ? current : { sessionId }
      return value.projectionMs === undefined
        ? { ...value, projectionMs: elapsedStartupMilliseconds(startupStartedAt) } : value
    })
  }, [projection, roleplayExpected, sessionId, startupStartedAt])
  useEffect(() => {
    if (!roleplayExpected || projection === undefined || waitingForCharacter) return
    setStartupTiming(current => {
      const value = current.sessionId === sessionId ? current : { sessionId }
      return value.characterMs === undefined
        ? { ...value, characterMs: elapsedStartupMilliseconds(startupStartedAt) } : value
    })
  }, [projection, roleplayExpected, sessionId, startupStartedAt, waitingForCharacter])
  const startupPhase = projection === undefined ? 'projection' : waitingForCharacter ? 'character' : 'ready'
  const startupElapsed = startupActive ? liveStartupElapsed
    : currentStartupTiming.characterMs ?? currentStartupTiming.projectionMs ?? liveStartupElapsed
  const displayStateRef = useRef({
    cardFrameRenderDepth, chat, characterDetail, compatibilityMarkers, displayOverrides,
    characterStatus: storedCharacterRuntime?.status,
    displayRegexScripts: storedCharacterRuntime?.displayRegexScripts, projection, viewMode,
  })
  const scanDisplayRef = useRef<() => void>(() => undefined)
  displayStateRef.current = {
    cardFrameRenderDepth, chat, characterDetail, compatibilityMarkers, displayOverrides,
    characterStatus: storedCharacterRuntime?.status,
    displayRegexScripts: storedCharacterRuntime?.displayRegexScripts, projection, viewMode,
  }
  const backgroundChoice = useRoleplayBackground(sessionId)
  const background = selectedBackground(characterDetail, backgroundChoice)
  const displayName = projection === undefined ? undefined : roleplayDisplayName(summary, projection)
  const placeholder = displayName === undefined ? undefined : '写下你的回应…'
  const transcriptSignature = projection?.tavern?.messages.map(message => `${message.seq}\u0000${message.text}`).join('\u0001')
  const onDisplayOverride = useCallback((_scriptId: string, messageId: number, value: string): void => {
    setDisplayOverrides(current => new Map(current).set(messageId, value))
  }, [])
  const onCompatibilityMarkersChange = useCallback((markers: readonly string[]): void => {
    setCompatibilityMarkers(current => current.length === markers.length
      && current.every((marker, index) => marker === markers[index]) ? current : [...markers])
  }, [])
  useEffect(() => { setDisplayOverrides(new Map()) }, [sessionId, transcriptSignature])
  useEffect(() => { setCompatibilityMarkers([]) }, [sessionId])
  useEffect(() => {
    const sync = (): void => { setApprovedCardNativeIdentities(readApprovedNativeIdentities()) }
    window.addEventListener(nativeIdentityApprovalsChangedEvent, sync)
    return () => { window.removeEventListener(nativeIdentityApprovalsChangedEvent, sync) }
  }, [])
  useEffect(() => {
    const clearCardFrameDiagnostics = (): void => {
      for (const source of cardFrameDiagnosticSourcesRef.current.values()) runtimeDiagnostics.remove(source)
      cardFrameDiagnosticSourcesRef.current.clear()
      cardFrameDiagnosticFactsRef.current.clear()
    }
    clearCardFrameDiagnostics()
    setCardExternalWindowRequests(new Map())
    setCardNativeIdentityRequests(new Map())
    setCardExternalWindowPermissionOpen(false)
    cardFramesByTokenRef.current.clear()
    return () => {
      clearCardFrameDiagnostics()
      for (const broker of cardExternalWindowBrokers.current.values()) broker.close()
      cardExternalWindowBrokers.current.clear()
    }
  }, [runtimeDiagnostics, sessionId])
  useLayoutEffect(() => {
    const dock = rootRef.current?.closest<HTMLElement>('[data-slot="conversation.composer.dock"]')
    const inputRoot = dock?.parentElement
    if (dock == null || inputRoot == null) return
    const host = document.createElement('div')
    host.dataset.agentRpStatusPanelDock = 'true'
    host.style.cssText = 'box-sizing:border-box;min-width:0;padding:0 0 8px;width:100%;'
    const card = inputRoot.querySelector<HTMLElement>('[data-composer-card]')
    inputRoot.insertBefore(host, card ?? dock)
    setStatusPanelHost(host)
    return () => {
      setStatusPanelHost(current => current === host ? undefined : current)
      host.remove()
    }
  }, [sessionId])
  useLayoutEffect(() => {
    const scroll = rootRef.current?.closest<HTMLElement>('[data-conversation-scroll]')
    if (scroll == null || background === undefined || projection?.avatarLibraryId === undefined || viewMode !== 'immersive') return
    const previous = {
      attachment: scroll.style.getPropertyValue('background-attachment'),
      image: scroll.style.getPropertyValue('background-image'),
      position: scroll.style.getPropertyValue('background-position'),
      repeat: scroll.style.getPropertyValue('background-repeat'),
      size: scroll.style.getPropertyValue('background-size'),
    }
    scroll.dataset.agentRpBackground = 'true'
    scroll.style.setProperty('background-attachment', 'local')
    scroll.style.setProperty('background-image', `linear-gradient(rgba(10,11,15,.76),rgba(10,11,15,.88)),url("${characterLibraryImageUrl(projection.avatarLibraryId, background.index)}")`)
    scroll.style.setProperty('background-position', 'center')
    scroll.style.setProperty('background-repeat', 'no-repeat')
    scroll.style.setProperty('background-size', 'cover')
    return () => {
      delete scroll.dataset.agentRpBackground
      for (const [property, value] of Object.entries(previous)) {
        const cssProperty = `background-${property === 'image' ? 'image' : property}`
        if (value === '') scroll.style.removeProperty(cssProperty)
        else scroll.style.setProperty(cssProperty, value)
      }
    }
  }, [background?.index, projection?.avatarLibraryId, viewMode])
  useLayoutEffect(() => {
    const scroll = rootRef.current?.closest<HTMLElement>('[data-conversation-scroll]')
    if (scroll == null) return
    scroll.dataset.agentRpSession = 'true'
    scroll.dataset.agentRpView = viewMode
    const applyContrastContract = (): void => {
      const scrollStyle = getComputedStyle(scroll)
      const foreground = scrollStyle.getPropertyValue('--dsw-alias-label-primary').trim() || scrollStyle.color
      let background: string | undefined
      let externalBackgroundImage = false
      for (let element: HTMLElement | null = scroll; element !== null; element = element.parentElement) {
        const style = getComputedStyle(element)
        if (style.backgroundImage !== 'none' && element.dataset.agentRpBackground !== 'true') {
          externalBackgroundImage = true
        }
        const parsed = parseComputedColor(style.backgroundColor)
        if (background === undefined && parsed !== undefined && parsed.alpha >= .98) background = style.backgroundColor
      }
      let palette: RoleplayContrastPalette | undefined
      let contract: RoleplayContrastPalette | 'light-scrim' | undefined
      if (scroll.dataset.agentRpBackground === 'true') contract = 'light'
      else if (externalBackgroundImage) contract = 'light-scrim'
      else if (background !== undefined) {
        palette = roleplayContrastOverride(foreground, background)
        contract = palette
      }
      if (contract === undefined) delete scroll.dataset.agentRpAssistantContrast
      else scroll.dataset.agentRpAssistantContrast = contract
    }
    applyContrastContract()
    const observer = new MutationObserver(applyContrastContract)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    if (document.body !== null) observer.observe(document.body, {
      attributes: true, attributeFilter: ['class', 'style', 'data-theme'],
    })
    const queued = window.requestAnimationFrame(applyContrastContract)
    return () => {
      window.cancelAnimationFrame(queued)
      observer.disconnect()
      delete scroll.dataset.agentRpSession
      delete scroll.dataset.agentRpView
      delete scroll.dataset.agentRpAssistantContrast
    }
  }, [background?.index, sessionId, viewMode])
  useLayoutEffect(() => {
    const dock = rootRef.current?.closest<HTMLElement>('[data-slot="conversation.composer.dock"]')
    const inputRoot = dock?.parentElement
    if (dock == null || inputRoot == null || placeholder === undefined) return
    const managedTextareas = new Map<HTMLTextAreaElement, string | null>()
    const hiddenControls = new Map<HTMLElement, { display: string; priority: string }>()
    const hide = (element: Element): void => {
      if (!(element instanceof HTMLElement) || hiddenControls.has(element)) return
      hiddenControls.set(element, {
        display: element.style.getPropertyValue('display'),
        priority: element.style.getPropertyPriority('display'),
      })
      element.style.setProperty('display', 'none', 'important')
    }
    const refreshComposer = (): void => {
      const card = inputRoot.querySelector<HTMLElement>('[data-composer-card]')
      const textarea = card?.querySelector<HTMLTextAreaElement>('textarea')
      if (textarea != null) {
        if (!managedTextareas.has(textarea)) managedTextareas.set(textarea, textarea.getAttribute('placeholder'))
        if (textarea.getAttribute('placeholder') !== placeholder) textarea.setAttribute('placeholder', placeholder)
      }
      if (viewMode === 'debug') return
      const row = card?.lastElementChild
      const tools = row?.firstElementChild
      const trailing = row?.lastElementChild
      for (const element of Array.from(tools?.children ?? [])) hide(element)
      for (const element of Array.from(trailing?.children ?? [])) {
        const ownsMenuButton = element.querySelector('button[aria-haspopup="menu"]') !== null
        if (element.tagName !== 'BUTTON' && !ownsMenuButton) hide(element)
      }
      for (const element of Array.from(inputRoot.children)) {
        if (element !== card && element !== dock
          && (element as HTMLElement).dataset.agentRpStatusPanelDock !== 'true') hide(element)
      }
    }
    if (viewMode !== 'debug') dock.dataset.agentRpInput = ''
    refreshComposer()
    const observer = new MutationObserver(refreshComposer)
    observer.observe(inputRoot, { attributeFilter: ['placeholder'], attributes: true, childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const [element, { display, priority }] of hiddenControls) {
        if (display === '') element.style.removeProperty('display')
        else element.style.setProperty('display', display, priority)
      }
      delete dock.dataset.agentRpInput
      for (const [textarea, previousPlaceholder] of managedTextareas) {
        if (textarea.getAttribute('placeholder') !== placeholder) continue
        if (previousPlaceholder === null) textarea.removeAttribute('placeholder')
        else textarea.setAttribute('placeholder', previousPlaceholder)
      }
    }
  }, [placeholder, viewMode])
  useEffect(() => {
    if (projection === undefined) return
    const scroll = rootRef.current?.closest<HTMLElement>('[data-conversation-scroll]')
    if (scroll == null) return
    const mounted = new Map<HTMLElement, {
      readonly capabilityToken: string
      readonly root: Root
      signature: string
    }>()
    const cardPlayerActions = new CardPlayerActionCoordinator<Window>()
    const cardVariableMutationQueues = new WeakMap<Window, Promise<void>>()
    const hiddenTranscriptDetails = new Map<HTMLElement, { readonly display: string; readonly priority: string }>()
    const legacyConversationNotices = new Set<HTMLElement>()
    const updateCardFrameDiagnostic = (
      token: string,
      update: Partial<AgentRpRuntimeCardFrameFacts>,
    ): void => {
      let source = cardFrameDiagnosticSourcesRef.current.get(token)
      if (source === undefined) {
        source = createAgentRpRuntimeDiagnosticSource('card-frame')
        cardFrameDiagnosticSourcesRef.current.set(token, source)
      }
      const facts: AgentRpRuntimeCardFrameFacts = {
        scriptEnabled: true,
        registered: true,
        resized: false,
        ...cardFrameDiagnosticFactsRef.current.get(token),
        ...update,
      }
      cardFrameDiagnosticFactsRef.current.set(token, facts)
      runtimeDiagnostics.publish(source, { kind: 'card-frame', scope: String(sessionId), facts })
    }
    const removeCardFrameDiagnostic = (token: string): void => {
      const source = cardFrameDiagnosticSourcesRef.current.get(token)
      if (source !== undefined) runtimeDiagnostics.remove(source)
      cardFrameDiagnosticSourcesRef.current.delete(token)
      cardFrameDiagnosticFactsRef.current.delete(token)
    }
    const hideTranscriptDetail = (element: HTMLElement): void => {
      if (hiddenTranscriptDetails.has(element)) return
      hiddenTranscriptDetails.set(element, {
        display: element.style.getPropertyValue('display'),
        priority: element.style.getPropertyPriority('display'),
      })
      element.style.setProperty('display', 'none', 'important')
    }
    const restoreTranscriptDetail = (element: HTMLElement): void => {
      const previous = hiddenTranscriptDetails.get(element)
      if (previous === undefined) return
      if (previous.display === '') element.style.removeProperty('display')
      else element.style.setProperty('display', previous.display, previous.priority)
      hiddenTranscriptDetails.delete(element)
    }
    const showLegacyConversationNotice = (item: HTMLElement): void => {
      if (item.dataset.agentRpLegacyConversation === 'true') return
      const notice = document.createElement('aside')
      notice.setAttribute('role', 'status')
      notice.style.cssText = 'border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:10px;margin:8px 0;padding:12px 14px;font-size:13px;line-height:1.6;opacity:.76;'
      notice.textContent = '这段会话由早期预览版创建，当前版本无法继续读取它的轮次记录。原会话仍保留；请从标题栏打开“角色库”，选择对应角色后开始新对话。'
      item.before(notice)
      item.dataset.agentRpLegacyConversation = 'true'
      legacyConversationNotices.add(notice)
      hideTranscriptDetail(item)
    }
    const registeredCardFrame = (token: string, source: MessageEventSource | null): HTMLIFrameElement | undefined => {
      const registered = cardFramesByTokenRef.current.get(token)
      if (registered?.contentWindow === source) return registered
      const recovered = [...mounted.keys()]
        .flatMap(root => [...root.querySelectorAll<HTMLIFrameElement>('iframe[data-agent-rp-frame-token]')])
        .find(frame => frame.dataset.agentRpFrameToken === token && frame.contentWindow === source)
      if (recovered !== undefined) cardFramesByTokenRef.current.set(token, recovered)
      return recovered
    }
    const bridge = (event: MessageEvent<unknown>): void => {
      if (typeof event.data !== 'object' || event.data === null) return
      const externalWindowDelivery = parseCardExternalWindowDeliveryReport(event.data)
      if (externalWindowDelivery !== undefined) {
        const sourceFrame = registeredCardFrame(externalWindowDelivery.token, event.source)
        if (sourceFrame === undefined) return
        cardExternalWindowBrokers.current
          .get(`${externalWindowDelivery.token}:${externalWindowDelivery.requestId}`)
          ?.acknowledgeDelivery()
        return
      }
      const resourceBlocked = parseCardResourceBlockedReport(event.data)
      if (resourceBlocked !== undefined) {
        const sourceFrame = registeredCardFrame(resourceBlocked.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpResourceBlocked = resourceBlocked.type
        updateCardFrameDiagnostic(resourceBlocked.token, { blockedResourceClass: resourceBlocked.type })
        sourceFrame.dispatchEvent(new CustomEvent<CharacterRemoteResourceApproval>(cardResourceBlockedEvent, {
          detail: { origin: resourceBlocked.origin, type: resourceBlocked.type },
        }))
        return
      }
      const externalWindowControl = parseCardExternalWindowControlRequest(event.data)
      if (externalWindowControl !== undefined) {
        const sourceFrame = registeredCardFrame(externalWindowControl.token, event.source)
        if (sourceFrame === undefined) return
        const target = event.source as Window
        const key = `${externalWindowControl.token}:${externalWindowControl.requestId}`
        const broker = cardExternalWindowBrokers.current.get(key)
        if (externalWindowControl.action === 'external-window-focus') {
          broker?.focus()
          return
        }
        setCardExternalWindowRequests(current => {
          if (!current.has(key)) return current
          const next = new Map(current)
          next.delete(key)
          return next
        })
        if (broker !== undefined) {
          cardExternalWindowBrokers.current.delete(key)
          broker.close()
        } else {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'external-window-closed',
            requestId: externalWindowControl.requestId,
          }, '*')
        }
        return
      }
      const externalWindowRequest = parseCardExternalWindowCapabilityRequest(event.data)
      if (externalWindowRequest !== undefined) {
        const sourceFrame = registeredCardFrame(externalWindowRequest.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpCapabilityRequest = externalWindowRequest.capability
        const target = event.source as Window
        const key = `${externalWindowRequest.token}:${externalWindowRequest.requestId}`
        const request: CardExternalWindowRequest = {
          key,
          target,
          token: externalWindowRequest.token,
          requestId: externalWindowRequest.requestId,
          url: externalWindowRequest.url,
          hostname: new URL(externalWindowRequest.url).hostname,
        }
        setCardExternalWindowRequests(current => {
          return enqueueExternalWindowRequest(current, cardExternalWindowBrokers.current, request)
        })
        setCardExternalWindowPermissionOpen(true)
        return
      }
      const nativeIdentityRequest = parseCardNativeIdentityCapabilityRequest(event.data)
      if (nativeIdentityRequest !== undefined) {
        const sourceFrame = registeredCardFrame(nativeIdentityRequest.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpCapabilityRequest = nativeIdentityRequest.capability
        const target = event.source as Window
        const current = displayStateRef.current.projection
        if (current === undefined) return
        const characterId = current.tavern?.characterSourceId ?? current.avatarLibraryId ?? current.characterName
        const application = JSON.stringify(['card-frame', characterId])
        const approval = nativeIdentityApprovalKey(
          application, nativeIdentityRequest.audience, nativeIdentityRequest.includeDisplayName,
        )
        const request: NativeIdentityRuntimeRequest = {
          key: `${nativeIdentityRequest.token}:${nativeIdentityRequest.requestId}`,
          target,
          runtime: 'card-frame-v0',
          requestId: nativeIdentityRequest.requestId,
          application,
          applicationName: current.characterName,
          audience: nativeIdentityRequest.audience,
          nonce: nativeIdentityRequest.nonce,
          includeDisplayName: nativeIdentityRequest.includeDisplayName,
          token: nativeIdentityRequest.token,
        }
        if (approvedCardNativeIdentitiesRef.current.has(approval)) {
          void deliverNativeIdentityResult(request, target)
          return
        }
        setCardNativeIdentityRequests(requests => {
          if (requests.has(request.key)) return requests
          if (requests.size >= 8) {
            target.postMessage({
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'identity.native.attest',
              requestId: request.requestId, ok: false, error: '等待确认的本机身份请求过多',
            }, '*')
            return requests
          }
          return new Map(requests).set(request.key, request)
        })
        setCardExternalWindowPermissionOpen(true)
        return
      }
      const capabilityRequest = parseCardCapabilityRequest(event.data)
      const chatSendRequest = parseCardChatSendCapabilityRequest(event.data)
      if (chatSendRequest !== undefined) {
        const sourceFrame = registeredCardFrame(chatSendRequest.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpCapabilityRequest = chatSendRequest.capability
        const target = event.source as Window
        const respond = (ok: boolean, error?: string): void => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'chat.send',
            requestId: chatSendRequest.requestId, ok, ...(error === undefined ? {} : { error }),
          }, '*')
        }
        const conversation = ctx.sessions.scope(sessionId)?.get('conversation') as IConversation | undefined
        if (conversation === undefined) {
          respond(false, '当前角色会话尚未准备好发送消息')
          return
        }
        const variableWrites = cardVariableMutationQueues.get(target) ?? Promise.resolve()
        void cardPlayerActions.run(target, chatSendRequest.playerAction, () => (
          variableWrites.catch(() => undefined).then(() => conversation.send(chatSendRequest.value))
        )).then(result => {
          if (result.status === 'completed') respond(true)
          else if (result.status === 'activation-required') respond(false, '需要点击后才能发送消息')
          else if (result.status === 'busy') respond(false, '上一项卡片操作仍在进行')
          else {
            ctx.logger.warn(`agent-rp: card chat send failed: ${String(result.reason)}`)
            respond(false, '消息发送失败')
          }
        })
        return
      }
      const userMessageAppendRequest = parseCardUserMessageAppendCapabilityRequest(event.data)
      if (userMessageAppendRequest !== undefined) {
        const sourceFrame = registeredCardFrame(userMessageAppendRequest.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpCapabilityRequest = userMessageAppendRequest.capability
        const target = event.source as Window
        const respond = (ok: boolean, error?: string): void => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'chat.user-message.append',
            requestId: userMessageAppendRequest.requestId, ok,
            ...(error === undefined ? {} : { error }),
          }, '*')
        }
        const variableWrites = cardVariableMutationQueues.get(target) ?? Promise.resolve()
        void cardPlayerActions.run(target, userMessageAppendRequest.playerAction, () => variableWrites.catch(() => undefined).then(() => (
          runTavernMutation(sessionId, {
            format: 0, operation: 'create-chat-messages',
            messages: [{ role: 'user', message: userMessageAppendRequest.message }], insertAt: 'end',
          })
        )), { grantTrigger: true }).then(result => {
          if (result.status === 'completed') respond(true)
          else if (result.status === 'activation-required') respond(false, '需要点击后才能创建用户消息')
          else if (result.status === 'busy') respond(false, '上一项卡片操作仍在进行')
          else {
            ctx.logger.warn(`agent-rp: card user message append failed: ${String(result.reason)}`)
            respond(false, '卡片用户消息保存失败')
          }
        })
        return
      }
      if (capabilityRequest !== undefined) {
        const sourceFrame = registeredCardFrame(capabilityRequest.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpCapabilityRequest = capabilityRequest.capability
        const target = event.source as Window
        const respond = (ok: boolean, error?: string): void => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'capability-result', requestId: capabilityRequest.requestId,
            ok, ...(error === undefined ? {} : { error }),
          }, '*')
        }
        const current = displayStateRef.current
        const choices = current.projection === undefined
          ? undefined : cardFrameGreetingChoices(current.projection, current.characterDetail)
        const selectedGreeting = choices?.alternatives[capabilityRequest.greetingIndex]
        if (selectedGreeting === undefined) {
          respond(false, '这条开场已不属于当前角色卡')
          return
        }
        void cardPlayerActions.run(target, capabilityRequest.playerAction, () => runTavernMutation(sessionId, {
          format: 0, operation: 'set-chat-messages', messages: [{ message_id: 0, message: selectedGreeting }],
        })).then(result => {
          if (result.status === 'completed') respond(true)
          else if (result.status === 'activation-required') respond(false, '需要点击后才能切换开场')
          else if (result.status === 'busy') respond(false, '上一项卡片操作仍在进行')
          else {
            ctx.logger.warn(`agent-rp: card greeting switch failed: ${String(result.reason)}`)
            respond(false, '开场切换失败')
          }
        })
        return
      }
      const variableRequest = parseCardVariableReplaceRequest(event.data)
      if (variableRequest !== undefined) {
        const sourceFrame = registeredCardFrame(variableRequest.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpVariableScope = variableRequest.scope
        const target = event.source as Window
        const respond = (ok: boolean, error?: string): void => {
          target.postMessage({
            source: 'dsh-agent-rp-host', action: 'variables-result', requestId: variableRequest.requestId,
            ok, ...(error === undefined ? {} : { error }),
          }, '*')
        }
        const previous = cardVariableMutationQueues.get(target) ?? Promise.resolve()
        const work = previous.catch(() => undefined).then(() => runTavernMutation(sessionId, {
          format: 0, scope: variableRequest.scope, variables: variableRequest.variables,
        }))
        cardVariableMutationQueues.set(target, work)
        void work.then(() => {
          respond(true)
        }, reason => {
          ctx.logger.warn(`agent-rp: card variable update failed: ${String(reason)}`)
          respond(false, '变量保存失败')
        }).finally(() => {
          if (cardVariableMutationQueues.get(target) === work) cardVariableMutationQueues.delete(target)
        })
        return
      }
      const runtimeReport = parseCardRuntimeReport(event.data)
      if (runtimeReport !== undefined) {
        const sourceFrame = registeredCardFrame(runtimeReport.token, event.source)
        if (sourceFrame === undefined) return
        sourceFrame.dataset.agentRpRuntimePhase = runtimeReport.value
        updateCardFrameDiagnostic(runtimeReport.token, { runtimePhase: runtimeReport.value })
        return
      }
      const message = event.data as {
        readonly source?: unknown
        readonly action?: unknown
        readonly playerAction?: unknown
        readonly token?: unknown
        readonly value?: unknown
      }
      if (message.source !== 'dsh-agent-rp-card') return
      const sourceFrame = typeof message.token === 'string'
        ? registeredCardFrame(message.token, event.source) : undefined
      if (sourceFrame === undefined) return
      if (message.action === 'resource-monitor' && typeof message.value === 'string'
        && ['listener-installed', 'document-open', 'bootstrap-injected', 'listener-restored'].includes(message.value)) {
        sourceFrame.dataset.agentRpResourceMonitor = message.value
        updateCardFrameDiagnostic(message.token as string, {
          resourceMonitor: message.value as NonNullable<AgentRpRuntimeCardFrameFacts['resourceMonitor']>,
        })
        return
      }
      if (message.action === 'resize' && typeof message.value === 'number' && Number.isFinite(message.value)) {
        sourceFrame.style.height = `${Math.max(72, Math.ceil(message.value))}px`
        sourceFrame.style.visibility = 'visible'
        sourceFrame.dataset.agentRpResizeReceived = 'true'
        updateCardFrameDiagnostic(message.token as string, { resized: true })
        return
      }
      if (typeof message.value !== 'string' || message.value.length > 65_536) return
      if (message.action === 'draft') {
        inputActions.setDraft(message.value)
        return
      }
      if (message.action !== 'trigger-slash') return
      const command = parseTavernSlashCommand(message.value)
      if (command?.kind === 'set-input' && !command.trigger) {
        inputActions.setDraft(command.text)
        return
      }
      if (command?.kind === 'trigger') {
        void cardPlayerActions.trigger(
          event.source as Window, message.playerAction === true, () => runTavernTrigger(sessionId),
        ).then(result => {
          if (result.status === 'failed') {
            ctx.logger.warn(`agent-rp: card /trigger failed: ${String(result.reason)}`)
          } else if (result.status === 'activation-required') {
            sourceFrame.dataset.agentRpCapabilityRequest = 'trigger-user-activation-required'
          }
        })
        return
      }
      if (command?.kind !== 'send' && command?.kind !== 'set-input') return
      const scoped = ctx.sessions.scope(sessionId)
      const conversation = scoped?.get('conversation') as IConversation | undefined
      if (conversation === undefined) return
      void cardPlayerActions.run(
        event.source as Window, message.playerAction === true, () => conversation.send(command.text),
      ).then(result => {
        if (result.status === 'failed') {
          ctx.logger.warn(`agent-rp: card slash send failed: ${String(result.reason)}`)
        } else if (result.status === 'activation-required') {
          sourceFrame.dataset.agentRpCapabilityRequest = 'slash-send-user-activation-required'
        }
      })
    }
    const mountRenderedDisplay = (
      item: HTMLElement,
      original: HTMLElement,
      compilation: CompiledCharacterDisplay,
      currentMessageId: number | undefined,
      activeProjection: AgentRpProjection,
      activeCharacterDetail: CharacterLibraryDetail | undefined,
      activeCompatibilityMarkers: readonly string[],
    ): void => {
      const existing = item.querySelector<HTMLElement>(':scope > [data-agent-rp-rendered-display]')
      const appearance = captureCardFrameAppearance(original)
      const greetingChoices = cardFrameGreetingChoices(activeProjection, activeCharacterDetail)
      const activeCharacterScripts = activeTavernScripts(activeProjection, 'character')
      const visibleMessages = activeProjection.tavern?.messages.filter(message => !message.isHidden) ?? []
      const currentMessageIndex = currentMessageId === undefined
        ? -1
        : visibleMessages.findIndex(message => message.messageId === currentMessageId)
      const chat = currentMessageIndex < 0 ? undefined : {
        currentMessageId: currentMessageId!,
        messages: visibleMessages.slice(0, currentMessageIndex + 1).map(message => ({
          messageId: message.messageId,
          role: message.role,
          text: message.text,
        })),
      }
      const signature = JSON.stringify([
        compilation,
        chat,
        appearance,
        activeProjection.mvu?.statData,
        activeProjection.tavern?.scopes,
        activeProjection.characterName,
        activeProjection.userName,
        activeCharacterDetail?.id,
        activeCharacterDetail?.imageAssets,
        activeCharacterDetail?.displayExtensions.filter(extension => extension.enabled),
        activeCharacterDetail?.approvedRemoteResources,
        activeCharacterDetail?.remoteResourcePolicy,
        activeCompatibilityMarkers,
        greetingChoices,
        activeCharacterScripts,
      ])
      const existingMount = existing === null ? undefined : mounted.get(existing)
      const registerFrame = (token: string, frame: HTMLIFrameElement | null): void => {
        if (frame === null) {
          cardFramesByTokenRef.current.delete(token)
          removeCardFrameDiagnostic(token)
        }
        else {
          cardFramesByTokenRef.current.set(token, frame)
          frame.dataset.agentRpFrameRegistered = 'true'
          updateCardFrameDiagnostic(token, {
            scriptEnabled: frame.sandbox.contains('allow-scripts'),
            registered: true,
            resized: frame.dataset.agentRpResizeReceived === 'true',
          })
        }
      }
      const render = (display: HTMLElement, mount: {
        readonly capabilityToken: string
        readonly root: Root
      }): void => {
        original.style.removeProperty('display')
        display.style.setProperty('display', 'block')
        mount.root.render(<CharacterDisplay
          appearance={appearance}
          capabilityToken={mount.capabilityToken}
          {...(chat === undefined ? {} : { chat })}
          compilation={compilation}
          statData={activeProjection.mvu?.statData}
          characterName={activeProjection.characterName}
          compatibilityMarkers={activeCompatibilityMarkers}
          tavernHelperScripts={activeCharacterScripts}
          {...(activeProjection.tavern === undefined ? {} : { variableScopes: activeProjection.tavern.scopes })}
          {...(activeProjection.userName === undefined ? {} : { userName: activeProjection.userName })}
          {...(greetingChoices === undefined ? {} : { greetingChoices })}
          {...(activeCharacterDetail === undefined ? {} : { character: activeCharacterDetail })}
          onFrameRegistration={registerFrame}
          onReady={() => { original.style.display = 'none' }}
        />)
      }
      if (existing !== null && existingMount !== undefined) {
        if (existingMount.signature === signature) return
        existingMount.signature = signature
        render(existing, existingMount)
        return
      }
      const display = document.createElement('div')
      display.style.cssText = 'display:block;min-width:0;width:100%;'
      display.dataset.agentRpRenderedDisplay = 'true'
      item.dataset.agentRpFrontend = 'true'
      item.insertBefore(display, original.nextSibling)
      const root = createRoot(display)
      const mount = { capabilityToken: crypto.randomUUID(), root, signature }
      mounted.set(display, mount)
      render(display, mount)
    }
    const restoreHostDisplay = (item: HTMLElement, original: HTMLElement): void => {
      const display = item.querySelector<HTMLElement>(':scope > [data-agent-rp-rendered-display]')
      if (display === null) return
      const mount = mounted.get(display)
      if (mount !== undefined) {
        mount.root.unmount()
        mounted.delete(display)
      }
      display.remove()
      original.style.removeProperty('display')
      delete item.dataset.agentRpFrontend
    }
    window.addEventListener('message', bridge)
    const scan = (): void => {
      const {
        cardFrameRenderDepth: activeCardFrameRenderDepth,
        chat: activeChat,
        characterDetail: activeCharacterDetail,
        characterStatus: activeCharacterStatus,
        compatibilityMarkers: activeCompatibilityMarkers,
        displayOverrides: activeDisplayOverrides,
        displayRegexScripts: activeCharacterDisplayRegexScripts,
        projection: activeProjection,
        viewMode: activeViewMode,
      } = displayStateRef.current
      if (activeProjection === undefined) return
      if (activeProjection.avatarLibraryId !== undefined && activeCharacterDetail === undefined
        && activeCharacterStatus !== 'error') return
      const frontend = activeProjection.frontend === undefined ? undefined
        : withCurrentCharacterDisplayScripts(activeProjection.frontend, activeCharacterDisplayRegexScripts)
      const displayPlanner = createRoleplayDisplayPlanner({
        projection: activeProjection,
        immersive: activeViewMode === 'immersive',
        overrides: activeDisplayOverrides,
        ...(frontend === undefined ? {} : { frontend }),
      })
      const visibleTavernMessages = activeProjection.tavern?.messages.filter(message => !message.isHidden) ?? []
      const retainedCardFrames = retainedCardFrameMessageIds(visibleTavernMessages, activeCardFrameRenderDepth)
      const visibleFlowItems = [...scroll.querySelectorAll<HTMLElement>(
        '[data-chat-flow-kind="user"], [data-chat-flow-kind="assistant-step"]',
      )]
      const alignedTavernMessageByItem = new Map<HTMLElement, (typeof visibleTavernMessages)[number]>()
      if (visibleFlowItems.length === visibleTavernMessages.length && visibleFlowItems.every((item, index) => {
        const role = item.dataset.chatFlowKind === 'user' ? 'user' : 'assistant'
        return visibleTavernMessages[index]?.role === role
      })) {
        visibleFlowItems.forEach((item, index) => {
          alignedTavernMessageByItem.set(item, visibleTavernMessages[index]!)
        })
      }
      if (activeViewMode === 'immersive') {
        for (const item of scroll.querySelectorAll<HTMLElement>(
          '[data-chat-flow-kind="context"], [data-chat-flow-kind="tool-call"], '
          + '[data-chat-flow-kind="manual-compaction"], [data-chat-flow-kind="compaction"], '
          + '[data-chat-flow-kind="model-retry"], [data-chat-flow-kind="unknown"]',
        )) hideTranscriptDetail(item)
        for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow-kind="command"]')) {
          if (item.querySelector('[data-agent-rp-image-card]') === null) hideTranscriptDetail(item)
          else restoreTranscriptDetail(item)
        }
        for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow-kind="turn-error"]')) {
          if (item.textContent?.includes('agent-rp/character-card-seed has invalid provenance')) {
            hideTranscriptDetail(item)
            continue
          }
          if (!item.textContent?.includes('received more than one start Match')
            || item.dataset.agentRpLegacyConversation === 'true') continue
          showLegacyConversationNotice(item)
        }
        for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow] > div')) {
          if (!item.textContent?.startsWith('历史加载失败：conversation Context')
            || !item.textContent.includes('received more than one start Match')) continue
          showLegacyConversationNotice(item)
        }
        for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"]')) {
          if (item.dataset.agentRpSetupCollapsed === 'true'
            || !item.textContent?.includes('🎬 档案提交完毕指令：')) continue
          const content = item.firstElementChild as HTMLElement | null
          if (content === null) continue
          const details = document.createElement('details')
          details.style.cssText = 'font-size:12px;opacity:.72;'
          const summaryElement = document.createElement('summary')
          summaryElement.textContent = '角色设定已提交'
          summaryElement.style.cssText = 'cursor:pointer;list-style:none;'
          const original = content.cloneNode(true) as HTMLElement
          original.style.cssText = 'margin-top:8px;max-height:240px;overflow:auto;white-space:pre-wrap;'
          details.append(summaryElement, original)
          content.style.display = 'none'
          item.insertBefore(details, content.nextSibling)
          item.dataset.agentRpSetupCollapsed = 'true'
        }
      }
      for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"]')) {
        const key = item.dataset.chatFlowKey
        if (key === undefined) continue
        const node = activeChat.nodes.get(key)
        if (node?.kind !== 'user') continue
        const seq = (node.data as { readonly seq: number }).seq
        const original = item.firstElementChild as HTMLElement | null
        if (original === null) continue
        const alignedMessage = alignedTavernMessageByItem.get(item)
        const plan = displayPlanner.user({ seq, ...(alignedMessage === undefined ? {} : { alignedMessage }) })
        if (plan.kind !== 'render'
          || (plan.messageId !== undefined && !retainedCardFrames.has(plan.messageId))) restoreHostDisplay(item, original)
        else mountRenderedDisplay(
          item, original, plan.compilation, plan.messageId, activeProjection, activeCharacterDetail, activeCompatibilityMarkers,
        )
      }
      for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow-kind="assistant-step"]')) {
        const key = item.dataset.chatFlowKey
        if (key === undefined) continue
        const node = activeChat.nodes.get(key)
        if (node?.kind !== 'assistant-step') continue
        const data = node.data as { readonly blocks?: readonly { readonly kind: string; readonly text?: string }[] }
        const finalSeq = (node.data as { readonly finalNode?: { readonly seq: number } }).finalNode?.seq
        const original = item.firstElementChild as HTMLElement | null
        const alignedMessage = alignedTavernMessageByItem.get(item)
        const plan = displayPlanner.assistant({
          blockText: data.blocks
            ?.flatMap(block => block.kind === 'text' && block.text !== undefined ? [block.text] : []).join('\n') ?? '',
          ...(finalSeq === undefined ? {} : { finalSeq }),
          ...(alignedMessage === undefined ? {} : { alignedMessage }),
        })
        if (plan.kind === 'hidden') {
          if (original !== null) restoreHostDisplay(item, original)
          hideTranscriptDetail(item)
          continue
        }
        if (original === null) continue
        if (plan.kind !== 'render'
          || (plan.messageId !== undefined && !retainedCardFrames.has(plan.messageId))) restoreHostDisplay(item, original)
        else mountRenderedDisplay(
          item, original, plan.compilation, plan.messageId, activeProjection, activeCharacterDetail, activeCompatibilityMarkers,
        )
      }
      if (activeViewMode === 'immersive') {
        for (const item of scroll.querySelectorAll<HTMLElement>('[data-chat-flow-kind="turn-tail"]')) {
          const key = item.dataset.chatFlowKey
          const node = key === undefined ? undefined : activeChat.nodes.get(key)
          if (node?.kind !== 'turn-tail') continue
          const seq = (node.data as { readonly closing?: { readonly finalNode?: { readonly seq: number } } }).closing?.finalNode?.seq
          if (seq !== undefined && activeProjection.generations.some(group =>
            group.assistantSeqs.includes(seq) && seq !== group.anchorSeq)) hideTranscriptDetail(item)
        }
      }
    }
    let scanFrame: number | undefined
    const scheduleScan = (): void => {
      if (scanFrame !== undefined) return
      scanFrame = window.requestAnimationFrame(() => {
        scanFrame = undefined
        scan()
      })
    }
    scanDisplayRef.current = scheduleScan
    scan()
    const observer = new MutationObserver(scheduleScan)
    observer.observe(scroll, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (scanFrame !== undefined) window.cancelAnimationFrame(scanFrame)
      scanDisplayRef.current = () => undefined
      window.removeEventListener('message', bridge)
      for (const [display, { root }] of mounted) {
        const item = display.closest<HTMLElement>('[data-agent-rp-frontend]')
        const original = item?.firstElementChild as HTMLElement | null
        if (original !== null) original.style.removeProperty('display')
        if (item !== null) delete item.dataset.agentRpFrontend
        root.unmount()
        display.remove()
      }
      for (const [element, { display, priority }] of hiddenTranscriptDetails) {
        if (display === '') element.style.removeProperty('display')
        else element.style.setProperty('display', display, priority)
        delete element.dataset.agentRpLegacyConversation
      }
      for (const notice of legacyConversationNotices) notice.remove()
      for (const item of scroll.querySelectorAll<HTMLElement>('[data-agent-rp-setup-collapsed="true"]')) {
        const content = item.firstElementChild as HTMLElement | null
        content?.style.removeProperty('display')
        item.querySelector(':scope > details')?.remove()
        delete item.dataset.agentRpSetupCollapsed
      }
    }
  }, [runtimeDiagnostics, sessionId, viewMode, projection !== undefined])
  useEffect(() => { scanDisplayRef.current() }, [
    cardFrameRenderDepth, chat, characterDetail, compatibilityMarkers, displayOverrides, projection,
    storedCharacterRuntime?.displayRegexScripts, storedCharacterRuntime?.status,
  ])
  const hasTavernVariableSurface = projection !== undefined
    && (['global', 'preset', 'character'] as const).some(scope =>
      activeTavernScripts(projection, scope).some(script => script.enabled && script.content.trim() !== ''))
  const capabilityPlans = projection === undefined ? [] : [
      resolveAgentRpCapabilityPlan(CARD_FRONTEND_CAPABILITY_MANIFEST),
      ...(projection.worldInfoCount === 0 ? [] : [resolveAgentRpCapabilityPlan(NATIVE_WORLD_ENGINE_MANIFEST)]),
      ...((characterDetail?.greetingCount ?? 0) <= 1
        ? [] : [resolveAgentRpCapabilityPlan(CARD_GREETING_CAPABILITY_MANIFEST)]),
      ...(hasTavernVariableSurface ? [resolveAgentRpCapabilityPlan(TAVERN_LEGACY_ADAPTER_MANIFEST)] : []),
    ]
  const capabilitySummary = mergeAgentRpCapabilityPlanSummaries(
    capabilityPlans.map(summarizeAgentRpCapabilityPlan),
  )
  const auxiliaryGenerations = projection?.auxiliaryGenerations ?? {
    requests: 0, succeeded: 0, failed: 0, pending: 0, malformed: 0,
  }
  const worldEngineFailures = projection?.worldInfo.failureCounts ?? {
    regexRuntimeUnavailable: 0, regexInvalid: 0, regexExecutionLimit: 0, regexResourceLimit: 0,
    decoratorUnsupported: 0, templateUnsupported: 0, templateError: 0,
  }
  const worldInfoBooks = projection?.worldInfo.books ?? []
  const worldEngineResources = summarizeWorldEngineResources(worldInfoBooks)
  const worldEngineReasons = worldEngineResources.reasons
  useAgentRpRuntimeDiagnosticContribution(
    runtimeDiagnostics,
    'roleplay-session',
    projection === undefined ? undefined : {
      kind: 'session',
      scope: String(sessionId),
      facts: {
        turns: turnHealth,
        capabilities: {
          extensions: capabilityPlans.length,
          requirements: capabilitySummary.requirements,
          available: capabilitySummary.resolutions.available,
          approvals: capabilitySummary.resolutions['approval-required'],
          requiredUnavailable: capabilitySummary.requiredUnavailable,
          unsupported: capabilitySummary.resolutions.unsupported,
          versionMismatch: capabilitySummary.resolutions['version-mismatch'],
          denied: capabilitySummary.resolutions.denied,
        },
        auxiliaryGenerations,
        externalWindowPhases: cardExternalWindowPhase === undefined ? [] : [cardExternalWindowPhase],
        nativeIdentity: {
          state: nativeIdentityState,
          approved: approvedCardNativeIdentities.size,
          pending: cardNativeIdentityRequests.size,
        },
        variables: {
          surfaces: hasTavernVariableSurface ? 2 : 1,
          sharedScopes: 5,
          scriptScopes: hasTavernVariableSurface ? 1 : 0,
        },
        renderer: { inlineFrontendSanitizer: inlineCardSanitizerProbeState() },
        worldEngine: {
          engine: worldInfoBooks.length === 0 ? 'inactive' : 'native-v0',
          bindings: worldEngineResources.bindings,
          entries: worldEngineResources.entries,
          enabled: worldEngineResources.enabled,
          active: worldEngineResources.active,
          budgetExcluded: projection.worldInfo.budgetExcludedCount,
          reasons: worldEngineReasons,
          failures: worldEngineFailures,
        },
      },
    },
  )
  if (projection === undefined) return roleplayExpected ? <div ref={rootRef} role="status"
    data-agent-rp-status data-agent-rp-startup data-agent-rp-startup-phase="projection"
    data-agent-rp-startup-elapsed-ms={startupElapsed} style={{
      alignItems: 'center', color: 'inherit', display: 'flex', fontSize: '11px', gap: '7px',
      minWidth: 0, opacity: .68, padding: '4px 8px',
    }}>
    <span aria-hidden="true" style={{ color }}>●</span>
    <span>{startupElapsed < 1_200
      ? '正在准备角色会话…'
      : `会话投影仍在读取 · ${(startupElapsed / 1_000).toFixed(1)} 秒；输入区保持可用`}</span>
  </div> : null
  const cardPermissionCount = cardExternalWindowRequests.size + cardNativeIdentityRequests.size
  return <div ref={rootRef} data-agent-rp-status
    data-agent-rp-startup data-agent-rp-startup-phase={startupPhase}
    data-agent-rp-startup-elapsed-ms={startupElapsed}
    data-agent-rp-character-library={projection.avatarLibraryId === undefined
      ? 'not-used' : storedCharacterRuntime?.status ?? 'loading'}
    {...(currentStartupTiming.projectionMs === undefined
      ? {} : { 'data-agent-rp-startup-projection-ms': currentStartupTiming.projectionMs })}
    {...(currentStartupTiming.characterMs === undefined
      ? {} : { 'data-agent-rp-startup-character-ms': currentStartupTiming.characterMs })}
    {...(cardExternalWindowPhase === undefined
      ? {} : { 'data-agent-rp-external-window-phase': cardExternalWindowPhase })}
    data-agent-rp-inline-frontend-sanitizer={inlineCardSanitizerProbeState()}
    data-agent-rp-capability-extensions={capabilityPlans.length}
    data-agent-rp-capability-requirements={capabilitySummary.requirements}
    data-agent-rp-capability-available={capabilitySummary.resolutions.available}
    data-agent-rp-capability-approvals={capabilitySummary.resolutions['approval-required']}
    data-agent-rp-capability-required-unavailable={capabilitySummary.requiredUnavailable}
    data-agent-rp-capability-unsupported={capabilitySummary.resolutions.unsupported}
    data-agent-rp-capability-version-mismatch={capabilitySummary.resolutions['version-mismatch']}
    data-agent-rp-capability-denied={capabilitySummary.resolutions.denied}
    data-agent-rp-native-identity={nativeIdentityState}
    data-agent-rp-native-identity-approved={approvedCardNativeIdentities.size}
    data-agent-rp-native-identity-pending={cardNativeIdentityRequests.size}
    data-agent-rp-auxiliary-generation-requests={auxiliaryGenerations.requests}
    data-agent-rp-auxiliary-generation-succeeded={auxiliaryGenerations.succeeded}
    data-agent-rp-auxiliary-generation-failed={auxiliaryGenerations.failed}
    data-agent-rp-auxiliary-generation-pending={auxiliaryGenerations.pending}
    data-agent-rp-auxiliary-generation-malformed={auxiliaryGenerations.malformed}
    data-agent-rp-variable-surfaces={hasTavernVariableSurface ? 2 : 1}
    data-agent-rp-variable-shared-scopes={5}
    data-agent-rp-variable-script-scopes={hasTavernVariableSurface ? 1 : 0}
    data-agent-rp-world-info-write-surfaces={hasTavernVariableSurface ? 1 : 0}
    data-agent-rp-chat-write-surfaces={hasTavernVariableSurface ? 1 : 0}
    data-agent-rp-prompt-injection-surfaces={hasTavernVariableSurface ? 1 : 0}
    data-agent-rp-prompt-preview-surfaces={hasTavernVariableSurface ? 1 : 0}
    data-agent-rp-world-engine={worldInfoBooks.length === 0 ? 'inactive' : 'native-v0'}
    data-agent-rp-world-engine-books={worldEngineResources.bindings.books}
    data-agent-rp-world-engine-character-books={worldEngineResources.bindings.character}
    data-agent-rp-world-engine-standalone-books={worldEngineResources.bindings.standalone}
    data-agent-rp-world-engine-entries={worldEngineResources.entries}
    data-agent-rp-world-engine-enabled={worldEngineResources.enabled}
    data-agent-rp-world-engine-active={worldEngineResources.active}
    data-agent-rp-world-engine-budget-excluded={projection.worldInfo.budgetExcludedCount}
    data-agent-rp-world-engine-reason-active-constant={worldEngineReasons['active-constant'] ?? 0}
    data-agent-rp-world-engine-reason-active-keyword={worldEngineReasons['active-keyword'] ?? 0}
    data-agent-rp-world-engine-reason-disabled={worldEngineReasons.disabled ?? 0}
    data-agent-rp-world-engine-reason-deleted={worldEngineReasons.deleted ?? 0}
    data-agent-rp-world-engine-reason-empty-content={worldEngineReasons['empty-content'] ?? 0}
    data-agent-rp-world-engine-reason-compatibility-unsupported={worldEngineReasons['compatibility-unsupported'] ?? 0}
    data-agent-rp-world-engine-reason-decorator-unsupported={worldEngineReasons['decorator-unsupported'] ?? 0}
    data-agent-rp-world-engine-reason-template-unsupported={worldEngineReasons['template-unsupported'] ?? 0}
    data-agent-rp-world-engine-reason-template-error={worldEngineReasons['template-error'] ?? 0}
    data-agent-rp-world-engine-reason-regex-runtime-unavailable={worldEngineReasons['regex-runtime-unavailable'] ?? 0}
    data-agent-rp-world-engine-reason-regex-invalid={worldEngineReasons['regex-invalid'] ?? 0}
    data-agent-rp-world-engine-reason-regex-execution-limit={worldEngineReasons['regex-execution-limit'] ?? 0}
    data-agent-rp-world-engine-reason-regex-resource-limit={worldEngineReasons['regex-resource-limit'] ?? 0}
    data-agent-rp-world-engine-reason-primary-unmatched={worldEngineReasons['primary-unmatched'] ?? 0}
    data-agent-rp-world-engine-reason-secondary-unmatched={worldEngineReasons['secondary-unmatched'] ?? 0}
    data-agent-rp-world-engine-reason-budget-excluded={worldEngineReasons['budget-excluded'] ?? 0}
    data-agent-rp-world-engine-reason-session-budget-excluded={worldEngineReasons['session-budget-excluded'] ?? 0}
    data-agent-rp-world-engine-regex-runtime-unavailable={worldEngineFailures.regexRuntimeUnavailable}
    data-agent-rp-world-engine-regex-invalid={worldEngineFailures.regexInvalid}
    data-agent-rp-world-engine-regex-execution-limit={worldEngineFailures.regexExecutionLimit}
    data-agent-rp-world-engine-regex-resource-limit={worldEngineFailures.regexResourceLimit}
    data-agent-rp-world-engine-decorator-unsupported={worldEngineFailures.decoratorUnsupported}
    data-agent-rp-world-engine-template-unsupported={worldEngineFailures.templateUnsupported}
    data-agent-rp-world-engine-template-error={worldEngineFailures.templateError}
    style={{ alignItems: 'center', display: 'flex', gap: '4px', minWidth: 0 }}>
    {statusPanelHost !== undefined && createPortal(<TavernStatusPanels projection={projection} />, statusPanelHost)}
    {storedCharacterRuntime?.status === 'error' && <span role="status"
      title={storedCharacterRuntime.error} style={{
        color: 'var(--dsw-alias-state-warning, #d6a955)', fontSize: '11px', lineHeight: 1.45, padding: '3px 6px',
      }}>角色库资源已缺失；正文仍可继续，头像与角色库附加资源不可用</span>}
    {cardExternalWindowPermissionOpen && <div role="dialog" aria-modal aria-label="轻前端权限"
      data-agent-rp-surface="card-permissions" onMouseDown={event => {
      if (event.target === event.currentTarget) setCardExternalWindowPermissionOpen(false)
    }} style={{
      alignItems: 'center', background: 'rgba(0,0,0,.72)', display: 'flex', inset: 0, justifyContent: 'center',
      padding: '18px', position: 'fixed', zIndex: 1240,
    }}><section style={{
      background: 'var(--dsw-alias-bg-base, #121318)', border: '1px solid var(--dsw-alias-border-l2, #3b3d45)',
      borderRadius: '14px', boxShadow: '0 22px 72px rgba(0,0,0,.5)', display: 'grid', gap: '12px',
      maxHeight: 'min(82vh, 720px)', maxWidth: '620px', overflow: 'auto', padding: '16px', width: 'min(92vw, 620px)',
    }}>
      <header style={{ alignItems: 'center', display: 'flex', gap: '10px' }}>
        <div style={{ flex: '1 1 auto' }}><strong style={{ display: 'block', fontSize: '14px' }}>轻前端权限</strong>
          <span style={{ fontSize: '11px', opacity: .58 }}>当前角色卡 · 按能力和目标来源分别保存</span></div>
        <button type="button" aria-label="关闭轻前端权限" onClick={() => {
          setCardExternalWindowPermissionOpen(false)
        }} style={{
          background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '20px', padding: '2px 6px',
        }}>×</button>
      </header>
      <p style={{ fontSize: '12px', lineHeight: 1.6, margin: 0, opacity: .7 }}>
        本机身份证明由 Host 签名并绑定目标来源；私钥不会交给轻前端。旧式外部登录仍使用隔离面板。
      </p>
      {cardNativeIdentityRequests.size > 0 && nativeIdentityState !== 'ready' && <p role="status" style={{
        color: 'var(--dsw-alias-state-warning, #d6a955)', fontSize: '12px', lineHeight: 1.55, margin: 0,
      }}>请先在 DSH 设置的 Agent RP 页面创建本机身份，再确认身份请求。</p>}
      <div style={{ display: 'grid', gap: '8px' }}>
        {cardPermissionCount === 0
          ? <span style={{ fontSize: '12px', opacity: .62, padding: '8px 0' }}>当前没有待确认权限。</span>
          : <>
            {[...cardNativeIdentityRequests.values()].map(request => {
              const approval = nativeIdentityApprovalKey(
                request.application, request.audience, request.includeDisplayName,
              )
              return <button type="button" key={`identity:${request.key}`}
                disabled={nativeIdentityState !== 'ready'}
                title={nativeIdentityState === 'ready'
                  ? `允许这个轻前端向 ${request.audience} 出示五分钟有效的 DSH 本机身份证明；私钥不会离开 Host`
                  : '请先在 DSH 设置的 Agent RP 页面创建本机身份'}
                onClick={() => {
                  const next = new Set(approvedCardNativeIdentities)
                  next.add(approval)
                  writeApprovedNativeIdentities(next)
                  setApprovedCardNativeIdentities(next)
                  setCardNativeIdentityRequests(current => {
                    const remaining = new Map(current)
                    remaining.delete(request.key)
                    return remaining
                  })
                  const target = request.token === undefined
                    ? request.target : cardFramesByTokenRef.current.get(request.token)?.contentWindow ?? request.target
                  void deliverNativeIdentityResult(request, target)
                }} style={{
                  background: 'transparent', border: '1px solid var(--dsw-alias-state-warning, #9f7934)',
                  borderRadius: '9px', color: 'inherit', cursor: nativeIdentityState === 'ready' ? 'pointer' : 'not-allowed',
                  font: 'inherit', fontSize: '12px', opacity: nativeIdentityState === 'ready' ? 1 : .55,
                  lineHeight: 1.45, padding: '9px 11px', textAlign: 'left', width: '100%',
                }}>允许 {projection.characterName} 向 {new URL(request.audience).hostname}
                  证明本机身份{request.includeDisplayName ? '并分享显示名称' : ''}</button>
            })}
            {[...cardExternalWindowRequests.values()].map(request => <button type="button" key={request.key}
            title={`打开只连接 ${request.hostname} 的隔离登录面板`} onClick={() => {
              const broker = openExternalWindowBroker({
                hostWindow: window,
                url: request.url,
                hostname: request.hostname,
                requesterName: projection.characterName,
                runtime: 'card-frame-v0',
                requestId: request.requestId,
                resolveTarget: () => cardFramesByTokenRef.current.get(request.token)?.contentWindow,
                onClosed: () => {
                  cardExternalWindowBrokers.current.delete(request.key)
                  const target = cardFramesByTokenRef.current.get(request.token)?.contentWindow ?? request.target
                  target.postMessage({
                    source: 'dsh-agent-rp-host', action: 'external-window-closed', requestId: request.requestId,
                  }, '*')
                },
                onStateChange: state => { setCardExternalWindowPhase(state.phase) },
              })
              setCardExternalWindowRequests(current => {
                const next = new Map(current)
                next.delete(request.key)
                return next
              })
              if (broker === undefined) {
                request.target.postMessage({
                  source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.external-window.open',
                  requestId: request.requestId, ok: false, error: '无法创建外部登录隔离面板',
                }, '*')
                return
              }
              cardExternalWindowBrokers.current.set(request.key, broker)
              request.target.postMessage({
                source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.external-window.open',
                requestId: request.requestId, ok: true,
              }, '*')
              setCardExternalWindowPermissionOpen(false)
            }} style={{
              background: 'transparent', border: '1px solid var(--dsw-alias-state-warning, #9f7934)', borderRadius: '9px',
              color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px', lineHeight: 1.45,
              padding: '9px 11px', textAlign: 'left', width: '100%',
            }}>打开 {request.hostname} 登录页（{projection.characterName}）</button>)}
          </>}
      </div>
    </section></div>}
    <TavernScriptRuntime key={sessionId} ctx={ctx} debugEnabled={debugEnabled} inputActions={inputActions}
      {...(storedCharacterRuntime === undefined ? {} : { characterDisplayRegexScripts: storedCharacterRuntime.displayRegexScripts })}
      runtimeDiagnostics={runtimeDiagnostics}
      onCompatibilityMarkersChange={onCompatibilityMarkersChange} onDisplayOverride={onDisplayOverride} projection={projection}
      runGeneration={runTavernGeneration} runModelList={runTavernModelList} runMutation={runTavernMutation}
      runPresetConfiguration={runPresetConfiguration} runPromptPreview={runTavernPromptPreview}
      runTrigger={runTavernTrigger} sessionId={sessionId} />
    {cardPermissionCount > 0 && <button type="button" title={`${cardPermissionCount} 项轻前端权限待确认`}
      onClick={() => { setCardExternalWindowPermissionOpen(true) }} style={{
        background: 'color-mix(in srgb, var(--dsw-alias-state-warning, #d5a64c) 12%, transparent)',
        border: '1px solid var(--dsw-alias-state-warning, #9f7934)', borderRadius: '7px', color: 'inherit',
        cursor: 'pointer', font: 'inherit', fontSize: '11px', padding: '3px 7px',
      }}>轻前端权限 {cardPermissionCount}</button>}
    <button type="button" aria-label="生成聊天插图" title="生成聊天插图" onClick={() => { setDrawOpen(true) }} style={{
      alignItems: 'center', background: 'transparent', border: 0, borderRadius: '7px', color: 'inherit', cursor: 'pointer',
      display: 'inline-flex', flex: '0 0 auto', font: 'inherit', fontSize: '11px', gap: '4px', opacity: .62, padding: '3px 7px',
    }}><span aria-hidden="true" style={{ color }}>✦</span>绘图</button>
    <RoleplayStatusLine projection={summary?.title?.trim() && summary.title.trim() !== projection.characterName
      ? { ...projection, characterName: summary.title.trim() }
      : projection} running={useSession(state => state.running)} />
    {drawOpen && <ImageGenerationDialog projection={projection} onClose={() => { setDrawOpen(false) }}
      onGenerate={request => { runImageGeneration(sessionId, request) }} />}
  </div>
  }
}

function RoleplayStatusLine({ projection, running }: {
  readonly projection: AgentRpProjection
  readonly running: boolean
}) {
  const parts = [
    projection.userName === undefined ? undefined : `你是 ${projection.userName}`,
    projection.worldInfoCount === 0 ? undefined : `世界书 ${projection.worldInfoCount} 条`,
    projection.importedMessageCount === 0 ? undefined : `已迁移 ${projection.importedMessageCount} 条历史`,
  ].filter((part): part is string => part !== undefined)
  if (!running && parts.length === 0) return null
  return <div data-agent-rp-status-line style={{ alignItems: 'center', display: 'flex', fontSize: '11px', gap: '8px', minHeight: '18px', opacity: 0.5, padding: '0 10px' }}>
    {running && <span>{projection.characterName}正在回应</span>}
    {running && parts.length > 0 && <span>·</span>}
    {parts.length > 0 && <span>{parts.join(' · ')}</span>}
  </div>
}

const hintStyle = {
  alignItems: 'center', background: `color-mix(in srgb, ${color} 8%, transparent)`,
  border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`, borderRadius: '10px',
  display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '9px 12px',
} as const

const markStyle = {
  alignItems: 'center', background: `color-mix(in srgb, ${color} 16%, transparent)`, borderRadius: '8px',
  display: 'flex', flex: '0 0 30px', fontSize: '16px', height: '30px', justifyContent: 'center',
} as const

const actionStyle = {
  background: `color-mix(in srgb, ${color} 12%, transparent)`,
  border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`, borderRadius: '7px', color: 'inherit',
  cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '5px 9px',
} as const

function importHintComponent(
  ctx: Context,
  runtimeDiagnostics: AgentRpRuntimeDiagnosticRegistry,
  prepareChatMigration: HeaderProps['prepareChatMigration'],
  prepareRpDistributionChatMigration: HeaderProps['prepareRpDistributionChatMigration'],
  launchPreparedChatMigration: HeaderProps['launchPreparedChatMigration'],
  listCharacters: HeaderProps['listCharacters'],
  listPresets: HeaderProps['listPresets'],
): (props: ImportHintProps) => JSX.Element | null {
  return function SillyTavernImportHint({ input, inputActions, sessionId }: ImportHintProps): JSX.Element | null {
    const [migrationOpen, setMigrationOpen] = useState(false)
    const [jsonKind, setJsonKind] = useState<SillyTavernJsonKind>()
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    const scoped = ctx.sessions.scope(sessionId)
    const conversation = scoped?.get('conversation') as (IConversation & Partial<DraftResolver>) | undefined
    const ids = [...new Set([...(input.attachmentIds ?? []), ...(input.imageIds ?? [])])]
    const draftAttachments = conversation?.draftAttachments
    const attachments = typeof draftAttachments === 'function' ? draftAttachments.call(conversation, ids) : []
    const selected = selectSillyTavernDraft(attachments)
    const jsonFile = selected?.kind === 'json-resource' && attachments.length === 1
      ? attachments[0]?.file : undefined
    useEffect(() => {
      let current = true
      setJsonKind(undefined)
      if (jsonFile === undefined) return () => { current = false }
      void classifySillyTavernJsonFile(jsonFile).then(value => {
        if (current) setJsonKind(value)
      }, () => {
        if (current) setJsonKind('unknown')
      })
      return () => { current = false }
    }, [jsonFile])
    const inferredDraft = jsonKind === 'character-card' ? '请导入这张角色卡'
      : jsonKind === 'world-info' ? '请导入这本世界书'
        : jsonKind === 'preset' ? '请导入这份预设' : undefined
    useEffect(() => {
      if (isAgentRpCapabilityPresetId(sessionAgentPreset(summary)) && input.draft.trim() === '' && inferredDraft !== undefined) {
        inputActions.setDraft(inferredDraft)
      }
    }, [inferredDraft, input.draft, inputActions, summary?.projectionValues?.agentPreset])
    if (!isAgentRpCapabilityPresetId(sessionAgentPreset(summary))) return null
    if (selected === undefined) return null
    const blank = input.draft.trim() === ''
    const chat = selected.kind === 'chat'
    const migration = selected.kind === 'migration'
    const chatAttachment = (chat || migration) ? attachments.find(attachment =>
      attachment.kind === 'file' && /\.jsonl$/iu.test(attachment.file.name)) : undefined
    const cardAttachment = migration ? attachments.find(attachment => attachment !== chatAttachment) : undefined
    const releaseDraft = (): void => {
      const actions = inputActions as typeof inputActions & {
        readonly removeAttachment?: (id: string) => void
        readonly removeImage?: (id: string) => void
      }
      for (const attachment of attachments) {
        actions.removeAttachment?.(attachment.id)
        actions.removeImage?.(attachment.id)
        conversation?.releaseDraftAttachment?.(attachment.id)
      }
    }
    return <>
      <div style={hintStyle} role="status">
      <div style={markStyle} aria-hidden="true">↗</div>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.45 }}>
          {migration ? '迁移角色与对话' : chat ? '导入历史对话' : selected.kind === 'character-card'
            ? '识别到 CHARX 角色卡' : jsonKind === 'character-card' ? '识别到角色卡'
              : jsonKind === 'world-info' ? '识别到世界书' : jsonKind === 'preset' ? '识别到聊天补全预设'
                : jsonKind === 'regex-pack' ? '识别到独立正则包'
                : selected.kind === 'json-resource' ? '识别到 JSON 资源' : '识别到 PNG 图片'}
          <span style={{ fontWeight: 400, marginLeft: '6px', opacity: 0.72 }}>{selected.name}</span>
        </div>
        <div style={{ fontSize: '12px', lineHeight: 1.45, marginTop: '2px', opacity: 0.62 }}>{migration
          ? '将创建一个角色会话，并保留原聊天历史'
          : chat ? '将从这份记录创建新的角色会话'
              : selected.kind === 'json-resource' && jsonKind === undefined ? '正在安全识别资源类型…'
                : jsonKind === 'regex-pack' ? '请在 Agent RP 资源中心的“正则包”中导入并选择使用'
              : inferredDraft !== undefined ? '已自动选择导入类型；发送后开始导入'
                : blank ? '无法确定资源类型，请手动选择' : '发送后开始导入'}</div>
      </div>
      {(chat || migration) && <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
        <button type="button" style={actionStyle} onClick={() => { setMigrationOpen(true) }}>
          {migration ? '迁移' : '导入'}
        </button>
      </div>}
      {!chat && !migration && blank && (selected.kind !== 'json-resource' || jsonKind === 'unknown') && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginLeft: 'auto' }}>
        <button type="button" style={actionStyle} onClick={() => { inputActions.setDraft('请导入这张角色卡') }}>角色卡</button>
        {selected.kind === 'json-resource' && <button type="button" style={actionStyle} onClick={() => { inputActions.setDraft('请导入这本世界书') }}>世界书</button>}
        {selected.kind === 'json-resource' && <button type="button" style={actionStyle} onClick={() => { inputActions.setDraft('请导入这份预设') }}>预设</button>}
      </div>}
      </div>
      {migrationOpen && chatAttachment !== undefined && createPortal(<SillyTavernImportDialog
        runtimeDiagnostics={runtimeDiagnostics}
        listCharacters={listCharacters}
        listPresets={listPresets}
        initialChatFile={chatAttachment.file}
        {...(cardAttachment === undefined ? {} : { initialCardFile: cardAttachment.file })}
        onClose={() => { setMigrationOpen(false) }}
        onPrepare={(chatFile, cardFile, characterId) => prepareChatMigration(sessionId, chatFile, cardFile, characterId)}
        onPrepareRpDistribution={(target, remoteSessionId) => prepareRpDistributionChatMigration(
          sessionId, target, remoteSessionId,
        )}
        onLaunch={(prepared, presetId, resourcePermissions) => launchPreparedChatMigration(
          sessionId, prepared, presetId, resourcePermissions,
        )}
        onCompleted={releaseDraft}
      />, document.body)}
    </>
  }
}

function avatarLoader(ctx: ClientContext) {
  return async (attachmentId: string): Promise<string | undefined> => {
    const state = ctx.sessions.list.getSnapshot()
    const sessionId = state.current
    if (sessionId === undefined) return undefined
    const scope = ctx.sessions.scope(sessionId)
    const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
    if (session === undefined) return undefined
    const result = await session.readAttachment(attachmentId as ImageAttachmentRef['attachmentId'])
    if (!result.ok) return undefined
    const bytes = new Uint8Array(result.value.data).slice().buffer
    const blob = new Blob([bytes], { type: result.value.attachment.mediaType })
    return URL.createObjectURL(blob)
  }
}

function SessionLaunchNoticeToast({ source }: { readonly source: SessionLaunchNoticeSource }): ReactElement | null {
  const notice = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  useEffect(() => {
    if (notice === undefined) return
    const timer = window.setTimeout(() => { source.clear(notice.id) }, 12_000)
    return () => { window.clearTimeout(timer) }
  }, [notice, source])
  if (notice === undefined) return null
  return <div role="alert" data-agent-rp-session-launch-notice style={{
    position: 'absolute', top: '18px', right: '18px', width: 'min(420px, calc(100vw - 36px))',
    border: '1px solid color-mix(in srgb, #d5a64c 62%, transparent)', borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-2, #252528)', boxShadow: '0 14px 40px rgba(0,0,0,.32)',
    color: 'var(--dsw-alias-label-primary, #f2f2f2)', padding: '12px 38px 12px 14px',
    pointerEvents: 'auto', zIndex: 1,
  }}>
    <strong style={{ display: 'block', fontSize: '13px', lineHeight: 1.45 }}>新角色会话未加入工作区</strong>
    <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.55, marginTop: '3px', opacity: .76 }}>
      {notice.message}
    </span>
    <button type="button" aria-label="关闭工作区提示" onClick={() => { source.clear(notice.id) }} style={{
      position: 'absolute', top: '7px', right: '8px', width: '26px', height: '26px', border: 0,
      borderRadius: '7px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '18px',
    }}>×</button>
  </div>
}

/** Client services required by the Roleplay shell. */
export const inject = ['remote', 'remote.session', 'uiConversation', 'slots', 'sessions', 'workspaces']

/** Register the Agent RP header, composer presentation, and import affordance. */
export function apply(ctx: ClientContext): void {
  const storyWorkspaceNavigation = createStoryWorkspaceNavigation()
  const installedStExtensions = new InstalledStExtensionRegistry()
  const installedStExtensionSurface = new InstalledStExtensionSurface()
  const installedStSettingsOwner = installedStExtensionSettingsIdentity()
  const installedStExtensionSessionSource = {
    current: () => {
      const state = ctx.sessions.list.getSnapshot()
      const sessionId = state.current
      if (sessionId === undefined) return undefined
      const projection = state.byId[sessionId]?.projectionValues?.agentRp
      return {
        sessionId,
        ...(projection === undefined ? {} : { projection }),
      }
    },
    subscribe: (listener: () => void) => ctx.sessions.list.subscribe(listener),
  }
  const installedStExtensionSettingsStore = {
    read: () => readTavernExtensionSettings(installedStSettingsOwner, window.localStorage),
    write: (settings: Readonly<Record<string, JsonValue>>) => writeTavernExtensionSettings(
      installedStSettingsOwner,
      settings,
    ),
  }
  ctx.provide(AGENT_RP_ST_EXTENSION_SERVICE, installedStExtensions)
  ctx.effect(() => installStExtensionSurface(window, document, installedStExtensionSurface))
  installRoleplayArtifactTail(ctx)
  installStoryWorkspaceSessionCard(ctx, storyWorkspaceNavigation)
  const runtimeDiagnostics = new AgentRpRuntimeDiagnosticRegistry()
  ctx.effect(() => installAgentRpRuntimeDiagnostic(window, runtimeDiagnostics))
  ctx.effect(() => installAgentRpBrowserCompatibilityDiagnostic(window, document, runtimeDiagnostics))
  ctx.effect(() => installAgentRpNativeBack(window, document))
  ctx.effect(() => installAgentRpNativeShare(window, document))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.agentRpResponsive = ''
    style.textContent = agentRpResponsiveStyle
    document.head.append(style)
    return () => { style.remove() }
  })
  const workspaceSettings = createWorkspaceSettingsSource()
  const sessionLaunchNotices = createSessionLaunchNoticeSource()
  const workspaceList: WorkspaceListSource = {
    getSnapshot: () => ctx.workspaces.list.getSnapshot(),
    subscribe: listener => ctx.workspaces.list.subscribe(listener),
  }
  const loadAvatar = avatarLoader(ctx)
  const readModelCatalog = async (sessionId: SessionId): Promise<AvailableModelCatalog> => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error('当前角色会话不可用')
    const result = await ctx.remote.session.modelCatalog()
    if (!result.ok) throw new Error(result.error.message)
    const selection = binding.session.projections.faceOf('modelSelection').getSnapshot() as unknown as
      ModelSelectionProjection | undefined
    return availableModelCatalog(result.value, selection)
  }
  const loadModelCapabilities = async (sessionId: SessionId): Promise<CurrentModelCapabilities> => {
    const catalog = await readModelCatalog(sessionId)
    const provider = catalog.groups.find(group => group.id === catalog.current.provider)
    const model = provider?.models.find(entry => entry.id === catalog.current.model)
    return {
      current: catalog.current,
      ...(provider === undefined ? {} : { providerName: provider.name }),
      ...(model === undefined ? {} : {
        modelName: model.name,
        reasoning: model.reasoning ?? { efforts: [] },
      }),
    }
  }
  const loadWorkerModelCatalog = async (): Promise<AvailableModelCatalog> => {
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) throw new Error('请先选择一个会话，以读取已配置的模型')
    return readModelCatalog(sessionId)
  }
  const renameSession = async (sessionId: SessionId, title: string): Promise<void> => {
    const scope = ctx.sessions.scope(sessionId)
    const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
    if (session === undefined) throw new Error('当前角色会话不可用')
    const result = await session.rename(title)
    if (!result.ok) throw new Error(result.error.message)
  }
  const exportChat = async (sessionId: SessionId): Promise<void> => {
    const response = await fetch(`${SILLYTAVERN_CHAT_EXPORT_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { accept: 'application/x-ndjson, application/json' },
    })
    if (!response.ok) {
      const source = await response.text()
      let message: string | undefined
      try {
        message = (JSON.parse(source) as { readonly error?: string }).error
      } catch (_invalidJson) {
        message = undefined
      }
      throw new Error(message ?? `聊天导出失败（${response.status}）`)
    }
    const encodedFilename = response.headers.get('x-agent-rp-filename')
    const filename = encodedFilename === null ? 'Agent-RP-对话.jsonl' : decodeURIComponent(encodedFilename)
    const objectUrl = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    try {
      link.href = objectUrl
      link.download = filename
      document.body.append(link)
      link.click()
    } finally {
      link.remove()
      window.setTimeout(() => { URL.revokeObjectURL(objectUrl) }, 0)
    }
  }
  const listMemory = async (sessionId: SessionId): Promise<readonly AgentRpMemoryView[]> => {
    const response = await fetch(`${AGENT_RP_MEMORY_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { accept: 'application/json' },
    })
    const value = await response.json() as Partial<AgentRpMemoryResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || !Array.isArray(value.memories)
      || value.memories.some(memory => typeof memory !== 'object' || memory === null
        || typeof memory.id !== 'string' || typeof memory.subject !== 'string' || typeof memory.text !== 'string'
        || !['fact', 'promise', 'relationship', 'preference', 'event'].includes(memory.kind)
        || (memory.source !== 'character' && memory.source !== 'user' && memory.source !== 'inherited'))) {
      throw new Error(value.error ?? `记忆读取失败（${response.status}）`)
    }
    return value.memories
  }
  const manageMemory = async (sessionId: SessionId, request: AgentRpMemoryCommandRequest): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-memory ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用记忆管理')
  }
  const manageState = async (sessionId: SessionId, request: RoleplayStateCommandRequest): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-state ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用状态管理')
  }
  const manageTurnMode = async (
    sessionId: SessionId,
    mode: AgentRpProjection['turnMode'],
  ): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-turn-mode ${JSON.stringify({ format: 0, mode })}`)
    if (!response.matched) throw new Error('当前 Host 未启用回合方式切换')
  }
  const listCharacters = async (collection: CharacterLibraryCollection = 'active'): Promise<readonly CharacterLibrarySummary[]> => {
    const query = collection === 'active' ? '' : '?collection=archived'
    const value = await characterLibraryJson<{ readonly format: 0; readonly entries: readonly CharacterLibrarySummary[] }>(query)
    return value.entries
  }
  const readCharacter = async (id: string): Promise<CharacterLibraryDetail> => {
    const value = await characterLibraryJson<{ readonly format: 0; readonly entry: CharacterLibraryDetail }>(`/${encodeURIComponent(id)}`)
    return value.entry
  }
  const setCharacterArchived = async (id: string, archived: boolean): Promise<CharacterLibraryDetail> => {
    const operation = archived ? 'archive' : 'restore'
    const response = await fetch(`${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(id)}/${operation}`, {
      method: 'POST', headers: { accept: 'application/json' },
    })
    const value = await response.json() as { readonly error?: string; readonly format?: 0; readonly entry?: CharacterLibraryDetail }
    if (!response.ok || value.entry === undefined) throw new Error(value.error ?? `角色库请求失败（${response.status}）`)
    return value.entry
  }
  const deleteCharacter = async (id: string): Promise<void> => {
    const response = await fetch(`${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { accept: 'application/json' },
    })
    const value = await response.json() as Partial<CharacterLibraryDeleteResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || value.id !== id) {
      throw new Error(value.error ?? `角色卡删除失败（${response.status}）`)
    }
    notifyCharacterLibraryChanged(id)
  }
  const importCharacterFile = async (file: File): Promise<CharacterLibraryImportResult> => {
    const response = await fetch(`${CHARACTER_LIBRARY_PATH}/import?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    const value = await response.json() as {
      readonly error?: string
      readonly format?: 0
      readonly entry?: CharacterLibraryDetail
      readonly outcome?: CharacterLibraryImportResult['outcome']
    }
    if (!response.ok || value.entry === undefined || value.outcome === undefined) {
      throw new Error(value.error ?? `角色卡导入失败（${response.status}）`)
    }
    return { entry: value.entry, outcome: value.outcome }
  }
  const launchRoleplaySession = async (
    request: AgentRpSessionLaunchRequest,
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ): Promise<SessionId> => {
    const response = await fetch(AGENT_RP_SESSION_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const responseText = await response.text()
    let value: { readonly error?: string } & Partial<AgentRpSessionLaunchResponse>
    try {
      value = JSON.parse(responseText) as typeof value
    } catch {
      throw new Error(response.ok ? 'Host 返回了无法识别的角色会话' : `角色会话创建失败（${response.status}）`)
    }
    if (!response.ok || value.sessionId === undefined) {
      throw new Error(value.error ?? `角色会话创建失败（${response.status}）`)
    }
    if (value.workspaceWarning !== undefined) console.warn(`Agent RP：${value.workspaceWarning}`)
    const sessionId = value.sessionId as SessionId
    if (resourcePermissions !== undefined) {
      writeAgentRpSessionResourcePermissions(
        window.sessionStorage, String(sessionId), resourcePermissions, window,
      )
    }
    await (ctx.sessions as unknown as { refresh(): Promise<void> }).refresh()
    if (ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) {
      throw new Error('角色会话已创建，但客户端尚未收到它；请刷新页面后重试')
    }
    ctx.sessions.open(sessionId)
    if (value.workspaceWarning !== undefined) sessionLaunchNotices.publish(value.workspaceWarning)
    return sessionId
  }
  const rewriteTurn = async (sourceSessionId: SessionId, turn: number, draft: string): Promise<void> => {
    await launchRoleplaySession({
      format: 0,
      sourceSessionId,
      kind: 'rewrite',
      turn,
      text: draft,
    })
  }
  const retainRpDistributionChat = async (
    target: string,
    sessionId: string,
  ): Promise<RpDistributionChatImportResponse> => {
    const response = await fetch(RP_DISTRIBUTION_BRIDGE_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, operation: 'import-chat', target, sessionId }),
    })
    const value = await response.json() as Partial<RpDistributionChatImportResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || value.operation !== 'import-chat'
      || typeof value.target !== 'string' || typeof value.sourceSessionId !== 'string'
      || typeof value.importId !== 'string' || typeof value.filename !== 'string'
      || typeof value.messageCount !== 'number' || typeof value.characterName !== 'string'
      || typeof value.userName !== 'string') {
      throw new Error(value.error ?? `模块化 RP 会话迁移失败（${response.status}）`)
    }
    return value as RpDistributionChatImportResponse
  }
  const startCharacterSession = async (
    sessionId: SessionId,
    character: CharacterLibraryDetail,
    greetingIndex: number,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    memory?: 'copy-active',
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ): Promise<void> => {
    if (memory === undefined && (worldInfoIds !== undefined || regexPackIds !== undefined)) {
      await launchRoleplaySession(characterExperienceLaunchRequest({
        sourceSessionId: sessionId,
        characterId: character.id,
        greetingIndex,
        ...(persona === undefined ? {} : { persona }),
        ...(presetId === undefined ? {} : { presetId }),
        ...(agentPresetId === undefined ? {} : { agentPresetId }),
        worldInfoIds: worldInfoIds ?? [],
        ...(regexPackIds === undefined ? {} : { regexPackIds }),
      }), resourcePermissions)
      return
    }
    await launchRoleplaySession({
      format: 0,
      sourceSessionId: sessionId,
      kind: 'character',
      characterId: character.id,
      greetingIndex,
      ...(persona === undefined ? {} : { persona }),
      ...(presetId === undefined ? {} : { presetId }),
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
      ...(worldInfoIds === undefined ? {} : { worldInfoIds }),
      ...(memory === undefined ? {} : { memory }),
    }, resourcePermissions)
  }
  const startWorldInfoSession = async (
    sessionId: SessionId,
    worldInfo: WorldInfoLibraryUpload,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ): Promise<void> => {
    if (worldInfoIds !== undefined || regexPackIds !== undefined) {
      await launchRoleplaySession(sceneExperienceLaunchRequest({
        sourceSessionId: sessionId,
        primaryWorldInfoId: worldInfo.id,
        ...(persona === undefined ? {} : { persona }),
        ...(presetId === undefined ? {} : { presetId }),
        ...(agentPresetId === undefined ? {} : { agentPresetId }),
        supportingWorldInfoIds: worldInfoIds ?? [],
        ...(regexPackIds === undefined ? {} : { regexPackIds }),
      }), resourcePermissions)
      return
    }
    await launchRoleplaySession({
      format: 0,
      sourceSessionId: sessionId,
      kind: 'world-info',
      importId: worldInfo.id,
      ...(persona === undefined ? {} : { persona }),
      ...(presetId === undefined ? {} : { presetId }),
      ...(agentPresetId === undefined ? {} : { agentPresetId }),
      ...(worldInfoIds === undefined ? {} : { worldInfoIds }),
    }, resourcePermissions)
  }
  const archiveConsumedBlankSession = async (sessionId: SessionId): Promise<void> => {
    if (ctx.sessions.list.getSnapshot().byId[sessionId]?.blank !== true) return
    try {
      await ctx.workspaces.archiveSession(sessionId)
    } catch (reason: unknown) {
      ctx.logger.warn(`agent-rp: blank source Session ${JSON.stringify(sessionId)} remains visible: ${String(reason)}`)
    }
  }
  const startCharacterFromBlankSession = async (
    sessionId: SessionId,
    character: CharacterLibraryDetail,
    greetingIndex: number,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    _memory?: 'copy-active',
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ): Promise<void> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined || !summary.blank) throw new Error('只能从尚未开始的会话选择角色')
    await startCharacterSession(
      sessionId, character, greetingIndex, persona, presetId, worldInfoIds,
      undefined, resourcePermissions, agentPresetId, regexPackIds,
    )
    await archiveConsumedBlankSession(sessionId)
  }
  const startWorldInfoFromBlankSession = async (
    sessionId: SessionId,
    worldInfo: WorldInfoLibraryUpload,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ): Promise<void> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined || !summary.blank) throw new Error('只能从尚未开始的会话选择世界书剧情')
    await startWorldInfoSession(
      sessionId, worldInfo, persona, presetId, worldInfoIds, resourcePermissions, agentPresetId, regexPackIds,
    )
    await archiveConsumedBlankSession(sessionId)
  }
  const sendStoryWorkspaceTurn = async (sessionId: SessionId, workspaceId: string, request: string): Promise<void> => {
    const selected = await executeAgentRpCommand(sessionId, `/rp-story-workspace ${JSON.stringify({ format: 0, workspaceId })}`)
    if (!selected.matched) throw new Error('当前角色会话没有游玩场地命令')
    const conversation = ctx.sessions.scope(sessionId)?.get('conversation') as IConversation | undefined
    if (conversation === undefined) throw new Error('角色会话已经打开，但暂时还不能发送这一回合；请稍后重试')
    await conversation.send(request)
  }
  const startStoryWorkspaceFromBlankSession = async (sessionId: SessionId, workspaceId: string, request: string): Promise<void> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined || !summary.blank) throw new Error('只能从尚未开始的会话进入游玩场地')
    const launchedSessionId = await launchRoleplaySession({
      format: 0,
      sourceSessionId: String(sessionId),
      kind: 'story-workspace',
      workspaceId,
    })
    await archiveConsumedBlankSession(sessionId)
    const conversation = ctx.sessions.scope(launchedSessionId)?.get('conversation') as IConversation | undefined
    if (conversation === undefined) throw new Error('游玩会话已经创建，但暂时还不能发送第一回合；请稍后重试')
    await conversation.send(request)
  }
  const startCharacterFromCurrentSession = async (
    sessionId: SessionId,
    character: CharacterLibraryDetail,
    greetingIndex: number,
    persona?: SessionPersonaSnapshot,
    presetId?: string,
    worldInfoIds?: readonly string[],
    memory?: 'copy-active',
    resourcePermissions?: AgentRpSessionResourcePermissions,
    agentPresetId?: string,
    regexPackIds?: readonly string[],
  ): Promise<void> => {
    await startCharacterSession(
      sessionId, character, greetingIndex, persona, presetId, worldInfoIds,
      memory, resourcePermissions, agentPresetId, regexPackIds,
    )
  }
  const prepareChatMigration = async (
    sourceSessionId: SessionId,
    chatFile: File,
    cardFile?: File,
    characterId?: string,
  ): Promise<PreparedChatMigration> => {
    if (ctx.sessions.list.getSnapshot().byId[sourceSessionId] === undefined) throw new Error('来源会话当前不可用')
    if (!/\.jsonl$/iu.test(chatFile.name)) throw new Error('请选择 SillyTavern 导出的 JSONL 聊天记录')
    if (cardFile !== undefined && characterId !== undefined) throw new Error('只能选择一种角色卡来源')
    const character = characterId === undefined
      ? cardFile === undefined ? undefined : (await importCharacterFile(cardFile)).entry
      : await readCharacter(characterId)
    const response = await fetch(`${SILLYTAVERN_CHAT_PATH}?filename=${encodeURIComponent(chatFile.name)}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': chatFile.type || 'application/x-ndjson' },
      body: chatFile,
    })
    const responseText = await response.text()
    let value: { readonly error?: string } & Partial<SillyTavernChatUploadResponse>
    try {
      value = JSON.parse(responseText) as typeof value
    } catch {
      throw new Error(response.ok ? 'Host 返回了无法识别的聊天迁移结果' : `聊天记录上传失败（${response.status}）`)
    }
    if (!response.ok || value.upload === undefined) throw new Error(value.error ?? `聊天记录上传失败（${response.status}）`)
    return {
      importId: value.upload.id,
      permissionOwnerId: chatMigrationPermissionOwnerId({
        ...(character === undefined ? {} : { characterId: character.id }),
        ...(value.upload.characterName === undefined ? {} : { chatCharacterName: value.upload.characterName }),
      }),
      ...(character === undefined ? {} : { character }),
    }
  }
  const prepareRpDistributionChatMigration = async (
    sourceSessionId: SessionId,
    target: string,
    remoteSessionId: string,
  ): Promise<PreparedChatMigration> => {
    if (ctx.sessions.list.getSnapshot().byId[sourceSessionId] === undefined) throw new Error('来源会话当前不可用')
    const imported = await retainRpDistributionChat(target, remoteSessionId)
    try { window.localStorage.setItem(RP_DISTRIBUTION_TARGET_KEY, imported.target) } catch {}
    return {
      importId: imported.importId,
      permissionOwnerId: chatMigrationPermissionOwnerId({ chatCharacterName: imported.characterName }),
    }
  }
  const launchPreparedChatMigration = async (
    sourceSessionId: SessionId,
    prepared: PreparedChatMigration,
    presetId?: string,
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ): Promise<void> => {
    await launchRoleplaySession({
      format: 0,
      sourceSessionId,
      kind: 'chat',
      importId: prepared.importId,
      ...(prepared.character === undefined ? {} : { characterId: prepared.character.id }),
      ...(presetId === undefined ? {} : { presetId }),
    }, resourcePermissions)
  }
  const prepareChatMigrationFromBlankSession = async (
    sourceSessionId: SessionId,
    chatFile: File,
    cardFile?: File,
  ): Promise<PreparedChatMigration> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sourceSessionId]
    if (summary === undefined || !summary.blank) throw new Error('只能从尚未开始的会话迁移聊天')
    return prepareChatMigration(sourceSessionId, chatFile, cardFile)
  }
  const prepareRpDistributionChatMigrationFromBlankSession = async (
    sourceSessionId: SessionId,
    target: string,
    remoteSessionId: string,
  ): Promise<PreparedChatMigration> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sourceSessionId]
    if (summary === undefined || !summary.blank) throw new Error('只能从尚未开始的会话迁移聊天')
    return prepareRpDistributionChatMigration(sourceSessionId, target, remoteSessionId)
  }
  const launchPreparedChatMigrationFromBlankSession = async (
    sourceSessionId: SessionId,
    prepared: PreparedChatMigration,
    presetId?: string,
    resourcePermissions?: AgentRpSessionResourcePermissions,
  ): Promise<void> => {
    const summary = ctx.sessions.list.getSnapshot().byId[sourceSessionId]
    if (summary === undefined || !summary.blank) throw new Error('只能从尚未开始的会话迁移聊天')
    await launchPreparedChatMigration(sourceSessionId, prepared, presetId, resourcePermissions)
    await archiveConsumedBlankSession(sourceSessionId)
  }
  const personaLibraryJson = async <T,>(
    init?: { readonly method: 'POST'; readonly body: PersonaLibrarySaveRequest },
  ): Promise<T> => {
    const response = await fetch(PERSONA_LIBRARY_PATH, init === undefined ? {
      headers: { accept: 'application/json' },
    } : {
      method: init.method,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(init.body),
    })
    const value = await response.json() as { readonly error?: string } & T
    if (!response.ok) throw new Error(value.error ?? `Persona 库请求失败（${response.status}）`)
    return value
  }
  const listPersonas = async (): Promise<readonly PersonaLibraryEntry[]> => {
    const value = await personaLibraryJson<{ readonly format: 0; readonly entries: readonly PersonaLibraryEntry[] }>()
    return value.entries
  }
  const listPresets = async (): Promise<readonly PresetLibrarySummary[]> => {
    const response = await fetch(PRESET_LIBRARY_PATH, { headers: { accept: 'application/json' } })
    const value = await response.json() as Partial<PresetLibraryListResponse> & { readonly error?: string }
    if (!response.ok || value.entries === undefined) throw new Error(value.error ?? `预设库请求失败（${response.status}）`)
    return value.entries
  }
  const listAgentCapabilityPresets = async (): Promise<readonly AgentRpCapabilityPresetSummary[]> => {
    const response = await fetch(AGENT_RP_CAPABILITY_PRESETS_PATH, { headers: { accept: 'application/json' } })
    const value = await response.json() as Partial<AgentRpCapabilityPresetListResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || !Array.isArray(value.entries)) {
      throw new Error(value.error ?? `Agent 能力读取失败（${response.status}）`)
    }
    return value.entries
  }
  const listWorldInfos = async (): Promise<readonly WorldInfoLibraryUpload[]> => {
    const response = await fetch(WORLD_INFO_LIBRARY_PATH, { headers: { accept: 'application/json' } })
    const value = await response.json() as Partial<WorldInfoLibraryListResponse> & { readonly error?: string }
    if (!response.ok || value.entries === undefined) throw new Error(value.error ?? `世界书来源读取失败（${response.status}）`)
    return value.entries
  }
  const savePersona = async (request: PersonaLibrarySaveRequest): Promise<PersonaLibraryEntry> => {
    const value = await personaLibraryJson<{ readonly format: 0; readonly entry: PersonaLibraryEntry }>({ method: 'POST', body: request })
    return value.entry
  }
  const deletePersona = async (id: string): Promise<PersonaLibraryEntry> => {
    const response = await fetch(`${PERSONA_LIBRARY_PATH}/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { accept: 'application/json' },
    })
    const value = await response.json() as { readonly error?: string; readonly format?: 0; readonly entry?: PersonaLibraryEntry }
    if (!response.ok || value.entry === undefined) throw new Error(value.error ?? `Persona 移除失败（${response.status}）`)
    return value.entry
  }
  const applyPersona = async (sessionId: SessionId, persona?: SessionPersonaSnapshot): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-persona ${JSON.stringify({
      format: 0,
      ...(persona === undefined ? {} : { persona }),
    })}`)
    if (!response.matched) throw new Error('当前 Host 未启用身份管理')
  }
  const importPresetFile = async (file: File): Promise<PresetLibrarySummary> => {
    if (!/\.json$/iu.test(file.name)) throw new Error('请选择 SillyTavern 预设 JSON 文件')
    const response = await fetch(`${PRESET_LIBRARY_PATH}?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': file.type || 'application/json' },
      body: file,
    })
    const value = await response.json() as Partial<PresetLibraryImportResponse> & { readonly error?: string }
    if (!response.ok || value.entry === undefined) throw new Error(value.error ?? `预设导入失败（${response.status}）`)
    const entries = await listPresets()
    const entry = entries.find(candidate => candidate.id === value.entry?.id)
    if (entry === undefined) throw new Error('预设已导入，但预设库没有返回对应条目')
    return entry
  }
  const importPreset = async (sessionId: SessionId, file: File): Promise<void> => {
    const entry = await importPresetFile(file)
    await managePresetLibrary(sessionId, { operation: 'select', id: entry.id })
  }
  const configurePreset = async (sessionId: SessionId, request: PresetConfigurationRequest): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-preset-configure ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用预设管理命令')
  }
  const managePresetLibrary = async (sessionId: SessionId, request: PresetLibraryRequest): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-preset-library ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用预设库')
  }
  const configureWorldInfo = async (sessionId: SessionId, request: WorldInfoConfigurationRequest): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-world-info ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用世界书管理')
  }
  const importWorldInfoFile = async (file: File): Promise<WorldInfoLibraryUpload> => {
    if (!/\.json$/iu.test(file.name)) throw new Error('请选择 SillyTavern World Info JSON 文件')
    const response = await fetch(`${WORLD_INFO_LIBRARY_PATH}?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': file.type || 'application/json' },
      body: file,
    })
    const value = await response.json() as Partial<WorldInfoLibraryUploadResponse> & { readonly error?: string }
    if (!response.ok || value.upload === undefined) throw new Error(value.error ?? `世界书上传失败（${response.status}）`)
    return value.upload
  }
  const setWorldInfoDefault = async (id: string, enabled: boolean): Promise<WorldInfoLibraryUpload> => {
    const response = await fetch(WORLD_INFO_LIBRARY_PATH, {
      method: 'PATCH',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, id, defaultForNewSessions: enabled }),
    })
    const value = await response.json() as Partial<WorldInfoLibraryUploadResponse> & { readonly error?: string }
    if (!response.ok || value.upload === undefined) throw new Error(value.error ?? `世界书默认加载设置失败（${response.status}）`)
    return value.upload
  }
  const deleteWorldInfo = async (id: string): Promise<WorldInfoLibraryUpload> => {
    const response = await fetch(WORLD_INFO_LIBRARY_PATH, {
      method: 'DELETE',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, id }),
    })
    const value = await response.json() as Partial<WorldInfoLibraryUploadResponse> & { readonly error?: string }
    if (!response.ok || value.upload === undefined) throw new Error(value.error ?? `世界书移除失败（${response.status}）`)
    return value.upload
  }
  const attachWorldInfo = async (sessionId: SessionId, importId: string): Promise<void> => {
    const request: WorldInfoLibraryLaunchRequest = { format: 0, importId }
    const result = await executeAgentRpCommand(sessionId, `/rp-world-info-import ${JSON.stringify(request)}`)
    if (!result.matched) throw new Error('当前 Host 未启用世界书导入')
  }
  const importWorldInfo = async (sessionId: SessionId, file: File): Promise<void> => {
    const upload = await importWorldInfoFile(file)
    await attachWorldInfo(sessionId, upload.id)
  }
  const runGeneration = async (
    sessionId: SessionId,
    request: { readonly operation: 'regenerate' | 'continue'; readonly replySeq: number }
      | { readonly operation: 'select'; readonly replySeq: number; readonly versionIndex: number },
  ): Promise<void> => {
    const response = await executeAgentRpCommand(sessionId, `/rp-generation ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用回复版本控制')
  }
  const runImageGeneration: RunImageGeneration = (sessionId, request) => {
    const jobId = `image-${crypto.randomUUID()}`
    const payload: ImageGenerationRequest = { format: 0, jobId, ...request }
    void executeAgentRpCommand(sessionId, `/rp-draw ${JSON.stringify(payload)}`).then(response => {
      if (!response.matched) throw new Error('当前 Host 未启用聊天绘图')
    }).catch((reason: unknown) => {
      ctx.logger.warn(`agent-rp: image command ${JSON.stringify(jobId)} failed: ${String(reason)}`)
    })
    return jobId
  }
  const runTavernMutation: RunTavernMutation = async (sessionId, request) => {
    const response = await executeAgentRpCommand(sessionId, `/rp-tavern-variables ${JSON.stringify(request)}`)
    if (!response.matched) throw new Error('当前 Host 未启用酒馆脚本变量桥')
  }
  const installedStGenerationClient = createStExtensionGenerationClient()
  ctx.effect(() => installStExtensionHost(
    window,
    document,
    installedStExtensions,
    installedStExtensionSessionSource,
    installedStExtensionSettingsStore,
    message => { ctx.logger.warn(message) },
    installedStExtensionSurface,
    {
      client: installedStGenerationClient,
      replacePrompts: (sessionId, prompts) => runTavernMutation(sessionId, {
        format: 0,
        operation: 'replace-installed-extension-prompts',
        prompts,
      }),
    },
  ))
  const runTavernTrigger: RunTavernTrigger = async sessionId => {
    const response = await executeAgentRpCommand(sessionId, '/rp-tavern-trigger')
    if (!response.matched) throw new Error('当前 Host 未启用酒馆脚本生成桥')
  }
  const runTavernGeneration: RunTavernGeneration = async (sessionId, request, signal) => {
    const response = await fetch(TAVERN_GENERATION_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, sessionId, ...request }),
      ...(signal === undefined ? {} : { signal }),
    })
    const responseText = await response.text()
    let value: Partial<TavernGenerationResponse> & { readonly error?: string }
    try {
      value = JSON.parse(responseText) as typeof value
    } catch {
      throw new Error(response.ok ? 'Host 返回了无法识别的脚本生成结果' : `酒馆脚本生成失败（${response.status}）`)
    }
    if (!response.ok || value.format !== 0 || typeof value.text !== 'string') {
      throw new Error(value.error ?? `酒馆脚本生成失败（${response.status}）`)
    }
    return value.text
  }
  const runTavernPromptPreview: RunTavernPromptPreview = async (sessionId, request, signal) => {
    const response = await fetch(TAVERN_PROMPT_PREVIEW_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, sessionId, ...request }),
      ...(signal === undefined ? {} : { signal }),
    })
    const responseText = await response.text()
    let value: Partial<TavernPromptPreviewResponse> & { readonly error?: string }
    try {
      value = JSON.parse(responseText) as typeof value
    } catch {
      throw new Error(response.ok ? 'Host 返回了无法识别的提示词预览' : `提示词预览失败（${response.status}）`)
    }
    if (!response.ok || value.format !== 0 || !Array.isArray(value.prompts)
      || value.prompts.some(prompt => typeof prompt !== 'object' || prompt === null
        || (prompt.role !== 'system' && prompt.role !== 'user' && prompt.role !== 'assistant')
        || typeof prompt.content !== 'string')) {
      throw new Error(value.error ?? `提示词预览失败（${response.status}）`)
    }
    return value.prompts as readonly TavernPrompt[]
  }
  const runTavernModelList: RunTavernModelList = async request => {
    const response = await fetch(TAVERN_MODEL_LIST_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, ...request }),
    })
    const responseText = await response.text()
    let value: Partial<TavernModelListResponse> & { readonly error?: string }
    try {
      value = JSON.parse(responseText) as typeof value
    } catch {
      throw new Error(response.ok ? 'Host 返回了无法识别的模型列表' : `模型列表读取失败（${response.status}）`)
    }
    if (!response.ok || value.format !== 0 || !Array.isArray(value.models)
      || value.models.some(model => typeof model !== 'string')) {
      throw new Error(value.error ?? `模型列表读取失败（${response.status}）`)
    }
    return value.models as readonly string[]
  }
  const probeRpDistribution = async (target: string): Promise<RpDistributionProbeResponse> => {
    const response = await fetch(`${RP_DISTRIBUTION_BRIDGE_PATH}?target=${encodeURIComponent(target)}`, {
      headers: { accept: 'application/json' },
    })
    const value = await response.json() as Partial<RpDistributionProbeResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || typeof value.target !== 'string'
      || typeof value.generatedAt !== 'number' || typeof value.experienceCount !== 'number'
      || typeof value.componentCount !== 'number' || typeof value.capabilityCount !== 'number'
      || !validRpDistributionRemoteAssets(value.remoteAssets)) {
      throw new Error(value.error ?? `模块化 RP 连接失败（${response.status}）`)
    }
    return value as RpDistributionProbeResponse
  }
  const transferRpDistribution = async (
    target: string,
    kind: RpDistributionAssetKind,
    id: string,
  ): Promise<RpDistributionTransferResponse> => {
    const response = await fetch(RP_DISTRIBUTION_BRIDGE_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, target, kind, id }),
    })
    const value = await response.json() as Partial<RpDistributionTransferResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || typeof value.target !== 'string' || value.kind !== kind
      || value.sourceId !== id || !Array.isArray(value.savedIds)
      || value.savedIds.some(savedId => typeof savedId !== 'string')
      || typeof value.compatibilityDifferenceCount !== 'number') {
      throw new Error(value.error ?? `RP 资产复制失败（${response.status}）`)
    }
    return value as RpDistributionTransferResponse
  }
  const receiveRpDistribution = async (
    target: string,
    kind: RpDistributionAssetKind,
    id: string,
  ): Promise<RpDistributionAssetImportResponse> => {
    const response = await fetch(RP_DISTRIBUTION_BRIDGE_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ format: 0, operation: 'import-asset', target, kind, id }),
    })
    const value = await response.json() as Partial<RpDistributionAssetImportResponse> & { readonly error?: string }
    if (!response.ok || value.format !== 0 || value.operation !== 'import-asset'
      || typeof value.target !== 'string' || value.kind !== kind || value.sourceId !== id
      || typeof value.savedId !== 'string' || typeof value.name !== 'string') {
      throw new Error(value.error ?? `RP 资产复制失败（${response.status}）`)
    }
    return value as RpDistributionAssetImportResponse
  }
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'agent-rp-character-header', order: -100,
  }, props => <RoleplayHeader {...props} runtimeDiagnostics={runtimeDiagnostics} workspaceSettings={workspaceSettings} loadAvatar={loadAvatar} renameSession={renameSession} configurePreset={configurePreset} importPresetFile={importPresetFile} importPreset={importPreset} managePresetLibrary={managePresetLibrary} configureWorldInfo={configureWorldInfo} importWorldInfo={importWorldInfo} attachWorldInfo={attachWorldInfo} listWorldInfos={listWorldInfos} listCharacters={listCharacters} readCharacter={readCharacter} setCharacterArchived={setCharacterArchived} deleteCharacter={deleteCharacter} importCharacterFile={importCharacterFile} prepareChatMigration={prepareChatMigration} prepareRpDistributionChatMigration={prepareRpDistributionChatMigration} launchPreparedChatMigration={launchPreparedChatMigration} exportChat={exportChat} listMemory={listMemory} manageMemory={manageMemory} manageState={manageState} manageTurnMode={manageTurnMode} startCharacterSession={startCharacterFromCurrentSession} listPresets={listPresets} listRegexPacks={listRegexPacks} importRegexPackFile={importRegexPackFile} deleteRegexPack={deleteRegexPack} listAgentCapabilityPresets={listAgentCapabilityPresets} listPersonas={listPersonas} savePersona={savePersona} deletePersona={deletePersona} applyPersona={applyPersona} loadModelCapabilities={loadModelCapabilities} />))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-rp',
    order: 25,
    label: 'Agent RP',
  }, props => <WorkspaceSettingsSection {...props} workspaceSettings={workspaceSettings} workspaceList={workspaceList}
    loadModelCatalog={loadWorkerModelCatalog} />))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'agent-rp-interoperability',
    order: 26,
    label: 'RP 互通',
  }, props => <RpDistributionBridgeSection {...props} listCharacters={listCharacters} listPresets={listPresets}
    listPersonas={listPersonas} listWorldInfos={listWorldInfos}
    probe={probeRpDistribution} transfer={transferRpDistribution} receive={receiveRpDistribution} />))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'agent-rp-session-launch-notice', order: 20,
  }, () => <SessionLaunchNoticeToast source={sessionLaunchNotices} />))
  const sidebarRoleplayWorkbenchProps: SidebarRoleplayWorkbenchProps = {
    runtimeDiagnostics, workspaceSettings, workspaceList, listCharacters, readCharacter, setCharacterArchived, deleteCharacter,
    importCharacterFile, prepareChatMigration: prepareChatMigrationFromBlankSession,
    prepareRpDistributionChatMigration: prepareRpDistributionChatMigrationFromBlankSession,
    launchPreparedChatMigration: launchPreparedChatMigrationFromBlankSession,
    startCharacterSession: startCharacterFromBlankSession, listPresets, listRegexPacks,
    importRegexPackFile, deleteRegexPack, listAgentCapabilityPresets, importPresetFile,
    renamePreset: renamePresetLibraryEntry, deletePreset: deletePresetLibraryEntry, listPersonas, savePersona, deletePersona,
    listWorldInfos, importWorldInfoFile, setWorldInfoDefault, deleteWorldInfo,
    startWorldInfoSession: startWorldInfoFromBlankSession,
    startStoryWorkspaceSession: startStoryWorkspaceFromBlankSession,
    continueStoryWorkspaceSession: sendStoryWorkspaceTurn,
    storyWorkspaceNavigation,
  }
  ctx.slots.inject('sidebar.destinations', () => ctx.slots.register({
    name: 'sidebar.destinations', id: 'agent-rp-workbench', order: 20,
    children: { [AGENT_RP_WORKBENCH_SECTION_SLOT]: { kind: 'list', scope: 'root' } },
  }, props => <SidebarRoleplayDestination {...props} {...sidebarRoleplayWorkbenchProps} />))
  ctx.slots.inject('sidebar.footer.action', () => {
    if (ctx.slots.spec('sidebar.destinations') !== undefined) return () => {}
    return ctx.slots.register({
      name: 'sidebar.footer.action', id: 'agent-rp-workbench', order: 20,
      children: { [AGENT_RP_WORKBENCH_SECTION_SLOT]: { kind: 'list', scope: 'root' } },
    }, props => <SidebarRoleplayFooterAction {...props} {...sidebarRoleplayWorkbenchProps} />)
  })
  ctx.slots.inject(AGENT_RP_WORKBENCH_SECTION_SLOT, () => ctx.slots.register({
    name: AGENT_RP_WORKBENCH_SECTION_SLOT, id: 'agent-rp-installed-st-extension-settings', order: 40,
  }, props => <InstalledStExtensionWorkbenchSection {...props} surface={installedStExtensionSurface} />))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-tavern-variables',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-tavern-trigger',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-character-library',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-chat-import',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-persona',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-story-workspace',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-memory',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-state',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-turn-mode',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-preset-configure',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-preset-library',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-generation',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-draw',
  }, props => <ImageGenerationCommandCard {...props} runImageGeneration={runImageGeneration} />))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-world-info',
  }, () => null))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'rp-world-info-import',
  }, () => null))
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'agent-rp-generation',
    order: 100,
  }, props => <AssistantGenerationActions {...props} runGeneration={runGeneration} rewriteTurn={rewriteTurn}
    runImageGeneration={runImageGeneration} />))
  ctx.slots.inject('conversation.chat.turnActions', () => ctx.slots.register({
    name: 'conversation.chat.turnActions',
    id: 'agent-rp-generation',
    order: 100,
  }, props => ctx.slots.spec('conversation.chat.assistant-actions') === undefined
    ? <GenerationTail {...props} runGeneration={runGeneration} rewriteTurn={rewriteTurn}
      runImageGeneration={runImageGeneration} />
    : null))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    priority: 100,
    select: owner => {
      if (ctx.slots.spec('conversation.chat.assistant-actions') !== undefined
        || ctx.slots.spec('conversation.chat.turnActions') !== undefined) return null
      const closing = owner.turn.data.get('turn-tail')?.closing
      return closing === null || closing === undefined ? null : { replySeq: closing.finalNode.seq }
    },
  }, props => <GenerationTail {...props} runGeneration={runGeneration} rewriteTurn={rewriteTurn}
    runImageGeneration={runImageGeneration} />))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'agent-rp-status', order: -100,
  }, roleplayComposerDockComponent(
    ctx, runtimeDiagnostics, workspaceSettings, runImageGeneration, runTavernMutation, runTavernGeneration, runTavernPromptPreview, runTavernModelList,
    runTavernTrigger, configurePreset,
  )))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'agent-rp-sillytavern-import-hint', order: -10,
  }, importHintComponent(
    ctx, runtimeDiagnostics, prepareChatMigration, prepareRpDistributionChatMigration,
    launchPreparedChatMigration, listCharacters, listPresets,
  )))
}
function useAgentRpSessionResourcePermissions(sessionId: SessionId): AgentRpSessionResourcePermissions {
  const read = (): AgentRpSessionResourcePermissions => readAgentRpSessionResourcePermissions(
    window.sessionStorage, String(sessionId),
  )
  const [permissions, setPermissions] = useState(read)
  useEffect(() => {
    const synchronize = (): void => { setPermissions(read()) }
    window.addEventListener(agentRpSessionResourcePermissionsChangedEvent, synchronize)
    synchronize()
    return () => { window.removeEventListener(agentRpSessionResourcePermissionsChangedEvent, synchronize) }
  }, [sessionId])
  return permissions
}
