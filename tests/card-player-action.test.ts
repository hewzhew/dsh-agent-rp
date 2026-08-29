import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CardPlayerActionCoordinator,
} from '../src/client/card-player-action.ts'

interface CardPlayerActionSource { readonly id: string }

function actionSource(id: string): CardPlayerActionSource {
  return { id }
}

test('requires a Host-shell player-action stamp before a card action starts', async () => {
  const source = actionSource('frame-1')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>()
  let calls = 0

  assert.deepEqual(await coordinator.run(source, false, async () => { calls += 1 }), {
    status: 'activation-required',
  })
  assert.equal(calls, 0)

  assert.deepEqual(await coordinator.run(source, true, async () => { calls += 1 }), {
    status: 'completed',
  })
  assert.equal(calls, 1)
})

test('serializes card actions across every frame in one Session', async () => {
  const first = actionSource('frame-1')
  const second = actionSource('frame-2')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>()
  let finish!: () => void
  const blocked = new Promise<void>(resolve => { finish = resolve })
  const running = coordinator.run(first, true, () => blocked)

  assert.deepEqual(await coordinator.run(second, true, async () => undefined), { status: 'busy' })
  finish()
  assert.deepEqual(await running, { status: 'completed' })
  assert.deepEqual(await coordinator.run(second, true, async () => undefined), { status: 'completed' })
})

test('grants exactly one trigger after one successful user-message append', async () => {
  let now = 1_000
  const source = actionSource('frame-1')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>(() => now)
  const mutations: unknown[] = []
  let triggers = 0

  assert.deepEqual(await coordinator.run(source, true, async () => {
    mutations.push({
      format: 0, operation: 'create-chat-messages',
      messages: [{ role: 'user', message: '继续调查线索' }], insertAt: 'end',
    })
  }, { grantTrigger: true }), { status: 'completed' })
  assert.equal(mutations.length, 1)
  assert.equal(triggers, 0)

  assert.deepEqual(await coordinator.trigger(source, false, async () => { triggers += 1 }), { status: 'completed' })
  assert.equal(triggers, 1)
  assert.deepEqual(await coordinator.trigger(source, false, async () => { triggers += 1 }), {
    status: 'activation-required',
  })
  assert.equal(triggers, 1)

  assert.deepEqual(await coordinator.run(source, true, async () => undefined, { grantTrigger: true }), {
    status: 'completed',
  })
  now += 30_001
  assert.deepEqual(await coordinator.trigger(source, false, async () => { triggers += 1 }), {
    status: 'activation-required',
  })
  assert.equal(triggers, 1)
})

test('waits for an in-flight append before starting its granted trigger', async () => {
  const source = actionSource('frame-1')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>()
  let finish!: () => void
  const blocked = new Promise<void>(resolve => { finish = resolve })
  const events: string[] = []
  const mutation = coordinator.run(source, true, async () => {
    events.push('mutation-start')
    await blocked
    events.push('mutation-end')
  }, { grantTrigger: true })
  const trigger = coordinator.trigger(source, false, async () => { events.push('trigger') })

  await Promise.resolve()
  assert.deepEqual(events, ['mutation-start'])
  finish()
  assert.deepEqual(await mutation, { status: 'completed' })
  assert.deepEqual(await trigger, { status: 'completed' })
  assert.deepEqual(events, ['mutation-start', 'mutation-end', 'trigger'])
})

test('does not grant a trigger when the Session mutation fails', async () => {
  const source = actionSource('frame-1')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>()
  const failure = new Error('save failed')
  const result = await coordinator.run(source, true, async () => { throw failure }, { grantTrigger: true })
  assert.equal(result.status, 'failed')
  assert.equal(result.status === 'failed' ? result.reason : undefined, failure)

  let triggers = 0
  assert.deepEqual(await coordinator.trigger(source, false, async () => { triggers += 1 }), {
    status: 'activation-required',
  })
  assert.equal(triggers, 0)
})

test('revokes an append trigger grant when a later player action is accepted', async () => {
  const first = actionSource('frame-1')
  const second = actionSource('frame-2')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>()

  assert.deepEqual(await coordinator.run(first, true, async () => undefined, { grantTrigger: true }), {
    status: 'completed',
  })
  assert.deepEqual(await coordinator.run(second, true, async () => undefined), { status: 'completed' })

  let triggers = 0
  assert.deepEqual(await coordinator.trigger(first, false, async () => { triggers += 1 }), {
    status: 'activation-required',
  })
  assert.equal(triggers, 0)
})

test('keeps a grant through a rejected action but revokes it when a later accepted action fails', async () => {
  const first = actionSource('frame-1')
  const second = actionSource('frame-2')
  const coordinator = new CardPlayerActionCoordinator<CardPlayerActionSource>()
  const failure = new Error('save failed')

  assert.deepEqual(await coordinator.run(first, true, async () => undefined, { grantTrigger: true }), {
    status: 'completed',
  })
  assert.deepEqual(await coordinator.run(second, false, async () => undefined), { status: 'activation-required' })
  let triggers = 0
  assert.deepEqual(await coordinator.trigger(first, false, async () => { triggers += 1 }), { status: 'completed' })
  assert.equal(triggers, 1)

  assert.deepEqual(await coordinator.run(first, true, async () => undefined, { grantTrigger: true }), {
    status: 'completed',
  })
  const result = await coordinator.run(second, true, async () => { throw failure })
  assert.equal(result.status, 'failed')
  assert.equal(result.status === 'failed' ? result.reason : undefined, failure)

  assert.deepEqual(await coordinator.trigger(first, false, async () => { triggers += 1 }), {
    status: 'activation-required',
  })
  assert.equal(triggers, 1)
})
