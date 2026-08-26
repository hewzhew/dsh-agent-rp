import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CARD_GREETING_CAPABILITY_MANIFEST,
  CARD_FRONTEND_CAPABILITY_MANIFEST,
  NATIVE_WORLD_ENGINE_MANIFEST,
  TAVERN_LEGACY_ADAPTER_MANIFEST,
  AGENT_RP_CAPABILITIES,
  boundedAgentRpCapabilityResultError,
  mergeAgentRpCapabilityPlanSummaries,
  resolveAgentRpCapabilityPlan,
  summarizeAgentRpCapabilityPlan,
  type AgentRpExtensionManifestV0,
} from '../src/extension-capability.ts'

const manifest: AgentRpExtensionManifestV0 = {
  format: 0,
  runtime: 'card-frame-v0',
  requirements: [
    { capability: 'greeting.select', version: 0, optional: false },
    { capability: 'future.optional', version: 0, optional: true },
    { capability: 'greeting.select', version: 1, optional: true },
  ],
}

test('resolves known grants separately from unknown and version-mismatched requirements', () => {
  const pending = resolveAgentRpCapabilityPlan(manifest)
  assert.deepEqual(pending.entries.map(entry => entry.resolution), [
    'available', 'unsupported', 'version-mismatch',
  ])
  assert.deepEqual(summarizeAgentRpCapabilityPlan(pending), {
    requirements: 3,
    requiredUnavailable: 0,
    optionalUnavailable: 2,
    resolutions: {
      available: 1,
      'approval-required': 0,
      unsupported: 1,
      'version-mismatch': 1,
      denied: 0,
    },
  })

  const approved = resolveAgentRpCapabilityPlan(manifest, { approved: new Set(['greeting.select']) })
  assert.equal(approved.entries[0]?.resolution, 'available')
  assert.equal(summarizeAgentRpCapabilityPlan(approved).requiredUnavailable, 0)
})

test('keeps explicit denial distinct and refuses a capability in the wrong runtime', () => {
  const denied = resolveAgentRpCapabilityPlan({
    format: 0,
    runtime: 'card-frame-v0',
    requirements: [{ capability: 'greeting.select', version: 0, optional: false }],
  }, {
    approved: new Set(['greeting.select']),
    denied: new Set(['greeting.select']),
  })
  assert.equal(denied.entries[0]?.resolution, 'denied')

  const wrongRuntime = resolveAgentRpCapabilityPlan({
    format: 0,
    runtime: 'world-engine-v0',
    requirements: [{ capability: 'greeting.select', version: 0, optional: false }],
  }, { approved: new Set(['greeting.select']) })
  assert.equal(wrongRuntime.entries[0]?.resolution, 'unsupported')
})

test('makes the native World Info snapshot available without user approval only to its engine runtime', () => {
  const available = resolveAgentRpCapabilityPlan(NATIVE_WORLD_ENGINE_MANIFEST)
  assert.equal(available.entries[0]?.resolution, 'available')

  const frame = resolveAgentRpCapabilityPlan({
    format: 0,
    runtime: 'card-frame-v0',
    requirements: [{ capability: 'world-info.snapshot.read', version: 0, optional: false }],
  })
  assert.equal(frame.entries[0]?.resolution, 'unsupported')
})

test('aggregates independent runtime plans without treating user activation as a startup permission', () => {
  const summary = mergeAgentRpCapabilityPlanSummaries([
    summarizeAgentRpCapabilityPlan(resolveAgentRpCapabilityPlan(NATIVE_WORLD_ENGINE_MANIFEST)),
    summarizeAgentRpCapabilityPlan(resolveAgentRpCapabilityPlan(CARD_GREETING_CAPABILITY_MANIFEST)),
    summarizeAgentRpCapabilityPlan(resolveAgentRpCapabilityPlan(CARD_FRONTEND_CAPABILITY_MANIFEST)),
    summarizeAgentRpCapabilityPlan(resolveAgentRpCapabilityPlan(TAVERN_LEGACY_ADAPTER_MANIFEST)),
  ])
  assert.deepEqual(summary, {
    requirements: 19,
    requiredUnavailable: 0,
    optionalUnavailable: 0,
    resolutions: {
      available: 19,
      'approval-required': 0,
      unsupported: 0,
      'version-mismatch': 0,
      denied: 0,
    },
  })
})

test('publishes truthful Session variable ownership and runtime-specific payload limits', () => {
  const chatSend = AGENT_RP_CAPABILITIES['chat.send']
  assert.equal(chatSend.effect, 'model-request')
  assert.equal(chatSend.approval, 'player-action')
  assert.equal(chatSend.approvalPersistence, 'none')
  assert.equal(chatSend.statePersistence, 'session')
  assert.deepEqual(chatSend.runtimePolicies, {
    'card-frame-v0': { requestBytes: 64 * 1024, resultBytes: 4096 },
  })

  const variables = AGENT_RP_CAPABILITIES['session.variables.replace']
  assert.equal(variables.stateOwner, 'session')
  assert.equal(variables.statePersistence, 'session')
  assert.equal(variables.approvalPersistence, 'none')
  assert.equal(variables.modelVisible, true)
  assert.deepEqual(variables.runtimePolicies, {
    'card-frame-v0': { requestBytes: 1024 * 1024, resultBytes: 4096 },
    'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
  })
  assert.equal(boundedAgentRpCapabilityResultError(
    'session.variables.replace', 'tavern-script-frame-v0', 'a'.repeat(5000), 'fallback',
  ).length, 4096)
  assert.ok(Buffer.byteLength(boundedAgentRpCapabilityResultError(
    'session.variables.replace', 'tavern-script-frame-v0', '猫'.repeat(2000), 'fallback',
  )) <= 4096)
  assert.equal(boundedAgentRpCapabilityResultError(
    'session.variables.replace', 'world-engine-v0', 'unregistered runtime', 'fallback',
  ), 'fallback')

  const chatMutation = AGENT_RP_CAPABILITIES['chat.session.mutate']
  assert.equal(chatMutation.stateOwner, 'session')
  assert.equal(chatMutation.modelVisible, true)
  assert.deepEqual(chatMutation.runtimePolicies, {
    'card-frame-v0': { requestBytes: 64 * 1024, resultBytes: 4096 },
    'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
  })

  for (const id of ['world-info.session.mutate', 'prompt-injection.session.replace'] as const) {
    const definition = AGENT_RP_CAPABILITIES[id]
    assert.equal(definition.stateOwner, 'session')
    assert.equal(definition.modelVisible, true)
    assert.deepEqual(definition.runtimePolicies, {
      'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
    })
  }

  const promptPreview = AGENT_RP_CAPABILITIES['prompt.snapshot.read']
  assert.equal(promptPreview.effect, 'read')
  assert.equal(promptPreview.stateOwner, 'host')
  assert.equal(promptPreview.modelVisible, false)
  assert.deepEqual(promptPreview.runtimePolicies, {
    'tavern-script-frame-v0': { requestBytes: 512 * 1024, resultBytes: 8 * 1024 * 1024 },
  })

  const modelList = AGENT_RP_CAPABILITIES['model.catalog.external.read']
  assert.equal(modelList.effect, 'external-request')
  assert.equal(modelList.approval, 'call-policy')
  assert.equal(modelList.approvalPersistence, 'character-policy')
  assert.equal(modelList.statePersistence, 'ephemeral')
  assert.deepEqual(modelList.runtimePolicies, {
    'tavern-script-frame-v0': { requestBytes: 16 * 1024, resultBytes: 2 * 1024 * 1024 },
  })

  const generation = AGENT_RP_CAPABILITIES['model.generate.auxiliary']
  assert.equal(generation.effect, 'model-request')
  assert.equal(generation.approval, 'call-policy')
  assert.equal(generation.approvalPersistence, 'character-policy')
  assert.equal(generation.statePersistence, 'session')
  assert.equal(generation.stateOwner, 'session')
  assert.equal(generation.modelVisible, true)
  assert.deepEqual(generation.runtimePolicies, {
    'tavern-script-frame-v0': { requestBytes: 512 * 1024, resultBytes: 8 * 1024 * 1024 },
  })

  const popup = AGENT_RP_CAPABILITIES['ui.popup.open']
  assert.equal(popup.effect, 'isolated-ui')
  assert.equal(popup.approval, 'none')
  assert.equal(popup.statePersistence, 'ephemeral')
  assert.equal(popup.stateOwner, 'host')
  assert.equal(popup.modelVisible, false)
  assert.deepEqual(popup.runtimePolicies, {
    'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 512 * 1024 },
  })

  const externalWindow = AGENT_RP_CAPABILITIES['ui.external-window.open']
  assert.equal(externalWindow.effect, 'external-request')
  assert.equal(externalWindow.approval, 'player-action')
  assert.equal(externalWindow.approvalPersistence, 'none')
  assert.equal(externalWindow.statePersistence, 'ephemeral')
  assert.equal(externalWindow.stateOwner, 'host')
  assert.equal(externalWindow.modelVisible, false)
  assert.deepEqual(externalWindow.runtimePolicies, {
    'card-frame-v0': { requestBytes: 16 * 1024, resultBytes: 64 * 1024 },
    'tavern-script-frame-v0': { requestBytes: 16 * 1024, resultBytes: 64 * 1024 },
  })

  const nativeIdentity = AGENT_RP_CAPABILITIES['identity.native.attest']
  assert.equal(nativeIdentity.effect, 'identity-disclosure')
  assert.equal(nativeIdentity.approval, 'call-policy')
  assert.equal(nativeIdentity.approvalPersistence, 'character-policy')
  assert.equal(nativeIdentity.statePersistence, 'host-persistent')
  assert.equal(nativeIdentity.stateOwner, 'host')
  assert.equal(nativeIdentity.modelVisible, false)
  assert.deepEqual(nativeIdentity.runtimePolicies, {
    'card-frame-v0': { requestBytes: 16 * 1024, resultBytes: 32 * 1024 },
    'tavern-script-frame-v0': { requestBytes: 16 * 1024, resultBytes: 32 * 1024 },
  })

  const storage = AGENT_RP_CAPABILITIES['storage.script.persist']
  assert.equal(storage.effect, 'host-storage')
  assert.equal(storage.approval, 'none')
  assert.equal(storage.statePersistence, 'host-persistent')
  assert.equal(storage.stateOwner, 'host')
  assert.equal(storage.modelVisible, false)
  assert.deepEqual(storage.runtimePolicies, {
    'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 2 * 1024 * 1024 },
  })

  const settings = AGENT_RP_CAPABILITIES['settings.extension.persist']
  assert.equal(settings.effect, 'host-storage')
  assert.equal(settings.approval, 'none')
  assert.equal(settings.statePersistence, 'host-persistent')
  assert.equal(settings.stateOwner, 'host')
  assert.equal(settings.modelVisible, false)
  assert.deepEqual(settings.runtimePolicies, {
    'tavern-script-frame-v0': { requestBytes: 2 * 1024 * 1024, resultBytes: 4096 },
  })
})

test('content-free summaries never include declared capability text', () => {
  const summary = summarizeAgentRpCapabilityPlan(resolveAgentRpCapabilityPlan(manifest))
  assert.doesNotMatch(JSON.stringify(summary), /greeting|future/u)
})
