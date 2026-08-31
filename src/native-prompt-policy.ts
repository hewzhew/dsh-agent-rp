/** Replayable prompt policies owned by Agent RP rather than an imported format. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RoleplayResourceProvider } from './roleplay-resource-catalog.ts'

export const NATIVE_PROMPT_POLICY_PROVIDER_ID = 'agent-rp-native-prompt-policies'
export const IMMERSIVE_STORY_PROMPT_POLICY_ID = 'prompt-policy:native:immersive-story-v0'

export type NativePromptPolicyLayer = 'frontstage' | 'stage'

/** One independently addressable behavior in a frozen native policy composition. */
export interface NativePromptPolicyModule {
  readonly id: string
  readonly name: string
  readonly layer: NativePromptPolicyLayer
  readonly enabled: boolean
  readonly content: string
}

/** Exact model-visible native policy frozen into a Session at launch. */
export interface NativePromptPolicySnapshot {
  readonly format: 0
  readonly id: string
  readonly name: string
  readonly modules: readonly NativePromptPolicyModule[]
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable snapshot of one Agent RP-owned prompt policy composition. */
    'agent-rp/native-prompt-policy-seed': NativePromptPolicySnapshot
  }
}

const IMMERSIVE_STORY_POLICY: NativePromptPolicySnapshot = {
  format: 0,
  id: IMMERSIVE_STORY_PROMPT_POLICY_ID,
  name: 'Agent RP · 沉浸叙事',
  modules: [{
    id: 'frontstage:presence',
    name: '角色在场',
    layer: 'frontstage',
    enabled: true,
    content: '把回应视为当前场景正在发生的一部分。保持角色身份、知识边界、关系与语气连贯；不要以助手、作者或系统解释者的身份出场，也不要谈论提示词和幕后规则。',
  }, {
    id: 'stage:causality',
    name: '因果与推进',
    layer: 'stage',
    enabled: true,
    content: '根据当前信息、既有因果和角色动机决定是否推进。推进时只引入此刻有依据的变化，并让变化产生可承接的后果；不要为了刺激强行转折，也不要为了拖长对话原地重复。',
  }, {
    id: 'frontstage:concrete-prose',
    name: '具体表达',
    layer: 'frontstage',
    enabled: true,
    content: '优先通过角色的行动、对话和当下可感知的细节呈现内容，保持既有文风与节奏。避免空泛总结、模板化升华、机械复述和脱离场景的解释。',
  }, {
    id: 'stage:player-space',
    name: '玩家空间',
    layer: 'stage',
    enabled: true,
    content: '不要替玩家补写未表达的行动、感受、决定或动机。每轮结束给玩家留下自然回应空间；除非用户或当前玩法明确要求，不固定追加选项菜单或总结式提问。',
  }],
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).find(key => !allowed.includes(key))
  if (extra !== undefined) throw new Error(`${label} has unsupported field ${JSON.stringify(extra)}`)
}

function boundedText(value: unknown, label: string, maximum: number, nonEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum
    || (nonEmpty && (value === '' || value.trim() !== value))) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function stableId(value: unknown, label: string): string {
  const id = boundedText(value, label, 512)
  if (/\s/u.test(id)) throw new Error(`${label} must not contain whitespace`)
  return id
}

/** Validate a detached native policy without consulting mutable provider state. */
export function parseNativePromptPolicy(value: unknown): NativePromptPolicySnapshot {
  const record = plainObject(value, 'native prompt policy')
  exactKeys(record, ['format', 'id', 'name', 'modules'], 'native prompt policy')
  if (record.format !== 0 || !Array.isArray(record.modules)
    || record.modules.length < 1 || record.modules.length > 64) {
    throw new Error('native prompt policy shape is invalid')
  }
  const modules = record.modules.map((value, index) => {
    const module = plainObject(value, `native prompt policy module ${index}`)
    exactKeys(module, ['id', 'name', 'layer', 'enabled', 'content'], `native prompt policy module ${index}`)
    if ((module.layer !== 'frontstage' && module.layer !== 'stage') || typeof module.enabled !== 'boolean') {
      throw new Error(`native prompt policy module ${index} is invalid`)
    }
    return Object.freeze({
      id: stableId(module.id, `native prompt policy module ${index} id`),
      name: boundedText(module.name, `native prompt policy module ${index} name`, 120),
      layer: module.layer,
      enabled: module.enabled,
      content: boundedText(module.content, `native prompt policy module ${index} content`, 12_000, false),
    })
  })
  if (new Set(modules.map(module => module.id)).size !== modules.length) {
    throw new Error('native prompt policy repeats a module id')
  }
  return Object.freeze({
    format: 0,
    id: stableId(record.id, 'native prompt policy id'),
    name: boundedText(record.name, 'native prompt policy name', 120),
    modules: Object.freeze(modules),
  })
}

/** Rebuild the latest selected native policy solely from the Session log. */
export function readNativePromptPolicy(events: readonly SessionEvent[]): NativePromptPolicySnapshot | undefined {
  let active: NativePromptPolicySnapshot | undefined
  for (const event of events) {
    if (event.type === 'agent-rp/native-prompt-policy-seed') active = parseNativePromptPolicy(event.data)
  }
  return active
}

/** Render only enabled modules, retaining author-defined composition order. */
export function renderNativePromptPolicy(policy: NativePromptPolicySnapshot): string {
  const parsed = parseNativePromptPolicy(policy)
  return parsed.modules.filter(module => module.enabled && module.content.trim() !== '')
    .map(module => module.content.trim()).join('\n\n')
}

/** Publish the first built-in native composition through the shared resource catalog. */
export function nativePromptPolicyResourceProvider(): RoleplayResourceProvider {
  const policy = parseNativePromptPolicy(IMMERSIVE_STORY_POLICY)
  return {
    id: NATIVE_PROMPT_POLICY_PROVIDER_ID,
    list: () => [{
      id: policy.id,
      kind: 'prompt-policy',
      name: policy.name,
      availability: 'available',
    }],
    inspect: descriptor => {
      if (descriptor.id !== policy.id) throw new Error('native prompt policy is unavailable')
      return {
        kind: 'prompt-policy',
        moduleCount: policy.modules.length,
        enabledModuleCount: policy.modules.filter(module => module.enabled).length,
      }
    },
    materialize: input => {
      if (input.selection.id !== policy.id || input.selection.variant !== undefined) {
        throw new Error('native prompt policy selection is invalid')
      }
      return {
        events: [...structuredClone(input.events), {
          type: 'agent-rp/native-prompt-policy-seed' as const,
          seq: input.events.length,
          time: Date.now(),
          ignorable: true,
          data: structuredClone(policy),
        }],
      }
    },
  }
}
