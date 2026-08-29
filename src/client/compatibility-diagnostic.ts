/** Content-free browser diagnostics for one mounted Agent RP interface. */

import type {
  AgentRpRuntimeDiagnosticRegistry,
  AgentRpRuntimeDiagnosticSnapshot,
} from './runtime-diagnostic.ts'
import type { AgentRpTurnHealthDiagnostic } from '../roleplay-turn-health-protocol.ts'
import { WORLD_ENGINE_ACTIVATION_REASONS } from '../world-engine-diagnostic.ts'
import { AGENT_RP_BUILD_IDENTITY, type AgentRpBuildIdentity } from './build-identity.ts'

type Counter = Readonly<Record<string, number>>

/** Root attribute containing the latest serialized content-free report. */
export const AGENT_RP_BROWSER_COMPATIBILITY_ATTRIBUTE = 'data-agent-rp-compatibility-snapshot'

/** Stable issue codes emitted by the browser compatibility snapshot. */
export type AgentRpBrowserCompatibilityIssue =
  | 'capability-required-unavailable'
  | 'card-frame-content-empty'
  | 'card-frame-runtime-failed'
  | 'card-frame-unregistered'
  | 'external-window-callback-rejected'
  | 'external-window-delivery-unconfirmed'
  | 'external-window-closed-without-callback'
  | 'external-window-open-unconfirmed'
  | 'iframe-sandbox-expanded'
  | 'inline-frontend-sanitizer-degraded'
  | 'interactive-entry-missing'
  | 'preflight-count-mismatch'
  | 'preflight-failed'
  | 'preflight-launch-mismatch'
  | 'preflight-request-failed'
  | 'tavern-permission-count-mismatch'
  | 'tavern-runtime-failed'
  | 'turn-record-invalid'
  | 'world-engine-count-mismatch'
  | 'world-engine-degraded'

/** Content-free Host runtime facts plus mounted DOM integrity and interaction checks. */
export interface AgentRpBrowserCompatibilitySnapshot {
  readonly audit: 'agent-rp-browser-compat-v0'
  readonly build: AgentRpBuildIdentity
  readonly runtime?: {
    readonly source: 'host'
    readonly audit: AgentRpRuntimeDiagnosticSnapshot['audit']
    readonly revision: number
    readonly updatedAt: number
    readonly sources: AgentRpRuntimeDiagnosticSnapshot['sources']
  }
  readonly interactions: {
    readonly characterLibrary: {
      readonly launchers: number
      readonly state: 'closed' | 'open'
    }
    readonly presetManager: {
      readonly launchers: number
      readonly state: 'closed' | 'open'
    }
    readonly sessionSettings: {
      readonly launchers: number
      readonly state: 'closed' | 'open'
    }
    readonly tavernPanel: {
      readonly launchers: number
      readonly mobileLaunchers: number
      readonly state: 'closed' | 'mobile' | 'script'
    }
    readonly tavernPermissions: {
      readonly launchers: number
      readonly state: 'closed' | 'open'
    }
    readonly worldInfoManager: {
      readonly launchers: number
      readonly state: 'closed' | 'open'
    }
  }
  /** Content-free elapsed times locating the active startup bottleneck. */
  readonly startup?: {
    readonly phase: 'projection' | 'character' | 'authorization' | 'scripts' | 'ready' | 'unknown'
    readonly sessionElapsedMs: number
    readonly projectionMs?: number
    readonly characterMs?: number
    readonly tavernPlanMs?: number
    readonly tavernFirstReadyMs?: number
    readonly tavernSettledMs?: number
    readonly tavernNavigationFirstMs?: number
    readonly tavernNavigationLastMs?: number
    readonly tavernBootstrapFirstMs?: number
    readonly tavernBootstrapLastMs?: number
    readonly tavernRuntimeFirstMs?: number
    readonly tavernRuntimeLastMs?: number
    readonly tavernScriptFirstMs?: number
    readonly tavernScriptLastMs?: number
    readonly tavernProgramMinMs?: number
    readonly tavernProgramMaxMs?: number
    readonly tavernExecutionMinMs?: number
    readonly tavernExecutionMaxMs?: number
  }
  readonly session?: {
    readonly turns?: AgentRpTurnHealthDiagnostic
    readonly capabilities: {
      readonly extensions: number
      readonly requirements: number
      readonly available: number
      readonly approvals: number
      readonly requiredUnavailable: number
      readonly unsupported: number
      readonly versionMismatch: number
      readonly denied: number
    }
    readonly auxiliaryGenerations: {
      readonly requests: number
      readonly succeeded: number
      readonly failed: number
      readonly pending: number
      readonly malformed: number
    }
    readonly externalWindows: {
      readonly phases: Counter
    }
    readonly nativeIdentity: {
      readonly state: 'loading' | 'unconfigured' | 'ready' | 'error' | 'unknown'
      readonly approved: number
      readonly pending: number
    }
    readonly variables: {
      readonly surfaces: number
      readonly sharedScopes: number
      readonly scriptScopes: number
    }
    readonly renderer: {
      readonly inlineFrontendSanitizer: string
    }
    readonly worldEngine: {
      readonly engine: string
      readonly bindings: {
        readonly books: number
        readonly character: number
        readonly standalone: number
      }
      readonly entries: number
      readonly enabled: number
      readonly active: number
      readonly budgetExcluded: number
      readonly reasons: Counter
      readonly failures: {
        readonly regexRuntimeUnavailable: number
        readonly regexInvalid: number
        readonly regexExecutionLimit: number
        readonly regexResourceLimit: number
        readonly decoratorUnsupported: number
        readonly templateUnsupported: number
        readonly templateError: number
      }
    }
    readonly tavern?: {
      readonly scripts: number
      readonly frames: number
      readonly ready: number
      readonly failed: number
      readonly pendingPermissions: number
      readonly startupPermissions: number
      readonly interactionPermissions: number
      readonly permissionState: 'settled' | 'startup-blocked' | 'interaction-pending' | 'unknown'
      readonly permissions: {
        readonly script: number
        readonly image: number
        readonly style: number
        readonly font: number
        readonly frame: number
        readonly identity: number
        readonly externalWindow: number
        readonly generation: number
        readonly customGeneration: number
        readonly modelList: number
      }
      readonly queuedGenerations: number
      readonly queuedModelLists: number
      readonly blockedResources: number
      readonly blockedResourceOrigins: number
      readonly blockedResourceClasses: Counter
      readonly phases: Counter
      readonly scopes: Counter
    }
    readonly cardFrames: {
      readonly total: number
      readonly scriptEnabled: number
      readonly inert: number
      readonly registered: number
      readonly resized: number
      readonly runtimePhases: Counter
      readonly resourceMonitors: Counter
      readonly blockedResourceClasses: Counter
    }
  }
  readonly preflight?: {
    readonly status: string
    readonly launch: string
    readonly startReadiness?: string
    readonly startAction?: string
    readonly permissionDuration: 'session' | 'remember' | 'trust' | 'unknown'
    readonly scripts: number
    readonly cardResources: number
    readonly pendingCardPermissions: number
    readonly pendingScriptPermissions: number
    readonly pendingScriptOrigins: number
    readonly pendingImageOrigins: number
    readonly pendingStyleOrigins: number
    readonly pendingFrameOrigins: number
    readonly pendingPermissions: number
    readonly failed: number
  }
  readonly checks: {
    readonly capabilitiesResolved: boolean
    readonly externalWindowsHealthy: boolean
    readonly iframeSandboxRestricted: boolean
    readonly inlineFrontendHealthy: boolean
    readonly interactiveEntriesPresent: boolean
    readonly preflightConsistent: boolean
    readonly preflightHealthy: boolean
    readonly tavernPermissionsConsistent: boolean
    readonly tavernRuntimeHealthy: boolean
    readonly turnRecordHealthy: boolean
    readonly worldEngineHealthy: boolean
  }
  readonly issues: readonly AgentRpBrowserCompatibilityIssue[]
}

declare global {
  interface Window {
    /** Return content-free Agent RP state for local and community compatibility reports. */
    __dshAgentRpCompatibilitySnapshot?: () => AgentRpBrowserCompatibilitySnapshot
  }
}

function integer(element: Element, name: string): number {
  const value = Number(element.getAttribute(name))
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function optionalInteger(element: Element | null, name: string): number | undefined {
  if (element === null) return undefined
  const source = element.getAttribute(name)
  if (source === null) return undefined
  const parsed = Number(source)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function value(element: Element, name: string): string {
  return element.getAttribute(name) ?? ''
}

function nativeIdentityState(element: Element): 'loading' | 'unconfigured' | 'ready' | 'error' | 'unknown' {
  const state = value(element, 'data-agent-rp-native-identity')
  return state === 'loading' || state === 'unconfigured' || state === 'ready' || state === 'error'
    ? state : 'unknown'
}

function counter(elements: readonly Element[], name: string): Counter {
  const result: Record<string, number> = {}
  for (const element of elements) {
    const current = element.getAttribute(name)
    if (current !== null && current !== '') result[current] = (result[current] ?? 0) + 1
  }
  return result
}

function sandboxTokens(frame: Element): readonly string[] | undefined {
  const source = frame.getAttribute('sandbox')
  return source === null ? undefined : source.trim() === '' ? [] : source.trim().split(/\s+/u)
}

function restrictedSandbox(frame: Element): boolean {
  const tokens = sandboxTokens(frame)
  if (frame.getAttribute('data-agent-rp-tavern-script-scope') !== null) {
    return tokens?.length === 3
      && tokens.includes('allow-scripts') && tokens.includes('allow-same-origin') && tokens.includes('allow-forms')
      && frame.getAttribute('src')?.startsWith('data:text/html;charset=utf-8;base64,') === true
      && frame.getAttribute('srcdoc') === null
  }
  const directCardFrame = tokens?.length === 1 && tokens[0] === 'allow-scripts'
  const compatibilityShell = tokens?.length === 2
    && tokens.includes('allow-scripts') && tokens.includes('allow-same-origin')
    && frame.getAttribute('src')?.startsWith('data:text/html;charset=utf-8;base64,') === true
    && frame.getAttribute('srcdoc') === null
  return directCardFrame || compatibilityShell
}

/** Assemble one mounted interface from Host facts and DOM checks without copying content-bearing values. */
export function collectAgentRpBrowserCompatibilitySnapshot(
  root: ParentNode,
  runtime?: AgentRpRuntimeDiagnosticSnapshot,
): AgentRpBrowserCompatibilitySnapshot {
  const status = root.querySelector('[data-agent-rp-status]')
  const tavern = root.querySelector('[data-agent-rp-tavern-total]')
  const tavernFrames = [...root.querySelectorAll('iframe[data-agent-rp-tavern-script-scope]')]
  const cardFrames = [...root.querySelectorAll('iframe[data-agent-rp-frame]')]
  const allFrames = [...tavernFrames, ...cardFrames]
  const scriptCardFrames = cardFrames.filter(frame => sandboxTokens(frame)?.includes('allow-scripts') === true)
  const externalWindowPhases = counter(
    [...root.querySelectorAll('[data-agent-rp-external-window-phase]')],
    'data-agent-rp-external-window-phase',
  )
  const preflightElement = root.querySelector('[data-agent-rp-resource-preflight]')
  const startElement = root.querySelector('[data-agent-rp-start-readiness]')
  const characterLibraryLaunchers = root.querySelectorAll('[data-agent-rp-action="open-character-library"]').length
  const characterLibraryOpen = root.querySelector('[data-agent-rp-surface="character-library"]') !== null
  const sessionSettingsLaunchers = root.querySelectorAll('[data-agent-rp-action="toggle-session-settings"]').length
  const sessionSettingsOpen = root.querySelector('[data-agent-rp-surface="session-settings"]')
    ?.getAttribute('data-agent-rp-surface-state') === 'open'
  const presetManagerLaunchers = root.querySelectorAll('[data-agent-rp-action="open-preset-manager"]').length
  const presetManagerOpen = root.querySelector('[data-agent-rp-surface="preset-manager"]') !== null
  const worldInfoManagerLaunchers = root.querySelectorAll('[data-agent-rp-action="open-world-info-manager"]').length
  const worldInfoManagerOpen = root.querySelector('[data-agent-rp-surface="world-info-manager"]') !== null
  const tavernPanelLaunchers = root.querySelectorAll('[data-agent-rp-action="open-tavern-panel"]').length
  const mobileLaunchers = root.querySelectorAll('[data-agent-rp-action="open-mobile-surface"]').length
  const tavernPermissionLaunchers = root.querySelectorAll('[data-agent-rp-action="open-tavern-permissions"]').length
  const tavernPermissionsOpen = root.querySelector('[data-agent-rp-surface="tavern-permissions"]') !== null
  const tavernPanelStateValue = root.querySelector('[data-agent-rp-surface="tavern-panel"]')
    ?.getAttribute('data-agent-rp-surface-state')
  const tavernPanelState = tavernPanelStateValue === 'mobile' || tavernPanelStateValue === 'script'
    ? tavernPanelStateValue
    : 'closed'
  const issues = new Set<AgentRpBrowserCompatibilityIssue>()
  const startupPhaseValue = status?.getAttribute('data-agent-rp-startup-phase')
  let startupPhase: NonNullable<AgentRpBrowserCompatibilitySnapshot['startup']>['phase']
    = startupPhaseValue === 'projection' || startupPhaseValue === 'character' || startupPhaseValue === 'ready'
      ? startupPhaseValue : 'unknown'
  if (startupPhase === 'ready' && tavern !== null) {
    if (tavern.getAttribute('data-agent-rp-tavern-permission-state') === 'startup-blocked') {
      startupPhase = 'authorization'
    } else if (integer(tavern, 'data-agent-rp-tavern-ready')
      + integer(tavern, 'data-agent-rp-tavern-failed') < integer(tavern, 'data-agent-rp-tavern-total')) {
      startupPhase = 'scripts'
    }
  }
  const projectionMs = optionalInteger(status, 'data-agent-rp-startup-projection-ms')
  const characterMs = optionalInteger(status, 'data-agent-rp-startup-character-ms')
  const tavernPlanMs = optionalInteger(tavern, 'data-agent-rp-tavern-plan-ms')
  const tavernFirstReadyMs = optionalInteger(tavern, 'data-agent-rp-tavern-first-ready-ms')
  const tavernSettledMs = optionalInteger(tavern, 'data-agent-rp-tavern-settled-ms')
  const tavernNavigationFirstMs = optionalInteger(tavern, 'data-agent-rp-tavern-navigation-first-ms')
  const tavernNavigationLastMs = optionalInteger(tavern, 'data-agent-rp-tavern-navigation-last-ms')
  const tavernBootstrapFirstMs = optionalInteger(tavern, 'data-agent-rp-tavern-bootstrap-first-ms')
  const tavernBootstrapLastMs = optionalInteger(tavern, 'data-agent-rp-tavern-bootstrap-last-ms')
  const tavernRuntimeFirstMs = optionalInteger(tavern, 'data-agent-rp-tavern-runtime-first-ms')
  const tavernRuntimeLastMs = optionalInteger(tavern, 'data-agent-rp-tavern-runtime-last-ms')
  const tavernScriptFirstMs = optionalInteger(tavern, 'data-agent-rp-tavern-script-first-ms')
  const tavernScriptLastMs = optionalInteger(tavern, 'data-agent-rp-tavern-script-last-ms')
  const tavernProgramMinMs = optionalInteger(tavern, 'data-agent-rp-tavern-program-min-ms')
  const tavernProgramMaxMs = optionalInteger(tavern, 'data-agent-rp-tavern-program-max-ms')
  const tavernExecutionMinMs = optionalInteger(tavern, 'data-agent-rp-tavern-execution-min-ms')
  const tavernExecutionMaxMs = optionalInteger(tavern, 'data-agent-rp-tavern-execution-max-ms')
  const startup = status?.getAttribute('data-agent-rp-startup') === null || status === null
    ? undefined
    : {
        phase: startupPhase,
        sessionElapsedMs: integer(status, 'data-agent-rp-startup-elapsed-ms'),
        ...(projectionMs === undefined ? {} : { projectionMs }),
        ...(characterMs === undefined ? {} : { characterMs }),
        ...(tavernPlanMs === undefined ? {} : { tavernPlanMs }),
        ...(tavernFirstReadyMs === undefined ? {} : { tavernFirstReadyMs }),
        ...(tavernSettledMs === undefined ? {} : { tavernSettledMs }),
        ...(tavernNavigationFirstMs === undefined ? {} : { tavernNavigationFirstMs }),
        ...(tavernNavigationLastMs === undefined ? {} : { tavernNavigationLastMs }),
        ...(tavernBootstrapFirstMs === undefined ? {} : { tavernBootstrapFirstMs }),
        ...(tavernBootstrapLastMs === undefined ? {} : { tavernBootstrapLastMs }),
        ...(tavernRuntimeFirstMs === undefined ? {} : { tavernRuntimeFirstMs }),
        ...(tavernRuntimeLastMs === undefined ? {} : { tavernRuntimeLastMs }),
        ...(tavernScriptFirstMs === undefined ? {} : { tavernScriptFirstMs }),
        ...(tavernScriptLastMs === undefined ? {} : { tavernScriptLastMs }),
        ...(tavernProgramMinMs === undefined ? {} : { tavernProgramMinMs }),
        ...(tavernProgramMaxMs === undefined ? {} : { tavernProgramMaxMs }),
        ...(tavernExecutionMinMs === undefined ? {} : { tavernExecutionMinMs }),
        ...(tavernExecutionMaxMs === undefined ? {} : { tavernExecutionMaxMs }),
      }

  let session: AgentRpBrowserCompatibilitySnapshot['session']
  if (status !== null && status.getAttribute('data-agent-rp-capability-extensions') !== null) {
    const capabilities = {
      extensions: integer(status, 'data-agent-rp-capability-extensions'),
      requirements: integer(status, 'data-agent-rp-capability-requirements'),
      available: integer(status, 'data-agent-rp-capability-available'),
      approvals: integer(status, 'data-agent-rp-capability-approvals'),
      requiredUnavailable: integer(status, 'data-agent-rp-capability-required-unavailable'),
      unsupported: integer(status, 'data-agent-rp-capability-unsupported'),
      versionMismatch: integer(status, 'data-agent-rp-capability-version-mismatch'),
      denied: integer(status, 'data-agent-rp-capability-denied'),
    }
    const inlineFrontendSanitizer = value(status, 'data-agent-rp-inline-frontend-sanitizer')
    const unregisteredCardFrames = scriptCardFrames.filter(
      frame => frame.getAttribute('data-agent-rp-frame-registered') !== 'true',
    ).length
    const runtimePhases = counter(scriptCardFrames, 'data-agent-rp-runtime-phase')
    const tavernFailed = tavern === null ? 0 : integer(tavern, 'data-agent-rp-tavern-failed')
    const tavernPermissionState = tavern?.getAttribute('data-agent-rp-tavern-permission-state')
    const normalizedTavernPermissionState = tavernPermissionState === 'settled'
      || tavernPermissionState === 'startup-blocked' || tavernPermissionState === 'interaction-pending'
      ? tavernPermissionState : 'unknown'
    const worldEngineFailures = {
      regexRuntimeUnavailable: integer(status, 'data-agent-rp-world-engine-regex-runtime-unavailable'),
      regexInvalid: integer(status, 'data-agent-rp-world-engine-regex-invalid'),
      regexExecutionLimit: integer(status, 'data-agent-rp-world-engine-regex-execution-limit'),
      regexResourceLimit: integer(status, 'data-agent-rp-world-engine-regex-resource-limit'),
      decoratorUnsupported: integer(status, 'data-agent-rp-world-engine-decorator-unsupported'),
      templateUnsupported: integer(status, 'data-agent-rp-world-engine-template-unsupported'),
      templateError: integer(status, 'data-agent-rp-world-engine-template-error'),
    }
    const worldEngineReasons = Object.fromEntries(WORLD_ENGINE_ACTIVATION_REASONS.flatMap(reason => {
      const total = integer(status, `data-agent-rp-world-engine-reason-${reason}`)
      return total === 0 ? [] : [[reason, total]]
    }))
    session = {
      capabilities,
      auxiliaryGenerations: {
        requests: integer(status, 'data-agent-rp-auxiliary-generation-requests'),
        succeeded: integer(status, 'data-agent-rp-auxiliary-generation-succeeded'),
        failed: integer(status, 'data-agent-rp-auxiliary-generation-failed'),
        pending: integer(status, 'data-agent-rp-auxiliary-generation-pending'),
        malformed: integer(status, 'data-agent-rp-auxiliary-generation-malformed'),
      },
      externalWindows: { phases: externalWindowPhases },
      nativeIdentity: {
        state: nativeIdentityState(status),
        approved: integer(status, 'data-agent-rp-native-identity-approved'),
        pending: integer(status, 'data-agent-rp-native-identity-pending')
          + (tavern === null ? 0 : integer(tavern, 'data-agent-rp-native-identity-pending')),
      },
      variables: {
        surfaces: integer(status, 'data-agent-rp-variable-surfaces'),
        sharedScopes: integer(status, 'data-agent-rp-variable-shared-scopes'),
        scriptScopes: integer(status, 'data-agent-rp-variable-script-scopes'),
      },
      renderer: { inlineFrontendSanitizer },
      worldEngine: {
        engine: value(status, 'data-agent-rp-world-engine'),
        bindings: {
          books: integer(status, 'data-agent-rp-world-engine-books'),
          character: integer(status, 'data-agent-rp-world-engine-character-books'),
          standalone: integer(status, 'data-agent-rp-world-engine-standalone-books'),
        },
        entries: integer(status, 'data-agent-rp-world-engine-entries'),
        enabled: integer(status, 'data-agent-rp-world-engine-enabled'),
        active: integer(status, 'data-agent-rp-world-engine-active'),
        budgetExcluded: integer(status, 'data-agent-rp-world-engine-budget-excluded'),
        reasons: worldEngineReasons,
        failures: worldEngineFailures,
      },
      ...(tavern === null ? {} : { tavern: {
        scripts: integer(tavern, 'data-agent-rp-tavern-total'),
        frames: tavernFrames.length,
        ready: integer(tavern, 'data-agent-rp-tavern-ready'),
        failed: tavernFailed,
        pendingPermissions: integer(tavern, 'data-agent-rp-tavern-permissions'),
        startupPermissions: integer(tavern, 'data-agent-rp-tavern-startup-permissions'),
        interactionPermissions: integer(tavern, 'data-agent-rp-tavern-interaction-permissions'),
        permissionState: normalizedTavernPermissionState,
        permissions: {
          script: integer(tavern, 'data-agent-rp-tavern-permission-script'),
          image: integer(tavern, 'data-agent-rp-tavern-permission-image'),
          style: integer(tavern, 'data-agent-rp-tavern-permission-style'),
          font: integer(tavern, 'data-agent-rp-tavern-permission-font'),
          frame: integer(tavern, 'data-agent-rp-tavern-permission-frame'),
          identity: integer(tavern, 'data-agent-rp-tavern-permission-identity'),
          externalWindow: integer(tavern, 'data-agent-rp-tavern-permission-external-window'),
          generation: integer(tavern, 'data-agent-rp-tavern-permission-generation'),
          customGeneration: integer(tavern, 'data-agent-rp-tavern-permission-custom-generation'),
          modelList: integer(tavern, 'data-agent-rp-tavern-permission-model-list'),
        },
        queuedGenerations: integer(tavern, 'data-agent-rp-tavern-generation-queued'),
        queuedModelLists: integer(tavern, 'data-agent-rp-tavern-model-list-queued'),
        blockedResources: integer(tavern, 'data-agent-rp-tavern-resource-blocked'),
        blockedResourceOrigins: integer(tavern, 'data-agent-rp-tavern-resource-blocked-origins'),
        blockedResourceClasses: Object.fromEntries(
          (['connect', 'font', 'frame', 'image', 'media', 'script', 'style'] as const).flatMap(type => {
            const total = integer(tavern, `data-agent-rp-tavern-resource-blocked-${type}`)
            return total === 0 ? [] : [[type, total] as const]
          }),
        ),
        phases: counter(tavernFrames, 'data-agent-rp-tavern-phase'),
        scopes: counter(tavernFrames, 'data-agent-rp-tavern-script-scope'),
      } }),
      cardFrames: {
        total: cardFrames.length,
        scriptEnabled: scriptCardFrames.length,
        inert: cardFrames.filter(frame => sandboxTokens(frame)?.length === 0).length,
        registered: scriptCardFrames.length - unregisteredCardFrames,
        resized: scriptCardFrames.filter(frame => frame.getAttribute('data-agent-rp-resize-received') === 'true').length,
        runtimePhases,
        resourceMonitors: counter(scriptCardFrames, 'data-agent-rp-resource-monitor'),
        blockedResourceClasses: counter(scriptCardFrames, 'data-agent-rp-resource-blocked'),
      },
    }
  }

  if (runtime?.session !== undefined) session = runtime.session
  if (session !== undefined) {
    if (session.turns?.status === 'invalid') issues.add('turn-record-invalid')
    if (session.capabilities.requiredUnavailable > 0) issues.add('capability-required-unavailable')
    if ((session.externalWindows.phases['external-open-unconfirmed'] ?? 0) > 0) {
      issues.add('external-window-open-unconfirmed')
    }
    if ((session.externalWindows.phases['callback-rejected'] ?? 0) > 0) {
      issues.add('external-window-callback-rejected')
    }
    if ((session.externalWindows.phases['callback-delivery-unconfirmed'] ?? 0) > 0) {
      issues.add('external-window-delivery-unconfirmed')
    }
    if ((session.externalWindows.phases['external-closed-without-callback'] ?? 0) > 0) {
      issues.add('external-window-closed-without-callback')
    }
    if (session.renderer.inlineFrontendSanitizer !== 'ready') issues.add('inline-frontend-sanitizer-degraded')
    if (session.cardFrames.registered < session.cardFrames.scriptEnabled) issues.add('card-frame-unregistered')
    if ((session.cardFrames.runtimePhases['content-empty'] ?? 0) > 0) issues.add('card-frame-content-empty')
    if ((session.cardFrames.runtimePhases['runtime-error'] ?? 0)
      + (session.cardFrames.runtimePhases['runtime-rejection'] ?? 0) > 0) {
      issues.add('card-frame-runtime-failed')
    }
    if ((session.tavern?.failed ?? 0) > 0) issues.add('tavern-runtime-failed')
    const worldReasonTotal = Object.values(session.worldEngine.reasons).reduce((total, count) => total + count, 0)
    const worldActive = (session.worldEngine.reasons['active-constant'] ?? 0)
      + (session.worldEngine.reasons['active-keyword'] ?? 0)
    const worldCountsConsistent = session.worldEngine.bindings.books
        === session.worldEngine.bindings.character + session.worldEngine.bindings.standalone
      && session.worldEngine.entries === worldReasonTotal
      && session.worldEngine.active === worldActive
      && session.worldEngine.enabled === session.worldEngine.entries
        - (session.worldEngine.reasons.disabled ?? 0) - (session.worldEngine.reasons.deleted ?? 0)
      && (session.worldEngine.engine === 'inactive') === (session.worldEngine.bindings.books === 0)
    if (!worldCountsConsistent) issues.add('world-engine-count-mismatch')
    if (Object.values(session.worldEngine.failures).some(count => count > 0)) issues.add('world-engine-degraded')
  }

  const interactiveEntriesPresent = session === undefined || (
    characterLibraryLaunchers > 0
    && sessionSettingsLaunchers > 0
    && (!sessionSettingsOpen || (presetManagerLaunchers > 0 && worldInfoManagerLaunchers > 0))
    && (session.tavern === undefined || session.tavern.scripts === 0 || tavernPanelLaunchers > 0)
    && (session.tavern === undefined || session.tavern.pendingPermissions === 0 || tavernPermissionLaunchers > 0)
  )
  if (!interactiveEntriesPresent) issues.add('interactive-entry-missing')
  const expectedTavernPermissionState = session?.tavern === undefined ? undefined
    : session.tavern.startupPermissions > 0 ? 'startup-blocked'
      : session.tavern.interactionPermissions > 0 ? 'interaction-pending' : 'settled'
  const expectedTavernStartupPermissions = session?.tavern === undefined ? undefined
    : session.tavern.permissions.script + session.tavern.permissions.image
      + session.tavern.permissions.style + session.tavern.permissions.frame
  const expectedTavernInteractionPermissions = session?.tavern === undefined ? undefined
    : session.tavern.permissions.font + session.tavern.permissions.identity + session.tavern.permissions.externalWindow
      + session.tavern.permissions.generation + session.tavern.permissions.customGeneration
      + session.tavern.permissions.modelList
  const tavernPermissionsConsistent = session?.tavern === undefined
    || (Object.values(session.tavern.permissions).reduce((total, count) => total + count, 0)
      === session.tavern.pendingPermissions
      && session.tavern.startupPermissions + session.tavern.interactionPermissions
        === session.tavern.pendingPermissions
      && session.tavern.startupPermissions === expectedTavernStartupPermissions
      && session.tavern.interactionPermissions === expectedTavernInteractionPermissions
      && session.tavern.permissionState === expectedTavernPermissionState)
  if (!tavernPermissionsConsistent) issues.add('tavern-permission-count-mismatch')

  let preflight: AgentRpBrowserCompatibilitySnapshot['preflight']
  let preflightConsistent = true
  let preflightHealthy = true
  if (preflightElement !== null) {
    const pendingCardPermissions = integer(preflightElement, 'data-agent-rp-resource-preflight-card-permissions')
    const pendingScriptPermissions = integer(preflightElement, 'data-agent-rp-resource-preflight-script-permissions')
    const pendingScriptOrigins = integer(preflightElement, 'data-agent-rp-resource-preflight-script-origins')
    const pendingImageOrigins = integer(preflightElement, 'data-agent-rp-resource-preflight-image-origins')
    const pendingStyleOrigins = integer(preflightElement, 'data-agent-rp-resource-preflight-style-origins')
    const pendingFrameOrigins = integer(preflightElement, 'data-agent-rp-resource-preflight-frame-origins')
    const pendingPermissions = integer(preflightElement, 'data-agent-rp-resource-preflight-permissions')
    const statusValue = value(preflightElement, 'data-agent-rp-resource-preflight')
    const launch = value(preflightElement, 'data-agent-rp-resource-launch')
    const failed = integer(preflightElement, 'data-agent-rp-resource-preflight-failed')
    const startReadiness = startElement?.getAttribute('data-agent-rp-start-readiness') ?? undefined
    const startAction = startElement?.getAttribute('data-agent-rp-start-action') ?? undefined
    const permissionDurationValue = value(preflightElement, 'data-agent-rp-resource-permission-duration')
    const permissionDuration = permissionDurationValue === 'session' || permissionDurationValue === 'remember'
      || permissionDurationValue === 'trust'
      ? permissionDurationValue : 'unknown'
    preflight = {
      status: statusValue,
      launch,
      ...(startReadiness === undefined ? {} : { startReadiness }),
      ...(startAction === undefined ? {} : { startAction }),
      permissionDuration,
      scripts: integer(preflightElement, 'data-agent-rp-resource-preflight-scripts'),
      cardResources: integer(preflightElement, 'data-agent-rp-resource-preflight-card-resources'),
      pendingCardPermissions,
      pendingScriptPermissions,
      pendingScriptOrigins,
      pendingImageOrigins,
      pendingStyleOrigins,
      pendingFrameOrigins,
      pendingPermissions,
      failed,
    }
  }
  if (runtime?.preflight !== undefined) preflight = runtime.preflight
  if (preflight !== undefined) {
    preflightConsistent = preflight.pendingPermissions
        === preflight.pendingCardPermissions + preflight.pendingScriptPermissions
      && preflight.pendingScriptPermissions
        === preflight.pendingScriptOrigins + preflight.pendingImageOrigins
          + preflight.pendingStyleOrigins + preflight.pendingFrameOrigins
      && preflight.permissionDuration !== 'unknown'
    if (!preflightConsistent) issues.add('preflight-count-mismatch')
    const expectedLaunch = preflight.status === 'loading' ? 'checking'
      : preflight.pendingPermissions > 0 ? 'approval-required' : 'ready'
    const expectedStartAction = expectedLaunch === 'checking' ? 'checking'
      : expectedLaunch === 'approval-required' ? 'approve-and-start' : 'start'
    if (preflight.launch !== expectedLaunch
      || (preflight.startReadiness !== undefined && preflight.startReadiness !== preflight.launch)
      || (preflight.startAction !== undefined && preflight.startAction !== expectedStartAction)) {
      preflightConsistent = false
      issues.add('preflight-launch-mismatch')
    }
    if (preflight.failed > 0) {
      preflightHealthy = false
      issues.add('preflight-failed')
    }
    if (preflight.status === 'error') {
      preflightHealthy = false
      issues.add('preflight-request-failed')
    }
  }

  if (allFrames.some(frame => !restrictedSandbox(frame))) issues.add('iframe-sandbox-expanded')
  return {
    audit: 'agent-rp-browser-compat-v0',
    build: AGENT_RP_BUILD_IDENTITY,
    ...(runtime === undefined ? {} : { runtime: {
      source: 'host' as const,
      audit: runtime.audit,
      revision: runtime.revision,
      updatedAt: runtime.updatedAt,
      sources: runtime.sources,
    } }),
    interactions: {
      characterLibrary: {
        launchers: characterLibraryLaunchers,
        state: characterLibraryOpen ? 'open' : 'closed',
      },
      presetManager: {
        launchers: presetManagerLaunchers,
        state: presetManagerOpen ? 'open' : 'closed',
      },
      sessionSettings: {
        launchers: sessionSettingsLaunchers,
        state: sessionSettingsOpen ? 'open' : 'closed',
      },
      tavernPanel: {
        launchers: tavernPanelLaunchers,
        mobileLaunchers,
        state: tavernPanelState,
      },
      tavernPermissions: {
        launchers: tavernPermissionLaunchers,
        state: tavernPermissionsOpen ? 'open' : 'closed',
      },
      worldInfoManager: {
        launchers: worldInfoManagerLaunchers,
        state: worldInfoManagerOpen ? 'open' : 'closed',
      },
    },
    ...(startup === undefined ? {} : { startup }),
    ...(session === undefined ? {} : { session }),
    ...(preflight === undefined ? {} : { preflight }),
    checks: {
      capabilitiesResolved: session === undefined || session.capabilities.requiredUnavailable === 0,
      externalWindowsHealthy: !issues.has('external-window-callback-rejected')
        && !issues.has('external-window-delivery-unconfirmed')
        && !issues.has('external-window-closed-without-callback')
        && !issues.has('external-window-open-unconfirmed'),
      iframeSandboxRestricted: !issues.has('iframe-sandbox-expanded'),
      inlineFrontendHealthy: session === undefined || !issues.has('inline-frontend-sanitizer-degraded'),
      interactiveEntriesPresent,
      preflightConsistent,
      preflightHealthy,
      tavernPermissionsConsistent,
      tavernRuntimeHealthy: session?.tavern === undefined || session.tavern.failed === 0,
      turnRecordHealthy: session?.turns?.status !== 'invalid',
      worldEngineHealthy: session === undefined || (!issues.has('world-engine-degraded')
        && !issues.has('world-engine-count-mismatch')),
    },
    issues: [...issues].sort(),
  }
}

/** Install the content-free snapshot function without granting a card frame access to the Host page. */
export function installAgentRpBrowserCompatibilityDiagnostic(
  target: Window,
  root: ParentNode,
  runtime?: Pick<AgentRpRuntimeDiagnosticRegistry, 'snapshot' | 'subscribe'>,
): () => void {
  const previous = target.__dshAgentRpCompatibilitySnapshot
  const documentRoot = 'documentElement' in root ? (root as Document).documentElement : undefined
  const previousAttribute = documentRoot?.getAttribute(AGENT_RP_BROWSER_COMPATIBILITY_ATTRIBUTE) ?? undefined
  const snapshot = (): AgentRpBrowserCompatibilitySnapshot => collectAgentRpBrowserCompatibilitySnapshot(
    root,
    runtime?.snapshot(),
  )
  const refresh = (): void => {
    if (documentRoot === undefined) return
    const serialized = JSON.stringify(snapshot())
    if (documentRoot.getAttribute(AGENT_RP_BROWSER_COMPATIBILITY_ATTRIBUTE) !== serialized) {
      documentRoot.setAttribute(AGENT_RP_BROWSER_COMPATIBILITY_ATTRIBUTE, serialized)
    }
  }
  target.__dshAgentRpCompatibilitySnapshot = snapshot
  let scheduledRefresh: number | undefined
  const scheduleRefresh = (): void => {
    if (scheduledRefresh !== undefined) return
    scheduledRefresh = target.setTimeout(() => {
      scheduledRefresh = undefined
      refresh()
    }, 50)
  }
  const observer = new MutationObserver(scheduleRefresh)
  const unsubscribeRuntime = runtime?.subscribe(scheduleRefresh)
  observer.observe(root as Node, {
    attributes: true,
    attributeFilter: [
      'sandbox',
      'data-agent-rp-status',
      'data-agent-rp-startup',
      'data-agent-rp-startup-phase',
      'data-agent-rp-startup-elapsed-ms',
      'data-agent-rp-startup-projection-ms',
      'data-agent-rp-startup-character-ms',
      'data-agent-rp-inline-frontend-sanitizer',
      'data-agent-rp-capability-extensions',
      'data-agent-rp-capability-requirements',
      'data-agent-rp-capability-available',
      'data-agent-rp-capability-approvals',
      'data-agent-rp-capability-required-unavailable',
      'data-agent-rp-capability-unsupported',
      'data-agent-rp-capability-version-mismatch',
      'data-agent-rp-capability-denied',
      'data-agent-rp-native-identity',
      'data-agent-rp-native-identity-approved',
      'data-agent-rp-native-identity-pending',
      'data-agent-rp-auxiliary-generation-requests',
      'data-agent-rp-auxiliary-generation-succeeded',
      'data-agent-rp-auxiliary-generation-failed',
      'data-agent-rp-auxiliary-generation-pending',
      'data-agent-rp-auxiliary-generation-malformed',
      'data-agent-rp-external-window-phase',
      'data-agent-rp-variable-surfaces',
      'data-agent-rp-variable-shared-scopes',
      'data-agent-rp-variable-script-scopes',
      'data-agent-rp-world-engine',
      'data-agent-rp-world-engine-entries',
      'data-agent-rp-world-engine-active',
      'data-agent-rp-world-engine-budget-excluded',
      'data-agent-rp-world-engine-regex-runtime-unavailable',
      'data-agent-rp-world-engine-regex-invalid',
      'data-agent-rp-world-engine-regex-execution-limit',
      'data-agent-rp-world-engine-regex-resource-limit',
      'data-agent-rp-world-engine-decorator-unsupported',
      'data-agent-rp-world-engine-template-unsupported',
      'data-agent-rp-world-engine-template-error',
      'data-agent-rp-tavern-total',
      'data-agent-rp-tavern-ready',
      'data-agent-rp-tavern-failed',
      'data-agent-rp-tavern-permissions',
      'data-agent-rp-tavern-startup-permissions',
      'data-agent-rp-tavern-interaction-permissions',
      'data-agent-rp-tavern-permission-state',
      'data-agent-rp-tavern-plan-ms',
      'data-agent-rp-tavern-first-ready-ms',
      'data-agent-rp-tavern-settled-ms',
      'data-agent-rp-tavern-permission-script',
      'data-agent-rp-tavern-permission-image',
      'data-agent-rp-tavern-permission-style',
      'data-agent-rp-tavern-permission-frame',
      'data-agent-rp-tavern-permission-identity',
      'data-agent-rp-tavern-permission-external-window',
      'data-agent-rp-tavern-permission-generation',
      'data-agent-rp-tavern-permission-custom-generation',
      'data-agent-rp-tavern-permission-model-list',
      'data-agent-rp-tavern-generation-queued',
      'data-agent-rp-tavern-model-list-queued',
      'data-agent-rp-tavern-resource-blocked',
      'data-agent-rp-tavern-resource-blocked-origins',
      'data-agent-rp-tavern-resource-blocked-connect',
      'data-agent-rp-tavern-resource-blocked-font',
      'data-agent-rp-tavern-resource-blocked-frame',
      'data-agent-rp-tavern-resource-blocked-image',
      'data-agent-rp-tavern-resource-blocked-media',
      'data-agent-rp-tavern-resource-blocked-script',
      'data-agent-rp-tavern-resource-blocked-style',
      'data-agent-rp-tavern-phase',
      'data-agent-rp-tavern-script-scope',
      'data-agent-rp-frame',
      'data-agent-rp-frame-registered',
      'data-agent-rp-resize-received',
      'data-agent-rp-runtime-phase',
      'data-agent-rp-resource-monitor',
      'data-agent-rp-resource-blocked',
      'data-agent-rp-resource-preflight',
      'data-agent-rp-resource-launch',
      'data-agent-rp-resource-preflight-scripts',
      'data-agent-rp-resource-preflight-card-resources',
      'data-agent-rp-resource-preflight-card-permissions',
      'data-agent-rp-resource-preflight-script-permissions',
      'data-agent-rp-resource-preflight-script-origins',
      'data-agent-rp-resource-preflight-image-origins',
      'data-agent-rp-resource-preflight-style-origins',
      'data-agent-rp-resource-preflight-frame-origins',
      'data-agent-rp-resource-preflight-permissions',
      'data-agent-rp-resource-preflight-failed',
      'data-agent-rp-resource-permission-duration',
      'data-agent-rp-start-readiness',
      'data-agent-rp-start-action',
      'data-agent-rp-action',
      'data-agent-rp-surface',
      'data-agent-rp-surface-state',
    ],
    childList: true,
    subtree: true,
  })
  refresh()
  return () => {
    observer.disconnect()
    unsubscribeRuntime?.()
    if (scheduledRefresh !== undefined) target.clearTimeout(scheduledRefresh)
    if (documentRoot !== undefined) {
      if (previousAttribute === undefined) documentRoot.removeAttribute(AGENT_RP_BROWSER_COMPATIBILITY_ATTRIBUTE)
      else documentRoot.setAttribute(AGENT_RP_BROWSER_COMPATIBILITY_ATTRIBUTE, previousAttribute)
    }
    if (previous === undefined) delete target.__dshAgentRpCompatibilitySnapshot
    else target.__dshAgentRpCompatibilitySnapshot = previous
  }
}
