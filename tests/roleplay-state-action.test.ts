import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CommandId } from '@deepseek-ai/dsh-commands'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/config.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { installAgentRp } from '../src/index.ts'
import { appendMvuState, readCurrentSessionMvuState } from '../src/mvu.ts'
import {
  collectRoleplayStateActionIntents,
  installRoleplayStateActionTool,
  ROLEPLAY_STATE_ACTION_TOOL,
} from '../src/roleplay-state-action.ts'
import {
  collectRoleplayStagedStateSettlement,
  resolveRoleplayStateVerificationModel,
  runRoleplayStagedStateSettlement,
} from '../src/roleplay-staged-state-settlement.ts'
import {
  ensureDefaultRoleplayTurnMode,
  readRoleplayTurnMode,
} from '../src/roleplay-turn-mode.ts'
import { executeRoleplayTurnModeCommand } from '../src/roleplay-turn-mode-command.ts'
import { prepareRoleplayTurn, type RoleplayTurnPlan } from '../src/roleplay-turn-plan.ts'
import {
  projectRoleplayTurnPlan,
  readRoleplayTurnSettlements,
  type RoleplayTurnPlanReference,
} from '../src/roleplay-turn-settlement.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { recoverSessionRoleplayTurns } from '../src/session-roleplay-turn-recovery.ts'
import {
  appendSessionRoleplayTurnPlan,
} from '../src/session-roleplay-turn-plan.ts'
import { installIgnorableSessionEventFixture } from './session-event-fixture.ts'

installIgnorableSessionEventFixture()

const deployment = resolveConfig({ characterName: '状态行动测试角色' })

function mvuCard() {
  return parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '白露',
      description: '钟表匠',
      personality: '沉静',
      scenario: '修理铺打烊前',
      first_mes: '门还没锁。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: 'fixture',
      character_version: '1',
      extensions: {},
      character_book: {
        recursive_scanning: false,
        extensions: {},
        entries: [{
          id: 1,
          comment: '[initvar]',
          keys: [],
          content: '角色:\n  等级: 1\n  称号: 学徒',
          enabled: false,
          insertion_order: 1,
          constant: false,
          extensions: {},
        }, {
          id: 2,
          comment: '变量更新规则',
          keys: ['__mvu_rules__'],
          content: '变量更新规则：剧情推进时更新等级，旧格式要求回复末尾输出 <UpdateVariable>。',
          enabled: true,
          insertion_order: 2,
          constant: false,
          extensions: {},
        }],
      },
    },
  }))
}

function cardSession(id: string, mode: 'conversation' | 'agent') {
  const card = mvuCard()
  const seed = createCharacterCardSessionSeed(card, {
    kind: 'file',
    attachmentId: AttachmentId(`sha256:${id}`),
    bytes: 100,
    name: `${id}.json`,
    mediaType: 'application/json',
  }, 0, '')
  const session = Session.create(SessionId(id), seed)
  if (mode === 'agent') ensureDefaultRoleplayTurnMode(session, 'agent')
  return { card, session }
}

function beginTurn(session: Session): {
  readonly plan: RoleplayTurnPlan
  readonly reference: RoleplayTurnPlanReference
  readonly record: SessionEvent<'agent-rp/turn-plan'>
} {
  session.append('turn/start', { turn: 1 })
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '今晚的修行让我进步了。' }],
  })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [pending], deployment, resolved })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  const record = appendSessionRoleplayTurnPlan(session, 1, 1, plan)
  return { plan, reference: record.data.reference, record }
}

function appendActionCall(
  session: Session,
  callId: string,
  args: { readonly stateId: string; readonly operations: readonly object[] },
  text = '白露把修行笔记收好，终于跨过了原先的门槛。',
) {
  const argumentsText = JSON.stringify(args)
  const assistant = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text }, {
        type: 'tool-call',
        id: CallId(callId),
        name: ROLEPLAY_STATE_ACTION_TOOL,
        arguments: argumentsText,
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CallId(callId),
    name: ROLEPLAY_STATE_ACTION_TOOL,
    arguments: argumentsText,
  })
  return { assistant, call }
}

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  installRoleplayStateActionTool(ctx)
  return ctx
}

async function executeAndAppend(
  ctx: Context,
  agent: Agent,
  callId: string,
  callSeq: number,
  args: { readonly stateId: string; readonly operations: readonly object[] },
  sourceEventSeqs: readonly number[] = [callSeq],
) {
  const result = await ctx.tools.execute({
    callId: CallId(callId),
    name: ROLEPLAY_STATE_ACTION_TOOL,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(result.isError, false)
  if (result.isError) throw new Error('state action unexpectedly failed')
  const event = agent.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId(callId),
      content: result.content,
      isError: false,
    }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  }, { surfaceOp: 'append', sourceEventSeqs: [...sourceEventSeqs] })
  return { event, result }
}

test('keeps state arithmetic out of the actor step and does not migrate resumed logs', async (context) => {
  const root = new Context()
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRegistry)
  await root.plugin(AgentRegistry)
  root.provide('commands' as never, { register: () => () => {} } as never)
  root.provide('attachments' as never, {} as never)
  root.provide('credentials' as never, {} as never)
  const presetKey = {}
  const preset = createScope(root, presetKey)
  const characterLibraryRoot = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-state-action-'))
  let installed = false
  let agentParentCtx: Context | undefined
  await preset.ctx.plugin({
    inject: ['systemPrompt', 'tools'],
    apply(pluginCtx: Context) {
      pluginCtx.tools.register(defineTool({
        name: 'bash',
        description: 'High-authority fixture that must stay hidden from roleplay Agents.',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: () => Promise.resolve('unexpected'),
      }))
      installAgentRp(pluginCtx, deployment, { characterLibraryRoot })
      agentParentCtx = pluginCtx
      installed = true
    },
  })
  assert.equal(installed, true)
  assert.ok(agentParentCtx)

  const native = cardSession('state-action-same-step-schema', 'agent')
  const nativeAgent = { id: native.session.id, session: native.session } as Agent
  const nativeScope = createScope(agentParentCtx, nativeAgent, { parent: presetKey })
  Object.assign(nativeAgent, { ctx: nativeScope.ctx })
  const disposeNative = root.agents.register(nativeAgent)

  const before = await root.systemPrompt.assemble({ scope: nativeAgent })
  assert.equal(before.tools.some(tool => tool.name === ROLEPLAY_STATE_ACTION_TOOL), false)
  assert.equal(before.tools.some(tool => tool.name === 'bash'), false)
  native.session.append('turn/start', { turn: 1 })
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '今晚的修行让我进步了。' }],
  })
  agentEvents(root, nativeAgent).emit('agent/inbox/claimed', { message: pending, turn: 1 })
  const sameStep = await root.systemPrompt.assemble({ scope: nativeAgent })
  assert.equal(sameStep.tools.some(tool => tool.name === ROLEPLAY_STATE_ACTION_TOOL), false)
  assert.equal(sameStep.tools.some(tool => tool.name === 'bash'), false)
  const stateContext = sameStep.contexts.find(value => value.name === 'agent-rp:state')?.text ?? ''
  assert.match(stateContext, /本轮只读状态/u)
  assert.match(stateContext, /"state:mvu":\{"角色":\{"等级":1,"称号":"学徒"\}\}/u)

  const rawInput = JSON.stringify({ mode: 'conversation', format: 0 })
  const commandId = CommandId('turn-mode-user-selection')
  native.session.append('command/run', {
    commandId,
    name: 'rp-turn-mode',
    args: rawInput,
    source: { kind: 'user' },
  })
  executeRoleplayTurnModeCommand({ commandId, agent: nativeAgent, rawInput })
  assert.equal(readRoleplayTurnMode(Session.create(native.session.id, native.session.events).events), 'conversation')
  native.session.append('turn/start', { turn: 2 })
  agentEvents(root, nativeAgent).emit('agent/inbox/claimed', {
    message: createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '继续聊，不进行 Agent 结算。' }],
    }),
    turn: 2,
  })
  const dialogueStep = await root.systemPrompt.assemble({ scope: nativeAgent })
  assert.equal(dialogueStep.tools.some(tool => tool.name === ROLEPLAY_STATE_ACTION_TOOL), false)
  const dialogueState = dialogueStep.contexts.find(value => value.name === 'agent-rp:state')?.text ?? ''
  assert.match(dialogueState, /本轮只读状态/u)
  assert.match(dialogueState, /"state:mvu":\{"角色":\{"等级":1,"称号":"学徒"\}\}/u)

  const resumedSession = Session.create(SessionId('state-action-resumed-default'))
  const resumedAgent = { id: resumedSession.id, session: resumedSession } as Agent
  const resumedScope = createScope(agentParentCtx, resumedAgent, { parent: presetKey })
  Object.assign(resumedAgent, { ctx: resumedScope.ctx })
  const disposeResumed = root.agents.register(resumedAgent)
  agentEvents(root, resumedAgent).emit('agent/session-start', { source: 'resume' })
  assert.equal(readRoleplayTurnMode(resumedSession.events), 'conversation')

  const freshSession = Session.create(SessionId('state-action-fresh-default'))
  const freshAgent = { id: freshSession.id, session: freshSession } as Agent
  const freshScope = createScope(agentParentCtx, freshAgent, { parent: presetKey })
  Object.assign(freshAgent, { ctx: freshScope.ctx })
  const disposeFresh = root.agents.register(freshAgent)
  agentEvents(root, freshAgent).emit('agent/session-start', { source: 'startup' })
  assert.equal(readRoleplayTurnMode(freshSession.events), 'agent')

  context.after(async () => {
    disposeFresh()
    disposeResumed()
    disposeNative()
    await freshScope.dispose()
    await resumedScope.dispose()
    await nativeScope.dispose()
    await preset.dispose()
    await root.fiber.dispose()
    rmSync(characterLibraryRoot, { recursive: true, force: true })
  })
})

test('applies one semantic action after turn end and keeps its narrative message as the final reply', async (context) => {
  const ctx = await mounted()
  context.after(async () => { await ctx.fiber.dispose() })
  const { card, session } = cardSession('state-action-success', 'agent')
  const { plan, reference } = beginTurn(session)
  assert.equal(plan.act.strategy, 'agent')
  assert.deepEqual(plan.act.responseRepairs, [])
  assert.equal(plan.act.stateActions[0]?.tool, ROLEPLAY_STATE_ACTION_TOOL)
  assert.doesNotMatch(plan.prompt.systemPromptText, /后台阶段独立结算/u)
  assert.match(plan.prompt.afterHistory.map(message => message.content).join('\n'), /后台阶段独立结算/u)
  const schema4 = projectRoleplayTurnPlan(plan, 4) as RoleplayTurnPlan
  assert.match(schema4.prompt.afterHistory.map(message => message.content).join('\n'), /再在正文之后调用 apply_roleplay_state/u)
  assert.equal(schema4.act.stateActions[0]?.instructions, undefined)
  const args = {
    stateId: 'state:mvu',
    operations: [{ op: 'delta', path: '/角色/等级', value: 2 }],
  }
  const { assistant, call } = appendActionCall(session, 'state-action-success-call', args)
  const { event, result } = await executeAndAppend(ctx, { session } as Agent, 'state-action-success-call', call.seq, args)
  assert.equal(result.concludesTurn, true)
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [event.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const restarted = Session.create(session.id, session.events)
  assert.equal(restarted.events.at(-1)?.type, 'session/end-seed')

  assert.deepEqual(collectRoleplayStateActionIntents({
    events: restarted.events,
    sessionId: String(restarted.id),
    turn: 1,
    plans: [reference],
  }).map(item => item.resultEventSeq), [event.seq])
  assert.deepEqual(recoverSessionRoleplayTurns({ session: restarted, deployment }), {
    settlements: 1,
    presentations: 1,
    turns: [1],
  })
  assert.deepEqual(readCurrentSessionMvuState(card, restarted), {
    statData: { 角色: { 等级: 3, 称号: '学徒' } },
    updateCount: 1,
    source: { kind: 'agent-action', turn: 1, resultEventSeqs: [event.seq] },
  })
  const actionState = restarted.events.findLast(event => event.type === 'agent-rp/mvu-state')
  assert.equal(actionState?.type, 'agent-rp/mvu-state')
  if (actionState?.type === 'agent-rp/mvu-state') {
    assert.deepEqual(actionState.data.source, {
      kind: 'agent-action',
      turn: 1,
      resultEventSeqs: [event.seq],
    })
  }
  const settlement = readRoleplayTurnSettlements(restarted.events)[0]
  assert.equal(settlement?.reply?.eventSeq, assistant.seq)
  assert.deepEqual(settlement?.state, [{
    id: 'state:mvu', beforeRevision: 0, afterRevision: 1, outcome: 'updated',
  }])
  assert.deepEqual(settlement?.settle.modules.find(module => module.moduleId === 'adapter:mvu'), {
    moduleId: 'adapter:mvu', outcome: 'applied', changes: 1,
  })
  assert.deepEqual(recoverSessionRoleplayTurns({ session: restarted, deployment }), {
    settlements: 0,
    presentations: 0,
    turns: [],
  })
  assert.equal(restarted.events.filter(candidate => candidate.type === 'agent-rp/mvu-state').length, 1)
})

test('settles MVU after the visible reply through a replayable local-provider stage', async () => {
  const { card, session } = cardSession('staged-state-success', 'agent')
  session.append('turn/start', { turn: 1 })
  const openingResolved = resolveSessionRoleplayRuntime({ session, deployment })
  const openingPlan = prepareRoleplayTurn({ session, deployment, resolved: openingResolved })
  session.append('step/start', { turn: 1, step: 1 })
  appendSessionRoleplayTurnPlan(session, 1, 1, openingPlan)
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '门还没锁。这是同一回合中已经结束的角色开场白。' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 1 })
  const pending = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '今晚的修行让我进步了。' }],
  })
  const resolved = resolveSessionRoleplayRuntime({ session, deployment })
  const plan = prepareRoleplayTurn({ session, pendingMessages: [pending], deployment, resolved })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    source: { kind: 'plugin', plugin: 'fixture-runtime-context' },
    content: [{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.',
    }],
  }), { surfaceOp: 'append' })
  const record = appendSessionRoleplayTurnPlan(session, 1, 2, plan)
  const reference = record.data.reference
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 128 } },
  })
  const narrative = session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '白露合上修行笔记，确认自己已经跨过两级门槛。' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 2 })
  const reviewedNarrative = session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture-review' },
      content: [{ type: 'text', text: '白露合上修行笔记，确认自己已经稳稳跨过两级门槛。' }],
    }),
  }, {
    surfaceOp: { op: 'replace', start: narrative.seq, end: narrative.seq },
    sourceEventSeqs: [narrative.seq],
  })
  const requestTexts: string[] = []
  const requestSystems: string[] = []
  const requestReasoning: (string | undefined)[] = []
  const requestMaxTokens: (number | undefined)[] = []
  const requestModels: Array<{ readonly provider: string; readonly model: string }> = []
  let requestCount = 0
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: {
        readonly provider: string
        readonly model: string
        readonly messages: readonly { readonly content: readonly unknown[] }[]
        readonly system?: string
        readonly reasoningEffort?: string
        readonly maxTokens?: number
      }) {
        requestCount += 1
        requestTexts.push(JSON.stringify(options.messages))
        requestSystems.push(options.system ?? '')
        requestReasoning.push(options.reasoningEffort)
        requestMaxTokens.push(options.maxTokens)
        requestModels.push({ provider: options.provider, model: options.model })
        return (async function* () {
          const delta = requestCount === 1 ? 1 : 2
          const text = `{"operations":[{"operation":"delta","path":"/角色/等级","value":${String(delta)}}]}`
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, session } as Agent
  await runRoleplayStagedStateSettlement({
    ctx: fake,
    agent,
    turn: 1,
    plan: { step: 2, plan },
    verificationModel: { provider: 'fast-fixture', model: 'verification-fixture' },
    signal: new AbortController().signal,
  })
  await runRoleplayStagedStateSettlement({
    ctx: fake,
    agent,
    turn: 1,
    plan: { step: 2, plan },
    signal: new AbortController().signal,
  })
  assert.equal(requestCount, 2)
  const requestText = requestTexts[0] ?? ''
  const requestSystem = requestSystems[0] ?? ''
  const verificationText = requestTexts[1] ?? ''
  const verificationSystem = requestSystems[1] ?? ''
  assert.match(requestSystem, /只返回一个 JSON 对象/u)
  assert.match(requestSystem, /回合、计数器、阶段和关联实体/u)
  assert.match(requestSystem, /字段名 op（不要写 operation）/u)
  assert.match(requestSystem, /从 <current_state> JSON 根开始的完整绝对 JSON Pointer/u)
  assert.match(requestText, /稳稳跨过两级门槛/u)
  assert.doesNotMatch(requestText, /确认自己已经跨过两级门槛/u)
  assert.doesNotMatch(requestText, /同一回合中已经结束的角色开场白/u)
  assert.doesNotMatch(requestText, /Current runtime context/u)
  assert.match(requestText, /变量更新规则/u)
  assert.match(verificationSystem, /独立状态核验器/u)
  assert.match(verificationSystem, /从 current_state 直接到核验后状态/u)
  assert.doesNotMatch(verificationText, /<proposal_operations>|<candidate_state>/u)
  assert.deepEqual(requestReasoning, ['off', 'low'])
  assert.deepEqual(requestMaxTokens, [4096, 4096])
  assert.deepEqual(requestModels, [
    { provider: 'fixture', model: 'fixture' },
    { provider: 'fast-fixture', model: 'verification-fixture' },
  ])
  assert.equal(session.events.filter(event => event.type === 'assistant/message').length, 3)
  const requestEvent = session.events.find(event => event.type === 'agent-rp/staged-state-request'
    && event.data.stage === 'proposal')
  assert.equal(requestEvent?.type, 'agent-rp/staged-state-request')
  if (requestEvent?.type !== 'agent-rp/staged-state-request') assert.fail('staged request was not recorded')
  assert.equal(JSON.stringify(requestEvent.data.dispatch.messages), requestText)
  assert.equal(requestEvent.data.dispatch.system, requestSystem)
  const requestBlock = requestEvent.data.dispatch.messages[0]?.content[0]
  assert.equal(requestBlock?.type, 'text')
  if (requestBlock?.type !== 'text') assert.fail('staged request text was not recorded')
  const requestBody = requestBlock.text
  assert.equal(/<player_input>\n([\s\S]*?)\n<\/player_input>/u.exec(requestBody)?.[1], '今晚的修行让我进步了。')
  assert.equal(
    /<roleplay_reply>\n([\s\S]*?)\n<\/roleplay_reply>/u.exec(requestBody)?.[1],
    '白露合上修行笔记，确认自己已经稳稳跨过两级门槛。',
  )
  assert.ok(requestBody.indexOf('<imported_state_rules>') < requestBody.indexOf('<current_state>'))
  assert.ok(requestBody.indexOf('<current_state>') < requestBody.indexOf('<player_input>'))
  assert.ok(requestBody.indexOf('<player_input>') < requestBody.indexOf('<roleplay_reply>'))
  const proposalResult = session.events.find(event => event.type === 'agent-rp/staged-state-result'
    && event.data.requestSeq === requestEvent.seq)
  const verificationRequest = session.events.find(event => event.type === 'agent-rp/staged-state-request'
    && event.data.stage === 'verification')
  assert.equal(proposalResult?.type, 'agent-rp/staged-state-result')
  assert.equal(verificationRequest?.type, 'agent-rp/staged-state-request')
  if (proposalResult?.type !== 'agent-rp/staged-state-result'
    || verificationRequest?.type !== 'agent-rp/staged-state-request') {
    assert.fail('staged verification chain was not recorded')
  }
  assert.equal(proposalResult.data.result.kind, 'success')
  if (proposalResult.data.result.kind !== 'success') assert.fail('staged proposal unexpectedly failed')
  assert.deepEqual(proposalResult.data.result.operations, [{ op: 'delta', path: '/角色/等级', value: 1 }])
  assert.throws(() => collectRoleplayStagedStateSettlement({
    events: session.events.slice(0, proposalResult.seq + 1),
    sessionId: String(session.id),
    turn: 1,
    plans: [reference],
  }), /no independent verification/u)
  const legacyRequest = {
    ...requestEvent,
    data: { ...requestEvent.data, stage: undefined },
  } as SessionEvent<'agent-rp/staged-state-request'>
  const legacyEvents = session.events.slice(0, proposalResult.seq + 1).map(event =>
    event.seq === legacyRequest.seq ? legacyRequest : event)
  assert.deepEqual(collectRoleplayStagedStateSettlement({
    events: legacyEvents,
    sessionId: String(session.id),
    turn: 1,
    plans: [reference],
  })?.operations, [{ op: 'delta', path: '/角色/等级', value: 1 }])
  assert.equal(verificationRequest.data.proposalResultSeq, proposalResult.seq)
  const staged = collectRoleplayStagedStateSettlement({
    events: session.events,
    sessionId: String(session.id),
    turn: 1,
    plans: [reference],
  })
  assert.equal(staged?.outcome, 'success')
  if (staged === undefined) assert.fail('staged verification was not collected')
  assert.deepEqual(staged?.operations, [{ op: 'delta', path: '/角色/等级', value: 2 }])
  const verificationResult = session.events[staged.resultEventSeq]
  assert.equal(verificationResult?.type, 'agent-rp/staged-state-result')
  if (verificationResult?.type !== 'agent-rp/staged-state-result') {
    assert.fail('staged verification result was not recorded')
  }
  const failedVerification = {
    ...verificationResult,
    data: {
      ...verificationResult.data,
      result: { kind: 'failure' as const, failure: 'aborted' as const },
    },
  }
  const failedEvents = session.events.map(event =>
    event.seq === failedVerification.seq ? failedVerification : event)
  assert.deepEqual(collectRoleplayStagedStateSettlement({
    events: failedEvents,
    sessionId: String(session.id),
    turn: 1,
    plans: [reference],
  }), {
    requestEventSeq: verificationRequest.seq,
    resultEventSeq: failedVerification.seq,
    throughEventSeq: verificationRequest.data.throughEventSeq,
    target: verificationRequest.data.target,
    outcome: 'failed',
    operations: [],
    error: '后台状态结算失败（aborted）',
  })
  assert.equal(session.events[record.seq]?.type, 'agent-rp/turn-plan')

  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 1,
    presentations: 1,
    turns: [1],
  })
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 3, 称号: '学徒' } },
    updateCount: 1,
    source: {
      kind: 'agent-action',
      turn: 1,
      resultEventSeqs: [staged!.resultEventSeq],
    },
  })
  assert.equal(readRoleplayTurnSettlements(session.events)[0]?.reply?.eventSeq, reviewedNarrative.seq)
  assert.equal(collectRoleplayStagedStateSettlement({
    events: session.events,
    sessionId: String(session.id),
    turn: 2,
    plans: [],
  }), undefined)
})

test('state verification follows the session model until the player selects another route', () => {
  const sessionModel = { provider: 'session-provider', model: 'session-model' }
  assert.deepEqual(resolveRoleplayStateVerificationModel(sessionModel, null), sessionModel)
  assert.deepEqual(resolveRoleplayStateVerificationModel(sessionModel, {
    provider: 'worker-provider', model: 'worker-model',
  }), { provider: 'worker-provider', model: 'worker-model' })
})

async function emptyStagedSettlementFixture(input: {
  readonly id: string
  readonly previousError?: string
  readonly verification: 'success' | 'failure'
}) {
  const { card, session } = cardSession(input.id, 'agent')
  if (input.previousError !== undefined) {
    appendMvuState(session, {
      statData: { 角色: { 等级: 1, 称号: '学徒' } },
      updateCount: 0,
      lastError: input.previousError,
    })
  }
  const { plan } = beginTurn(session)
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8192 } },
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '白露检查了一遍，状态没有发生变化。' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 1 })
  let requestCount = 0
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream() {
        requestCount += 1
        return (async function* () {
          const text = requestCount === 2 && input.verification === 'failure'
            ? 'not a state result'
            : '{"operations":[]}'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const outcome = await runRoleplayStagedStateSettlement({
    ctx: fake,
    agent: { id: session.id, session } as Agent,
    turn: 1,
    plan: { step: 1, plan },
    signal: new AbortController().signal,
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const recovery = recoverSessionRoleplayTurns({ session, deployment })
  return { card, session, outcome, recovery }
}

test('clears a previous state error after a verified unchanged settlement', async () => {
  const { card, session, outcome, recovery } = await emptyStagedSettlementFixture({
    id: 'staged-state-clears-error',
    previousError: '后台状态结算失败（unknown）',
    verification: 'success',
  })

  assert.equal(outcome.outcome, 'unchanged')
  assert.deepEqual(recovery, { settlements: 1, presentations: 1, turns: [1] })
  const result = session.events.findLast(event => event.type === 'agent-rp/staged-state-result')
  assert.equal(result?.type, 'agent-rp/staged-state-result')
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 1, 称号: '学徒' } },
    updateCount: 0,
    source: { kind: 'agent-action', turn: 1, resultEventSeqs: [result!.seq] },
  })
  assert.equal(session.events.filter(event => event.type === 'agent-rp/mvu-state').length, 2)
  const cleared = session.events.findLast(event => event.type === 'agent-rp/mvu-state')
  assert.equal(cleared?.type, 'agent-rp/mvu-state')
  const interrupted = Session.create(session.id, session.events.slice(0, cleared!.seq + 1))
  assert.deepEqual(recoverSessionRoleplayTurns({ session: interrupted, deployment }), {
    settlements: 1, presentations: 1, turns: [1],
  })
  assert.equal(interrupted.events.filter(event => event.type === 'agent-rp/mvu-state').length, 2)
  assert.deepEqual(recoverSessionRoleplayTurns({ session, deployment }), {
    settlements: 0, presentations: 0, turns: [],
  })
})

test('does not append an MVU snapshot for an unchanged settlement without an old error', async () => {
  const { card, session, outcome } = await emptyStagedSettlementFixture({
    id: 'staged-state-remains-unchanged',
    verification: 'success',
  })

  assert.equal(outcome.outcome, 'unchanged')
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 1, 称号: '学徒' } },
    updateCount: 0,
  })
  assert.equal(session.events.some(event => event.type === 'agent-rp/mvu-state'), false)
})

test('keeps a genuine staged state failure visible', async () => {
  const { card, session, outcome } = await emptyStagedSettlementFixture({
    id: 'staged-state-keeps-failure',
    verification: 'failure',
  })

  assert.equal(outcome.outcome, 'failed')
  assert.deepEqual(readCurrentSessionMvuState(card, session), {
    statData: { 角色: { 等级: 1, 称号: '学徒' } },
    updateCount: 0,
    lastError: '后台状态结算失败（unknown）',
    source: {
      kind: 'agent-action',
      turn: 1,
      resultEventSeqs: [session.events.findLast(event => event.type === 'agent-rp/staged-state-result')!.seq],
    },
  })
})
