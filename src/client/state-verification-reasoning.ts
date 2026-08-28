import type {
  ModelCatalog,
  ModelSelectionProjection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  RoleplayStateVerificationSettings,
  RoleplayWorkerModelSelection,
} from '../workspace-settings.ts'

/** Reasoning controls exposed by one exact provider/model route. */
export interface ModelReasoningCapabilities {
  readonly efforts: readonly {
    readonly id: string
    readonly name: string
    readonly description?: string
  }[]
  readonly defaultEffort?: string
}

/** Current session route and its resolved display metadata. */
export interface CurrentModelCapabilities {
  readonly current: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }
  readonly providerName?: string
  readonly modelName?: string
  readonly reasoning?: ModelReasoningCapabilities
}

/** Configured model routes available to the current session. */
export interface AvailableModelCatalog {
  readonly current: CurrentModelCapabilities['current']
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly {
      readonly id: string
      readonly name: string
      readonly reasoning?: ModelReasoningCapabilities
    }[]
  }[]
}

/** Combine the Host-generation catalog with one Session's durable next-request selection. */
export function availableModelCatalog(
  catalog: ModelCatalog,
  selection: ModelSelectionProjection | undefined,
): AvailableModelCatalog {
  if (selection === undefined) throw new Error('当前会话缺少模型选择投影')
  return {
    current: selection.next ?? catalog.default,
    groups: catalog.groups,
  }
}

/** One persisted reasoning value and whether the exact model currently accepts it. */
export interface StateVerificationReasoningChoice {
  readonly id: string | null
  readonly supported: boolean
}

/** Effective exact-model capabilities and the choices one settings selector must render. */
export interface ResolvedStateVerificationReasoningChoices {
  readonly reasoning?: ModelReasoningCapabilities
  readonly choices: readonly StateVerificationReasoningChoice[]
}

/**
 * Resolve choices for the explicit Worker route or the current session route.
 * A stale persisted id remains visible once as unsupported without joining the selectable capability list.
 */
export function resolveStateVerificationReasoningChoices(
  catalog: AvailableModelCatalog | undefined,
  selectedModel: RoleplayWorkerModelSelection | null,
  selectedEffort: string | null,
): ResolvedStateVerificationReasoningChoices {
  const route = selectedModel ?? catalog?.current
  const reasoning = route === undefined ? undefined : catalog?.groups
    .find(group => group.id === route.provider)?.models
    .find(model => model.id === route.model)?.reasoning
  const supported = reasoning?.efforts.some(effort => effort.id === selectedEffort) === true
  return {
    ...(reasoning === undefined ? {} : { reasoning }),
    choices: [
      { id: null, supported: true },
      ...(selectedEffort === null || supported ? [] : [{ id: selectedEffort, supported: false }]),
      ...(reasoning?.efforts.map(effort => ({ id: effort.id, supported: true })) ?? []),
    ],
  }
}

/** Apply one visible settings change while resetting effort only when the exact model route changes. */
export function updateStateVerificationSettings(
  current: RoleplayStateVerificationSettings,
  change:
    | { readonly type: 'model'; readonly model: RoleplayWorkerModelSelection | null }
    | { readonly type: 'reasoning-effort'; readonly reasoningEffort: string | null },
  currentSessionModel?: RoleplayWorkerModelSelection,
): RoleplayStateVerificationSettings {
  if (change.type === 'reasoning-effort') {
    return { ...current, reasoningEffort: change.reasoningEffort }
  }
  const sameSelection = current.model === null
    ? change.model === null
    : change.model !== null
      && current.model.provider === change.model.provider
      && current.model.model === change.model.model
  const previousRoute = current.model ?? currentSessionModel
  const nextRoute = change.model ?? currentSessionModel
  const sameRoute = sameSelection || (previousRoute !== undefined && nextRoute !== undefined
    && previousRoute.provider === nextRoute.provider
    && previousRoute.model === nextRoute.model)
  return sameRoute
    ? { model: change.model, reasoningEffort: current.reasoningEffort }
    : { model: change.model, reasoningEffort: null }
}
