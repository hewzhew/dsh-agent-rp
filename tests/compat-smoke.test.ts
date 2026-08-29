import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bootstrapAgentRpCompatSmokeSourceSession,
  classifyAgentRpPreflight,
  classifyAgentRpRuntime,
  classifyAgentRpSmokeConsoleError,
  classifyAgentRpSmokeConsoleSource,
  classifyAgentRpSmokeSecurityPolicyReason,
  classifyAgentRpSmokeConsoleSignal,
  runAgentRpBrowserCompatibilitySmoke,
  type AgentRpCompatSmokeAction,
  type AgentRpCompatSmokeDriver,
  type AgentRpCompatSmokePermissionDuration,
} from '../src/compat-smoke.ts'
import type { AgentRpBrowserCompatibilitySnapshot } from '../src/client/compatibility-diagnostic.ts'
import { AGENT_RP_BUILD_IDENTITY } from '../src/client/build-identity.ts'

test('classifies browser console failures without retaining their private text', () => {
  assert.equal(classifyAgentRpSmokeConsoleError('Failed to load resource: net::ERR_FAILED'), 'resource-load')
  assert.equal(classifyAgentRpSmokeConsoleError('Refused to connect because of Content Security Policy'), 'security-policy')
  assert.equal(classifyAgentRpSmokeConsoleError('Unhandled application failure'), 'runtime')
  assert.equal(classifyAgentRpSmokeSecurityPolicyReason(
    "Blocked script execution because the document's frame is sandboxed and the 'allow-scripts' permission is not set",
  ), 'sandbox-script')
  assert.equal(classifyAgentRpSmokeSecurityPolicyReason(
    "Refused to load an image because it violates the following Content Security Policy directive: img-src 'none'",
  ), 'image-source')
  assert.equal(classifyAgentRpSmokeSecurityPolicyReason(
    'Access was blocked by CORS policy',
  ), 'cross-origin')
  assert.equal(classifyAgentRpSmokeSecurityPolicyReason(
    'Refused by an unknown browser security rule',
  ), 'other')
  assert.equal(classifyAgentRpSmokeConsoleSource('about:srcdoc', 'http://127.0.0.1:3091'), 'srcdoc-frame')
  assert.equal(classifyAgentRpSmokeConsoleSource(
    'http://127.0.0.1:3091/assets/client.js', 'http://127.0.0.1:3091',
  ), 'host-document')
  assert.equal(classifyAgentRpSmokeConsoleSource(
    'https://example.invalid/private', 'http://127.0.0.1:3091',
  ), 'external-document')
  assert.equal(classifyAgentRpSmokeConsoleSource('', 'http://127.0.0.1:3091'), 'unknown')
  assert.equal(classifyAgentRpSmokeConsoleSignal({
    'resource-load': 0, 'security-policy': 0, runtime: 0,
  }, 0), 'clean')
  assert.equal(classifyAgentRpSmokeConsoleSignal({
    'resource-load': 0, 'security-policy': 34, runtime: 0,
  }, 0), 'security-policy-only')
  assert.equal(classifyAgentRpSmokeConsoleSignal({
    'resource-load': 1, 'security-policy': 34, runtime: 0,
  }, 0), 'errors-observed')
  assert.equal(classifyAgentRpSmokeConsoleSignal({
    'resource-load': 0, 'security-policy': 0, runtime: 0,
  }, 1), 'errors-observed')
})

function browserSnapshot(options: {
  readonly preflight?: 'loading' | 'approval-required' | 'ready' | 'error'
  readonly runtime?: 'pending' | 'healthy' | 'empty' | 'failed'
  readonly characterLibrary?: 'closed' | 'open'
  readonly presetManager?: 'closed' | 'open'
  readonly sessionSettings?: 'closed' | 'open'
  readonly tavernPanel?: 'closed' | 'mobile' | 'script'
  readonly worldInfoManager?: 'closed' | 'open'
  readonly permissionDuration?: AgentRpCompatSmokePermissionDuration
  readonly blockedFonts?: number
  readonly runtimeScripts?: number
} = {}): AgentRpBrowserCompatibilitySnapshot {
  const runtime = options.runtime
  const blockedFonts = options.blockedFonts ?? 0
  const issues = runtime === 'empty' ? ['card-frame-content-empty'] as const
    : runtime === 'failed' ? ['card-frame-runtime-failed'] as const : []
  const preflight = options.preflight
  return {
    audit: 'agent-rp-browser-compat-v0',
    build: AGENT_RP_BUILD_IDENTITY,
    interactions: {
      characterLibrary: { launchers: 1, state: options.characterLibrary ?? 'closed' },
      presetManager: { launchers: 1, state: options.presetManager ?? 'closed' },
      sessionSettings: { launchers: 1, state: options.sessionSettings ?? 'closed' },
      tavernPanel: { launchers: 1, mobileLaunchers: 1, state: options.tavernPanel ?? 'closed' },
      tavernPermissions: { launchers: 0, state: 'closed' },
      worldInfoManager: { launchers: 1, state: options.worldInfoManager ?? 'closed' },
    },
    ...(runtime === undefined ? {} : { session: {
      capabilities: {
        extensions: 4, requirements: 10, available: 10, approvals: 0,
        requiredUnavailable: 0, unsupported: 0, versionMismatch: 0, denied: 0,
      },
      auxiliaryGenerations: { requests: 0, succeeded: 0, failed: 0, pending: 0, malformed: 0 },
      externalWindows: { phases: {} },
      nativeIdentity: { state: 'ready' as const, approved: 0, pending: 0 },
      variables: { surfaces: 2, sharedScopes: 5, scriptScopes: 1 },
      renderer: { inlineFrontendSanitizer: 'ready' },
      worldEngine: {
        engine: 'native-v0', bindings: { books: 2, character: 1, standalone: 1 },
        entries: 611, enabled: 600, active: 12, budgetExcluded: 0,
        reasons: {
          'active-constant': 8, 'active-keyword': 4, disabled: 7, deleted: 4,
          'primary-unmatched': 500, 'secondary-unmatched': 88,
        },
        failures: {
          regexRuntimeUnavailable: 0, regexInvalid: 0, regexExecutionLimit: 0,
          regexResourceLimit: 0, decoratorUnsupported: 0, templateUnsupported: 0, templateError: 0,
        },
      },
      tavern: {
        scripts: options.runtimeScripts ?? 1, frames: options.runtimeScripts ?? 1,
        ready: runtime === 'pending' ? 0 : options.runtimeScripts ?? 1, failed: 0,
        pendingPermissions: blockedFonts, queuedGenerations: 0, queuedModelLists: 0,
        blockedResources: blockedFonts, blockedResourceOrigins: blockedFonts,
        blockedResourceClasses: blockedFonts === 0 ? {} : { font: blockedFonts },
        startupPermissions: 0, interactionPermissions: blockedFonts,
        permissionState: blockedFonts === 0 ? 'settled' : 'interaction-pending',
        permissions: {
          script: 0, image: 0, style: 0, font: blockedFonts, frame: 0, identity: 0, externalWindow: 0,
          generation: 0, customGeneration: 0, modelList: 0,
        },
        phases: { [runtime === 'pending' ? 'booting' : 'ready']: 1 }, scopes: { character: 1 },
      },
      cardFrames: {
        total: 1, scriptEnabled: 1, inert: 0, registered: 1, resized: 1,
        runtimePhases: {
          [runtime === 'empty' ? 'content-empty'
            : runtime === 'failed' ? 'runtime-error' : 'content-present']: 1,
        },
        resourceMonitors: { 'listener-restored': 1 }, blockedResourceClasses: {},
      },
    } }),
    ...(preflight === undefined ? {} : { preflight: {
      status: preflight === 'approval-required' ? 'permission-required' : preflight,
      launch: preflight === 'loading' ? 'checking'
        : preflight === 'approval-required' ? 'approval-required' : 'ready',
      startReadiness: preflight === 'loading' ? 'checking'
        : preflight === 'approval-required' ? 'approval-required' : 'ready',
      startAction: preflight === 'loading' ? 'checking'
        : preflight === 'approval-required' ? 'approve-and-start' : 'start',
      permissionDuration: options.permissionDuration ?? 'remember',
      scripts: 1,
      cardResources: 2,
      pendingCardPermissions: preflight === 'approval-required' ? 1 : 0,
      pendingScriptPermissions: 0,
      pendingScriptOrigins: 0,
      pendingImageOrigins: 0,
      pendingStyleOrigins: 0,
      pendingFrameOrigins: 0,
      pendingPermissions: preflight === 'approval-required' ? 1 : 0,
      failed: preflight === 'error' ? 1 : 0,
    } }),
    checks: {
      capabilitiesResolved: runtime !== 'failed',
      externalWindowsHealthy: true,
      iframeSandboxRestricted: true,
      inlineFrontendHealthy: true,
      interactiveEntriesPresent: true,
      preflightConsistent: true,
      preflightHealthy: preflight !== 'error',
      tavernPermissionsConsistent: true,
      tavernRuntimeHealthy: runtime !== 'failed',
      turnRecordHealthy: true,
      worldEngineHealthy: true,
    },
    issues,
  }
}

test('classifies preflight waits, approvals, and deterministic failures separately', () => {
  assert.equal(classifyAgentRpPreflight(browserSnapshot({ preflight: 'loading' })), 'pending')
  assert.deepEqual(classifyAgentRpPreflight(browserSnapshot({ preflight: 'loading' }), true), {
    status: 'failed', stage: 'preflight-checking', exitCode: 3,
  })
  assert.deepEqual(classifyAgentRpPreflight(browserSnapshot({ preflight: 'approval-required' })), {
    status: 'manual-required', stage: 'approval-required', exitCode: 2,
  })
  assert.deepEqual(classifyAgentRpPreflight(browserSnapshot({ preflight: 'error' })), {
    status: 'failed', stage: 'preflight-failed', exitCode: 3,
  })
})

test('keeps transitional card frames pending before assigning a stable failure stage', () => {
  assert.equal(classifyAgentRpRuntime(browserSnapshot({ runtime: 'empty' })), 'pending')
  assert.deepEqual(classifyAgentRpRuntime(browserSnapshot({ runtime: 'empty' }), true), {
    status: 'failed', stage: 'frame-content-empty', exitCode: 3,
  })
  assert.deepEqual(classifyAgentRpRuntime(browserSnapshot({ runtime: 'failed' })), {
    status: 'failed', stage: 'runtime-failed', exitCode: 3,
  })
})

test('does not accept an empty Tavern runtime when preflight selected scripts', () => {
  const missing = browserSnapshot({ runtime: 'healthy', runtimeScripts: 0 })
  assert.equal(classifyAgentRpRuntime(missing, false, false, 1), 'pending')
  assert.deepEqual(classifyAgentRpRuntime(missing, true, false, 1), {
    status: 'failed', stage: 'runtime-failed', exitCode: 3,
  })
  assert.deepEqual(classifyAgentRpRuntime(missing, false, false, 0), {
    status: 'healthy', stage: 'healthy', exitCode: 0,
  })
})

class FakeSmokeDriver implements AgentRpCompatSmokeDriver {
  private characterLibrary: 'closed' | 'open' = 'closed'
  private presetManager: 'closed' | 'open' = 'closed'
  private sessionSettings: 'closed' | 'open' = 'closed'
  private tavernPanel: 'closed' | 'mobile' | 'script' = 'closed'
  private worldInfoManager: 'closed' | 'open' = 'closed'
  private selected = false
  private launched = false
  permissionDuration: AgentRpCompatSmokePermissionDuration = 'remember'
  readonly approvalAttempts: number[] = []
  onboardingAcknowledgements = 0
  sourceLauncherReveals = 0
  runtimeFontApprovals = 0
  readonly actions: AgentRpCompatSmokeAction[] = []
  private remainingPostInteractionPendingSnapshots = 0
  private mobileSurfaceOpened = false

  constructor(
    private readonly preflightNeedsApproval = false,
    private readonly approvalClears = true,
    private readonly genericTavernPanel: 'script' | 'mobile' = 'script',
    private clientGateState: 'ready' | 'onboarding' = 'ready',
    private remainingRuntimeFonts = 0,
    private readonly postInteractionPendingSnapshots = 0,
  ) {}

  delay(): Promise<void> { return Promise.resolve() }

  clientGate(): Promise<'ready' | 'onboarding'> { return Promise.resolve(this.clientGateState) }

  acknowledgeOnboarding(): Promise<void> {
    this.onboardingAcknowledgements += 1
    this.clientGateState = 'ready'
    return Promise.resolve()
  }

  revealSourceLaunchers(): Promise<void> {
    this.sourceLauncherReveals += 1
    return Promise.resolve()
  }

  approveRuntimeFont(): Promise<boolean> {
    if (this.remainingRuntimeFonts === 0) return Promise.resolve(false)
    this.remainingRuntimeFonts -= 1
    this.runtimeFontApprovals += 1
    return Promise.resolve(true)
  }

  closeRuntimePermissions(): Promise<void> { return Promise.resolve() }

  snapshot(): Promise<AgentRpBrowserCompatibilitySnapshot> {
    const approvalRequired = this.preflightNeedsApproval
      && (!this.approvalClears || this.approvalAttempts.length === 0)
    const runtime = this.launched && this.remainingPostInteractionPendingSnapshots > 0
      ? (this.remainingPostInteractionPendingSnapshots -= 1, 'pending' as const)
      : this.launched ? 'healthy' as const : undefined
    return Promise.resolve(browserSnapshot({
      ...(this.selected && !this.launched
        ? {
            preflight: approvalRequired ? 'approval-required' as const : 'ready' as const,
            permissionDuration: this.permissionDuration,
          }
        : {}),
      ...(runtime === undefined ? {} : { runtime }),
      blockedFonts: this.launched ? this.remainingRuntimeFonts : 0,
      characterLibrary: this.characterLibrary,
      presetManager: this.presetManager,
      sessionSettings: this.sessionSettings,
      tavernPanel: this.tavernPanel,
      worldInfoManager: this.worldInfoManager,
    }))
  }

  sourceLauncherCount(sourceSessionId?: string): Promise<number> {
    return Promise.resolve(sourceSessionId === undefined || sourceSessionId === 'source-session' ? 1 : 0)
  }

  clickAction(action: AgentRpCompatSmokeAction): Promise<void> {
    this.actions.push(action)
    switch (action) {
      case 'open-character-library': this.characterLibrary = 'open'; break
      case 'close-character-library': this.characterLibrary = 'closed'; break
      case 'toggle-session-settings':
        this.sessionSettings = this.sessionSettings === 'open' ? 'closed' : 'open'
        break
      case 'open-preset-manager': this.sessionSettings = 'closed'; this.presetManager = 'open'; break
      case 'close-preset-manager': this.presetManager = 'closed'; break
      case 'open-world-info-manager': this.sessionSettings = 'closed'; this.worldInfoManager = 'open'; break
      case 'close-world-info-manager': this.worldInfoManager = 'closed'; break
      case 'open-tavern-panel': this.tavernPanel = this.genericTavernPanel; break
      case 'open-mobile-surface': this.tavernPanel = 'mobile'; this.mobileSurfaceOpened = true; break
      case 'close-tavern-panel':
        this.tavernPanel = 'closed'
        if (this.mobileSurfaceOpened) {
          this.remainingPostInteractionPendingSnapshots = this.postInteractionPendingSnapshots
        }
        break
    }
    return Promise.resolve()
  }

  selectCharacter(characterId: string): Promise<void> {
    assert.equal(characterId, 'character-id')
    this.selected = true
    return Promise.resolve()
  }

  selectPreset(presetId: string): Promise<void> {
    assert.equal(presetId, 'preset-id')
    return Promise.resolve()
  }

  selectPermissionDuration(duration: AgentRpCompatSmokePermissionDuration): Promise<void> {
    this.permissionDuration = duration
    return Promise.resolve()
  }

  startSession(): Promise<void> {
    if (this.preflightNeedsApproval && this.approvalAttempts.length === 0) {
      this.approvalAttempts.push(1)
      if (!this.approvalClears) return Promise.reject(new Error('permission remains pending'))
    }
    this.characterLibrary = 'closed'
    this.launched = true
    return Promise.resolve()
  }
}

test('drives one content-free launch and all applicable stable interaction surfaces', async () => {
  const driver = new FakeSmokeDriver()
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    sourceSessionId: 'source-session', characterId: 'character-id', presetId: 'preset-id', timeoutMs: 100,
  })

  assert.deepEqual(result.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
  assert.equal(driver.sourceLauncherReveals, 1)
  assert.deepEqual(driver.actions, [
    'open-character-library',
    'open-character-library', 'close-character-library',
    'toggle-session-settings', 'open-preset-manager', 'close-preset-manager',
    'toggle-session-settings', 'open-world-info-manager', 'close-world-info-manager',
    'open-tavern-panel', 'close-tavern-panel',
    'open-mobile-surface', 'close-tavern-panel',
  ])
})

test('keeps first-run acknowledgement explicit and continues after authorization', async () => {
  const pending = new FakeSmokeDriver(false, true, 'script', 'onboarding')
  const manual = await runAgentRpBrowserCompatibilitySmoke(pending, {
    characterId: 'character-id', timeoutMs: 100,
  })
  assert.deepEqual(manual.decision, {
    status: 'manual-required', stage: 'onboarding-required', exitCode: 2,
  })
  assert.equal(pending.onboardingAcknowledgements, 0)
  assert.deepEqual(pending.actions, [])

  const authorized = new FakeSmokeDriver(false, true, 'script', 'onboarding')
  const healthy = await runAgentRpBrowserCompatibilitySmoke(authorized, {
    characterId: 'character-id', timeoutMs: 100, acknowledgeOnboarding: true,
  })
  assert.deepEqual(healthy.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
  assert.equal(authorized.onboardingAcknowledgements, 1)
})

test('explicitly approves runtime-discovered fonts until the sandbox settles', async () => {
  const driver = new FakeSmokeDriver(false, true, 'script', 'ready', 2)
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 100, pollMs: 1, approveRuntimeFonts: true,
  })
  assert.deepEqual(result.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
  assert.equal(driver.runtimeFontApprovals, 2)
  assert.equal(result.snapshot?.session?.tavern?.blockedResources, 0)
})

test('bootstraps an isolated source Session through the public RPCs', async () => {
  const calls: Array<{ method: string; payload: Readonly<Record<string, string>> }> = []
  const sourceSessionId = await bootstrapAgentRpCompatSmokeSourceSession({
    call: (method, payload) => {
      calls.push({ method, payload })
      return Promise.resolve(method === 'workspace.create'
        ? { workspace: { workspaceId: 'workspace-id' }, created: true }
        : { sessionId: 'source-session' })
    },
  }, '/isolated/workspace')

  assert.equal(sourceSessionId, 'source-session')
  assert.deepEqual(calls, [
    { method: 'workspace.create', payload: { path: '/isolated/workspace' } },
    { method: 'session.create', payload: { workspaceId: 'workspace-id' } },
  ])
  await assert.rejects(
    bootstrapAgentRpCompatSmokeSourceSession({ call: () => Promise.resolve({}) }, '/isolated/workspace'),
    /workspace id/,
  )
})

test('distinguishes a missing requested source Session from an unloaded client', async () => {
  const driver = new FakeSmokeDriver()
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    sourceSessionId: 'missing-source', characterId: 'character-id', timeoutMs: 1, pollMs: 1,
  })
  assert.deepEqual(result.decision, {
    status: 'failed', stage: 'source-session-failed', exitCode: 3,
  })
})

test('leaves preflight approval manual unless the caller explicitly authorizes it', async () => {
  const driver = new FakeSmokeDriver(true)
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 100,
  })

  assert.deepEqual(result.decision, {
    status: 'manual-required', stage: 'approval-required', exitCode: 2,
  })
  assert.equal(driver.approvalAttempts.length, 0)
})

test('explicit preflight approval continues through the healthy lifecycle', async () => {
  const driver = new FakeSmokeDriver(true)
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 100, approvePreflight: true,
  })

  assert.deepEqual(result.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
  assert.equal(driver.approvalAttempts.length, 1)
  assert.equal(driver.permissionDuration, 'session')
})

test('explicit preflight approval can retain exact grants for the card', async () => {
  const driver = new FakeSmokeDriver(true)
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 100, approvePreflight: true, permissionDuration: 'remember',
  })

  assert.deepEqual(result.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
  assert.equal(driver.permissionDuration, 'remember')
})

test('approve-and-start reports one launch failure when permission persistence fails', async () => {
  const driver = new FakeSmokeDriver(true, false)
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 5, pollMs: 1, approvePreflight: true,
  })

  assert.deepEqual(result.decision, {
    status: 'failed', stage: 'session-launch-failed', exitCode: 3,
  })
  assert.equal(driver.approvalAttempts.length, 1)
})

test('accepts a mobile script as the first visible generic Tavern panel', async () => {
  const driver = new FakeSmokeDriver(false, true, 'mobile')
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 100,
  })

  assert.deepEqual(result.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
})

test('waits for scripts remounted by the final interaction before reporting healthy', async () => {
  const driver = new FakeSmokeDriver(false, true, 'script', 'ready', 0, 3)
  const result = await runAgentRpBrowserCompatibilitySmoke(driver, {
    characterId: 'character-id', timeoutMs: 100, pollMs: 1,
  })

  assert.deepEqual(result.decision, { status: 'healthy', stage: 'healthy', exitCode: 0 })
  assert.equal(result.snapshot?.session?.tavern?.ready, 1)
})
