import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import {
  createAssistantMessage,
  createUserMessage,
  markAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { applyMvuReply, appendMvuState, readCurrentMvuState, readCurrentSessionMvuState, readInitialMvuState } from '../src/mvu.ts'
import { installMvuStreamCompletion } from '../src/mvu-stream.ts'
import { ROLEPLAY_TURN_PHASES } from '../src/roleplay-runtime.ts'
import { readRoleplayTurnRecords } from '../src/roleplay-turn-record.ts'
import type { RoleplayTurnPlan } from '../src/roleplay-turn-plan.ts'
import { prepareRoleplayToolPolicy } from '../src/roleplay-tool-guidance.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayActReceipt,
  compileRoleplayTurnSettlement,
} from '../src/roleplay-turn-settlement.ts'
import { appendSessionRoleplayTurnPlan } from '../src/session-roleplay-turn-plan.ts'
import {
  applyTavernHelperMutation,
  encodeTavernHelperState,
  initializeTavernHelperState,
  parseTavernHelperMutationRequest,
} from '../src/tavern-helper.ts'

function cardWithEntries(entries: readonly object[]) {
  return parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '测试角色', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [],
      creator: 'fixture', character_version: '1.0', extensions: {},
      character_book: { recursive_scanning: false, extensions: {}, entries },
    },
  }))
}

test('merges tagged and named MVU initializers in lorebook order', () => {
  const card = cardWithEntries([{
    id: 3, comment: '[Initvar] 初始变量登记', keys: [], content: '',
    enabled: false, insertion_order: 30, constant: false, extensions: {},
  }, {
    id: 2, comment: '[initvar] 后续', keys: [], content: '```yaml\r\n角色:\r\n  等级: 2\r\n物品: [新]\r\n```',
    enabled: false, insertion_order: 20, constant: false, extensions: {},
  }, {
    id: 1, comment: '旧式标签', keys: [], content: '<initvar>\n角色:\n  名称: 小满\n物品: [旧]\n</initvar>',
    enabled: false, insertion_order: 10, constant: false, extensions: {},
  }])

  assert.deepEqual(readInitialMvuState(card), {
    角色: { 名称: '小满', 等级: 2 },
    物品: ['新'],
  })
})

test('adopts browser-initialized MVU state when a card has no static initializer', () => {
  const card = cardWithEntries([])
  const initial = initializeTavernHelperState(card.frontend, 'card-with-runtime-init')
  const state = applyTavernHelperMutation(initial, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'message', variables: { stat_data: { 角色: { 等级: 1 } } },
  })))
  const session = Session.create(SessionId('mvu-runtime-init'))
  session.append('command/done', {
    commandId: CommandId('mvu-runtime-init'), kind: 'success', text: encodeTavernHelperState(state),
  })

  assert.deepEqual(readCurrentMvuState(card, session.events), {
    statData: { 角色: { 等级: 1 } }, updateCount: 0,
  })
})

test('rejects incomplete legacy MVU blocks instead of treating them as empty updates', () => {
  assert.throws(
    () => applyMvuReply({}, '<UpdateVariable><JSONPatch>[]</JSONPatch>'),
    /UpdateVariable 缺少闭合标签/u,
  )
  assert.throws(
    () => applyMvuReply({}, '<UpdateVariable><JSONPatch>[]</UpdateVariable>'),
    /JSONPatch 缺少闭合标签/u,
  )
})

test('excludes shadowed reply updates while retaining durable script state', () => {
  const card = cardWithEntries([{
    id: 1, comment: '[initvar]', keys: [], content: '角色:\n  等级: 1', enabled: false,
    insertion_order: 1, constant: false, extensions: {},
  }])
  const initial = initializeTavernHelperState(card.frontend, 'mvu-surface-state')
  const scriptState = applyTavernHelperMutation(initial, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'message', variables: { stat_data: { 角色: { 等级: 4 } } },
  })))
  const session = Session.create(SessionId('mvu-surface-state'))
  session.append('command/done', {
    commandId: CommandId('mvu-surface-state'), kind: 'success', text: encodeTavernHelperState(scriptState),
  })
  const original = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":1}]</JSONPatch></UpdateVariable>' }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })

  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 5 } }, updateCount: 2,
  })

  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [], source: { provider: 'fixture', model: 'fixture' },
    }),
  }, {
    surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
    sourceEventSeqs: [original.seq],
  })

  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 4 } }, updateCount: 1,
  })
})

test('replays an exact MVU version checkpoint before applying the new visible reply', () => {
  const card = cardWithEntries([{
    id: 1, comment: '[initvar]', keys: [], content: '角色:\n  等级: 1', enabled: false,
    insertion_order: 1, constant: false, extensions: {},
  }])
  const session = Session.create(SessionId('mvu-version-checkpoint'))
  const rejected = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":9}]</JSONPatch></UpdateVariable>' }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendMvuState(session, { statData: { 角色: { 等级: 3 } }, updateCount: 2 })
  session.append('assistant/message', {
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/等级","value":2}]</JSONPatch></UpdateVariable>' }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, {
    surfaceOp: { op: 'replace', start: rejected.seq, end: rejected.seq },
    sourceEventSeqs: [rejected.seq],
  })

  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 5 } }, updateCount: 3,
  })
  appendMvuState(session, { statData: { 角色: { 等级: 4 } }, updateCount: 1 })
  assert.deepEqual(readCurrentSessionMvuState(card, Session.create(session.id, session.events)), {
    statData: { 角色: { 等级: 4 } }, updateCount: 1,
  })
})

test('repairs a missing MVU block from only the frozen act plan in a cardless Session', async () => {
  type StreamHandler = (
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ) => AsyncIterable<StreamChunk>
  const session = Session.create(SessionId('mvu-frozen-act-plan'))
  session.append('command/done', {
    commandId: CommandId('mvu-frozen-act-plan-prefix'), kind: 'success', text: 'unrelated earlier event',
  })
  const plan: RoleplayTurnPlan = {
    format: 0,
    input: { sessionId: String(session.id), sessionSeq: session.events.length, pendingMessageIds: [] },
    runtime: {
      format: 0,
      lifecycle: ROLEPLAY_TURN_PHASES,
      experience: { id: 'fixture', name: '测试角色', owner: 'session', mode: 'character' },
      world: { bindings: [] },
      prompt: { strategy: 'native' },
      state: [{ id: 'state:mvu', owner: 'session', revision: 3 }],
      memory: { read: true, write: false },
      modules: [{
        id: 'adapter:mvu', source: 'adapter', phases: ['prepare', 'act', 'settle'], stateIds: ['state:mvu'],
      }],
    },
    world: {
      engine: 'native-v0', resources: [], inChat: [], experienceBeforeActor: [], actorBefore: [], actorAfter: [],
      experienceAfterActor: [], approximateTokens: 0,
    },
    prompt: {
      beforeHistory: [], afterHistory: [], inChat: [], includeHistory: true, systemPromptText: '',
      transforms: { actorName: '测试角色', operations: [] },
      diagnostics: { enabledModules: 0, unsupportedMacros: 0, templateFailures: 0 },
    },
    act: { strategy: 'conversation', stateActions: [], responseRepairs: [{
      engine: 'mvu-v0', moduleId: 'adapter:mvu', stateId: 'state:mvu', updateInstructions: '只用冻结规则',
    }] },
    tools: prepareRoleplayToolPolicy(),
    stateReads: [{
      id: 'state:mvu', owner: 'session', revision: 3, writerModuleId: 'adapter:mvu', value: { score: 7 },
    }],
    memory: { read: true, write: false, reads: [], contextText: '' },
    generation: {},
    prepare: { modules: [] },
    recall: { modules: [] },
  }
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const planEvent = appendSessionRoleplayTurnPlan(session, 1, 1, plan)
  let handler: StreamHandler | undefined
  let supplementalRequest: GenerateOptions | undefined
  const ctx = {
    on(_event: string, callback: StreamHandler) { handler = callback },
    llm: {
      stream(options: GenerateOptions) {
        supplementalRequest = options
        return (async function* (): AsyncIterable<StreamChunk> {
          const text = '<UpdateVariable><Analysis>无变化</Analysis><JSONPatch>[]</JSONPatch></UpdateVariable>'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    sessions: { flush: async () => true },
    logger: { warn() {} },
  } as unknown as Context
  const agent = { session } as Agent
  installMvuStreamCompletion(ctx, id => id === String(session.id) ? agent : undefined, () => plan)
  assert.ok(handler)
  const original = async function* (): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '原始回复' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '原始回复' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  let bypassed = 0
  handler(Object.freeze({
    provider: 'fixture', model: 'fixture', sessionId: session.id, messages: [],
  }) as GenerateOptions, () => {
    bypassed += 1
    return original()
  })
  assert.equal(bypassed, 1)
  assert.equal(session.events.some(event => event.type === 'agent-rp/act-model-request'), false)

  const options = Object.freeze(markAgentLoopRequest({
    provider: 'fixture', model: 'fixture', sessionId: session.id,
    messages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }],
    })],
  })) as GenerateOptions
  const output: StreamChunk[] = []
  for await (const chunk of handler(options, original)) output.push(chunk)

  const requestText = supplementalRequest?.messages.flatMap(message => message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n') ?? ''
  assert.match(requestText, /"score":7/u)
  assert.match(requestText, /只用冻结规则/u)
  const outputText = output.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
  assert.match(outputText, /<UpdateVariable>/u)
  const requestEvent = session.events.find(event => event.type === 'agent-rp/act-model-request')
  const resultEvent = session.events.find(event => event.type === 'agent-rp/act-model-result')
  assert.equal(requestEvent?.type, 'agent-rp/act-model-request')
  assert.equal(resultEvent?.type, 'agent-rp/act-model-result')
  if (requestEvent?.type !== 'agent-rp/act-model-request'
    || resultEvent?.type !== 'agent-rp/act-model-result') throw new Error('missing act-model audit')
  assert.equal(requestEvent.data.planSeq, planEvent.seq)
  assert.deepEqual(requestEvent.data.dispatch.messages, supplementalRequest?.messages)
  assert.deepEqual(resultEvent.data.result, {
    kind: 'success',
    text: '<UpdateVariable><Analysis>无变化</Analysis><JSONPatch>[]</JSONPatch></UpdateVariable>',
    application: 'applied',
  })

  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: outputText }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const receipt = compileRoleplayActReceipt(session.events, 1, 'completed', [planEvent.data.reference])
  assert.deepEqual(receipt.steps[0]?.modelCalls, [{
    requestEventSeq: requestEvent.seq,
    resultEventSeq: resultEvent.seq,
    requestId: requestEvent.data.requestId,
    purpose: 'response-repair',
    engine: 'mvu-v0',
    moduleId: 'adapter:mvu',
    stateId: 'state:mvu',
    outcome: 'applied',
  }])
  const settlement = compileRoleplayTurnSettlement({
    sessionId: String(session.id),
    turn: 1,
    result: 'completed',
    plans: [{ step: 1, plan }],
    events: session.events,
    after: plan.runtime,
  })
  appendRoleplayTurnSettlement(session, settlement)
  assert.deepEqual(readRoleplayTurnRecords(session)[0]?.act?.steps[0]?.modelCalls,
    receipt.steps[0]?.modelCalls)
})
