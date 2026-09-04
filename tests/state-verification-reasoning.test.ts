import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableModelCatalog,
  resolveStateVerificationReasoningChoices,
  updateStateVerificationSettings,
  type AvailableModelCatalog,
} from '../src/client/state-verification-reasoning.ts'

const catalog = {
  current: { provider: 'opencode-go', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
  groups: [{
    id: 'opencode-go',
    name: 'OpenCode Go',
    models: [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      reasoning: {
        efforts: [
          { id: 'high', name: 'High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'high',
      },
    }, {
      id: 'hy3',
      name: 'Hy3',
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'high', name: 'High' },
        ],
      },
    }],
  }],
} satisfies AvailableModelCatalog

test('combines the prerelease Host catalog with the durable next-request selection', () => {
  const host = {
    default: { provider: 'default', model: 'default' },
    routableProviders: ['opencode-go'],
    groups: catalog.groups,
    failures: [],
  }
  assert.deepEqual(availableModelCatalog(host, {
    lastUsed: { provider: 'opencode-go', model: 'old' },
    next: catalog.current,
  }), catalog)
  assert.deepEqual(availableModelCatalog(host, { lastUsed: null, next: null }), {
    current: host.default,
    groups: catalog.groups,
  })
  assert.throws(() => availableModelCatalog(host, undefined), /模型选择投影/u)
})

test('derives selectable efforts from the effective state verification model', () => {
  assert.deepEqual(resolveStateVerificationReasoningChoices(catalog, null, 'max'), {
    reasoning: catalog.groups[0]!.models[0]!.reasoning,
    choices: [
      { id: null, supported: true },
      { id: 'high', supported: true },
      { id: 'max', supported: true },
    ],
  })
  assert.deepEqual(resolveStateVerificationReasoningChoices(catalog, {
    provider: 'opencode-go', model: 'hy3',
  }, null), {
    reasoning: catalog.groups[0]!.models[1]!.reasoning,
    choices: [
      { id: null, supported: true },
      { id: 'low', supported: true },
      { id: 'high', supported: true },
    ],
  })
})

test('keeps an unsupported saved effort visible without making it selectable', () => {
  assert.deepEqual(resolveStateVerificationReasoningChoices(catalog, null, 'low'), {
    reasoning: catalog.groups[0]!.models[0]!.reasoning,
    choices: [
      { id: null, supported: true },
      { id: 'low', supported: false },
      { id: 'high', supported: true },
      { id: 'max', supported: true },
    ],
  })
})

test('resets reasoning only when the effective provider or model changes', () => {
  const currentSessionModel = { provider: 'opencode-go', model: 'deepseek-v4-flash' }
  const current = {
    model: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    reasoningEffort: 'max',
  }
  assert.deepEqual(updateStateVerificationSettings(current, {
    type: 'model', model: { provider: 'opencode-go', model: 'hy3' },
  }, currentSessionModel), {
    model: { provider: 'opencode-go', model: 'hy3' },
    reasoningEffort: null,
  })
  assert.deepEqual(updateStateVerificationSettings(current, {
    type: 'model', model: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
  }, currentSessionModel), current)
  const followingCurrent = {
    model: null,
    reasoningEffort: 'max',
  } as const
  assert.deepEqual(updateStateVerificationSettings(followingCurrent, {
    type: 'model', model: null,
  }, { provider: 'another-provider', model: 'another-model' }), followingCurrent)
  assert.deepEqual(updateStateVerificationSettings(followingCurrent, {
    type: 'model', model: currentSessionModel,
  }, currentSessionModel), {
    model: currentSessionModel,
    reasoningEffort: 'max',
  })
  assert.deepEqual(updateStateVerificationSettings(current, {
    type: 'model', model: null,
  }, currentSessionModel), {
    model: null,
    reasoningEffort: 'max',
  })
  assert.deepEqual(updateStateVerificationSettings(current, {
    type: 'model', model: { provider: 'another-provider', model: 'deepseek-v4-flash' },
  }, currentSessionModel), {
    model: { provider: 'another-provider', model: 'deepseek-v4-flash' },
    reasoningEffort: null,
  })
  assert.deepEqual(updateStateVerificationSettings(current, {
    type: 'model', model: { provider: 'opencode-go', model: 'another-model' },
  }, currentSessionModel), {
    model: { provider: 'opencode-go', model: 'another-model' },
    reasoningEffort: null,
  })
  assert.deepEqual(updateStateVerificationSettings(current, {
    type: 'reasoning-effort', reasoningEffort: 'high',
  }), {
    model: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    reasoningEffort: 'high',
  })
})
