import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import { resolveConfig } from '../src/config.ts'
import { renderCharacterPrompt } from '../src/prompt.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import {
  appendRoleplayState,
  readRoleplayStates,
  ROLEPLAY_STATE_MODULE_ID,
} from '../src/roleplay-state.ts'
import { renderRoleplayTurnStateContext } from '../src/roleplay-runtime-context.ts'
import { executeRoleplayStateCommand } from '../src/roleplay-state-command.ts'
import { prepareRoleplayTurn } from '../src/roleplay-turn-plan.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayTurnSettlement,
} from '../src/roleplay-turn-settlement.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { compileInitialSessionRoleplayTurnPresentation } from '../src/session-roleplay-turn-presentation.ts'

const deployment = resolveConfig({ characterName: '岚' })

test('writes conflict-checked state revisions and reconstructs them after reopening', () => {
  const session = Session.create(SessionId('native-state-write'))
  const mutable = { scene: { weather: '雨', hour: 21 }, flags: ['arrived'] }
  const first = appendRoleplayState(session, {
    id: 'state:scene',
    expectedRevision: 0,
    writerModuleId: 'roleplay:fixture',
    value: mutable,
  })
  mutable.scene.weather = '晴'
  mutable.flags.push('mutated-after-append')

  const second = appendRoleplayState(session, {
    id: 'state:scene',
    expectedRevision: 1,
    writerModuleId: 'roleplay:fixture',
    value: { scene: { weather: '雨', hour: 22 }, flags: ['arrived'] },
  })

  assert.equal(first.revision, 1)
  assert.equal(second.revision, 2)
  assert.equal(session.events[0]?.ignorable, true)
  assert.equal(session.events[1]?.ignorable, true)
  assert.deepEqual(first.value, { scene: { weather: '雨', hour: 21 }, flags: ['arrived'] })
  assert.throws(() => appendRoleplayState(session, {
    id: 'state:scene',
    expectedRevision: 1,
    writerModuleId: 'roleplay:fixture',
    value: null,
  }), /revision conflict: expected 1, current 2/u)

  const reopened = Session.create(SessionId('native-state-reopened'), session.events)
  assert.deepEqual(readRoleplayStates(reopened.events), [{
    format: 0,
    id: 'state:scene',
    revision: 2,
    ownerModuleId: 'roleplay:fixture',
    writerModuleId: 'roleplay:fixture',
    value: { scene: { weather: '雨', hour: 22 }, flags: ['arrived'] },
    eventSeq: second.eventSeq,
  }])
})

test('keeps module ownership stable while allowing a causally recorded player correction', () => {
  const agent = { session: Session.create(SessionId('native-state-authority')) } as Agent
  appendRoleplayState(agent.session, {
    id: 'state:clock', expectedRevision: 0, writerModuleId: 'roleplay:clock', value: { hour: 21 },
  })
  assert.throws(() => appendRoleplayState(agent.session, {
    id: 'state:clock', expectedRevision: 1, writerModuleId: 'roleplay:weather', value: { hour: 22 },
  }), /owned by roleplay:clock, not roleplay:weather/u)

  const request = {
    format: 0 as const,
    operation: 'set' as const,
    id: 'state:clock',
    expectedRevision: 1,
    value: { hour: 22 },
  }
  const rawInput = JSON.stringify(request)
  const commandId = CommandId('state-player-correction')
  agent.session.append('command/run', {
    commandId, name: 'rp-state', args: rawInput, source: { kind: 'user' },
  })
  const result = executeRoleplayStateCommand({ commandId, agent, rawInput })
  agent.session.append('command/done', { commandId, ...result })

  assert.deepEqual(readRoleplayStates(agent.session.events), [{
    format: 0,
    id: 'state:clock',
    revision: 2,
    ownerModuleId: 'roleplay:clock',
    writerModuleId: 'roleplay:user',
    sourceEventSeq: 1,
    value: { hour: 22 },
    eventSeq: 2,
  }])
  const resumed = Session.create(SessionId('native-state-authority-resumed'), agent.session.events)
  assert.equal(readRoleplayStates(resumed.events)[0]?.ownerModuleId, 'roleplay:clock')

  let projected = agentRpProjectionDefinition.init(agent.session.header)
  for (const event of agent.session.events) projected = agentRpProjectionDefinition.apply(projected, event)
  assert.deepEqual(agentRpProjectionDefinition.wire.view(projected).nativeStates, [{
    id: 'state:clock',
    revision: 2,
    ownerModuleId: 'roleplay:clock',
    writerModuleId: 'roleplay:user',
    eventSeq: 2,
    value: { hour: 22 },
  }])

  const moduleUpdate = appendRoleplayState(agent.session, {
    id: 'state:clock', expectedRevision: 2, writerModuleId: 'roleplay:clock', value: { hour: 23 },
  })
  assert.equal(moduleUpdate.revision, 3)
  assert.equal(moduleUpdate.ownerModuleId, 'roleplay:clock')
})

test('binds a player edit to its command id when another command has already entered the log', () => {
  const agent = { session: Session.create(SessionId('native-state-interleaved-command')) } as Agent
  const request = JSON.stringify({
    format: 0, operation: 'set', id: 'state:scene', expectedRevision: 0, value: { phase: 'ready' },
  })
  const commandId = CommandId('state-interleaved-source')
  const source = agent.session.append('command/run', {
    commandId, name: 'rp-state', args: request, source: { kind: 'user' },
  })
  agent.session.append('command/run', {
    commandId: CommandId('state-interleaved-other'), name: 'rp-memory', source: { kind: 'user' },
  })

  const result = executeRoleplayStateCommand({ commandId, agent, rawInput: request })
  agent.session.append('command/done', { commandId, ...result })

  const written = readRoleplayStates(agent.session.events)[0]
  assert.equal(written?.sourceEventSeq, source.seq)
  assert.deepEqual(written?.value, { phase: 'ready' })
})

test('rejects a player state event whose value does not match its cited command', () => {
  const session = Session.create(SessionId('native-state-false-attribution'))
  const request = JSON.stringify({
    format: 0, operation: 'set', id: 'state:scene', expectedRevision: 0, value: { weather: '雨' },
  })
  const source = session.append('command/run', {
    commandId: CommandId('state-false-attribution'), name: 'rp-state', args: request, source: { kind: 'user' },
  })
  session.append('agent-rp/state', {
    format: 0,
    id: 'state:scene',
    revision: 1,
    ownerModuleId: 'roleplay:user',
    writerModuleId: 'roleplay:user',
    sourceEventSeq: source.seq,
    value: { weather: '晴' },
  })

  assert.throws(() => readRoleplayStates(session.events), /does not match its command source/u)
})

test('migrates actual legacy module state without accepting a forged legacy player write', () => {
  const session = Session.create(SessionId('native-state-legacy-owner'))
  session.append('agent-rp/state', {
    format: 0,
    id: 'state:legacy',
    revision: 1,
    writerModuleId: 'roleplay:legacy',
    value: { ready: true },
  })
  assert.equal(readRoleplayStates(session.events)[0]?.ownerModuleId, 'roleplay:legacy')
  assert.equal(appendRoleplayState(session, {
    id: 'state:legacy', expectedRevision: 1, writerModuleId: 'roleplay:legacy', value: { ready: false },
  }).revision, 2)

  const forged = Session.create(SessionId('native-state-forged-legacy-player'))
  forged.append('agent-rp/state', {
    format: 0,
    id: 'state:forged',
    revision: 1,
    writerModuleId: 'roleplay:user',
    value: { accepted: false },
  })
  assert.throws(() => readRoleplayStates(forged.events), /cannot use the legacy ownership format/u)
})

test('rejects discontinuous durable state history instead of silently rebuilding the wrong value', () => {
  const session = Session.create(SessionId('native-state-discontinuous'))
  session.append('agent-rp/state', {
    format: 0,
    id: 'state:clock',
    revision: 2,
    writerModuleId: 'roleplay:fixture',
    value: { hour: 2 },
  })

  assert.throws(() => readRoleplayStates(session.events), /revision is discontinuous: expected 1, received 2/u)
})

test('keeps state-free turns unchanged and compiles exact native state into prepare', () => {
  const emptySession = Session.create(SessionId('native-state-empty'))
  const emptyResolved = resolveSessionRoleplayRuntime({ session: emptySession, deployment })
  const emptyPlan = prepareRoleplayTurn({ session: emptySession, deployment, resolved: emptyResolved })

  assert.deepEqual(emptyResolved.nativeStates, [])
  assert.equal(emptyResolved.snapshot.modules.some(module => module.id === ROLEPLAY_STATE_MODULE_ID), false)
  assert.deepEqual(emptyPlan.stateReads, [])
  assert.equal(emptyPlan.prompt.systemPromptText, renderCharacterPrompt(deployment, [], []))

  const session = Session.create(SessionId('native-state-prepare'))
  const written = appendRoleplayState(session, {
    id: 'state:scene',
    expectedRevision: 0,
    writerModuleId: 'roleplay:fixture',
    value: { location: '钟楼', weather: '浓雾' },
  })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })

  assert.deepEqual(resolved.snapshot.state, [{ id: 'state:scene', owner: 'session', revision: 1 }])
  assert.deepEqual(resolved.snapshot.modules.find(module => module.id === ROLEPLAY_STATE_MODULE_ID), {
    id: ROLEPLAY_STATE_MODULE_ID,
    source: 'native',
    phases: ['prepare', 'settle', 'present'],
    stateIds: ['state:scene'],
  })
  assert.deepEqual(plan.stateReads, [{
    id: 'state:scene',
    owner: 'session',
    revision: 1,
    eventSeq: written.eventSeq,
    writerModuleId: 'roleplay:fixture',
    value: { location: '钟楼', weather: '浓雾' },
  }])
  assert.doesNotMatch(plan.prompt.systemPromptText, /state:scene|浓雾/u)
  assert.match(renderRoleplayTurnStateContext(plan), /本轮只读状态[\s\S]*"state:scene"[\s\S]*"浓雾"/u)
  assert.equal(plan.prompt.afterHistory.at(-1)?.content, renderRoleplayTurnStateContext(plan))
  assert.deepEqual(plan.prepare.modules.find(module => module.moduleId === ROLEPLAY_STATE_MODULE_ID), {
    moduleId: ROLEPLAY_STATE_MODULE_ID,
    outcome: 'applied',
    contributions: 1,
  })
})

test('projects identity macros without exposing state-owned braces to DSH interpolation', () => {
  const session = Session.create(SessionId('native-state-prompt-macros'))
  appendRoleplayState(session, {
    id: 'state:scene',
    expectedRevision: 0,
    writerModuleId: 'roleplay:fixture',
    value: {
      actor: '{{char}}',
      player: '{{user}}',
      preserved: '{{unknown}} / {literal}',
      nested: { label: '仍由 {{char}} 看见 {{user}}' },
    },
  })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved })
  const context = renderRoleplayTurnStateContext(plan)
  const serialized = context.split('\n').at(-1)

  assert.ok(serialized)
  assert.doesNotMatch(context, /\{\{(?:user|char|unknown)\}\}/u)
  assert.deepEqual(JSON.parse(serialized), {
    'state:scene': {
      actor: '岚',
      player: '用户',
      preserved: '{{unknown}} / {literal}',
      nested: { label: '仍由 岚 看见 用户' },
    },
  })
  assert.deepEqual(renderContextSections({
    sections: [],
    contexts: [{ name: 'agent-rp:state', text: context }],
    tools: [],
    variables: { provider: 'fixture', model: 'fixture', cwd: 'D:\\fixture' },
  }), [{ name: 'agent-rp:state', text: context }])
})

test('carries native state changes through settle and present without a format-specific branch', () => {
  const session = Session.create(SessionId('native-state-lifecycle'))
  appendRoleplayState(session, {
    id: 'state:scene', expectedRevision: 0, writerModuleId: 'roleplay:fixture', value: { hour: 21 },
  })
  const before = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, deployment, resolved: before })
  const reply = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '钟声响过，已经十点。' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendRoleplayState(session, {
    id: 'state:scene', expectedRevision: 1, writerModuleId: 'roleplay:fixture', value: { hour: 22 },
  })
  const after = resolveSessionRoleplayRuntime({ session, deployment })
  const plans = [{ step: 1, plan }]
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans,
    events: session.events,
    after: after.snapshot,
  })
  const settlementEvent = appendRoleplayTurnSettlement(session, settlement)
  const presentation = compileInitialSessionRoleplayTurnPresentation({ session, settlementEvent, plans })

  assert.deepEqual(settlement.reply, { eventSeq: reply.seq, messageId: String(reply.data.message.id) })
  assert.deepEqual(settlement.state, [{
    id: 'state:scene', beforeRevision: 1, afterRevision: 2, outcome: 'updated',
  }])
  assert.deepEqual(settlement.settle.modules.find(module => module.moduleId === ROLEPLAY_STATE_MODULE_ID), {
    moduleId: ROLEPLAY_STATE_MODULE_ID, outcome: 'applied', changes: 1,
  })
  assert.deepEqual(presentation.state, [{
    id: 'state:scene', status: 'settled', eventSeq: settlementEvent.seq,
  }])
  assert.deepEqual(presentation.present.modules.find(module => module.moduleId === ROLEPLAY_STATE_MODULE_ID), {
    moduleId: ROLEPLAY_STATE_MODULE_ID, outcome: 'applied', changes: 1,
  })
})
