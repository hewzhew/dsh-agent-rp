import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type GenerateOptions,
  type Message,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import type { ImportedCharacterCard, ImportedRegexScript } from '../src/import/types.ts'
import { roleplayVisibleDialogue, roleplayVisibleTranscript } from '../src/prompt.ts'
import {
  applyPromptRegexSurface,
  installAgentPromptRegexStream,
  installPromptRegexStream,
} from '../src/prompt-regex-stream.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import type {
  RoleplayPromptRegexTransform,
  RoleplayPromptTransformPlan,
  RoleplayTurnPromptPlan,
} from '../src/roleplay-turn-plan.ts'

const script = (placement: number, findRegex: string, replaceString: string): ImportedRegexScript => ({
  scriptName: `${placement}:${findRegex}`,
  findRegex,
  replaceString,
  trimStrings: [],
  placement: [placement],
  disabled: false,
  markdownOnly: false,
  promptOnly: true,
  runOnEdit: false,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
})

function card(regexScripts: readonly ImportedRegexScript[]): ImportedCharacterCard {
  return {
    format: 0,
    version: 3,
    specVersion: '3.0',
    name: '测试角色',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    messageExample: '',
    alternateGreetings: [],
    systemPrompt: '',
    postHistoryInstructions: '',
    frontend: { regexScripts, tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {} },
    degradations: [],
    raw: {},
  }
}

function persistableCard(regexScripts: readonly ImportedRegexScript[]): ImportedCharacterCard {
  return parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '测试角色', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [],
      creator: 'fixture', character_version: '1', extensions: { regex_scripts: regexScripts },
    },
  }))
}

function transformPlan(
  actorScripts: readonly ImportedRegexScript[],
  promptPolicyScripts: readonly ImportedRegexScript[] = [],
): RoleplayPromptTransformPlan {
  const operation = (
    value: ImportedRegexScript,
    owner: RoleplayPromptRegexTransform['owner'],
    ownerIndex: number,
  ): RoleplayPromptRegexTransform => ({
    engine: 'regex-v0',
    owner,
    ownerIndex,
    name: value.scriptName,
    pattern: value.findRegex,
    replacement: value.replaceString,
    trim: value.trimStrings,
    placements: value.placement.flatMap(placement => placement === 1
      ? ['user-input' as const] : placement === 2 ? ['assistant-output' as const] : []),
    enabled: !value.disabled,
    phase: value.promptOnly ? 'prompt-only' : 'shared',
    identitySubstitution: 'none',
  })
  return {
    actorName: '测试角色',
    participantName: '用户',
    operations: [
      ...promptPolicyScripts.map((value, index) => operation(value, 'prompt-policy', index)),
      ...actorScripts.map((value, index) => operation(value, 'actor', index)),
    ],
  }
}

function promptPlan(overrides: Partial<RoleplayTurnPromptPlan> = {}): RoleplayTurnPromptPlan {
  return {
    beforeHistory: [],
    afterHistory: [],
    inChat: [],
    includeHistory: true,
    systemPromptText: '',
    transforms: transformPlan([]),
    diagnostics: { enabledModules: 0, unsupportedMacros: 0, templateFailures: 0 },
    ...overrides,
  }
}

function textHistory(session: Session): string[] {
  return session.deriveMessages().flatMap(message =>
    message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

function openConversation(): Session {
  const session = Session.create(SessionId('prompt-regex'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'secret one' }],
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'mock', model: 'mock' },
      content: [{ type: 'text', text: 'old answer' }],
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'secret two' }],
  }), { surfaceOp: 'append' })
  return session
}

function openCardConversation(active: ImportedCharacterCard): Session {
  const seed = createCharacterCardSessionSeed(active, {
    kind: 'file',
    attachmentId: AttachmentId('sha256:prompt-regex-live-card'),
    bytes: 100,
    name: 'live.json',
    mediaType: 'application/json',
  }, 0, '')
  const session = Session.create(SessionId('prompt-regex-live-card'), seed)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'secret' }],
  }), { surfaceOp: 'append' })
  return session
}

function openFailedToolContinuation(): {
  readonly session: Session
  readonly assistantId: string
  readonly callId: string
} {
  const session = Session.create(SessionId('prompt-regex-failed-tool'))
  const callId = ToolCallId('failed-image-call')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: '请继续剧情' }],
  }), { surfaceOp: 'append' })
  const assistant = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'mock', model: 'mock' },
      content: [
        { type: 'text', text: 'tool answer' },
        { type: 'tool-call', id: callId, name: 'generate_roleplay_image', arguments: '{}' },
      ],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'generate_roleplay_image', arguments: '{}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'Error: 图片服务没有配置' }],
      isError: true,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  return { session, assistantId: String(assistant.data.message.id), callId: String(callId) }
}

function toolPair(messages: readonly Message[], callId: string): {
  readonly assistantIndex: number
  readonly resultIndex: number
} {
  const assistantIndex = messages.findIndex(message => message.content.some(block =>
    block.type === 'tool-call' && String(block.id) === callId))
  const resultIndex = messages.findIndex(message => message.content.some(block =>
    block.type === 'tool-result' && String(block.toolCallId) === callId))
  return { assistantIndex, resultIndex }
}

test('logs prompt-only replacements while the visible projection keeps append-origin text', () => {
  const session = openConversation()
  const active = card([
    script(1, '/secret/gu', 'masked'),
    script(2, '/old/gu', 'prior'),
  ])

  const first = applyPromptRegexSurface(session, transformPlan(active.frontend.regexScripts))
  assert.equal(first?.replacementCount, 3)
  assert.deepEqual(textHistory(session), ['masked one', 'prior answer', 'masked two'])
  assert.deepEqual(roleplayVisibleDialogue(session), ['secret one', 'old answer', 'secret two'])
  assert.deepEqual(roleplayVisibleTranscript(session), [
    { role: 'user', content: 'secret one' },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'secret two' },
  ])
  assert.deepEqual(first?.scripts.map(item => [item.outcome, item.affectedMessages]), [
    ['applied', 2],
    ['applied', 1],
  ])

  const second = applyPromptRegexSurface(session, transformPlan(active.frontend.regexScripts))
  assert.equal(second?.replacementCount, 0)
  assert.deepEqual(textHistory(session), ['masked one', 'prior answer', 'masked two'])
  assert.equal(session.events.some(event => String(event.type) === 'agent-rp/prompt-regex-trace'), false)

  const reopened = Session.create(SessionId('prompt-regex-reopened'), session.events)
  assert.deepEqual(textHistory(reopened), ['masked one', 'prior answer', 'masked two'])

  let state = agentRpProjectionDefinition.init(reopened.header)
  for (const event of reopened.events) state = agentRpProjectionDefinition.apply(state, event)
  assert.deepEqual(state.surface.map(message => message.text), ['secret one', 'old answer', 'secret two'])
  const projection = agentRpProjectionDefinition.wire.view(state)
  assert.deepEqual(projection.promptRegex, second)

  const restored = applyPromptRegexSurface(session, transformPlan([]))
  assert.equal(restored?.replacementCount, 3)
  assert.deepEqual(textHistory(session), ['secret one', 'old answer', 'secret two'])
})

test('preserves shared-before-prompt-only execution across semantic resource owners', () => {
  const session = openConversation()
  const sharedActor = { ...script(1, '/secret/gu', 'stage'), promptOnly: false }
  const promptPolicy = script(1, '/stage/gu', 'prepared')

  const trace = applyPromptRegexSurface(session, transformPlan([sharedActor], [promptPolicy]))

  assert.deepEqual(textHistory(session), ['prepared one', 'old answer', 'prepared two'])
  assert.deepEqual(trace?.scripts.map(item => [item.source, item.index, item.outcome]), [
    ['preset', 0, 'applied'],
    ['character', 0, 'applied'],
  ])
})

test('records a no-op trace without rewriting a tool-call assistant in the following step', () => {
  const { session, assistantId, callId } = openFailedToolContinuation()

  const trace = applyPromptRegexSurface(session, transformPlan([
    script(2, '/not-present/gu', 'unused'),
  ]))

  assert.equal(trace?.replacementCount, 0)
  const messages = session.deriveMessages()
  const pair = toolPair(messages, callId)
  assert.equal(pair.resultIndex, pair.assistantIndex + 1)
  assert.equal(String(messages[pair.assistantIndex]?.id), assistantId)
  assert.equal(session.events.some(event => event.type === 'assistant/message'
    && event.data.step === 2), false)
  let state = agentRpProjectionDefinition.init(session.header)
  for (const event of session.events) state = agentRpProjectionDefinition.apply(state, event)
  assert.deepEqual(agentRpProjectionDefinition.wire.view(state).promptRegex, trace)
})

test('preserves a failed tool pair when prompt regex changes its assistant text', () => {
  const { session, assistantId, callId } = openFailedToolContinuation()

  const trace = applyPromptRegexSurface(session, transformPlan([
    script(2, '/tool/gu', 'changed'),
  ]))

  assert.equal(trace?.replacementCount, 1)
  const messages = session.deriveMessages()
  const pair = toolPair(messages, callId)
  assert.equal(pair.resultIndex, pair.assistantIndex + 1)
  assert.notEqual(String(messages[pair.assistantIndex]?.id), assistantId)
  assert.deepEqual(messages[pair.assistantIndex]?.content.map(block => block.type === 'text'
    ? [block.type, block.text] : block.type === 'tool-call'
      ? [block.type, String(block.id)] : [block.type]), [
    ['text', 'changed answer'],
    ['tool-call', callId],
  ])
})

test('routes a continuation-only plan through the final provider message seam', () => {
  type StreamHandler = (options: GenerateOptions, next: () => unknown) => unknown
  let handler: StreamHandler | undefined
  let captured: GenerateOptions | undefined
  let calledNext = false
  const ctx = {
    on(event: string, callback: StreamHandler) {
      assert.equal(event, 'llm/stream')
      handler = callback
    },
    llm: {
      stream(options: GenerateOptions) {
        captured = options
        return undefined
      },
    },
  } as unknown as Context
  const session = Session.create(SessionId('continuation-provider-seam'))
  const agent = { session } as Agent
  installPromptRegexStream(ctx, () => agent, () => promptPlan({
    continuation: { prefill: true, postfix: ' ', nudgePrompt: '不应发送' },
  }))
  const options = Object.freeze({
    provider: 'mock',
    model: 'mock',
    sessionId: session.id,
    messages: [
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请开始' }] }),
      createAssistantMessage({
        source: { provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: '上一段回复' }],
      }),
      createUserMessage({
        source: {
          kind: 'plugin', plugin: 'dsh-agent-rp-generation', operation: 'continue',
          form: 'notice', summary: '正在续写',
        } as never,
        content: [{ type: 'text', text: '通用续写指令' }],
      }),
    ],
  }) as GenerateOptions

  assert.ok(handler)
  handler(options, () => {
    calledNext = true
    return undefined
  })
  assert.equal(calledNext, false)
  assert.deepEqual(captured?.messages.map(item => [
    item.role, item.content[0]?.type === 'text' ? item.content[0].text : '',
  ]), [
    ['user', '请开始'],
    ['assistant', '上一段回复 '],
  ])
})

test('installs provider preparation on the exact LLM service context', () => {
  type StreamHandler = (options: GenerateOptions, next: () => unknown) => unknown
  let handler: StreamHandler | undefined
  let captured: GenerateOptions | undefined
  const llmCtx = {
    on(event: string, callback: StreamHandler) {
      assert.equal(event, 'llm/stream')
      handler = callback
      return () => {}
    },
    llm: {
      stream(options: GenerateOptions) {
        captured = options
        return undefined
      },
    },
  } as unknown as Context
  const agentCtx = {
    llm: { ctx: llmCtx },
    effect(install: () => () => void) { install() },
    on() { throw new Error('listener installed on the Agent composition context') },
  } as unknown as Context
  const session = Session.create(SessionId('agent-owned-provider-seam'))
  const agent = { ctx: agentCtx, session } as Agent
  installAgentPromptRegexStream(agent, () => promptPlan({
    inChat: [{ role: 'system', content: 'Agent 根提示', depth: 0, order: 100 }],
  }))

  assert.ok(handler)
  handler(Object.freeze({
    provider: 'mock',
    model: 'mock',
    sessionId: session.id,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '请开始' }],
    })],
  }) as GenerateOptions, () => undefined)
  assert.deepEqual(captured?.messages.map(item => [
    item.role, item.content[0]?.type === 'text' ? item.content[0].text : '',
  ]), [
    ['user', '请开始'],
    ['system', 'Agent 根提示'],
  ])
})

test('executes only the frozen source-neutral transform plan for a cardless Session', () => {
  type StreamHandler = (options: GenerateOptions, next: () => unknown) => unknown
  let handler: StreamHandler | undefined
  let captured: GenerateOptions | undefined
  const ctx = {
    on(_event: string, callback: StreamHandler) { handler = callback },
    llm: { stream(options: GenerateOptions) { captured = options } },
  } as unknown as Context
  const session = openConversation()
  const agent = { session } as Agent
  const frozen = transformPlan([script(1, '/secret/gu', 'frozen')])
  installPromptRegexStream(ctx, () => agent, () => promptPlan({ transforms: frozen }))
  const options = Object.freeze({
    provider: 'mock', model: 'mock', sessionId: session.id, messages: session.deriveMessages(),
  }) as GenerateOptions

  assert.ok(handler)
  handler(options, () => undefined)

  assert.deepEqual(captured?.messages.flatMap(message => message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])), [
    'frozen one', 'old answer', 'frozen two',
  ])
  assert.deepEqual(roleplayVisibleDialogue(session), ['secret one', 'old answer', 'secret two'])
})

test('does not reread a changed card after the turn plan was prepared', () => {
  type StreamHandler = (options: GenerateOptions, next: () => unknown) => unknown
  let handler: StreamHandler | undefined
  let captured: GenerateOptions | undefined
  const ctx = {
    on(_event: string, callback: StreamHandler) { handler = callback },
    llm: { stream(options: GenerateOptions) { captured = options } },
  } as unknown as Context
  const session = openCardConversation(persistableCard([script(1, '/secret/gu', 'changed-source')]))
  const agent = { session } as Agent
  const frozen = transformPlan([script(1, '/secret/gu', 'prepared-plan')])
  installPromptRegexStream(ctx, () => agent, () => promptPlan({ transforms: frozen }))

  assert.ok(handler)
  handler(Object.freeze({
    provider: 'mock', model: 'mock', sessionId: session.id, messages: session.deriveMessages(),
  }) as GenerateOptions, () => undefined)

  assert.deepEqual(captured?.messages.flatMap(message => message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])), ['prepared-plan'])
})

test('does not invent an adapter transform when no prepared plan exists', () => {
  type StreamHandler = (options: GenerateOptions, next: () => unknown) => unknown
  let handler: StreamHandler | undefined
  let calledNext = false
  const ctx = { on(_event: string, callback: StreamHandler) { handler = callback } } as unknown as Context
  const session = openCardConversation(persistableCard([script(1, '/secret/gu', 'unprepared')]))
  installPromptRegexStream(ctx, () => ({ session }) as Agent)

  assert.ok(handler)
  handler(Object.freeze({
    provider: 'mock', model: 'mock', sessionId: session.id, messages: session.deriveMessages(),
  }) as GenerateOptions, () => { calledNext = true })

  assert.equal(calledNext, true)
  assert.deepEqual(textHistory(session), ['secret'])
})
