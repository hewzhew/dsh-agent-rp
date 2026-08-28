import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import {
  registerRoleplayRuntimeExtension,
  ROLEPLAY_RUNTIME_EXTENSIONS_KEY,
  RoleplayRuntimeExtensionRegistry,
} from '../src/roleplay-runtime-extension.ts'
import { prepareRoleplayTurn } from '../src/roleplay-turn-plan.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import {
  appendSessionRoleplayTurnPlan,
  replaySessionRoleplayTurnPlan,
} from '../src/session-roleplay-turn-plan.ts'

const deployment = resolveConfig({ characterName: '扩展测试角色' })

function emptySession(id: string): Session {
  return Session.create(SessionId(id))
}

test('registers, orders, and revokes source-neutral runtime modules deterministically', () => {
  const registry = new RoleplayRuntimeExtensionRegistry()
  const disposeLast = registry.register({
    module: { id: 'extension:z-last', source: 'native', phases: ['settle', 'recall'] },
    resolve: () => ({
      world: [{
        id: 'world:z', name: '远方天气', owner: 'deployment', placement: 'experience',
      }],
      outcomes: { recall: { outcome: 'applied', contributions: 1 } },
    }),
  })
  const disposeFirst = registry.register({
    module: { id: 'extension:a-first', source: 'adapter', phases: ['present'] },
    resolve: () => ({
      state: [{ id: 'state:a', owner: 'session', revision: 2 }],
    }),
  })

  const resolved = registry.resolve(emptySession('extension-order').events)
  assert.deepEqual(resolved.modules, [{
    id: 'extension:a-first', source: 'adapter', phases: ['present'], stateIds: ['state:a'],
  }, {
    id: 'extension:z-last', source: 'native', phases: ['recall', 'settle'],
  }])
  assert.deepEqual(resolved.world.map(value => value.id), ['world:z'])
  assert.deepEqual(resolved.state.map(value => value.id), ['state:a'])

  disposeFirst()
  assert.deepEqual(registry.resolve(emptySession('extension-revoked').events).modules.map(value => value.id), [
    'extension:z-last',
  ])
  disposeLast()
  assert.deepEqual(registry.resolve(emptySession('extension-empty').events), {
    modules: [], world: [], state: [], prepare: [], recall: [],
  })
})

test('rejects duplicate registrations and stale disposers cannot revoke successors', () => {
  const registry = new RoleplayRuntimeExtensionRegistry()
  const first = registry.register({
    module: { id: 'extension:replaceable', source: 'native', phases: ['prepare'] },
    resolve: () => ({}),
  })
  assert.throws(() => registry.register({
    module: { id: 'extension:replaceable', source: 'native', phases: ['prepare'] },
    resolve: () => ({}),
  }), /already registered/u)
  first()
  const successor = registry.register({
    module: { id: 'extension:replaceable', source: 'native', phases: ['act'] },
    resolve: () => ({}),
  })
  first()
  assert.deepEqual(registry.resolve(emptySession('extension-successor').events).modules[0]?.phases, ['act'])
  successor()
})

test('requires explicit prepare and recall outcomes from participating extensions', () => {
  const registry = new RoleplayRuntimeExtensionRegistry()
  registry.register({
    module: { id: 'extension:missing-outcome', source: 'native', phases: ['prepare'] },
    resolve: () => ({}),
  })
  assert.throws(() => registry.resolve(emptySession('extension-missing-outcome').events),
    /must report its prepare outcome/u)
})

test('revokes a registered module with its owning Cordis scope', async () => {
  const root = new Context()
  const registry = new RoleplayRuntimeExtensionRegistry()
  root.provide(ROLEPLAY_RUNTIME_EXTENSIONS_KEY, registry)
  registerRoleplayRuntimeExtension(root, {
    module: { id: 'extension:owned', source: 'native', phases: ['act'] },
    resolve: () => ({}),
  })
  assert.deepEqual(registry.resolve(emptySession('extension-owned').events).modules.map(value => value.id), [
    'extension:owned',
  ])
  await root.fiber.dispose()
  assert.deepEqual(registry.resolve(emptySession('extension-disposed').events).modules, [])
})

test('merges extension worlds and states while rejecting runtime namespace collisions', () => {
  const registry = new RoleplayRuntimeExtensionRegistry()
  registry.register({
    module: { id: 'extension:weather', source: 'native', phases: ['recall', 'settle'] },
    resolve: ({ events }) => events.some(event => event.type === 'turn/start')
      ? {
          world: [{
            id: 'world:weather', name: '动态天气', owner: 'session', placement: 'experience',
          }],
          state: [{ id: 'state:weather', owner: 'session', revision: 1 }],
          outcomes: { recall: { outcome: 'applied', contributions: 1 } },
        }
      : undefined,
  })
  const session = emptySession('extension-runtime')
  assert.equal(resolveSessionRoleplayRuntime({ session, deployment, extensions: registry }).snapshot.modules
    .some(value => value.id === 'extension:weather'), false)
  session.append('turn/start', { turn: 1 })
  const runtime = resolveSessionRoleplayRuntime({ session, deployment, extensions: registry }).snapshot
  assert.deepEqual(runtime.world.bindings.at(-1), {
    id: 'world:weather', name: '动态天气', owner: 'session', placement: 'experience',
  })
  assert.deepEqual(runtime.state.at(-1), { id: 'state:weather', owner: 'session', revision: 1 })
  assert.deepEqual(runtime.modules.at(-1), {
    id: 'extension:weather', source: 'native', phases: ['recall', 'settle'], stateIds: ['state:weather'],
  })

  const collision = new RoleplayRuntimeExtensionRegistry()
  collision.register({
    module: { id: 'roleplay:agent', source: 'native', phases: ['act'] },
    resolve: () => ({}),
  })
  assert.throws(() => resolveSessionRoleplayRuntime({ session, deployment, extensions: collision }),
    /module ids must be unique/u)
})

test('replays a dispatched turn exactly through the same registered extension seam', () => {
  const registry = new RoleplayRuntimeExtensionRegistry()
  const dispose = registry.register({
    module: { id: 'extension:replay', source: 'native', phases: ['prepare', 'recall'] },
    resolve: ({ events }) => events.some(event => event.type === 'turn/start')
      ? {
          world: [{
            id: 'world:replay', name: '可回放世界', owner: 'session', placement: 'experience',
          }],
          outcomes: {
            prepare: { outcome: 'idle', contributions: 0 },
            recall: { outcome: 'applied', contributions: 1 },
          },
        }
      : undefined,
  })
  const session = emptySession('extension-replay')
  session.append('turn/start', { turn: 1 })
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '继续。' }],
  })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, extensions: registry })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [pending], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  const record = appendSessionRoleplayTurnPlan(session, 1, 1, plan)

  const replayed = replaySessionRoleplayTurnPlan({ session, record, deployment, extensions: registry })
  assert.deepEqual(replayed, plan)
  assert.equal(replayed.runtime.modules.some(value => value.id === 'extension:replay'), true)
  assert.equal(JSON.stringify(record).includes('可回放世界'), false)

  dispose()
  assert.throws(() => replaySessionRoleplayTurnPlan({ session, record, deployment, extensions: registry }),
    /no longer matches its durable content digest/u)
})
