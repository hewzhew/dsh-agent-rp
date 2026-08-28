import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SlotCore,
  type PropsRenderSlots,
  type PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  AGENT_RP_CLIENT_EXTENSION_API_VERSION,
  AGENT_RP_PLAY_WORLD_VIEW_SLOT,
  AGENT_RP_WORKBENCH_SECTION_SLOT,
  type AgentRpPlayWorldViewProps,
  type AgentRpWorkbenchSectionProps,
} from '../src/client-extension-v0.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'test.agent-rp-workbench': { kind: 'single'; scope: 'root' }
  }
}

type TestWorkbenchProps = PropsRuntime<'test.agent-rp-workbench'>
  & PropsRenderSlots<typeof AGENT_RP_WORKBENCH_SECTION_SLOT>
type TestWorldViewHostProps = PropsRuntime<'test.agent-rp-workbench'>
  & PropsRenderSlots<typeof AGENT_RP_PLAY_WORLD_VIEW_SLOT>

test('lets an independent client plugin join and leave the Agent RP workbench lifecycle', () => {
  assert.equal(AGENT_RP_CLIENT_EXTENSION_API_VERSION, 0)
  const slots = new SlotCore()
  slots.register({
    name: 'root',
    children: { 'test.agent-rp-workbench': { kind: 'single', scope: 'root' } },
  } as never, (() => null) as never)
  let closeWorkbenchCalls = 0
  const closeWorkbench = (): void => { closeWorkbenchCalls += 1 }
  const disposeWorkbench = slots.register({
    name: 'test.agent-rp-workbench',
    children: { [AGENT_RP_WORKBENCH_SECTION_SLOT]: { kind: 'list', scope: 'root' } },
  }, ({ renderSlot }: TestWorkbenchProps) => renderSlot(
    AGENT_RP_WORKBENCH_SECTION_SLOT,
    { closeWorkbench },
  ))

  const ExternalWorldbookSection = (props: AgentRpWorkbenchSectionProps) => {
    props.closeWorkbench()
    return null
  }
  const disposeExternal = slots.register({
    name: AGENT_RP_WORKBENCH_SECTION_SLOT,
    id: 'community-worldbook',
    order: 10,
    label: '世界书',
  }, ExternalWorldbookSection)

  assert.deepEqual(slots.spec(AGENT_RP_WORKBENCH_SECTION_SLOT), { kind: 'list', scope: 'root' })
  assert.deepEqual(slots.snapshot('test.agent-rp-workbench')[0]?.children[0], {
    name: AGENT_RP_WORKBENCH_SECTION_SLOT,
    kind: 'list',
    scope: 'root',
    declaredBy: 'an entry in "test.agent-rp-workbench"',
    occupants: [{ id: 'community-worldbook', order: 10, priority: 0, active: true }],
    children: [],
  })
  ExternalWorldbookSection({ closeWorkbench } as AgentRpWorkbenchSectionProps)
  assert.equal(closeWorkbenchCalls, 1)

  disposeWorkbench()
  assert.equal(slots.spec(AGENT_RP_WORKBENCH_SECTION_SLOT), undefined)
  assert.deepEqual(slots.entriesOfSlot(AGENT_RP_WORKBENCH_SECTION_SLOT), [])
  disposeExternal()
})

test('routes browser-safe world state and legal actions to a module-id-keyed view', () => {
  const slots = new SlotCore()
  slots.register({
    name: 'root',
    children: { 'test.agent-rp-workbench': { kind: 'single', scope: 'root' } },
  } as never, (() => null) as never)
  let dispatchedAction: string | undefined
  const owner = {
    world: {
      format: 0 as const,
      instanceId: 'fixture-instance',
      moduleId: 'fixture.worldbook',
      moduleVersion: 1,
      title: 'Fixture world',
      state: { publicCounter: 2 },
      events: [],
    },
    characters: [{ id: 'character-a', name: '灵梦' }],
    turn: {
      cycleId: 'cycle-1',
      characterId: 'character-a',
      instruction: '选择一项合法行动',
      actions: [{ id: 'advance', label: '前进', description: '推进一格' }],
    },
    busy: false,
    dirty: false,
    dispatchAction: (actionId: string) => { dispatchedAction = actionId },
  }
  const disposeWorkbench = slots.register({
    name: 'test.agent-rp-workbench',
    children: { [AGENT_RP_PLAY_WORLD_VIEW_SLOT]: { kind: 'keyed', scope: 'root' } },
  }, ({ renderSlot }: TestWorldViewHostProps) => renderSlot(
    AGENT_RP_PLAY_WORLD_VIEW_SLOT,
    owner,
    { entryKey: owner.world.moduleId },
  ))

  const ExternalWorldView = (props: AgentRpPlayWorldViewProps) => {
    assert.equal(props.world.moduleId, 'fixture.worldbook')
    assert.deepEqual(props.characters, [{ id: 'character-a', name: '灵梦' }])
    assert.equal(props.turn?.actions[0]?.id, 'advance')
    assert.equal(props.busy, false)
    assert.equal(props.dirty, false)
    props.dispatchAction('advance')
    return null
  }
  const disposeExternal = slots.register({
    name: AGENT_RP_PLAY_WORLD_VIEW_SLOT,
    key: 'fixture.worldbook',
  }, ExternalWorldView)

  assert.deepEqual(slots.spec(AGENT_RP_PLAY_WORLD_VIEW_SLOT), { kind: 'keyed', scope: 'root' })
  assert.equal(slots.entriesOfSlot(AGENT_RP_PLAY_WORLD_VIEW_SLOT)[0]?.options.key, 'fixture.worldbook')
  ExternalWorldView(owner as AgentRpPlayWorldViewProps)
  assert.equal(dispatchedAction, 'advance')

  disposeWorkbench()
  assert.equal(slots.spec(AGENT_RP_PLAY_WORLD_VIEW_SLOT), undefined)
  assert.deepEqual(slots.entriesOfSlot(AGENT_RP_PLAY_WORLD_VIEW_SLOT), [])
  disposeExternal()
})
