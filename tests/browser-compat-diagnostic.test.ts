import assert from 'node:assert/strict'
import test from 'node:test'
import { collectAgentRpBrowserCompatibilitySnapshot } from '../src/client/compatibility-diagnostic.ts'
import {
  AgentRpRuntimeDiagnosticRegistry,
  createAgentRpRuntimeDiagnosticSource,
} from '../src/client/runtime-diagnostic.ts'

class DiagnosticElement {
  readonly attributes: Readonly<Record<string, string>>

  constructor(attributes: Readonly<Record<string, string>>) {
    this.attributes = attributes
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }
}

function diagnosticRoot(selectors: Readonly<Record<string, readonly DiagnosticElement[]>>): ParentNode {
  return {
    querySelector: (selector: string) => selectors[selector]?.[0] ?? null,
    querySelectorAll: (selector: string) => selectors[selector] ?? [],
  } as unknown as ParentNode
}

const capabilityAttributes = {
  'data-agent-rp-inline-frontend-sanitizer': 'ready',
  'data-agent-rp-capability-extensions': '4',
  'data-agent-rp-capability-requirements': '13',
  'data-agent-rp-capability-available': '13',
  'data-agent-rp-capability-approvals': '0',
  'data-agent-rp-capability-required-unavailable': '0',
  'data-agent-rp-capability-unsupported': '0',
  'data-agent-rp-capability-version-mismatch': '0',
  'data-agent-rp-capability-denied': '0',
  'data-agent-rp-native-identity': 'ready',
  'data-agent-rp-native-identity-approved': '3',
  'data-agent-rp-native-identity-pending': '1',
  'data-agent-rp-auxiliary-generation-requests': '2',
  'data-agent-rp-auxiliary-generation-succeeded': '1',
  'data-agent-rp-auxiliary-generation-failed': '0',
  'data-agent-rp-auxiliary-generation-pending': '1',
  'data-agent-rp-auxiliary-generation-malformed': '0',
  'data-agent-rp-variable-surfaces': '2',
  'data-agent-rp-variable-shared-scopes': '5',
  'data-agent-rp-variable-script-scopes': '1',
  'data-agent-rp-world-engine': 'native-v0',
  'data-agent-rp-world-engine-books': '3',
  'data-agent-rp-world-engine-character-books': '1',
  'data-agent-rp-world-engine-standalone-books': '2',
  'data-agent-rp-world-engine-entries': '611',
  'data-agent-rp-world-engine-enabled': '585',
  'data-agent-rp-world-engine-active': '14',
  'data-agent-rp-world-engine-budget-excluded': '21',
  'data-agent-rp-world-engine-reason-active-constant': '10',
  'data-agent-rp-world-engine-reason-active-keyword': '4',
  'data-agent-rp-world-engine-reason-disabled': '20',
  'data-agent-rp-world-engine-reason-deleted': '6',
  'data-agent-rp-world-engine-reason-primary-unmatched': '500',
  'data-agent-rp-world-engine-reason-secondary-unmatched': '50',
  'data-agent-rp-world-engine-reason-session-budget-excluded': '21',
  'data-agent-rp-world-engine-regex-runtime-unavailable': '0',
  'data-agent-rp-world-engine-regex-invalid': '0',
  'data-agent-rp-world-engine-regex-execution-limit': '0',
  'data-agent-rp-world-engine-regex-resource-limit': '0',
  'data-agent-rp-world-engine-decorator-unsupported': '0',
  'data-agent-rp-world-engine-template-unsupported': '0',
  'data-agent-rp-world-engine-template-error': '0',
} as const

const stableInteractionSelectors = {
  '[data-agent-rp-action="open-character-library"]': [new DiagnosticElement({})],
  '[data-agent-rp-action="toggle-session-settings"]': [new DiagnosticElement({})],
  '[data-agent-rp-action="open-preset-manager"]': [new DiagnosticElement({})],
  '[data-agent-rp-action="open-world-info-manager"]': [new DiagnosticElement({})],
  '[data-agent-rp-action="open-tavern-panel"]': [new DiagnosticElement({})],
  '[data-agent-rp-action="open-mobile-surface"]': [new DiagnosticElement({})],
  '[data-agent-rp-action="open-tavern-permissions"]': [new DiagnosticElement({})],
  '[data-agent-rp-surface="session-settings"]': [new DiagnosticElement({
    'data-agent-rp-surface-state': 'closed',
  })],
  '[data-agent-rp-surface="tavern-panel"]': [new DiagnosticElement({
    'data-agent-rp-surface-state': 'closed',
  })],
} as const

test('locates a slow startup without treating an unfinished projection as an empty Session', () => {
  const projection = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      'data-agent-rp-startup': '',
      'data-agent-rp-startup-phase': 'projection',
      'data-agent-rp-startup-elapsed-ms': '2417',
    })],
  }))
  assert.deepEqual(projection.startup, {
    phase: 'projection', sessionElapsedMs: 2417,
  })
  assert.equal(projection.session, undefined)

  const authorization = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      'data-agent-rp-startup': '',
      'data-agent-rp-startup-phase': 'ready',
      'data-agent-rp-startup-elapsed-ms': '531',
      'data-agent-rp-startup-projection-ms': '214',
      'data-agent-rp-startup-character-ms': '531',
    })],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '5',
      'data-agent-rp-tavern-ready': '3',
      'data-agent-rp-tavern-failed': '0',
      'data-agent-rp-tavern-permission-state': 'startup-blocked',
      'data-agent-rp-tavern-plan-ms': '92',
      'data-agent-rp-tavern-first-ready-ms': '118',
      'data-agent-rp-tavern-navigation-first-ms': '98',
      'data-agent-rp-tavern-navigation-last-ms': '101',
      'data-agent-rp-tavern-bootstrap-first-ms': '102',
      'data-agent-rp-tavern-bootstrap-last-ms': '105',
      'data-agent-rp-tavern-runtime-first-ms': '108',
      'data-agent-rp-tavern-runtime-last-ms': '112',
      'data-agent-rp-tavern-script-first-ms': '109',
      'data-agent-rp-tavern-script-last-ms': '113',
      'data-agent-rp-tavern-program-min-ms': '6',
      'data-agent-rp-tavern-program-max-ms': '14',
      'data-agent-rp-tavern-execution-min-ms': '2',
      'data-agent-rp-tavern-execution-max-ms': '9',
    })],
  }))
  assert.deepEqual(authorization.startup, {
    phase: 'authorization', sessionElapsedMs: 531, projectionMs: 214, characterMs: 531,
    tavernPlanMs: 92, tavernFirstReadyMs: 118,
    tavernNavigationFirstMs: 98, tavernNavigationLastMs: 101,
    tavernBootstrapFirstMs: 102, tavernBootstrapLastMs: 105,
    tavernRuntimeFirstMs: 108, tavernRuntimeLastMs: 112,
    tavernScriptFirstMs: 109, tavernScriptLastMs: 113,
    tavernProgramMinMs: 6, tavernProgramMaxMs: 14,
    tavernExecutionMinMs: 2, tavernExecutionMaxMs: 9,
  })
})

test('collects one content-free healthy browser snapshot with expected permission waits', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '2',
      'data-agent-rp-tavern-ready': '2',
      'data-agent-rp-tavern-failed': '0',
      'data-agent-rp-tavern-permissions': '1',
      'data-agent-rp-tavern-startup-permissions': '1',
      'data-agent-rp-tavern-interaction-permissions': '0',
      'data-agent-rp-tavern-permission-state': 'startup-blocked',
      'data-agent-rp-tavern-permission-frame': '1',
      'data-agent-rp-native-identity-pending': '2',
      'data-agent-rp-tavern-generation-queued': '0',
      'data-agent-rp-tavern-model-list-queued': '0',
    })],
    ...stableInteractionSelectors,
    'iframe[data-agent-rp-tavern-script-scope]': [
      new DiagnosticElement({ sandbox: 'allow-scripts allow-same-origin allow-forms', src: 'data:text/html;charset=utf-8;base64,QQ==', 'data-agent-rp-tavern-phase': 'ready', 'data-agent-rp-tavern-script-scope': 'character' }),
      new DiagnosticElement({ sandbox: 'allow-scripts allow-same-origin allow-forms', src: 'data:text/html;charset=utf-8;base64,QQ==', 'data-agent-rp-tavern-phase': 'ready', 'data-agent-rp-tavern-script-scope': 'preset' }),
    ],
    'iframe[data-agent-rp-frame]': [new DiagnosticElement({
      sandbox: 'allow-scripts allow-same-origin',
      src: 'data:text/html;charset=utf-8;base64,QQ==',
      'data-private-card-text': 'must not appear',
      'data-agent-rp-frame-registered': 'true',
      'data-agent-rp-resize-received': 'true',
      'data-agent-rp-runtime-phase': 'content-present',
      'data-agent-rp-resource-monitor': 'listener-restored',
    })],
    '[data-agent-rp-resource-preflight]': [new DiagnosticElement({
      'data-agent-rp-resource-preflight': 'permission-required',
      'data-agent-rp-resource-permission-duration': 'remember',
      'data-agent-rp-resource-launch': 'approval-required',
      'data-agent-rp-resource-preflight-scripts': '2',
      'data-agent-rp-resource-preflight-card-resources': '7',
      'data-agent-rp-resource-preflight-card-permissions': '1',
      'data-agent-rp-resource-preflight-script-permissions': '1',
      'data-agent-rp-resource-preflight-script-origins': '0',
      'data-agent-rp-resource-preflight-image-origins': '0',
      'data-agent-rp-resource-preflight-frame-origins': '1',
      'data-agent-rp-resource-preflight-permissions': '2',
      'data-agent-rp-resource-preflight-failed': '0',
    })],
    '[data-agent-rp-start-readiness]': [new DiagnosticElement({
      'data-agent-rp-start-readiness': 'approval-required',
      'data-agent-rp-start-action': 'approve-and-start',
    })],
  }))

  assert.equal(report.audit, 'agent-rp-browser-compat-v0')
  assert.deepEqual(report.build, {
    audit: 'agent-rp-build-v0',
    channel: 'alpha-dev',
    agentRp: { version: 'source', dirty: true },
    dsh: { version: 'source', dirty: true },
  })
  assert.deepEqual(report.checks, {
    capabilitiesResolved: true,
    externalWindowsHealthy: true,
    iframeSandboxRestricted: true,
    inlineFrontendHealthy: true,
    interactiveEntriesPresent: true,
    preflightConsistent: true,
    preflightHealthy: true,
    tavernPermissionsConsistent: true,
    tavernRuntimeHealthy: true,
    turnRecordHealthy: true,
    worldEngineHealthy: true,
  })
  assert.deepEqual(report.issues, [])
  assert.equal(report.session?.tavern?.pendingPermissions, 1)
  assert.deepEqual(report.session?.tavern === undefined ? undefined : {
    startup: report.session.tavern.startupPermissions,
    interaction: report.session.tavern.interactionPermissions,
    state: report.session.tavern.permissionState,
  }, { startup: 1, interaction: 0, state: 'startup-blocked' })
  assert.deepEqual(report.session?.tavern?.permissions, {
    script: 0, image: 0, style: 0, font: 0, frame: 1, identity: 0, externalWindow: 0,
    generation: 0, customGeneration: 0, modelList: 0,
  })
  assert.deepEqual(report.session?.nativeIdentity, { state: 'ready', approved: 3, pending: 3 })
  assert.deepEqual(report.interactions, {
    characterLibrary: { launchers: 1, state: 'closed' },
    presetManager: { launchers: 1, state: 'closed' },
    sessionSettings: { launchers: 1, state: 'closed' },
    tavernPanel: { launchers: 1, mobileLaunchers: 1, state: 'closed' },
    tavernPermissions: { launchers: 1, state: 'closed' },
    worldInfoManager: { launchers: 1, state: 'closed' },
  })
  assert.deepEqual(report.session?.tavern?.phases, { ready: 2 })
  assert.deepEqual(report.session?.cardFrames, {
    total: 1,
    scriptEnabled: 1,
    inert: 0,
    registered: 1,
    resized: 1,
    runtimePhases: { 'content-present': 1 },
    resourceMonitors: { 'listener-restored': 1 },
    blockedResourceClasses: {},
  })
  assert.equal(report.preflight?.pendingPermissions, 2)
  assert.deepEqual(report.preflight === undefined ? undefined : {
    script: report.preflight.pendingScriptOrigins,
    image: report.preflight.pendingImageOrigins,
    frame: report.preflight.pendingFrameOrigins,
  }, { script: 0, image: 0, frame: 1 })
  assert.doesNotMatch(JSON.stringify(report), /private|example|card-name|must not appear/u)
})

test('reports stable issue codes for expanded sandboxes and inconsistent lifecycle state', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-capability-required-unavailable': '1',
      'data-agent-rp-capability-unsupported': '1',
      'data-agent-rp-capability-version-mismatch': '1',
      'data-agent-rp-capability-denied': '1',
    })],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '1',
      'data-agent-rp-tavern-ready': '0',
      'data-agent-rp-tavern-failed': '1',
      'data-agent-rp-tavern-permissions': '0',
      'data-agent-rp-tavern-startup-permissions': '0',
      'data-agent-rp-tavern-interaction-permissions': '0',
      'data-agent-rp-tavern-permission-state': 'settled',
    })],
    ...stableInteractionSelectors,
    '[data-agent-rp-surface="tavern-panel"]': [new DiagnosticElement({
      'data-agent-rp-surface-state': 'script',
    })],
    'iframe[data-agent-rp-tavern-script-scope]': [new DiagnosticElement({
      sandbox: 'allow-scripts allow-same-origin',
      'data-agent-rp-tavern-phase': 'runtime-error',
      'data-agent-rp-tavern-script-scope': 'character',
    })],
    'iframe[data-agent-rp-frame]': [new DiagnosticElement({
      sandbox: 'allow-scripts',
      'data-agent-rp-runtime-phase': 'runtime-error',
    })],
    '[data-agent-rp-resource-preflight]': [new DiagnosticElement({
      'data-agent-rp-resource-preflight': 'permission-required',
      'data-agent-rp-resource-permission-duration': 'remember',
      'data-agent-rp-resource-launch': 'ready',
      'data-agent-rp-resource-preflight-card-permissions': '1',
      'data-agent-rp-resource-preflight-script-permissions': '1',
      'data-agent-rp-resource-preflight-permissions': '3',
      'data-agent-rp-resource-preflight-failed': '1',
    })],
    '[data-agent-rp-start-readiness]': [new DiagnosticElement({
      'data-agent-rp-start-readiness': 'ready',
      'data-agent-rp-start-action': 'start',
    })],
  }))

  assert.deepEqual(report.checks, {
    capabilitiesResolved: false,
    externalWindowsHealthy: true,
    iframeSandboxRestricted: false,
    inlineFrontendHealthy: true,
    interactiveEntriesPresent: true,
    preflightConsistent: false,
    preflightHealthy: false,
    tavernPermissionsConsistent: true,
    tavernRuntimeHealthy: false,
    turnRecordHealthy: true,
    worldEngineHealthy: true,
  })
  assert.deepEqual(report.issues, [
    'capability-required-unavailable',
    'card-frame-runtime-failed',
    'card-frame-unregistered',
    'iframe-sandbox-expanded',
    'preflight-count-mismatch',
    'preflight-failed',
    'preflight-launch-mismatch',
    'tavern-runtime-failed',
  ])
})

test('reports an empty executable card frame without copying its content', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    ...stableInteractionSelectors,
    'iframe[data-agent-rp-frame]': [new DiagnosticElement({
      sandbox: 'allow-scripts',
      'data-agent-rp-frame-registered': 'true',
      'data-agent-rp-runtime-phase': 'content-empty',
      'data-private-card-text': 'must not appear',
    })],
  }))

  assert.deepEqual(report.issues, ['card-frame-content-empty'])
  assert.doesNotMatch(JSON.stringify(report), /private|must not appear/u)
})

test('reports a failed inline-frontend sanitizer probe without exposing probe markup', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-inline-frontend-sanitizer': 'failed',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.inlineFrontendHealthy, false)
  assert.deepEqual(report.session?.renderer, { inlineFrontendSanitizer: 'failed' })
  assert.deepEqual(report.issues, ['inline-frontend-sanitizer-degraded'])
})

test('reports an unconfirmed external-window hop without recording its URL or callback', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-external-window-phase': 'external-open-unconfirmed',
      'data-private-oauth-url': 'https://discord.com/oauth2/authorize?secret=must-not-appear',
    })],
    '[data-agent-rp-external-window-phase]': [new DiagnosticElement({
      'data-agent-rp-external-window-phase': 'external-open-unconfirmed',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.externalWindowsHealthy, false)
  assert.deepEqual(report.session?.externalWindows.phases, { 'external-open-unconfirmed': 1 })
  assert.deepEqual(report.issues, ['external-window-open-unconfirmed'])
  assert.doesNotMatch(JSON.stringify(report), /discord|oauth|secret|must-not-appear/u)
})

test('reports a validated external-window callback not acknowledged by its runtime', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-external-window-phase': 'callback-delivery-unconfirmed',
    })],
    '[data-agent-rp-external-window-phase]': [new DiagnosticElement({
      'data-agent-rp-external-window-phase': 'callback-delivery-unconfirmed',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.externalWindowsHealthy, false)
  assert.deepEqual(report.session?.externalWindows.phases, { 'callback-delivery-unconfirmed': 1 })
  assert.deepEqual(report.issues, ['external-window-delivery-unconfirmed'])
})

test('keeps optional capability degradation distinct from required capability failure', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-capability-available': '10',
      'data-agent-rp-capability-unsupported': '1',
      'data-agent-rp-capability-version-mismatch': '1',
      'data-agent-rp-capability-denied': '1',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.capabilitiesResolved, true)
  assert.deepEqual(report.issues, [])
  assert.deepEqual(report.session?.capabilities, {
    extensions: 4,
    requirements: 13,
    available: 10,
    approvals: 0,
    requiredUnavailable: 0,
    unsupported: 1,
    versionMismatch: 1,
    denied: 1,
  })
})

test('reports World Info execution failures without treating misses or budget exclusions as errors', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-world-engine-budget-excluded': '44',
      'data-agent-rp-world-engine-regex-invalid': '2',
      'data-agent-rp-world-engine-regex-execution-limit': '1',
      'data-agent-rp-world-engine-decorator-unsupported': '3',
      'data-private-world-book-name': 'must not appear',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.worldEngineHealthy, false)
  assert.deepEqual(report.issues, ['world-engine-degraded'])
  assert.deepEqual(report.session?.worldEngine, {
    engine: 'native-v0',
    bindings: { books: 3, character: 1, standalone: 2 },
    entries: 611,
    enabled: 585,
    active: 14,
    budgetExcluded: 44,
    reasons: {
      'active-constant': 10, 'active-keyword': 4, disabled: 20, deleted: 6,
      'primary-unmatched': 500, 'secondary-unmatched': 50, 'session-budget-excluded': 21,
    },
    failures: {
      regexRuntimeUnavailable: 0,
      regexInvalid: 2,
      regexExecutionLimit: 1,
      regexResourceLimit: 0,
      decoratorUnsupported: 3,
      templateUnsupported: 0,
      templateError: 0,
    },
  })
  assert.doesNotMatch(JSON.stringify(report), /private|world-book-name|must not appear/u)
})

test('reports inconsistent content-free World Info counts as a diagnostic fault', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-world-engine-books': '4',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.worldEngineHealthy, false)
  assert.deepEqual(report.issues, ['world-engine-count-mismatch'])
})

test('reports missing stable interaction entries without reading labels or content', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '1',
      'data-agent-rp-tavern-ready': '1',
      'data-agent-rp-tavern-startup-permissions': '0',
      'data-agent-rp-tavern-interaction-permissions': '0',
      'data-agent-rp-tavern-permission-state': 'settled',
    })],
  }))

  assert.equal(report.checks.interactiveEntriesPresent, false)
  assert.deepEqual(report.interactions, {
    characterLibrary: { launchers: 0, state: 'closed' },
    presetManager: { launchers: 0, state: 'closed' },
    sessionSettings: { launchers: 0, state: 'closed' },
    tavernPanel: { launchers: 0, mobileLaunchers: 0, state: 'closed' },
    tavernPermissions: { launchers: 0, state: 'closed' },
    worldInfoManager: { launchers: 0, state: 'closed' },
  })
  assert.deepEqual(report.issues, ['interactive-entry-missing'])
})

test('accepts nested managers while settings are closed and requires them once opened', () => {
  const selectors = {
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    '[data-agent-rp-action="open-character-library"]': [new DiagnosticElement({})],
    '[data-agent-rp-action="toggle-session-settings"]': [new DiagnosticElement({})],
  }
  const closed = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot(selectors))
  assert.equal(closed.checks.interactiveEntriesPresent, true)
  assert.deepEqual(closed.issues, [])

  const open = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    ...selectors,
    '[data-agent-rp-surface="session-settings"]': [new DiagnosticElement({
      'data-agent-rp-surface-state': 'open',
    })],
  }))
  assert.equal(open.checks.interactiveEntriesPresent, false)
  assert.deepEqual(open.issues, ['interactive-entry-missing'])
})

test('reports open interaction surfaces through stable content-free states', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    ...stableInteractionSelectors,
    '[data-agent-rp-surface="character-library"]': [new DiagnosticElement({})],
    '[data-agent-rp-surface="preset-manager"]': [new DiagnosticElement({})],
    '[data-agent-rp-surface="session-settings"]': [new DiagnosticElement({
      'data-agent-rp-surface-state': 'open',
    })],
    '[data-agent-rp-surface="tavern-panel"]': [new DiagnosticElement({
      'data-agent-rp-surface-state': 'mobile',
    })],
    '[data-agent-rp-surface="tavern-permissions"]': [new DiagnosticElement({})],
    '[data-agent-rp-surface="world-info-manager"]': [new DiagnosticElement({})],
  }))

  assert.deepEqual(report.interactions, {
    characterLibrary: { launchers: 1, state: 'open' },
    presetManager: { launchers: 1, state: 'open' },
    sessionSettings: { launchers: 1, state: 'open' },
    tavernPanel: { launchers: 1, mobileLaunchers: 1, state: 'mobile' },
    tavernPermissions: { launchers: 1, state: 'open' },
    worldInfoManager: { launchers: 1, state: 'open' },
  })
  assert.deepEqual(report.issues, [])
})

test('distinguishes a failed preflight request from consistent permission waiting', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-resource-preflight]': [new DiagnosticElement({
      'data-agent-rp-resource-preflight': 'error',
      'data-agent-rp-resource-permission-duration': 'remember',
      'data-agent-rp-resource-launch': 'ready',
      'data-agent-rp-resource-preflight-permissions': '0',
    })],
    '[data-agent-rp-start-readiness]': [new DiagnosticElement({
      'data-agent-rp-start-readiness': 'ready',
      'data-agent-rp-start-action': 'start',
    })],
  }))

  assert.equal(report.checks.preflightConsistent, true)
  assert.equal(report.checks.preflightHealthy, false)
  assert.deepEqual(report.issues, ['preflight-request-failed'])
})

test('rejects a runtime permission total without matching content-free categories', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '1',
      'data-agent-rp-tavern-ready': '0',
      'data-agent-rp-tavern-failed': '0',
      'data-agent-rp-tavern-permissions': '1',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.tavernPermissionsConsistent, false)
  assert.deepEqual(report.issues, ['tavern-permission-count-mismatch'])
})

test('rejects permission lifecycle totals that disguise an interaction as startup work', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '1',
      'data-agent-rp-tavern-ready': '1',
      'data-agent-rp-tavern-failed': '0',
      'data-agent-rp-tavern-permissions': '1',
      'data-agent-rp-tavern-permission-generation': '1',
      'data-agent-rp-tavern-startup-permissions': '1',
      'data-agent-rp-tavern-interaction-permissions': '0',
      'data-agent-rp-tavern-permission-state': 'startup-blocked',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.tavernPermissionsConsistent, false)
  assert.equal(report.session?.tavern?.permissionState, 'startup-blocked')
  assert.deepEqual(report.issues, ['tavern-permission-count-mismatch'])
})

test('classifies runtime-discovered font permission as an interaction', () => {
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement(capabilityAttributes)],
    '[data-agent-rp-tavern-total]': [new DiagnosticElement({
      'data-agent-rp-tavern-total': '1',
      'data-agent-rp-tavern-ready': '1',
      'data-agent-rp-tavern-failed': '0',
      'data-agent-rp-tavern-permissions': '1',
      'data-agent-rp-tavern-permission-font': '1',
      'data-agent-rp-tavern-startup-permissions': '0',
      'data-agent-rp-tavern-interaction-permissions': '1',
      'data-agent-rp-tavern-permission-state': 'interaction-pending',
    })],
    ...stableInteractionSelectors,
  }))

  assert.equal(report.checks.tavernPermissionsConsistent, true)
  assert.equal(report.session?.tavern?.permissions.font, 1)
  assert.deepEqual(report.issues, [])
})

test('uses Host runtime facts while retaining DOM-owned sandbox checks', () => {
  const registry = new AgentRpRuntimeDiagnosticRegistry(() => 123)
  registry.publish(createAgentRpRuntimeDiagnosticSource('session'), {
    kind: 'session',
    scope: 'private-session-id',
    facts: {
      turns: { format: 0, status: 'invalid' },
      capabilities: {
        extensions: 1, requirements: 3, available: 3, approvals: 0,
        requiredUnavailable: 0, unsupported: 0, versionMismatch: 0, denied: 0,
      },
      auxiliaryGenerations: { requests: 0, succeeded: 0, failed: 0, pending: 0, malformed: 0 },
      externalWindowPhases: [],
      nativeIdentity: { state: 'ready', approved: 0, pending: 0 },
      variables: { surfaces: 1, sharedScopes: 5, scriptScopes: 0 },
      renderer: { inlineFrontendSanitizer: 'ready' },
      worldEngine: {
        engine: 'inactive', bindings: { books: 0, character: 0, standalone: 0 },
        entries: 0, enabled: 0, active: 0, budgetExcluded: 0, reasons: {},
        failures: {
          regexRuntimeUnavailable: 0, regexInvalid: 0, regexExecutionLimit: 0,
          regexResourceLimit: 0, decoratorUnsupported: 0, templateUnsupported: 0, templateError: 0,
        },
      },
    },
  })
  registry.publish(createAgentRpRuntimeDiagnosticSource('preflight'), {
    kind: 'preflight',
    facts: {
      status: 'ready', launch: 'ready', startReadiness: 'ready', startAction: 'start',
      permissionDuration: 'session', scripts: 0, cardResources: 1,
      pendingCardPermissions: 0, pendingScriptPermissions: 0, pendingScriptOrigins: 0,
      pendingImageOrigins: 0, pendingStyleOrigins: 0, pendingFrameOrigins: 0, pendingPermissions: 0, failed: 0,
    },
  })
  const report = collectAgentRpBrowserCompatibilitySnapshot(diagnosticRoot({
    '[data-agent-rp-status]': [new DiagnosticElement({
      ...capabilityAttributes,
      'data-agent-rp-inline-frontend-sanitizer': 'failed',
      'data-agent-rp-capability-required-unavailable': '1',
      'data-agent-rp-world-engine-template-error': '1',
      'data-private-card-text': 'must not appear',
    })],
    ...stableInteractionSelectors,
    'iframe[data-agent-rp-frame]': [new DiagnosticElement({
      sandbox: 'allow-scripts allow-same-origin',
      'data-agent-rp-runtime-phase': 'runtime-error',
    })],
    '[data-agent-rp-resource-preflight]': [new DiagnosticElement({
      'data-agent-rp-resource-preflight': 'error',
      'data-agent-rp-resource-launch': 'ready',
      'data-agent-rp-resource-permission-duration': 'remember',
      'data-agent-rp-resource-preflight-failed': '1',
    })],
  }), registry.snapshot())

  assert.deepEqual(report.issues, ['iframe-sandbox-expanded', 'turn-record-invalid'])
  assert.equal(report.checks.turnRecordHealthy, false)
  assert.equal(report.runtime?.source, 'host')
  assert.equal(report.runtime?.revision, 2)
  assert.equal(report.session?.renderer.inlineFrontendSanitizer, 'ready')
  assert.equal(report.session?.worldEngine.engine, 'inactive')
  assert.equal(report.preflight?.status, 'ready')
  assert.doesNotMatch(JSON.stringify(report), /private|session-id|must not appear/u)
})
