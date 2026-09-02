import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { createPresetSessionSeed } from '../src/import/session-preset.ts'
import type { ImportedSillyTavernPreset } from '../src/import/sillytavern-preset.ts'
import { prepareRoleplayTurn, type RoleplayTurnPlan } from '../src/roleplay-turn-plan.ts'
import { bindRoleplayExternalContext } from '../src/roleplay-turn-context.ts'
import {
  readCurrentRoleplayTurnPresentation,
  roleplayPresentedState,
} from '../src/roleplay-turn-presentation.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayTurnSettlement,
  createRoleplayTurnPlanReference,
  projectRoleplayTurnPlan,
  readRoleplayTurnSettlements,
  type RoleplayTurnPlanSchema,
} from '../src/roleplay-turn-settlement.ts'
import { readRoleplayTurnRecords } from '../src/roleplay-turn-record.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import {
  createSessionRoleplayTurnBoundary,
  recoverSessionRoleplayTurns,
} from '../src/session-roleplay-turn-recovery.ts'
import {
  appendSessionRoleplayTurnPlan,
  readSessionRoleplayTurnPlans,
  replaySessionRoleplayTurnPlan,
} from '../src/session-roleplay-turn-plan.ts'
import { collectSessionRoleplaySettlementContributions } from '../src/session-roleplay-turn-settlement.ts'
import {
  appendTavernHelperState,
  appendTavernHelperStateAttachment,
  initializeTavernHelperState,
  TAVERN_HELPER_ROLEPLAY_MODULE_ID,
  TAVERN_HELPER_ROLEPLAY_STATE_ID,
} from '../src/tavern-helper.ts'
import { sessionEvents } from '../src/session-events.ts'

const deployment = resolveConfig({ characterName: '恢复测试角色' })

function pending() {
  return createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '继续测试。' }],
  })
}

function reply(session: Session, turn: number, text: string, step = 1) {
  return session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

function appendRecoverableTextTurn(session: Session, turn: number, text: string): void {
  session.append('turn/start', { turn })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, turn, 1, plan)
  reply(session, turn, text)
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function reopenWithLegacyPlanReceipt(
  session: Session,
  recordSeq: number,
  plan: ReturnType<typeof prepareRoleplayTurn>,
  schema: RoleplayTurnPlanSchema,
): { readonly session: Session; readonly record: SessionEvent<'agent-rp/turn-plan'> } {
  const reference = createRoleplayTurnPlanReference(1, plan, schema)
  if (reference.receipt === undefined) throw new Error('missing fixture plan receipt')
  const { preparedPlanSchema: _preparedPlanSchema, ...legacyReceipt } = reference.receipt
  const events = sessionEvents(session).map((event): SessionEvent => event.seq !== recordSeq ? structuredClone(event) : {
    ...structuredClone(event),
    data: {
      ...(event as SessionEvent<'agent-rp/turn-plan'>).data,
      reference: { ...reference, receipt: legacyReceipt },
    },
  } as SessionEvent<'agent-rp/turn-plan'>)
  const reopened = Session.create(session.id, events)
  const record = sessionEvents(reopened)[recordSeq]
  if (record?.type !== 'agent-rp/turn-plan') throw new Error('missing fixture plan event')
  return { session: reopened, record }
}

test('persists one content-free plan receipt before dispatch and rejects retry drift', () => {
  const session = Session.create(SessionId('turn-plan-receipt'))
  session.append('turn/start', { turn: 1 })
  const persistent = createUserMessage({
    source: {
      kind: 'plugin', plugin: 'dsh-worldbook', form: 'snapshot', channel: 'persistent',
      sections: [{ name: 'persistent', text: '持续生效但不应复制的世界正文。' }],
    },
    content: [{ type: 'text', text: '持续生效但不应复制的世界正文。' }],
  })
  const persistentEvent = session.append('user/message', persistent, { surfaceOp: 'append' })
  const stale = createUserMessage({
    source: {
      kind: 'plugin', plugin: 'dsh-worldbook', form: 'snapshot', channel: 'fixture',
      sections: [{ name: 'fixture', text: '同频道旧世界正文。' }],
    },
    content: [{ type: 'text', text: '同频道旧世界正文。' }],
  })
  const staleEvent = session.append('user/message', stale, { surfaceOp: 'append' })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const toolGuidance = {
    enabled: true,
    includeFramework: false,
    includeAgentRp: true,
    imageMode: 'always' as const,
    custom: [{ id: 'fixture-image', enabled: true, text: 'Use the configured fixture image producer.' }],
  }
  const plan = prepareRoleplayTurn({
    session, pendingMessages: [message], deployment, resolved, toolGuidance,
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  const external = createUserMessage({
    source: {
      kind: 'plugin', plugin: 'dsh-worldbook', form: 'snapshot', channel: 'fixture',
      sections: [{ name: 'fixture', text: '不应复制进回合收据的世界正文。' }],
    },
    content: [{ type: 'text', text: '不应复制进回合收据的世界正文。' }],
  })
  const externalEvent = session.append('user/message', external, { surfaceOp: 'append' })
  const dispatchedPlan = bindRoleplayExternalContext({
    plan, events: sessionEvents(session), visibleMessages: session.deriveMessages(), turn: 1, step: 1,
  })

  const first = appendSessionRoleplayTurnPlan(session, 1, 1, dispatchedPlan)
  const duplicate = appendSessionRoleplayTurnPlan(session, 1, 1, dispatchedPlan)
  assert.equal(duplicate.seq, first.seq)
  assert.throws(() => appendSessionRoleplayTurnPlan(session, 1, 1, {
    ...dispatchedPlan,
    generation: { temperature: 0.91 },
  }), /changed after dispatch/u)

  const reopened = Session.create(session.id, sessionEvents(session))
  const records = readSessionRoleplayTurnPlans(sessionEvents(reopened))
  assert.equal(records.length, 1)
  assert.equal(records[0]?.data.reference.receipt.preparedPlanSchema, 5)
  assert.deepEqual(records[0]?.data.toolGuidance, toolGuidance)
  assert.equal(records[0]?.data.reference.receipt.memoryWriteAvailable, true)
  assert.deepEqual(records[0]?.data.reference.receipt.recall, dispatchedPlan.recall)
  const expectedContextReads = session.deriveMessages()
    .filter(value => value.source.kind === 'plugin')
    .map((value) => {
      const event = sessionEvents(session).find(candidate =>
        candidate.type === 'user/message' && String(candidate.data.id) === String(value.id))
      assert.equal(event?.type, 'user/message')
      return { eventSeq: event!.seq, messageId: String(value.id) }
    })
  assert.deepEqual(records[0]?.data.reference.receipt.recall?.contextReads, expectedContextReads)
  assert.deepEqual(readRoleplayTurnRecords(reopened)[0]?.recall.steps[0]?.contextReads, expectedContextReads)
  assert.equal(expectedContextReads.some(read => read.eventSeq === persistentEvent.seq), true)
  assert.equal(expectedContextReads.some(read => read.eventSeq === externalEvent.seq), true)
  const supportsSnapshotChannels = (session.constructor as { readonly contextSnapshotChannels?: unknown })
    .contextSnapshotChannels === 1
  assert.equal(expectedContextReads.some(read => read.eventSeq === staleEvent.seq), !supportsSnapshotChannels)
  assert.deepEqual(records[0]?.data.reference.receipt.runtime.settleModules, [{
    moduleId: 'roleplay:memory', stateIds: [],
  }])
  const record = records[0]
  assert.ok(record)
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: reopened,
    record,
    deployment,
  }), dispatchedPlan)
  const rc236 = reopenWithLegacyPlanReceipt(session, first.seq, dispatchedPlan, 2)
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: rc236.session,
    record: rc236.record,
    deployment,
  }), dispatchedPlan)
  const wrongSchemaEvents = sessionEvents(session).map((event): SessionEvent => event.seq !== first.seq
    ? structuredClone(event)
    : {
        ...structuredClone(event),
        data: {
          ...(event as typeof first).data,
          reference: {
            ...(event as typeof first).data.reference,
            receipt: { ...(event as typeof first).data.reference.receipt, preparedPlanSchema: 1 },
          },
        },
      } as typeof first)
  const wrongSchemaSession = Session.create(session.id, wrongSchemaEvents)
  assert.throws(() => replaySessionRoleplayTurnPlan({
    session: wrongSchemaSession,
    record: sessionEvents(wrongSchemaSession)[first.seq] as typeof first,
    deployment,
  }), /content digest/u)
  assert.throws(() => replaySessionRoleplayTurnPlan({
    session: reopened,
    record,
    deployment: resolveConfig({ characterName: '漂移后的恢复测试角色' }),
  }), /content digest/u)
  assert.doesNotMatch(
    JSON.stringify(records),
    /恢复测试角色|继续测试|不应复制进回合收据的世界正文|持续生效但不应复制|同频道旧世界正文/u,
  )
})

test('replays a cardless prompt-policy transform from the exact Session prefix', () => {
  const preset: ImportedSillyTavernPreset = {
    format: 0,
    name: '回放变换策略',
    prompts: [],
    order: [],
    generation: {},
    formats: { worldInfo: '{0}', scenario: '{0}', personality: '{0}' },
    regexScripts: [{
      scriptName: '回放净化', findRegex: '/secret/gu', replaceString: 'safe', trimStrings: [],
      placement: [1], disabled: false, markdownOnly: false, promptOnly: true,
      runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    }],
    extensionSummary: { regexScriptCount: 1, hasSPreset: false, hasTavernHelper: false },
  }
  const seed = createPresetSessionSeed([], preset, {
    kind: 'file',
    attachmentId: AttachmentId('sha256:turn-plan-transform'),
    bytes: 100,
    name: '回放变换策略.json',
    mediaType: 'application/json',
  })
  const session = Session.create(SessionId('turn-plan-transform-replay'), seed)
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  assert.deepEqual(plan.prompt.transforms.operations.map(operation => [
    operation.owner, operation.ownerIndex, operation.name,
  ]), [['prompt-policy', 0, '回放净化']])
  assert.deepEqual(plan.prepare.modules.find(module => module.moduleId === 'adapter:prompt-modules'), {
    moduleId: 'adapter:prompt-modules', outcome: 'applied', contributions: 1,
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  const record = appendSessionRoleplayTurnPlan(session, 1, 1, plan)

  const reopened = Session.create(session.id, sessionEvents(session))
  const stored = sessionEvents(reopened)[record.seq]
  assert.equal(stored?.type, 'agent-rp/turn-plan')
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: reopened,
    record: stored as typeof record,
    deployment,
  }), plan)
  const legacyProjection = projectRoleplayTurnPlan(plan, 0) as Record<string, unknown>
  assert.equal(Object.hasOwn(legacyProjection, 'act'), false)
  assert.equal(Object.hasOwn(legacyProjection.prompt as object, 'transforms'), false)
  assert.deepEqual((legacyProjection.prepare as RoleplayTurnPlan['prepare']).modules
    .find(module => module.moduleId === 'adapter:prompt-modules'), {
      moduleId: 'adapter:prompt-modules', outcome: 'idle', contributions: 0,
    })
  const legacy = reopenWithLegacyPlanReceipt(session, record.seq, plan, 0)
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: legacy.session,
    record: legacy.record,
    deployment,
  }), plan)
  assert.doesNotMatch(JSON.stringify(stored), /secret|safe/u)
})

test('replays frozen MVU response repair rules and state without copying either into the receipt', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'MVU 回放角色', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [],
      creator: 'fixture', character_version: '1', extensions: {},
      character_book: {
        recursive_scanning: false,
        extensions: {},
        entries: [{
          id: 1, comment: '[initvar]', keys: [], content: 'score: 7', enabled: false,
          insertion_order: 1, constant: false, extensions: {},
        }, {
          id: 2, comment: 'repair', keys: ['__repair__'],
          content: '变量更新规则：只使用冻结规则 sentinel-mvu-rule。', enabled: true,
          insertion_order: 2, constant: false, extensions: {},
        }],
      },
    },
  }))
  const seed = createCharacterCardSessionSeed(card, {
    kind: 'file',
    attachmentId: AttachmentId('sha256:turn-plan-mvu-repair'),
    bytes: 100,
    name: 'mvu-replay.json',
    mediaType: 'application/json',
  }, 0, '')
  const session = Session.create(SessionId('turn-plan-mvu-repair'), seed)
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  assert.deepEqual(plan.act.responseRepairs, [{
    engine: 'mvu-v0', moduleId: 'adapter:mvu', stateId: 'state:mvu',
    updateInstructions: '变量更新规则：只使用冻结规则 sentinel-mvu-rule。',
  }])
  assert.deepEqual(plan.stateReads.find(read => read.id === 'state:mvu')?.value, { score: 7 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  const record = appendSessionRoleplayTurnPlan(session, 1, 1, plan)

  const reopened = Session.create(session.id, sessionEvents(session))
  const stored = sessionEvents(reopened)[record.seq]
  assert.equal(stored?.type, 'agent-rp/turn-plan')
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: reopened,
    record: stored as typeof record,
    deployment,
  }), plan)
  const legacyProjection = projectRoleplayTurnPlan(plan, 1) as Record<string, unknown>
  assert.equal(Object.hasOwn(legacyProjection, 'act'), false)
  const legacyRuntime = legacyProjection.runtime as RoleplayTurnPlan['runtime']
  assert.equal(legacyRuntime.modules.find(module => module.id === 'adapter:mvu')?.phases.includes('act'), false)
  const legacyStateReads = legacyProjection.stateReads as RoleplayTurnPlan['stateReads']
  const legacyMvu = legacyStateReads.find(read => read.id === 'state:mvu')
  assert.equal(Object.hasOwn(legacyMvu ?? {}, 'writerModuleId'), false)
  assert.equal(Object.hasOwn(legacyMvu ?? {}, 'value'), false)
  const legacy = reopenWithLegacyPlanReceipt(session, record.seq, plan, 1)
  assert.deepEqual(replaySessionRoleplayTurnPlan({
    session: legacy.session,
    record: legacy.record,
    deployment,
  }), plan)
  assert.doesNotMatch(JSON.stringify(stored), /sentinel-mvu-rule|"score":7/u)
})

test('recovers a cold-closed turn and folds a late causal browser state into presentation', () => {
  const session = Session.create(SessionId('turn-cold-recovery'))
  const initialTavern = initializeTavernHelperState({
    regexScripts: [],
    tavernHelperScriptNames: [],
    tavernHelperVariables: {},
    tavernHelperScripts: [],
  }, 'recovery-card')
  appendTavernHelperState(session, initialTavern)
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, 1, 1, plan)
  const assistant = reply(session, 1, '中断前已经生成的回复。')
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', {
    turn: 1,
    reason: { kind: 'error', error: { message: 'fixture restart', code: 'UNKNOWN' } },
  })
  const plans = [{ step: 1, plan }]
  const boundary = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const expected = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'error',
    plans,
    events: sessionEvents(session),
    after: boundary.snapshot,
    contributions: collectSessionRoleplaySettlementContributions({
      session,
      turn: 1,
      plans,
      ...(boundary.mvu === undefined ? {} : { mvu: boundary.mvu }),
    }),
  })
  const lateState = { ...initialTavern, revision: initialTavern.revision + 1 }
  const late = appendTavernHelperStateAttachment(session, lateState, {
    format: 0,
    sessionId: String(session.id),
    replySeq: assistant.seq,
  }, true)

  const closing = sessionEvents(session).find(event => event.type === 'turn/end' && event.data.turn === 1)
  assert.equal(closing?.type, 'turn/end')
  const exactBoundary = createSessionRoleplayTurnBoundary(session, closing!)
  assert.equal(exactBoundary.events.at(-1)?.seq, closing?.seq)
  assert.equal(exactBoundary.events.some(event => event.seq === late.eventSeq), false)
  assert.deepEqual(resolveSessionRoleplayRuntime({
    session: exactBoundary.session,
    deployment,
    memoryWriteAvailable: true,
  }).snapshot, boundary.snapshot)

  const restarted = Session.create(session.id, sessionEvents(session))
  assert.equal(readRoleplayTurnSettlements(sessionEvents(restarted)).length, 0)
  const recovered = recoverSessionRoleplayTurns({ session: restarted, deployment })
  assert.deepEqual(recovered, { settlements: 1, presentations: 1, turns: [1] })

  const settlement = readRoleplayTurnSettlements(sessionEvents(restarted))[0]
  assert.deepEqual(settlement, expected)
  assert.equal(settlement?.result, 'error')
  assert.equal(settlement?.reply?.eventSeq, assistant.seq)
  assert.deepEqual(settlement?.settle.modules.find(module =>
    module.moduleId === TAVERN_HELPER_ROLEPLAY_MODULE_ID), {
    moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
    outcome: 'deferred',
    changes: 0,
  })
  const presentation = readCurrentRoleplayTurnPresentation(sessionEvents(restarted))
  assert.equal(presentation?.selectedReply?.sourceSeq, assistant.seq)
  assert.deepEqual(roleplayPresentedState(presentation!, TAVERN_HELPER_ROLEPLAY_STATE_ID), {
    id: TAVERN_HELPER_ROLEPLAY_STATE_ID,
    status: 'attached',
    eventSeq: late.eventSeq,
  })
  assert.deepEqual(presentation?.present.modules.find(module =>
    module.moduleId === TAVERN_HELPER_ROLEPLAY_MODULE_ID), {
    moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
    outcome: 'attached',
    changes: 1,
  })
  assert.deepEqual(recoverSessionRoleplayTurns({ session: restarted, deployment }), {
    settlements: 0, presentations: 0, turns: [],
  })
  assert.doesNotThrow(() => Session.create(restarted.id, sessionEvents(restarted)))
})

test('leaves a pre-dispatch plan alone while its turn is still open', () => {
  const session = Session.create(SessionId('turn-open-recovery'))
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, 1, 1, plan)

  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 0, presentations: 0, turns: [],
  })
  assert.equal(readRoleplayTurnRecords(session)[0]?.boundary.endSeq, undefined)
  assert.equal(readRoleplayTurnSettlements(sessionEvents(session)).length, 0)
})

test('finalizes every logged plan in a multi-step hot turn without coordinator state', () => {
  const session = Session.create(SessionId('turn-hot-log-finalization'))
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const firstResolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const firstPlan = prepareRoleplayTurn({
    session, pendingMessages: [message], deployment, resolved: firstResolved,
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, 1, 1, firstPlan)
  reply(session, 1, '先观察环境。')
  session.append('step/end', { turn: 1, step: 1 })

  const secondResolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const secondPlan = prepareRoleplayTurn({ session, deployment, resolved: secondResolved })
  session.append('step/start', { turn: 1, step: 2 })
  appendSessionRoleplayTurnPlan(session, 1, 2, secondPlan)
  const finalReply = reply(session, 1, '观察完成，继续剧情。', 2)
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 1, presentations: 1, turns: [1],
  })
  const record = readRoleplayTurnRecords(session)[0]
  assert.deepEqual(record?.plans.map(value => value.step), [1, 2])
  assert.deepEqual(record?.act?.steps.map(value => value.step), [1, 2])
  assert.equal(record?.settle?.reply?.eventSeq, finalReply.seq)
  assert.equal(record?.present?.selectedReply?.sourceSeq, finalReply.seq)
})

test('hot finalization validates only the requested turn while startup recovery still scans all', () => {
  const session = Session.create(SessionId('turn-targeted-finalization'))
  appendRecoverableTextTurn(session, 1, '第一轮。')
  appendRecoverableTextTurn(session, 2, '第二轮。')

  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment, turn: 2 }), {
    settlements: 1, presentations: 1, turns: [2],
  })
  let records = readRoleplayTurnRecords(session)
  assert.equal(records.find(record => record.turn === 1)?.settle, undefined)
  assert.notEqual(records.find(record => record.turn === 2)?.present, undefined)

  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 1, presentations: 1, turns: [1],
  })
  records = readRoleplayTurnRecords(session)
  assert.equal(records.every(record => record.settle !== undefined && record.present !== undefined), true)
})

test('adds only presentation when a durable settlement already exists', () => {
  const session = Session.create(SessionId('turn-presentation-only-recovery'))
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, 1, 1, plan)
  reply(session, 1, '结算已经存在。')
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const after = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  appendRoleplayTurnSettlement(session, compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans: [{ step: 1, plan }],
    events: sessionEvents(session),
    after: after.snapshot,
  }))

  assert.equal(readRoleplayTurnRecords(session)[0]?.present, undefined)
  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 0, presentations: 1, turns: [],
  })
  assert.notEqual(readRoleplayTurnRecords(session)[0]?.present, undefined)
  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 0, presentations: 0, turns: [],
  })
})

test('refuses recovery when persisted act evidence no longer matches the Session log', () => {
  const session = Session.create(SessionId('turn-corrupt-act-recovery'))
  session.append('turn/start', { turn: 1 })
  const message = pending()
  const resolved = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [message], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  appendSessionRoleplayTurnPlan(session, 1, 1, plan)
  reply(session, 1, '不可漂移。')
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const after = resolveSessionRoleplayRuntime({ session, deployment, memoryWriteAvailable: true })
  appendRoleplayTurnSettlement(session, compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'completed', plans: [{ step: 1, plan }],
    events: sessionEvents(session), after: after.snapshot,
  }))
  const tampered = sessionEvents(session).map(event => event.type !== 'agent-rp/turn-settlement'
    || event.data.act === undefined ? structuredClone(event) : {
      ...structuredClone(event),
      data: {
        ...event.data,
        act: {
          steps: event.data.act.steps.map(step => ({
            ...step,
            assistantMessages: step.assistantMessages.map(value => ({ ...value, eventSeq: value.eventSeq + 1 })),
          })),
        },
      },
    })
  const restarted = Session.create(session.id, tampered)

  assert.throws(() => recoverSessionRoleplayTurns({ session: restarted, deployment }), /act receipt drifted/u)
})
