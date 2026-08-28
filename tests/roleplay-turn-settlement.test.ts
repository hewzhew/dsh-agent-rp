import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolCallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { prepareAgentRpMemory, type AgentRpMemoryRecord } from '../src/memory.ts'
import { preparedMvuResponseRepair } from '../src/mvu-stream.ts'
import { ROLEPLAY_TURN_PHASES, type RoleplayRuntimeSnapshot } from '../src/roleplay-runtime.ts'
import type { RoleplayTurnPlan } from '../src/roleplay-turn-plan.ts'
import { prepareRoleplayToolPolicy } from '../src/roleplay-tool-guidance.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayTurnSettlement,
  readRoleplayTurnSettlements,
} from '../src/roleplay-turn-settlement.ts'

function runtime(
  state: RoleplayRuntimeSnapshot['state'] = [],
  modules: RoleplayRuntimeSnapshot['modules'] = [{
    id: 'roleplay:memory', source: 'native', phases: ['recall', 'act', 'settle'],
  }],
): RoleplayRuntimeSnapshot {
  return {
    format: 0,
    lifecycle: ROLEPLAY_TURN_PHASES,
    experience: { id: 'actor:test', name: '测试角色', owner: 'session', mode: 'character' },
    world: { bindings: [] },
    prompt: { strategy: 'native' },
    state,
    memory: { read: true, write: true },
    modules,
  }
}

function turnPlan(input: {
  readonly sessionId: string
  readonly sessionSeq: number
  readonly state?: RoleplayRuntimeSnapshot['state']
  readonly modules?: RoleplayRuntimeSnapshot['modules']
  readonly memoryWrite?: boolean
}): RoleplayTurnPlan {
  const snapshot = runtime(input.state, input.modules)
  return {
    format: 0,
    input: { sessionId: input.sessionId, sessionSeq: input.sessionSeq, pendingMessageIds: [] },
    runtime: snapshot,
    world: {
      engine: 'native-v0', resources: [], inChat: [], experienceBeforeActor: [], actorBefore: [], actorAfter: [],
      experienceAfterActor: [], approximateTokens: 0,
    },
    prompt: {
      beforeHistory: [], afterHistory: [], inChat: [], includeHistory: true, systemPromptText: '',
      transforms: { actorName: snapshot.experience.name, operations: [] },
      diagnostics: { enabledModules: 0, unsupportedMacros: 0, templateFailures: 0 },
    },
    act: { strategy: 'conversation', responseRepairs: [], stateActions: [] },
    tools: prepareRoleplayToolPolicy(),
    stateReads: snapshot.state,
    memory: { read: true, write: input.memoryWrite ?? true, reads: [], contextText: '' },
    generation: {},
    prepare: { modules: [] },
    recall: { modules: [] },
  }
}

function appendReply(session: Session, turn: number, step: number, text: string) {
  return session.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

function appendRemember(
  session: Session,
  callId: string,
  input: { readonly kind: 'fact'; readonly subject: string; readonly text: string; readonly supersedes?: string },
): AgentRpMemoryRecord {
  const argumentsText = JSON.stringify(input)
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{
        type: 'tool-call',
        id: ToolCallId(callId),
        name: 'remember',
        arguments: argumentsText,
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId(callId),
    name: 'remember',
    arguments: argumentsText,
  })
  const record = prepareAgentRpMemory(session, callId, input)
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: [{ type: 'text', text: JSON.stringify(record) }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return record
}

test('settles state, memory, and deferred browser work from one prepared plan', () => {
  const session = Session.create(SessionId('settlement-state'))
  session.append('turn/start', { turn: 1 })
  const modules = [
    { id: 'roleplay:memory', source: 'native', phases: ['recall', 'act', 'settle'] },
    { id: 'adapter:mvu', source: 'adapter', phases: ['prepare', 'settle'], stateIds: ['state:mvu'] },
    {
      id: 'adapter:tavern-helper', source: 'adapter', phases: ROLEPLAY_TURN_PHASES,
      stateIds: ['state:tavern-helper'],
    },
  ] as const
  const plan = turnPlan({
    sessionId: String(session.id),
    sessionSeq: session.seq,
    state: [
      { id: 'state:mvu', owner: 'session', revision: 2 },
      { id: 'state:tavern-helper', owner: 'session', revision: 7 },
    ],
    modules,
  })
  appendReply(session, 1, 1, '状态变化。')
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans: [{ step: 1, plan }],
    events: session.events,
    after: runtime([
      { id: 'state:mvu', owner: 'session', revision: 3 },
      { id: 'state:tavern-helper', owner: 'session', revision: 7 },
    ], modules),
    contributions: [{ moduleId: 'adapter:tavern-helper', outcome: 'deferred' }],
  })

  assert.deepEqual(settlement.state, [
    { id: 'state:mvu', beforeRevision: 2, afterRevision: 3, outcome: 'updated' },
    { id: 'state:tavern-helper', beforeRevision: 7, afterRevision: 7, outcome: 'unchanged' },
  ])
  assert.deepEqual(settlement.settle.modules, [
    { moduleId: 'roleplay:memory', outcome: 'idle', changes: 0 },
    { moduleId: 'adapter:mvu', outcome: 'applied', changes: 1 },
    { moduleId: 'adapter:tavern-helper', outcome: 'deferred', changes: 0 },
  ])
  assert.equal(settlement.reply?.eventSeq, session.events.find(event => event.type === 'assistant/message')?.seq)
})

test('records failed and removed state without hiding boundary revisions', () => {
  const session = Session.create(SessionId('settlement-failed'))
  const modules = [{
    id: 'adapter:mvu', source: 'adapter', phases: ['settle'], stateIds: ['state:mvu'],
  }] as const
  const plan = turnPlan({
    sessionId: String(session.id), sessionSeq: 0,
    state: [{ id: 'state:mvu', owner: 'session', revision: 4 }], modules,
  })
  const failed = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 2, result: 'error', plans: [{ step: 1, plan }], events: [],
    after: runtime([{ id: 'state:mvu', owner: 'session', revision: 4 }], modules),
    contributions: [{ moduleId: 'adapter:mvu', outcome: 'failed', error: 'JSON Patch 无效' }],
  })
  assert.deepEqual(failed.state, [{
    id: 'state:mvu', beforeRevision: 4, afterRevision: 4, outcome: 'failed', error: 'JSON Patch 无效',
  }])
  assert.deepEqual(failed.settle.modules, [{
    moduleId: 'adapter:mvu', outcome: 'failed', changes: 0, error: 'JSON Patch 无效',
  }])

  const removed = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 2, result: 'aborted', plans: [{ step: 1, plan }], events: [],
    after: runtime([], modules),
  })
  assert.deepEqual(removed.state, [{ id: 'state:mvu', beforeRevision: 4, outcome: 'removed' }])
})

test('compares native memory history across the exact first-plan boundary', () => {
  const seed: SessionEvent[] = [{
    type: 'agent-rp/memory-seed',
    seq: 0,
    time: 1,
    data: {
      format: 0,
      sourceSessionId: 'older-session',
      memories: [{ kind: 'fact', subject: '住处', text: '用户住在杭州' }],
    },
  }]
  const session = Session.create(SessionId('settlement-memory'), seed)
  session.append('turn/start', { turn: 1 })
  const plan = turnPlan({ sessionId: String(session.id), sessionSeq: session.seq })
  const replacement = appendRemember(session, 'settlement-memory-call', {
    kind: 'fact', subject: '住处', text: '用户搬到了苏州', supersedes: 'memory-seed-0-0',
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'completed', plans: [{ step: 1, plan }],
    events: session.events, after: runtime(),
  })
  assert.deepEqual(settlement.memory, {
    writeAvailable: true,
    createdIds: [String(replacement.id)],
    supersededIds: ['memory-seed-0-0'],
    activeCount: 1,
  })
  const assistant = session.events.find(event => event.type === 'assistant/message')
  const call = session.events.find(event => event.type === 'tool/call')
  const result = session.events.find(event => event.type === 'tool/result')
  assert.equal(assistant?.type, 'assistant/message')
  assert.equal(call?.type, 'tool/call')
  assert.equal(result?.type, 'tool/result')
  assert.deepEqual(settlement.act, {
    steps: [{
      step: 1,
      assistantMessages: [{ eventSeq: assistant!.seq, messageId: String(assistant!.data.message.id) }],
      modelCalls: [],
      toolCalls: [{ eventSeq: call!.seq, callId: 'settlement-memory-call', name: 'remember' }],
      toolResults: [{ eventSeq: result!.seq, callId: 'settlement-memory-call', outcome: 'succeeded' }],
    }],
  })
  assert.deepEqual(settlement.settle.modules, [{ moduleId: 'roleplay:memory', outcome: 'applied', changes: 2 }])
})

test('keeps each tool-loop step plan and the final visible reply', () => {
  const session = Session.create(SessionId('settlement-multi-step'))
  session.append('turn/start', { turn: 3 })
  const firstBase = turnPlan({ sessionId: String(session.id), sessionSeq: session.seq })
  const worldBinding = {
    id: 'world:test', name: '测试世界', owner: 'session', placement: 'experience',
  } as const
  const first: RoleplayTurnPlan = {
    ...firstBase,
    runtime: {
      ...firstBase.runtime,
      actor: { id: 'actor:card', name: '测试角色卡', owner: 'session' },
      participant: { id: 'persona:test', name: '测试玩家', owner: 'session' },
      world: { bindings: [worldBinding], tokenBudget: 512 },
      prompt: {
        strategy: 'modules',
        resource: { id: 'prompt:test', name: '测试提示策略', owner: 'session' },
      },
      state: [{ id: 'state:test', owner: 'session', revision: 2 }],
      modules: [
        ...firstBase.runtime.modules,
        { id: 'roleplay:world', source: 'native', phases: ['recall'] },
        { id: 'roleplay:state', source: 'native', phases: ['prepare'] },
      ],
    },
    world: {
      engine: 'native-v0',
      inChat: [],
      resources: [{
        resource: worldBinding,
        beforeActor: ['世界贡献'],
        afterActor: [],
        entries: [{
          entryId: 'entry:test', index: 0, active: true, reason: 'active-constant',
          matchedKeys: [], matchedSecondaryKeys: [], approximateTokens: 4,
        }],
      }],
      experienceBeforeActor: ['世界贡献'],
      actorBefore: [],
      actorAfter: [],
      experienceAfterActor: [],
      approximateTokens: 4,
      tokenBudget: 512,
    },
    prompt: {
      ...firstBase.prompt,
      diagnostics: { enabledModules: 2, unsupportedMacros: 1, templateFailures: 0 },
    },
    stateReads: [{
      id: 'state:test', owner: 'session', revision: 2, eventSeq: 0,
      writerModuleId: 'roleplay:state', value: { weather: '雾' },
    }],
    memory: {
      ...firstBase.memory,
      reads: [{ id: 'memory:test', sourceEventSeq: 0 }],
    },
    generation: { temperature: 0.7, maxTokens: 2048 },
    prepare: {
      modules: [{ moduleId: 'roleplay:state', outcome: 'applied', contributions: 1 }],
    },
    recall: {
      modules: [
        { moduleId: 'roleplay:memory', outcome: 'applied', contributions: 1 },
        { moduleId: 'roleplay:world', outcome: 'applied', contributions: 1 },
      ],
    },
  }
  const firstReply = appendReply(session, 3, 1, '先检查一下。')
  const second = turnPlan({ sessionId: String(session.id), sessionSeq: session.seq })
  const finalReply = appendReply(session, 3, 2, '已经完成。')
  session.append('turn/end', { turn: 3, reason: { kind: 'max-tokens' } })

  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 3, result: 'max-tokens',
    plans: [{ step: 2, plan: second }, { step: 1, plan: first }],
    events: session.events, after: runtime(),
  })
  assert.deepEqual(settlement.plans.map(reference => reference.step), [1, 2])
  assert.equal(settlement.plans[0]?.input.sessionSeq, first.input.sessionSeq)
  const { preparedPlanSha256, preparedPlanSectionsSha256, ...firstReceipt } = settlement.plans[0]!.receipt!
  assert.match(preparedPlanSha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.deepEqual(Object.keys(preparedPlanSectionsSha256 ?? {}), [
    'format', 'input', 'runtime', 'world', 'prompt', 'act', 'tools', 'stateReads', 'memory', 'generation', 'prepare', 'recall',
  ])
  assert.deepEqual(firstReceipt, {
    preparedPlanSchema: 5,
    runtime: {
      experienceId: 'actor:test',
      actorId: 'actor:card',
      participantId: 'persona:test',
      worldIds: ['world:test'],
      promptId: 'prompt:test',
      stateIds: ['state:test'],
      moduleIds: ['roleplay:memory', 'roleplay:world', 'roleplay:state'],
      settleModules: [{ moduleId: 'roleplay:memory', stateIds: [] }],
      presentModuleIds: [],
    },
    world: {
      activeEntries: [{ resourceId: 'world:test', entryIds: ['entry:test'] }],
      approximateTokens: 4,
      tokenBudget: 512,
    },
    promptDiagnostics: { enabledModules: 2, unsupportedMacros: 1, templateFailures: 0 },
    act: { strategy: 'conversation', responseRepairs: [], stateActions: [] },
    stateReads: [{ id: 'state:test', revision: 2, eventSeq: 0 }],
    memoryReads: [{ id: 'memory:test', sourceEventSeq: 0 }],
    memoryWriteAvailable: true,
    generation: { temperature: 0.7, maxTokens: 2048 },
    prepare: {
      modules: [{ moduleId: 'roleplay:state', outcome: 'applied', contributions: 1 }],
    },
    recall: {
      modules: [
        { moduleId: 'roleplay:memory', outcome: 'applied', contributions: 1 },
        { moduleId: 'roleplay:world', outcome: 'applied', contributions: 1 },
      ],
    },
  })
  assert.deepEqual(settlement.reply, { eventSeq: finalReply.seq, messageId: String(finalReply.data.message.id) })
  assert.deepEqual(settlement.act, {
    steps: [
      {
        step: 1,
        assistantMessages: [{ eventSeq: firstReply.seq, messageId: String(firstReply.data.message.id) }],
        modelCalls: [],
        toolCalls: [],
        toolResults: [],
      },
      {
        step: 2,
        assistantMessages: [{ eventSeq: finalReply.seq, messageId: String(finalReply.data.message.id) }],
        modelCalls: [],
        toolCalls: [],
        toolResults: [],
      },
    ],
  })
  assert.equal(settlement.result, 'max-tokens')
})

test('rejects a tool result whose Session citation does not point to its call', () => {
  const session = Session.create(SessionId('settlement-invalid-tool-citation'))
  session.append('turn/start', { turn: 1 })
  const prepared = turnPlan({ sessionId: String(session.id), sessionSeq: session.seq })
  const callId = ToolCallId('invalid-citation-call')
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'tool-call', id: callId, name: 'inspect', arguments: '{}' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'inspect', arguments: '{}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const events = structuredClone(session.events)
  const result = events.find(event => event.type === 'tool/result')
  assert.equal(result?.type, 'tool/result')
  if (result?.type === 'tool/result') result.sourceEventSeqs = []

  assert.throws(() => compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans: [{ step: 1, plan: prepared }],
    events,
    after: runtime(),
  }), /does not cite call event/u)
})

test('correlates provider call ids within their step rather than across the whole turn', () => {
  const session = Session.create(SessionId('settlement-reused-call-id'))
  session.append('turn/start', { turn: 1 })
  const plans: { step: number; plan: RoleplayTurnPlan }[] = []
  const callId = ToolCallId('provider-reused-call-id')
  for (const step of [1, 2]) {
    plans.push({ step, plan: turnPlan({ sessionId: String(session.id), sessionSeq: session.seq }) })
    session.append('step/start', { turn: 1, step })
    const argumentsText = JSON.stringify({ step })
    session.append('assistant/message', {
      turn: 1,
      step,
      message: createAssistantMessage({
        source: { provider: 'fixture', model: 'fixture' },
        content: [{ type: 'tool-call', id: callId, name: 'inspect', arguments: argumentsText }],
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    const call = session.append('tool/call', {
      turn: 1, step, callId, name: 'inspect', arguments: argumentsText,
    })
    session.append('tool/result', {
      turn: 1,
      step,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: `step ${String(step)}` }],
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    session.append('step/end', { turn: 1, step })
  }
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans,
    events: session.events,
    after: runtime(),
  })
  assert.deepEqual(settlement.act?.steps.map(step => ({
    step: step.step,
    callIds: step.toolCalls.map(call => call.callId),
    resultIds: step.toolResults.map(result => result.callId),
  })), [
    { step: 1, callIds: ['provider-reused-call-id'], resultIds: ['provider-reused-call-id'] },
    { step: 2, callIds: ['provider-reused-call-id'], resultIds: ['provider-reused-call-id'] },
  ])
})

test('appends only one replayable settlement for a turn', () => {
  const session = Session.create(SessionId('settlement-replay'))
  const plan = turnPlan({ sessionId: String(session.id), sessionSeq: 0 })
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'blocked', plans: [{ step: 1, plan }],
    events: session.events, after: runtime(),
  })
  const first = appendRoleplayTurnSettlement(session, settlement)
  const duplicate = appendRoleplayTurnSettlement(session, settlement)
  assert.equal(duplicate.seq, first.seq)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/turn-settlement').length, 1)

  const reopened = Session.create(session.id, session.events)
  assert.deepEqual(readRoleplayTurnSettlements(reopened.events), [settlement])
})

test('resolves MVU completion only from one prepared act program and its frozen state read', () => {
  assert.equal(preparedMvuResponseRepair(undefined), undefined)
  const enabled = turnPlan({
    sessionId: 'mvu-enabled', sessionSeq: 0,
    state: [{ id: 'state:mvu', owner: 'session', revision: 0 }],
    modules: [{
      id: 'adapter:mvu', source: 'adapter', phases: ['prepare', 'act', 'settle'], stateIds: ['state:mvu'],
    }],
  })
  const repair = {
    engine: 'mvu-v0' as const,
    moduleId: 'adapter:mvu',
    stateId: 'state:mvu',
    updateInstructions: '冻结规则',
  }
  const prepared = {
    ...enabled,
    act: { strategy: 'conversation' as const, responseRepairs: [repair], stateActions: [] },
    stateReads: [{ ...enabled.stateReads[0]!, value: { score: 1 } }],
  }
  assert.deepEqual(preparedMvuResponseRepair(prepared), {
    engine: 'mvu-v0', moduleId: 'adapter:mvu', stateId: 'state:mvu',
    current: { score: 1 }, updateInstructions: '冻结规则',
  })
  assert.equal(preparedMvuResponseRepair({ ...prepared, stateReads: [] }), undefined)
  assert.equal(preparedMvuResponseRepair({
    ...prepared,
    runtime: runtime(prepared.runtime.state, [{
      id: 'adapter:mvu', source: 'adapter', phases: ['prepare', 'settle'], stateIds: ['state:mvu'],
    }]),
  }), undefined)
})

test('attributes arbitrary runtime state through declared module ownership', () => {
  const session = Session.create(SessionId('settlement-generic-state'))
  const modules = [{
    id: 'roleplay:clock', source: 'native', phases: ['settle'], stateIds: ['state:clock'],
  }] as const
  const prepared = turnPlan({
    sessionId: String(session.id),
    sessionSeq: 0,
    state: [{ id: 'state:clock', owner: 'session', revision: 4 }],
    modules,
  })
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans: [{ step: 1, plan: prepared }],
    events: session.events,
    after: runtime([{ id: 'state:clock', owner: 'session', revision: 5 }], modules),
  })

  assert.deepEqual(settlement.state, [{
    id: 'state:clock', beforeRevision: 4, afterRevision: 5, outcome: 'updated',
  }])
  assert.deepEqual(settlement.settle.modules, [{
    moduleId: 'roleplay:clock', outcome: 'applied', changes: 1,
  }])
})

test('rejects ambiguous state ownership and inactive module contributions', () => {
  const session = Session.create(SessionId('settlement-invalid-contract'))
  const shared = [
    { id: 'module:left', source: 'native', phases: ['settle'], stateIds: ['state:shared'] },
    { id: 'module:right', source: 'native', phases: ['settle'], stateIds: ['state:shared'] },
  ] as const
  const ambiguous = turnPlan({ sessionId: String(session.id), sessionSeq: 0, modules: shared })
  assert.throws(() => compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'completed',
    plans: [{ step: 1, plan: ambiguous }], events: session.events, after: runtime([], shared),
  }), /owned by both/u)

  const valid = turnPlan({ sessionId: String(session.id), sessionSeq: 0, modules: [] })
  assert.throws(() => compileRoleplayTurnSettlement({
    sessionId: String(session.id), turn: 1, result: 'completed',
    plans: [{ step: 1, plan: valid }], events: session.events, after: runtime([], []),
    contributions: [{ moduleId: 'adapter:missing', outcome: 'deferred' }],
  }), /inactive module/u)
})
