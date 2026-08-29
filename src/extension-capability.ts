/** Typed capability planning shared by isolated Agent RP extensions. */

/** Runtime families accepted by the capability planner. */
export type AgentRpExtensionRuntime = 'card-frame-v0' | 'tavern-script-frame-v0' | 'world-engine-v0'

/** Serialized payload bounds for one capability in one runtime. */
export interface AgentRpCapabilityRuntimePolicy {
  /** Null means the Host calls an in-process runtime without a serialized request envelope. */
  readonly requestBytes: number | null
  /** Null means the Host receives an in-process result without a serialized result envelope. */
  readonly resultBytes: number | null
}

/** Security metadata for one Host-owned extension capability. */
export interface AgentRpCapabilityDefinition {
  readonly version: 0
  readonly runtimePolicies: Readonly<Partial<Record<AgentRpExtensionRuntime, AgentRpCapabilityRuntimePolicy>>>
  readonly effect: 'read' | 'session-write' | 'model-request' | 'external-request' | 'isolated-ui' | 'host-storage'
    | 'identity-disclosure'
  readonly approval: 'none' | 'player-action' | 'session-policy' | 'per-request' | 'call-policy'
  readonly approvalPersistence: 'none' | 'session' | 'character-policy'
  readonly statePersistence: 'ephemeral' | 'session' | 'host-persistent'
  readonly stateOwner: 'host' | 'session'
  readonly modelVisible: boolean
}

/** Host capabilities that have completed request validation and runtime integration. */
export const AGENT_RP_CAPABILITIES = {
  'chat.send': {
    version: 0,
    runtimePolicies: { 'card-frame-v0': { requestBytes: 64 * 1024, resultBytes: 4096 } },
    effect: 'model-request',
    approval: 'player-action',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'chat.user-message.append': {
    version: 0,
    runtimePolicies: { 'card-frame-v0': { requestBytes: 64 * 1024, resultBytes: 4096 } },
    effect: 'session-write',
    approval: 'player-action',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'greeting.select': {
    version: 0,
    runtimePolicies: { 'card-frame-v0': { requestBytes: 1024, resultBytes: 1024 } },
    effect: 'session-write',
    approval: 'player-action',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'session.variables.replace': {
    version: 0,
    runtimePolicies: {
      'card-frame-v0': { requestBytes: 1024 * 1024, resultBytes: 4096 },
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
    },
    effect: 'session-write',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'world-info.session.mutate': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
    },
    effect: 'session-write',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'chat.session.mutate': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
    },
    effect: 'session-write',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'prompt-injection.session.replace': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
    },
    effect: 'session-write',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'prompt.snapshot.read': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 512 * 1024, resultBytes: 8 * 1024 * 1024 },
    },
    effect: 'read',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'ephemeral',
    stateOwner: 'host',
    modelVisible: false,
  },
  'model.catalog.external.read': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 16 * 1024, resultBytes: 2 * 1024 * 1024 },
    },
    effect: 'external-request',
    approval: 'call-policy',
    approvalPersistence: 'character-policy',
    statePersistence: 'ephemeral',
    stateOwner: 'host',
    modelVisible: false,
  },
  'model.generate.auxiliary': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 512 * 1024, resultBytes: 8 * 1024 * 1024 },
    },
    effect: 'model-request',
    approval: 'call-policy',
    approvalPersistence: 'character-policy',
    statePersistence: 'session',
    stateOwner: 'session',
    modelVisible: true,
  },
  'settings.extension.persist': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
    },
    effect: 'host-storage',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'host-persistent',
    stateOwner: 'host',
    modelVisible: false,
  },
  'storage.script.persist': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 2 * 1024 * 1024 },
    },
    effect: 'host-storage',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'host-persistent',
    stateOwner: 'host',
    modelVisible: false,
  },
  'ui.popup.open': {
    version: 0,
    runtimePolicies: {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 512 * 1024 },
    },
    effect: 'isolated-ui',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'ephemeral',
    stateOwner: 'host',
    modelVisible: false,
  },
  'ui.external-window.open': {
    version: 0,
    runtimePolicies: {
      'card-frame-v0': { requestBytes: 16 * 1024, resultBytes: 64 * 1024 },
      'tavern-script-frame-v0': { requestBytes: 16 * 1024, resultBytes: 64 * 1024 },
    },
    effect: 'external-request',
    approval: 'player-action',
    approvalPersistence: 'none',
    statePersistence: 'ephemeral',
    stateOwner: 'host',
    modelVisible: false,
  },
  'identity.native.attest': {
    version: 0,
    runtimePolicies: {
      'card-frame-v0': { requestBytes: 16 * 1024, resultBytes: 32 * 1024 },
      'tavern-script-frame-v0': { requestBytes: 16 * 1024, resultBytes: 32 * 1024 },
    },
    effect: 'identity-disclosure',
    approval: 'call-policy',
    approvalPersistence: 'character-policy',
    statePersistence: 'host-persistent',
    stateOwner: 'host',
    modelVisible: false,
  },
  'world-info.snapshot.read': {
    version: 0,
    runtimePolicies: { 'world-engine-v0': { requestBytes: null, resultBytes: null } },
    effect: 'read',
    approval: 'none',
    approvalPersistence: 'none',
    statePersistence: 'ephemeral',
    stateOwner: 'host',
    modelVisible: false,
  },
} as const satisfies Readonly<Record<string, AgentRpCapabilityDefinition>>

/** Fixed identifier of one implemented Host capability. */
export type AgentRpCapabilityId = keyof typeof AGENT_RP_CAPABILITIES

/** One declared capability dependency in an extension manifest. */
export interface AgentRpCapabilityRequirement {
  readonly capability: string
  readonly version: number
  readonly optional: boolean
}

/** Content-free extension manifest consumed before code execution. */
export interface AgentRpExtensionManifestV0 {
  readonly format: 0
  readonly runtime: AgentRpExtensionRuntime
  readonly requirements: readonly AgentRpCapabilityRequirement[]
}

/** Capability manifest used by one registered Character Card greeting surface. */
export const CARD_GREETING_CAPABILITY_MANIFEST = {
  format: 0,
  runtime: 'card-frame-v0',
  requirements: [{ capability: 'greeting.select', version: 0, optional: false }],
} as const satisfies AgentRpExtensionManifestV0

/** Host capabilities exposed by every registered Character Card light-frontend adapter. */
export const CARD_FRONTEND_CAPABILITY_MANIFEST = {
  format: 0,
  runtime: 'card-frame-v0',
  requirements: [
    { capability: 'chat.send', version: 0, optional: false },
    { capability: 'chat.user-message.append', version: 0, optional: false },
    { capability: 'session.variables.replace', version: 0, optional: false },
    { capability: 'ui.external-window.open', version: 0, optional: false },
    { capability: 'identity.native.attest', version: 0, optional: true },
  ],
} as const satisfies AgentRpExtensionManifestV0

/** Host-owned compatibility adapter exposed on behalf of registered legacy Tavern Helper scripts. */
export const TAVERN_LEGACY_ADAPTER_MANIFEST = {
  format: 0,
  runtime: 'tavern-script-frame-v0',
  requirements: [
    { capability: 'session.variables.replace', version: 0, optional: false },
    { capability: 'chat.session.mutate', version: 0, optional: false },
    { capability: 'world-info.session.mutate', version: 0, optional: false },
    { capability: 'prompt-injection.session.replace', version: 0, optional: false },
    { capability: 'prompt.snapshot.read', version: 0, optional: false },
    { capability: 'model.catalog.external.read', version: 0, optional: false },
    { capability: 'model.generate.auxiliary', version: 0, optional: false },
    { capability: 'settings.extension.persist', version: 0, optional: false },
    { capability: 'storage.script.persist', version: 0, optional: false },
    { capability: 'ui.popup.open', version: 0, optional: false },
    { capability: 'ui.external-window.open', version: 0, optional: false },
    { capability: 'identity.native.attest', version: 0, optional: true },
  ],
} as const satisfies AgentRpExtensionManifestV0

/** Capabilities consumed by the built-in deterministic World Info matcher. */
export const NATIVE_WORLD_ENGINE_MANIFEST = {
  format: 0,
  runtime: 'world-engine-v0',
  requirements: [{ capability: 'world-info.snapshot.read', version: 0, optional: false }],
} as const satisfies AgentRpExtensionManifestV0

/** Stable outcome for one declared capability dependency. */
export type AgentRpCapabilityResolution =
  | 'available'
  | 'approval-required'
  | 'unsupported'
  | 'version-mismatch'
  | 'denied'

/** One resolved manifest dependency. */
export interface AgentRpCapabilityPlanEntry extends AgentRpCapabilityRequirement {
  readonly resolution: AgentRpCapabilityResolution
}

/** Complete capability plan produced without executing extension code. */
export interface AgentRpCapabilityPlan {
  readonly format: 0
  readonly runtime: AgentRpExtensionRuntime
  readonly entries: readonly AgentRpCapabilityPlanEntry[]
}

/** Content-free aggregate used by local acceptance and UI readiness checks. */
export interface AgentRpCapabilityPlanSummary {
  readonly requirements: number
  readonly requiredUnavailable: number
  readonly optionalUnavailable: number
  readonly resolutions: Readonly<Record<AgentRpCapabilityResolution, number>>
}

function isCapabilityId(value: string): value is AgentRpCapabilityId {
  return Object.hasOwn(AGENT_RP_CAPABILITIES, value)
}

/** Resolve one manifest against the implemented catalog and explicit grants without running extension code. */
export function resolveAgentRpCapabilityPlan(
  manifest: AgentRpExtensionManifestV0,
  policy: {
    readonly approved?: ReadonlySet<AgentRpCapabilityId>
    readonly denied?: ReadonlySet<AgentRpCapabilityId>
  } = {},
): AgentRpCapabilityPlan {
  const entries = manifest.requirements.map((requirement): AgentRpCapabilityPlanEntry => {
    if (!isCapabilityId(requirement.capability)) return { ...requirement, resolution: 'unsupported' }
    const definition: AgentRpCapabilityDefinition = AGENT_RP_CAPABILITIES[requirement.capability]
    if (requirement.version !== definition.version) return { ...requirement, resolution: 'version-mismatch' }
    if (definition.runtimePolicies[manifest.runtime] === undefined) {
      return { ...requirement, resolution: 'unsupported' }
    }
    if (policy.denied?.has(requirement.capability) === true) return { ...requirement, resolution: 'denied' }
    if (definition.approval === 'session-policy' && policy.approved?.has(requirement.capability) !== true) {
      return { ...requirement, resolution: 'approval-required' }
    }
    return { ...requirement, resolution: 'available' }
  })
  return { format: 0, runtime: manifest.runtime, entries }
}

/** Convert an extension failure into one bounded result field without exposing a larger Host error object. */
export function boundedAgentRpCapabilityResultError(
  capability: AgentRpCapabilityId,
  runtime: AgentRpExtensionRuntime,
  reason: unknown,
  fallback: string,
): string {
  const definition: AgentRpCapabilityDefinition = AGENT_RP_CAPABILITIES[capability]
  const limit = definition.runtimePolicies[runtime]?.resultBytes
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : fallback
  if (limit === undefined || limit === null) return fallback
  const encoded = new TextEncoder().encode(message)
  if (encoded.byteLength <= limit) return message
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let end = limit; end >= Math.max(0, limit - 3); end--) {
    try {
      return decoder.decode(encoded.slice(0, end))
    } catch {
      // A UTF-8 code point can straddle the byte limit by at most three bytes.
    }
  }
  return ''
}

/** Reduce a capability plan to counts that reveal no extension or card content. */
export function summarizeAgentRpCapabilityPlan(plan: AgentRpCapabilityPlan): AgentRpCapabilityPlanSummary {
  const resolutions: Record<AgentRpCapabilityResolution, number> = {
    available: 0,
    'approval-required': 0,
    unsupported: 0,
    'version-mismatch': 0,
    denied: 0,
  }
  let requiredUnavailable = 0
  let optionalUnavailable = 0
  for (const entry of plan.entries) {
    resolutions[entry.resolution] += 1
    if (entry.resolution === 'available') continue
    if (entry.optional) optionalUnavailable += 1
    else requiredUnavailable += 1
  }
  return { requirements: plan.entries.length, requiredUnavailable, optionalUnavailable, resolutions }
}

/** Combine independent runtime plans into one content-free Session acceptance summary. */
export function mergeAgentRpCapabilityPlanSummaries(
  summaries: readonly AgentRpCapabilityPlanSummary[],
): AgentRpCapabilityPlanSummary {
  const merged: AgentRpCapabilityPlanSummary = {
    requirements: 0,
    requiredUnavailable: 0,
    optionalUnavailable: 0,
    resolutions: {
      available: 0,
      'approval-required': 0,
      unsupported: 0,
      'version-mismatch': 0,
      denied: 0,
    },
  }
  return summaries.reduce((result, summary) => ({
    requirements: result.requirements + summary.requirements,
    requiredUnavailable: result.requiredUnavailable + summary.requiredUnavailable,
    optionalUnavailable: result.optionalUnavailable + summary.optionalUnavailable,
    resolutions: {
      available: result.resolutions.available + summary.resolutions.available,
      'approval-required': result.resolutions['approval-required'] + summary.resolutions['approval-required'],
      unsupported: result.resolutions.unsupported + summary.resolutions.unsupported,
      'version-mismatch': result.resolutions['version-mismatch'] + summary.resolutions['version-mismatch'],
      denied: result.resolutions.denied + summary.resolutions.denied,
    },
  }), merged)
}
