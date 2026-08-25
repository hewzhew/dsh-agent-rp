import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import {
  CHILD_TAVERN_SCRIPT_INJECTED_SOURCES_KEY,
  registerTavernScriptInjectedSource,
  TAVERN_SCRIPT_INJECTED_SOURCES_KEY,
  TavernScriptInjectedSourceRegistry,
} from '../src/tavern-script-injection.ts'

function installRegistry(context: Context): TavernScriptInjectedSourceRegistry {
  const registry = new TavernScriptInjectedSourceRegistry()
  context.provide(TAVERN_SCRIPT_INJECTED_SOURCES_KEY, registry)
  context.provide(CHILD_TAVERN_SCRIPT_INJECTED_SOURCES_KEY, registry)
  return registry
}

test('orders injected sources deterministically and revokes stale disposers safely', () => {
  const root = new Context()
  const registry = installRegistry(root)

  const revokeB = registry.register({
    id: 'st.semantics:b',
    source: 'window.__b = true;',
  })
  const revokeA = registry.register({
    id: 'st.semantics:a',
    source: 'window.__a = true;',
  })
  assert.deepEqual(registry.sources().map(source => source.id), ['st.semantics:a', 'st.semantics:b'])

  revokeB()
  revokeB()
  assert.deepEqual(registry.sources().map(source => source.id), ['st.semantics:a'])

  revokeA()
  assert.deepEqual(registry.sources(), [])
})

test('scopes Host registrations to the caller\'s Cordis lifecycle', async () => {
  const root = new Context()
  const registry = installRegistry(root)
  const scope = createScope(root, {})

  registerTavernScriptInjectedSource(scope.ctx, { id: 'st.scoped', source: 'window.x = 1;' })
  assert.deepEqual(registry.sources().map(source => source.id), ['st.scoped'])

  await scope.dispose()
  assert.deepEqual(registry.sources(), [])

  registerTavernScriptInjectedSource(root, { id: 'st.unscoped', source: 'window.x = 2;' })
  await root.fiber.dispose()
  assert.deepEqual(registry.sources(), [])
})

test('rejects duplicate, unserializable, and oversized injected sources', () => {
  const root = new Context()
  const registry = installRegistry(root)

  registerTavernScriptInjectedSource(root, { id: 'st.dupe', source: 'window.x = 1;' })
  assert.throws(
    () => registerTavernScriptInjectedSource(root, { id: 'st.dupe', source: 'window.x = 2;' }),
    /already registered/u,
  )
  assert.throws(
    () => registry.register({ id: 'st.bad id', source: 'window.x = 3;' }),
    /without whitespace/u,
  )
  assert.throws(
    () => registry.register({ id: 'st.empty', source: '' }),
    /is invalid/u,
  )
  assert.throws(
    () => registry.register({ id: 'st.over', source: `window.__pad = '${'x'.repeat(2 * 1024 * 1024)}';` }),
    /is invalid/u,
  )
  assert.deepEqual(registry.sources().map(source => source.id), ['st.dupe'])
})

test('rejects registration when the Host service is absent', () => {
  const root = new Context()
  assert.throws(
    () => registerTavernScriptInjectedSource(root, { id: 'st.lonely', source: 'window.x = 1;' }),
    /service is unavailable/u,
  )
})