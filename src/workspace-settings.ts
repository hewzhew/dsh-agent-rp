/** Workspace preferences for new Agent RP entry points. */

import type { ImageGenerationProvider } from './image-generation-protocol.ts'
import {
  DEFAULT_TOOL_GUIDANCE,
  normalizeToolGuidanceConfig,
  type ResolvedToolGuidanceConfig,
} from './roleplay-tool-guidance.ts'

/** Same-origin Host route for Agent RP workspace preferences. */
export const AGENT_RP_WORKSPACE_SETTINGS_PATH = '/api/agent-rp/settings'

/** Field selecting whether every workspace or an allowlist shows RP entry points. */
export const AGENT_RP_WORKSPACE_MODE_FIELD = 'workspaceMode'

/** Field containing workspace ids enabled in selected-workspace mode. */
export const AGENT_RP_WORKSPACE_IDS_FIELD = 'workspaceIds'

/** Field containing workspace ids disabled in all-workspace mode. */
export const AGENT_RP_WORKSPACE_EXCLUDED_IDS_FIELD = 'workspaceExcludedIds'

/** Supported workspace visibility modes. */
export const AGENT_RP_WORKSPACE_MODES = ['all', 'selected'] as const

/** Image providers available for explicit roleplay illustrations. */
export const AGENT_RP_IMAGE_PROVIDERS = ['openai', 'dashscope', 'novelai', 'a1111', 'comfyui'] as const satisfies readonly ImageGenerationProvider[]

/** Durable image provider settings; credentials are stored separately. */
export interface ImageGenerationSettings {
  readonly provider: ImageGenerationProvider
  readonly openai: {
    readonly endpoint: string
    readonly model: string
    readonly size: '1024x1024' | '1024x1536' | '1536x1024'
  }
  readonly dashscope: {
    readonly endpoint: string
    readonly model: 'qwen-image-3.0' | 'qwen-image-3.0-pro'
    readonly size: 'auto' | '1024*1024' | '1024*1536' | '1536*1024'
    readonly promptExtend: boolean
    readonly promptExtendMode: 'direct' | 'agent'
    readonly enableThinking: boolean
    readonly negativePrompt: string
    readonly watermark: boolean
  }
  readonly novelai: {
    readonly endpoint: string
    readonly model: 'nai-diffusion-4-5-full' | 'nai-diffusion-4-5-curated'
    readonly width: number
    readonly height: number
    readonly steps: number
    readonly scale: number
    readonly sampler: string
    readonly noiseSchedule: string
    readonly cfgRescale: number
    readonly negativePrompt: string
    readonly quality: boolean
    readonly smea: boolean
    readonly smeaDyn: boolean
  }
  readonly a1111: {
    readonly endpoint: string
    readonly model: string
    readonly width: number
    readonly height: number
    readonly steps: number
    readonly cfgScale: number
    readonly sampler: string
    readonly negativePrompt: string
  }
  readonly comfyui: {
    readonly endpoint: string
    readonly workflow: string
    readonly width: number
    readonly height: number
    readonly negativePrompt: string
  }
}

/** One reusable, non-secret image provider configuration. */
export interface ImageGenerationProfile {
  readonly id: string
  readonly name: string
  readonly settings: ImageGenerationSettings
}

/** Workspace visibility mode for new Agent RP entry points. */
export type AgentRpWorkspaceMode = typeof AGENT_RP_WORKSPACE_MODES[number]

/** Persisted Agent RP settings. */
export interface AgentRpSettings {
  /** Whether entry points appear everywhere or only in selected workspaces. */
  readonly workspaceMode: AgentRpWorkspaceMode
  /** Stable DSH workspace ids enabled by selected-workspace mode. */
  readonly workspaceIds: string[]
  /** Stable DSH workspace ids disabled by all-workspace mode. */
  readonly workspaceExcludedIds: string[]
  /** Provider and generation defaults for explicit roleplay image requests. */
  readonly imageGeneration: ImageGenerationSettings
  /** Selected reusable image provider configuration. */
  readonly activeImageProfileId: string
  /** Reusable image provider configurations; credentials remain in the Host credential store. */
  readonly imageProfiles: ImageGenerationProfile[]
  /** Agent tool policy and deployment-owned MCP instructions. */
  readonly toolGuidance: ResolvedToolGuidanceConfig
  /** Independent model workers run after the character Agent finishes its visible reply. */
  readonly turnWorkers: RoleplayTurnWorkerSettings
}

/** Workspace policy for the first deterministic multi-Agent turn pipeline. */
export interface RoleplayTurnWorkerSettings {
  /** Let a separate lightweight model pass revise expression without re-running the imported preset. */
  readonly narrativeReview: {
    readonly enabled: boolean
  }
  /** Model route and reasoning effort for the independent state verification pass. */
  readonly stateVerification: RoleplayStateVerificationSettings
}

/** Explicit provider route used by one background Roleplay Worker. */
export interface RoleplayWorkerModelSelection {
  readonly provider: string
  readonly model: string
}

/** Exact model controls for the independent state verification pass. */
export interface RoleplayStateVerificationSettings {
  /** Explicit Worker route; null follows the active session model. */
  readonly model: RoleplayWorkerModelSelection | null
  /** Exact effort id; null preserves the effective model's provider default. */
  readonly reasoningEffort: string | null
}

const DEFAULT_IMAGE_PROFILE_ID = 'default'
const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
  provider: 'openai',
  openai: {
    endpoint: 'https://api.openai.com/v1/images/generations',
    model: 'gpt-image-1',
    size: '1024x1024',
  },
  dashscope: {
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    model: 'qwen-image-3.0',
    size: '1024*1024',
    promptExtend: true,
    promptExtendMode: 'direct',
    enableThinking: true,
    negativePrompt: '',
    watermark: false,
  },
  novelai: {
    endpoint: 'https://image.novelai.net/ai/generate-image',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5,
    sampler: 'k_euler',
    noiseSchedule: 'karras',
    cfgRescale: 0.18,
    negativePrompt: '',
    quality: true,
    smea: true,
    smeaDyn: true,
  },
  a1111: {
    endpoint: 'http://127.0.0.1:7860',
    model: '',
    width: 768,
    height: 1024,
    steps: 28,
    cfgScale: 7,
    sampler: 'DPM++ 2M Karras',
    negativePrompt: '',
  },
  comfyui: {
    endpoint: 'http://127.0.0.1:8188',
    workflow: '',
    width: 768,
    height: 1024,
    negativePrompt: '',
  },
}

/** Default settings preserve the existing all-workspace behavior. */
export const DEFAULT_AGENT_RP_SETTINGS: AgentRpSettings = {
  workspaceMode: 'all',
  workspaceIds: [],
  workspaceExcludedIds: [],
  imageGeneration: DEFAULT_IMAGE_GENERATION_SETTINGS,
  activeImageProfileId: DEFAULT_IMAGE_PROFILE_ID,
  imageProfiles: [{
    id: DEFAULT_IMAGE_PROFILE_ID,
    name: '默认配置',
    settings: DEFAULT_IMAGE_GENERATION_SETTINGS,
  }],
  toolGuidance: DEFAULT_TOOL_GUIDANCE,
  turnWorkers: {
    narrativeReview: { enabled: false },
    stateVerification: { model: null, reasoningEffort: null },
  },
}

function text(value: unknown, fallback: string, max: number, label: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}无效`)
  return value.trim()
}

function endpoint(value: unknown, fallback: string, label: string): string {
  const candidate = text(value, fallback, 2_000, label)
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`${label}无效`)
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') throw new Error(`${label}无效`)
  return candidate
}

function httpsEndpoint(value: unknown, fallback: string, label: string): string {
  const candidate = endpoint(value, fallback, label)
  if (new URL(candidate).protocol !== 'https:') throw new Error(`${label}必须使用 https`)
  return candidate
}

function integer(value: unknown, fallback: number, min: number, max: number, label: string): number {
  const candidate = value === undefined ? fallback : value
  if (!Number.isSafeInteger(candidate) || Number(candidate) < min || Number(candidate) > max) throw new Error(`${label}无效`)
  return Number(candidate)
}

function finite(value: unknown, fallback: number, min: number, max: number, label: string): number {
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < min || candidate > max) {
    throw new Error(`${label}无效`)
  }
  return candidate
}

function bool(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${label}无效`)
  return value
}

function novelAiDimension(value: unknown, fallback: number, label: string): number {
  const candidate = integer(value, fallback, 64, 2_048, label)
  if (candidate % 64 !== 0) throw new Error(`${label}必须是 64 的倍数`)
  return candidate
}

/** Normalize image settings while accepting pre-image-generation settings files. */
export function normalizeImageGenerationSettings(value: unknown): ImageGenerationSettings {
  if (value === undefined) return structuredClone(DEFAULT_AGENT_RP_SETTINGS.imageGeneration)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Agent RP 图片设置不是对象')
  const record = value as Record<string, unknown>
  if (!AGENT_RP_IMAGE_PROVIDERS.includes(record.provider as ImageGenerationProvider)) {
    throw new Error('Agent RP 图片提供方无效')
  }
  const openai = typeof record.openai === 'object' && record.openai !== null && !Array.isArray(record.openai)
    ? record.openai as Record<string, unknown> : {}
  const dashscope = typeof record.dashscope === 'object' && record.dashscope !== null && !Array.isArray(record.dashscope)
    ? record.dashscope as Record<string, unknown> : {}
  const novelai = typeof record.novelai === 'object' && record.novelai !== null && !Array.isArray(record.novelai)
    ? record.novelai as Record<string, unknown> : {}
  const a1111 = typeof record.a1111 === 'object' && record.a1111 !== null && !Array.isArray(record.a1111)
    ? record.a1111 as Record<string, unknown> : {}
  const comfyui = typeof record.comfyui === 'object' && record.comfyui !== null && !Array.isArray(record.comfyui)
    ? record.comfyui as Record<string, unknown> : {}
  const size = openai.size ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.openai.size
  if (size !== '1024x1024' && size !== '1024x1536' && size !== '1536x1024') throw new Error('OpenAI 图片尺寸无效')
  const dashscopeModel = dashscope.model ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.model
  if (dashscopeModel !== 'qwen-image-3.0' && dashscopeModel !== 'qwen-image-3.0-pro') {
    throw new Error('百炼图片模型无效')
  }
  const dashscopeSize = dashscope.size ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.size
  if (dashscopeSize !== 'auto' && dashscopeSize !== '1024*1024'
    && dashscopeSize !== '1024*1536' && dashscopeSize !== '1536*1024') {
    throw new Error('百炼图片尺寸无效')
  }
  const dashscopePromptExtendMode = dashscope.promptExtendMode
    ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.promptExtendMode
  if (dashscopePromptExtendMode !== 'direct' && dashscopePromptExtendMode !== 'agent') {
    throw new Error('百炼提示词扩写模式无效')
  }
  const novelAiModel = novelai.model ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.model
  if (novelAiModel !== 'nai-diffusion-4-5-full' && novelAiModel !== 'nai-diffusion-4-5-curated') {
    throw new Error('NovelAI 图片模型无效')
  }
  return {
    provider: record.provider as ImageGenerationProvider,
    openai: {
      endpoint: endpoint(openai.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.openai.endpoint, 'OpenAI 图片服务地址'),
      model: text(openai.model, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.openai.model, 200, 'OpenAI 图片模型'),
      size,
    },
    dashscope: {
      endpoint: httpsEndpoint(
        dashscope.endpoint,
        DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.endpoint,
        '百炼图片服务地址',
      ),
      model: dashscopeModel,
      size: dashscopeSize,
      promptExtend: bool(
        dashscope.promptExtend,
        DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.promptExtend,
        '百炼提示词扩写',
      ),
      promptExtendMode: dashscopePromptExtendMode,
      enableThinking: bool(
        dashscope.enableThinking,
        DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.enableThinking,
        '百炼思考模式',
      ),
      negativePrompt: text(dashscope.negativePrompt, '', 8_000, '百炼负面提示词'),
      watermark: bool(
        dashscope.watermark,
        DEFAULT_AGENT_RP_SETTINGS.imageGeneration.dashscope.watermark,
        '百炼图片水印',
      ),
    },
    novelai: {
      endpoint: endpoint(novelai.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.endpoint, 'NovelAI 图片服务地址'),
      model: novelAiModel,
      width: novelAiDimension(novelai.width, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.width, 'NovelAI 宽度'),
      height: novelAiDimension(novelai.height, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.height, 'NovelAI 高度'),
      steps: integer(novelai.steps, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.steps, 1, 50, 'NovelAI 步数'),
      scale: finite(novelai.scale, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.scale, 0, 20, 'NovelAI 引导强度'),
      sampler: text(novelai.sampler, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.sampler, 100, 'NovelAI 采样器'),
      noiseSchedule: text(novelai.noiseSchedule, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.noiseSchedule, 100, 'NovelAI 噪声调度'),
      cfgRescale: finite(novelai.cfgRescale, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.cfgRescale, 0, 1, 'NovelAI CFG Rescale'),
      negativePrompt: text(novelai.negativePrompt, '', 8_000, 'NovelAI 负面提示词'),
      quality: bool(novelai.quality, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.quality, 'NovelAI 质量增强'),
      smea: bool(novelai.smea, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.smea, 'NovelAI SMEA'),
      smeaDyn: bool(novelai.smeaDyn, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.smeaDyn, 'NovelAI SMEA DYN'),
    },
    a1111: {
      endpoint: endpoint(a1111.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.endpoint, 'A1111 图片服务地址'),
      model: text(a1111.model, '', 500, 'A1111 模型'),
      width: integer(a1111.width, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.width, 256, 2_048, 'A1111 宽度'),
      height: integer(a1111.height, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.height, 256, 2_048, 'A1111 高度'),
      steps: integer(a1111.steps, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.steps, 1, 150, 'A1111 步数'),
      cfgScale: finite(a1111.cfgScale, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.cfgScale, 0, 30, 'A1111 CFG'),
      sampler: text(a1111.sampler, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.sampler, 300, 'A1111 采样器'),
      negativePrompt: text(a1111.negativePrompt, '', 8_000, 'A1111 负面提示词'),
    },
    comfyui: {
      endpoint: endpoint(comfyui.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.comfyui.endpoint, 'ComfyUI 服务地址'),
      workflow: text(comfyui.workflow, '', 256 * 1024, 'ComfyUI API 工作流'),
      width: integer(comfyui.width, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.comfyui.width, 64, 4_096, 'ComfyUI 宽度'),
      height: integer(comfyui.height, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.comfyui.height, 64, 4_096, 'ComfyUI 高度'),
      negativePrompt: text(comfyui.negativePrompt, '', 8_000, 'ComfyUI 负面提示词'),
    },
  }
}

/**
 * Validate one persisted or wire settings value.
 * @param value - untrusted JSON value.
 * @returns normalized settings with duplicate ids removed.
 */
export function normalizeAgentRpSettings(value: unknown): AgentRpSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Agent RP 设置不是对象')
  }
  const record = value as Record<string, unknown>
  const workspaceMode = record.workspaceMode
  const workspaceIds = record.workspaceIds
  const workspaceExcludedIds = record.workspaceExcludedIds ?? []
  if ((workspaceMode !== 'all' && workspaceMode !== 'selected') || !Array.isArray(workspaceIds)
    || workspaceIds.length > 1_000 || workspaceIds.some(id => typeof id !== 'string'
      || id.trim() !== id || id === '' || id.length > 256)
    || !Array.isArray(workspaceExcludedIds) || workspaceExcludedIds.length > 1_000
    || workspaceExcludedIds.some(id => typeof id !== 'string'
      || id.trim() !== id || id === '' || id.length > 256)) {
    throw new Error('Agent RP 工作区设置字段无效')
  }
  const imageGeneration = normalizeImageGenerationSettings(record.imageGeneration)
  const toolGuidance = normalizeToolGuidanceConfig(record.toolGuidance)
  const turnWorkersRecord = record.turnWorkers
  if (turnWorkersRecord !== undefined
    && (typeof turnWorkersRecord !== 'object' || turnWorkersRecord === null || Array.isArray(turnWorkersRecord))) {
    throw new Error('回合 Worker 设置无效')
  }
  const narrativeReview = (turnWorkersRecord as Record<string, unknown> | undefined)?.narrativeReview
  if (narrativeReview !== undefined
    && (typeof narrativeReview !== 'object' || narrativeReview === null || Array.isArray(narrativeReview))) {
    throw new Error('正文审阅 Worker 设置无效')
  }
  const narrativeReviewEnabled = (narrativeReview as Record<string, unknown> | undefined)?.enabled
    ?? DEFAULT_AGENT_RP_SETTINGS.turnWorkers.narrativeReview.enabled
  if (typeof narrativeReviewEnabled !== 'boolean') throw new Error('正文审阅 Worker 开关无效')
  const stateVerification = (turnWorkersRecord as Record<string, unknown> | undefined)?.stateVerification
  if (stateVerification !== undefined
    && (typeof stateVerification !== 'object' || stateVerification === null || Array.isArray(stateVerification))) {
    throw new Error('状态核验 Worker 设置无效')
  }
  const stateVerificationModel = (stateVerification as Record<string, unknown> | undefined)?.model ?? null
  if (stateVerificationModel !== null
    && (typeof stateVerificationModel !== 'object' || Array.isArray(stateVerificationModel))) {
    throw new Error('状态核验 Worker 模型无效')
  }
  let normalizedStateVerificationModel: RoleplayWorkerModelSelection | null = null
  if (stateVerificationModel !== null) {
    const model = stateVerificationModel as Record<string, unknown>
    if (typeof model.provider !== 'string' || model.provider.trim() !== model.provider
      || model.provider === '' || model.provider.length > 256
      || typeof model.model !== 'string' || model.model.trim() !== model.model
      || model.model === '' || model.model.length > 512) {
      throw new Error('状态核验 Worker 模型无效')
    }
    normalizedStateVerificationModel = { provider: model.provider, model: model.model }
  }
  const stateVerificationReasoningEffort = (stateVerification as Record<string, unknown> | undefined)
    ?.reasoningEffort ?? null
  if (stateVerificationReasoningEffort !== null
    && (typeof stateVerificationReasoningEffort !== 'string'
      || stateVerificationReasoningEffort === ''
      || stateVerificationReasoningEffort.trim() !== stateVerificationReasoningEffort
      || stateVerificationReasoningEffort.length > 256)) {
    throw new Error('状态核验 Worker 推理强度无效')
  }
  let imageProfiles: ImageGenerationProfile[]
  let activeImageProfileId: string
  if (record.imageProfiles === undefined) {
    activeImageProfileId = DEFAULT_IMAGE_PROFILE_ID
    imageProfiles = [{ id: activeImageProfileId, name: '默认配置', settings: imageGeneration }]
  } else {
    if (!Array.isArray(record.imageProfiles) || record.imageProfiles.length === 0 || record.imageProfiles.length > 50) {
      throw new Error('图片服务配置档案无效')
    }
    imageProfiles = record.imageProfiles.map(value => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('图片服务配置档案无效')
      const profile = value as Record<string, unknown>
      if (typeof profile.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(profile.id)) {
        throw new Error('图片服务配置档案 id 无效')
      }
      if (typeof profile.name !== 'string' || profile.name.trim() === '' || profile.name.trim().length > 80) {
        throw new Error('图片服务配置档案名称无效')
      }
      return { id: profile.id, name: profile.name.trim(), settings: normalizeImageGenerationSettings(profile.settings) }
    })
    if (new Set(imageProfiles.map(profile => profile.id)).size !== imageProfiles.length) {
      throw new Error('图片服务配置档案 id 重复')
    }
    if (new Set(imageProfiles.map(profile => profile.name.toLowerCase())).size !== imageProfiles.length) {
      throw new Error('图片服务配置档案名称重复')
    }
    activeImageProfileId = typeof record.activeImageProfileId === 'string'
      ? record.activeImageProfileId : imageProfiles[0]!.id
    if (!imageProfiles.some(profile => profile.id === activeImageProfileId)) {
      throw new Error('当前图片服务配置档案不存在')
    }
  }
  const activeImageGeneration = imageProfiles.find(profile => profile.id === activeImageProfileId)!.settings
  return {
    workspaceMode,
    workspaceIds: [...new Set(workspaceIds as string[])],
    workspaceExcludedIds: [...new Set(workspaceExcludedIds as string[])],
    imageGeneration: activeImageGeneration,
    activeImageProfileId,
    imageProfiles,
    toolGuidance,
    turnWorkers: {
      narrativeReview: { enabled: narrativeReviewEnabled },
      stateVerification: {
        model: normalizedStateVerificationModel,
        reasoningEffort: stateVerificationReasoningEffort,
      },
    },
  }
}

/**
 * Decide whether a workspace may show a new Agent RP entry point.
 * @param settings - resolved Host settings, or undefined before they are available.
 * @param workspaceId - workspace owning the current Session, when registered.
 * @returns whether the entry point should be visible.
 */
export function allowsAgentRpEntry(
  settings: Pick<AgentRpSettings, 'workspaceMode' | 'workspaceIds' | 'workspaceExcludedIds'> | undefined,
  workspaceId: string | undefined,
): boolean {
  const resolved = settings ?? DEFAULT_AGENT_RP_SETTINGS
  return resolved.workspaceMode === 'all'
    ? workspaceId === undefined || !resolved.workspaceExcludedIds.includes(workspaceId)
    : workspaceId !== undefined && resolved.workspaceIds.includes(workspaceId)
}

/**
 * Enable or disable one workspace without changing the policy for other workspaces.
 * @param settings - current complete Agent RP settings.
 * @param workspaceId - stable workspace id to update.
 * @param enabled - whether the workspace should expose Agent RP entry points.
 * @returns updated settings using the active mode's allowlist or exclusion list.
 */
export function setAgentRpWorkspaceEntry(
  settings: AgentRpSettings,
  workspaceId: string,
  enabled: boolean,
): AgentRpSettings {
  if (settings.workspaceMode === 'all') {
    const excluded = settings.workspaceExcludedIds.includes(workspaceId)
    if (excluded === !enabled) return settings
    return {
      ...settings,
      workspaceExcludedIds: enabled
        ? settings.workspaceExcludedIds.filter(id => id !== workspaceId)
        : [...settings.workspaceExcludedIds, workspaceId],
    }
  }
  const selected = settings.workspaceIds.includes(workspaceId)
  if (selected === enabled) return settings
  return {
    ...settings,
    workspaceIds: enabled
      ? [...settings.workspaceIds, workspaceId]
      : settings.workspaceIds.filter(id => id !== workspaceId),
  }
}
