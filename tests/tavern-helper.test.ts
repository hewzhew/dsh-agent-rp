import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { AGENT_RP_CAPABILITIES } from '../src/extension-capability.ts'
import {
  applyTavernHelperMutation,
  decodeActiveTavernHelperState,
  decodeTavernHelperState,
  decodeTavernHelperStateAttachment,
  encodeTavernHelperState,
  encodeTavernHelperStateAttachment,
  initializeTavernHelperState,
  initializeTavernHelperPresetState,
  parseTavernHelperMutationRequest,
  readTavernHelperStateSnapshot,
  readTavernHelperStateSnapshotAt,
  tavernInjectedInChatPrompts,
  tavernInjectedScanText,
} from '../src/tavern-helper.ts'
import { activeTavernWorldbooks, withTavernWorldbooks } from '../src/world-info-configuration-core.ts'
import {
  runTavernGeneration,
  runTavernPromptPreview,
  tavernChatCompletionsEndpoint,
} from '../src/tavern-generation-http.ts'
import { tavernModelListEndpoint } from '../src/tavern-model-list-http.ts'
import {
  advanceTavernTranscript,
  tavernMessageDepth,
  tavernReasoningExtra,
  type TavernScriptSnapshot,
} from '../src/client/tavern-runtime.ts'
import { tavernMutationMatchesCapability } from '../src/client/tavern-capability.ts'
import { summarizeTavernAuxiliaryGenerations } from '../src/tavern-generation-log.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import { tavernScriptIdentity } from '../src/tavern-script-identity.ts'
import { executeTavernHelperMutation } from '../src/tavern-helper-command.ts'
import { encodeGenerationState } from '../src/generation.ts'
import { readTavernMessageAnnotations } from '../src/tavern-message-annotation.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { inspectLorebook } from '../src/import/lorebook.ts'
import { sessionEvents } from '../src/session-events.ts'

function captureAgentRpEvents(session: Session): SessionEvent[] {
  const events: SessionEvent[] = []
  const writer = session as Session & { appendIgnorable(...args: unknown[]): SessionEvent }
  const appendIgnorable = writer.appendIgnorable.bind(writer)
  Object.defineProperty(writer, 'appendIgnorable', {
    configurable: true,
    value(...args: unknown[]) {
      const event = appendIgnorable(...args)
      if (event.type.startsWith('agent-rp/')) events.push(event)
      return event
    },
  })
  return events
}

function auxiliaryEvent(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq + 1, data } as unknown as SessionEvent
}

function auxiliaryRequestData(requestId: string): Readonly<Record<string, unknown>> {
  return {
    format: 0,
    requestId,
    mode: 'raw',
    dispatch: { kind: 'host-model', provider: 'fixture', model: 'fixture', messages: [] },
  }
}

function runtimeMessage(
  messageId: number,
  seq: number,
  role: 'user' | 'assistant',
  text: string,
): TavernScriptSnapshot['messages'][number] {
  return { messageId, seq, role, text, isHidden: false, data: {}, extra: {} }
}

test('projects model reasoning without exposing it as visible transcript text', () => {
  const session = Session.create(SessionId('reasoning-projection'))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [
        { type: 'reasoning', text: '<dream_plot>隐藏推理</dream_plot>' },
        { type: 'text', text: '可见正文' },
      ],
    }),
  }, { surfaceOp: 'append' })
  let state = agentRpProjectionDefinition.init(session.header, session.inheritedEventCount)
  for (const event of sessionEvents(session)) state = agentRpProjectionDefinition.apply(state, event)

  assert.deepEqual(state.surface, [{
    seq: 0,
    text: '可见正文',
    reasoning: '<dream_plot>隐藏推理</dream_plot>',
    role: 'assistant',
  }])
  assert.deepEqual(tavernReasoningExtra(state.surface[0]?.reasoning), {
    reasoning: '<dream_plot>隐藏推理</dream_plot>',
    reasoning_content: '<dream_plot>隐藏推理</dream_plot>',
  })
  assert.deepEqual(tavernReasoningExtra(undefined), {})
})

test('emits only transcript messages appended after the established runtime baseline', () => {
  const history = [
    runtimeMessage(0, 4, 'user', '旧提问'),
    runtimeMessage(1, 7, 'assistant', '旧回复'),
  ]
  const initial = advanceTavernTranscript(undefined, history)
  assert.deepEqual(initial.appended, [])

  const user = runtimeMessage(2, 9, 'user', '新提问')
  const afterUser = advanceTavernTranscript(initial.cursor, [...history, user])
  assert.deepEqual(afterUser.appended, [user])

  const assistant = runtimeMessage(3, 14, 'assistant', '新回复')
  const afterAssistant = advanceTavernTranscript(afterUser.cursor, [...history, user, assistant])
  assert.deepEqual(afterAssistant.appended, [assistant])
})

test('rebases transcript delivery after a rewrite instead of replaying visible history', () => {
  const history = [
    runtimeMessage(0, 2, 'user', '提问'),
    runtimeMessage(1, 5, 'assistant', '旧回复'),
  ]
  const initial = advanceTavernTranscript(undefined, history)
  const replacement = runtimeMessage(1, 8, 'assistant', '改写后的回复')
  const rewritten = advanceTavernTranscript(initial.cursor, [history[0]!, replacement])
  assert.deepEqual(rewritten.appended, [])

  const next = runtimeMessage(2, 11, 'user', '继续')
  assert.deepEqual(advanceTavernTranscript(rewritten.cursor, [history[0]!, replacement, next]).appended, [next])
})

test('computes regex depth from Tavern messages rather than Host flow nodes', () => {
  const messages = [{ messageId: 2 }, { messageId: 7 }, { messageId: 11 }]

  assert.equal(tavernMessageDepth(messages, 11), 0)
  assert.equal(tavernMessageDepth(messages, 7), 1)
  assert.equal(tavernMessageDepth(messages, 2), 2)
  assert.equal(tavernMessageDepth(messages, 99), undefined)
})

test('resolves OpenAI-compatible custom generation endpoints without retaining query credentials', () => {
  assert.equal(tavernChatCompletionsEndpoint('https://example.com/v1').href,
    'https://example.com/v1/chat/completions')
  assert.equal(tavernChatCompletionsEndpoint('https://example.com/v1/models?token=secret').href,
    'https://example.com/v1/chat/completions')
  assert.equal(tavernChatCompletionsEndpoint('http://127.0.0.1:11434/v1/chat/completions').href,
    'http://127.0.0.1:11434/v1/chat/completions')
  assert.throws(() => tavernChatCompletionsEndpoint('file:///generate'), /HTTP 或 HTTPS/u)
  assert.throws(() => tavernChatCompletionsEndpoint('https://user:secret@example.com/v1'), /账号或密码/u)
})

test('forwards one approved custom generation without retaining chat history at depth zero', async () => {
  const session = Session.create(SessionId('custom-generation'))
  const auditEvents = captureAgentRpEvents(session)
  session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: '不应发送的历史' }],
  }), { surfaceOp: 'append' })
  const agent = {
    session,
    options: { model: 'fallback-model' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  let requested: {
    readonly url: string
    readonly authorization: string | null
    readonly trace: string | null
    readonly body: unknown
  } | undefined
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    requested = {
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      trace: new Headers(init?.headers).get('x-v18-trace'),
      body: JSON.parse(String(init?.body)) as unknown,
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '辅助结果' } }] }), {
      headers: { 'content-type': 'application/json' }, status: 200,
    })
  }
  try {
    const ctx = {
      get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
      systemPrompt: {
        assemble: async () => ({
          sections: [{ name: 'base', text: 'DSH base' }], contexts: [], tools: [], variables: {},
        }),
      },
      llm: { stream: () => { throw new Error('preview contacted the DSH model') } },
      sessions: { flush: async () => true },
    } as never
    const request = {
      format: 0,
      sessionId: 'custom-generation',
      mode: 'raw',
      config: {
        user_input: '只发送当前任务',
        max_chat_history: 0,
        ordered_prompts: [{ role: 'system', content: '辅助系统提示' }, 'chat_history', 'user_input'],
        custom_api: {
          apiurl: 'https://example.com/v1?token=discarded', key: 'test-key', model: 'custom-model', source: 'openai',
          max_tokens: 321, temperature: 0.4, top_p: 0.8, frequency_penalty: -0.2, presence_penalty: 0.3,
          custom_include_body: [
            'top_k: 24',
            'response_options:',
            '  include_usage: true',
            'model: ignored-model',
            'stream: true',
          ].join('\n'),
          custom_exclude_body: ['temperature', 'model', 'stream'],
          custom_include_headers: JSON.stringify({ Authorization: 'Bearer hook-key', 'X-V18-Trace': 18 }),
        },
      },
    } as const
    const preview = await runTavernPromptPreview(ctx, request)
    assert.equal(requested, undefined)
    assert.deepEqual(preview, {
      format: 0,
      prompts: [
        { role: 'system', content: '辅助系统提示' },
        { role: 'user', content: '只发送当前任务' },
      ],
    })
    const result = await runTavernGeneration(ctx, request)
    assert.equal(result.text, '辅助结果')
    assert.equal(auditEvents.length, 2)
    assert.equal(auditEvents[0]?.type, 'agent-rp/tavern-generation-request')
    assert.equal(auditEvents[1]?.type, 'agent-rp/tavern-generation-result')
    const auditText = JSON.stringify(auditEvents)
    assert.doesNotMatch(auditText, /test-key|hook-key/u)
    assert.match(auditText, /"origin":"https:\/\/example\.com"/u)
    assert.match(auditText, /"pathname":"\/v1\/chat\/completions"/u)
    assert.match(auditText, /"text":"辅助结果"/u)
    assert.deepEqual(requested, {
      url: 'https://example.com/v1/chat/completions',
      authorization: 'Bearer hook-key',
      trace: '18',
      body: {
        model: 'custom-model',
        messages: [
          { role: 'system', content: '辅助系统提示' },
          { role: 'user', content: '只发送当前任务' },
        ],
        stream: false,
        max_tokens: 321,
        top_p: 0.8,
        frequency_penalty: -0.2,
        presence_penalty: 0.3,
        top_k: 24,
        response_options: { include_usage: true },
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('logs the exact Host model request before auxiliary dispatch', async () => {
  const session = Session.create(SessionId('host-generation'))
  const auditEvents = captureAgentRpEvents(session)
  const agent = {
    session,
    options: { provider: 'fixture-provider', model: 'fixture-model', maxTokens: 456 },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  let dispatched: Readonly<Record<string, unknown>> | undefined
  const result = await runTavernGeneration({
    get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
    systemPrompt: {
      assemble: async () => ({
        sections: [{ name: 'base', text: '角色设定' }], contexts: [], tools: [], variables: {},
      }),
    },
    sessions: { flush: async () => true },
    llm: {
      stream(options: Readonly<Record<string, unknown>>) {
        dispatched = options
        return (async function* () {
          yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
          yield { type: 'text-delta' as const, index: 0, text: 'Host 辅助结果' }
          yield { type: 'block-end' as const, index: 0, block: { type: 'text' as const, text: 'Host 辅助结果' } }
          yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
        })()
      },
    },
  } as never, {
    format: 0,
    sessionId: 'host-generation',
    mode: 'preset',
    config: { user_input: '只处理这一项', max_tokens: 123, temperature: 0.25 },
  })

  assert.equal(result.text, 'Host 辅助结果')
  assert.equal(dispatched?.provider, 'fixture-provider')
  assert.equal(dispatched?.model, 'fixture-model')
  assert.equal(dispatched?.sessionId, 'host-generation')
  assert.equal(dispatched?.maxTokens, 123)
  assert.equal(dispatched?.temperature, 0.25)
  assert.equal(auditEvents.length, 2)
  const requestEvent = auditEvents[0]
  const resultEvent = auditEvents[1]
  if (requestEvent?.type !== 'agent-rp/tavern-generation-request'
    || resultEvent?.type !== 'agent-rp/tavern-generation-result') {
    assert.fail('missing Tavern generation audit pair')
  }
  assert.deepEqual(requestEvent.data.dispatch, {
    kind: 'host-model',
    provider: 'fixture-provider',
    model: 'fixture-model',
    messages: dispatched?.messages,
    system: dispatched?.system,
    temperature: 0.25,
    maxTokens: 123,
  })
  assert.deepEqual(resultEvent.data.result, { kind: 'success', text: 'Host 辅助结果' })
})

test('rejects unsafe custom generation headers before contacting the model', async () => {
  const session = Session.create(SessionId('unsafe-custom-generation'))
  const agent = {
    session,
    options: { model: 'fallback-model' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  await assert.rejects(runTavernGeneration({
    get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
    systemPrompt: {
      assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
    },
  } as never, {
    format: 0,
    sessionId: 'unsafe-custom-generation',
    mode: 'raw',
    config: {
      user_input: '测试',
      custom_api: {
        apiurl: 'https://example.com/v1', model: 'custom-model',
        custom_include_headers: 'Host: attacker.example',
      },
    },
  }), /不允许设置 "Host"/u)
})

test('rejects auxiliary model text beyond the capability character limit', async () => {
  const session = Session.create(SessionId('oversized-generation-text'))
  const auditEvents = captureAgentRpEvents(session)
  const agent = {
    session,
    options: { model: 'fallback-model' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'x'.repeat(256 * 1024 + 1) } }],
  }), { headers: { 'content-type': 'application/json' }, status: 200 })
  try {
    await assert.rejects(runTavernGeneration({
      get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
      systemPrompt: { assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }) },
      sessions: { flush: async () => true },
    } as never, {
      format: 0,
      sessionId: 'oversized-generation-text',
      mode: 'raw',
      config: { user_input: '生成', custom_api: { apiurl: 'https://example.com/v1', model: 'custom-model' } },
    }), /模型返回文本过长/u)
    const resultEvent = auditEvents[1]
    if (resultEvent?.type !== 'agent-rp/tavern-generation-result') {
      assert.fail('missing Tavern generation failure audit')
    }
    assert.deepEqual(resultEvent.data.result, { kind: 'failure', failure: 'invalid-response' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects a complete prompt preview beyond its capability result limit', async () => {
  const session = Session.create(SessionId('oversized-prompt-preview'))
  const agent = {
    session,
    options: { model: 'test-model' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  await assert.rejects(runTavernPromptPreview({
    get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
    systemPrompt: {
      assemble: async () => ({
        sections: [{ name: 'large', text: '猫'.repeat(3 * 1024 * 1024) }],
        contexts: [], tools: [], variables: {},
      }),
    },
  } as never, {
    format: 0,
    sessionId: 'oversized-prompt-preview',
    mode: 'raw',
    config: { user_input: '预览' },
  }), /提示词预览结果过大/u)
})

test('cancels an active custom generation when its browser request closes', async () => {
  const session = Session.create(SessionId('cancel-custom-generation'))
  const auditEvents = captureAgentRpEvents(session)
  const agent = {
    session,
    options: { model: 'fallback-model' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  const originalFetch = globalThis.fetch
  let started: (() => void) | undefined
  const contacted = new Promise<void>(resolve => { started = resolve })
  globalThis.fetch = async (_input, init) => {
    started?.()
    await new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
    throw new Error('unreachable')
  }
  const controller = new AbortController()
  try {
    const running = runTavernGeneration({
      get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
      systemPrompt: {
        assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
      },
      sessions: { flush: async () => true },
    } as never, {
      format: 0,
      sessionId: 'cancel-custom-generation',
      mode: 'raw',
      config: {
        user_input: '等待取消',
        custom_api: { apiurl: 'https://example.com/v1', model: 'custom-model' },
      },
    }, controller.signal)
    await contacted
    controller.abort()
    await assert.rejects(running, /已取消或超时/u)
    assert.equal(auditEvents.length, 2)
    const resultEvent = auditEvents[1]
    if (resultEvent?.type !== 'agent-rp/tavern-generation-result') {
      assert.fail('missing Tavern generation cancellation audit')
    }
    assert.deepEqual(resultEvent.data.result, { kind: 'failure', failure: 'aborted' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('summarizes successful, failed, and pending auxiliary generations without content', () => {
  const events = [
    auxiliaryEvent('agent-rp/tavern-generation-request', 0, {
      ...auxiliaryRequestData('success'),
      dispatch: {
        kind: 'host-model', provider: 'fixture', model: 'fixture', messages: [], system: 'private prompt',
      },
    }),
    auxiliaryEvent('agent-rp/tavern-generation-result', 1, {
      format: 0, requestId: 'success', requestSeq: 0, result: { kind: 'success', text: 'private result' },
    }),
    auxiliaryEvent('agent-rp/tavern-generation-request', 2, auxiliaryRequestData('failure')),
    auxiliaryEvent('agent-rp/tavern-generation-result', 3, {
      format: 0, requestId: 'failure', requestSeq: 2, result: { kind: 'failure', failure: 'provider' },
    }),
    auxiliaryEvent('agent-rp/tavern-generation-request', 4, auxiliaryRequestData('pending')),
  ]
  const summary = summarizeTavernAuxiliaryGenerations(events)
  assert.deepEqual(summary, { requests: 3, succeeded: 1, failed: 1, pending: 1, malformed: 0 })
  assert.doesNotMatch(JSON.stringify(summary), /private|prompt|result/u)
  let state = agentRpProjectionDefinition.init(
    Session.create(SessionId('auxiliary-projection')).header,
    SessionLogOffset(0),
  )
  for (const event of events) state = agentRpProjectionDefinition.apply(state, event)
  assert.deepEqual(agentRpProjectionDefinition.wire.view(state).auxiliaryGenerations, summary)
})

test('counts broken auxiliary generation links without settling valid requests', () => {
  const events = [
    auxiliaryEvent('agent-rp/tavern-generation-request', 0, auxiliaryRequestData('settled')),
    auxiliaryEvent('agent-rp/tavern-generation-result', 1, {
      format: 0, requestId: 'settled', requestSeq: 0, result: { kind: 'success', text: 'ok' },
    }),
    auxiliaryEvent('agent-rp/tavern-generation-result', 2, {
      format: 0, requestId: 'settled', requestSeq: 0, result: { kind: 'failure', failure: 'provider' },
    }),
    auxiliaryEvent('agent-rp/tavern-generation-result', 3, {
      format: 0, requestId: 'missing', requestSeq: 99, result: { kind: 'failure', failure: 'unknown' },
    }),
    auxiliaryEvent('agent-rp/tavern-generation-request', 4, auxiliaryRequestData('settled')),
    auxiliaryEvent('agent-rp/tavern-generation-request', 5, auxiliaryRequestData('pending')),
    auxiliaryEvent('agent-rp/tavern-generation-result', 6, {
      format: 0, requestId: 'pending', requestSeq: 4, result: { kind: 'success', text: 'wrong link' },
    }),
  ]
  assert.deepEqual(summarizeTavernAuxiliaryGenerations(events), {
    requests: 2, succeeded: 1, failed: 0, pending: 1, malformed: 4,
  })
})

test('resolves OpenAI-compatible model list endpoints without retaining query credentials', () => {
  assert.equal(tavernModelListEndpoint('https://example.com/v1').href, 'https://example.com/v1/models')
  assert.equal(tavernModelListEndpoint('https://example.com/v1/chat/completions?token=secret').href,
    'https://example.com/v1/models')
  assert.equal(tavernModelListEndpoint('http://127.0.0.1:11434/v1/models').href,
    'http://127.0.0.1:11434/v1/models')
  assert.throws(() => tavernModelListEndpoint('file:///models'), /HTTP 或 HTTPS/u)
  assert.throws(() => tavernModelListEndpoint('https://user:secret@example.com/v1'), /账号或密码/u)
})

test('parses Tavern Helper chat mutation operations', () => {
  assert.deepEqual(parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'set-chat-messages', messages: [{ message_id: 2, message: '改写' }],
  })), { format: 0, operation: 'set-chat-messages', messages: [{ message_id: 2, message: '改写' }] })
  assert.deepEqual(parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'create-chat-messages', insert_at: -1,
    messages: [{ role: 'assistant', message: '插入' }],
  })), {
    format: 0, operation: 'create-chat-messages', insertAt: -1,
    messages: [{ role: 'assistant', message: '插入' }],
  })
  assert.deepEqual(parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'delete-chat-messages', messageIds: [1, 3],
  })), { format: 0, operation: 'delete-chat-messages', messageIds: [1, 3] })
  assert.deepEqual(parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'rotate-chat-messages', begin: 0, middle: 2, end: 4,
  })), { format: 0, operation: 'rotate-chat-messages', begin: 0, middle: 2, end: 4 })
  assert.deepEqual(parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'set-chat-hidden', start: 0, end: 8, hidden: true,
  })), { format: 0, operation: 'set-chat-hidden', start: 0, end: 8, hidden: true })
  assert.throws(() => parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'set-chat-hidden', start: 2, end: 1, hidden: true,
  })), /valid non-negative range/u)
})

test('keeps chat and World Info mutations on distinct Host capability actions', () => {
  for (const operation of [
    'set-chat-messages', 'create-chat-messages', 'delete-chat-messages', 'rotate-chat-messages', 'set-chat-hidden',
  ]) {
    assert.equal(tavernMutationMatchesCapability('chat-mutate', { operation }), true)
    assert.equal(tavernMutationMatchesCapability('worldbook-mutate', { operation }), false)
  }
  for (const operation of [
    'replace-worldbook', 'delete-worldbook', 'bind-global-worldbooks', 'bind-character-worldbooks', 'bind-chat-worldbook',
  ]) {
    assert.equal(tavernMutationMatchesCapability('worldbook-mutate', { operation }), true)
    assert.equal(tavernMutationMatchesCapability('chat-mutate', { operation }), false)
  }
  for (const request of [
    { scope: 'chat', variables: {} },
    { operation: 'replace-script-injections' },
    { operation: 'replace-script-trees' },
    null,
  ]) {
    assert.equal(tavernMutationMatchesCapability('worldbook-mutate', request), false)
    assert.equal(tavernMutationMatchesCapability('chat-mutate', request), false)
  }
})

test('round-trips the hidden Tavern prefix in durable script state', () => {
  const state = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'card-hidden')
  const decoded = decodeTavernHelperState(encodeTavernHelperState({
    ...state,
    hiddenPrefix: [
      { seq: 3, role: 'user', text: '旧问题' },
      { seq: 4, role: 'assistant', text: '旧回复' },
    ],
  }))
  assert.deepEqual(decoded?.hiddenPrefix, [
    { seq: 3, role: 'user', text: '旧问题' },
    { seq: 4, role: 'assistant', text: '旧回复' },
  ])
})

test('keeps inactive causal command attachments replayable without selecting their state', () => {
  const cause = { format: 0 as const, sessionId: 'causal-session', replySeq: 7 }
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'card-causal')
  const state = applyTavernHelperMutation(initial, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'chat', variables: { branch: 'older' }, cause,
  })))
  const activeText = encodeTavernHelperStateAttachment({ format: 0, cause, active: true, state })
  const inactiveText = encodeTavernHelperStateAttachment({ format: 0, cause, active: false, state })

  assert.deepEqual(decodeTavernHelperStateAttachment(inactiveText), {
    format: 0, cause, active: false, state,
  })
  assert.deepEqual(decodeActiveTavernHelperState(activeText), state)
  assert.equal(decodeActiveTavernHelperState(inactiveText), undefined)

  const session = Session.create(SessionId('causal-command-attachment'))
  const commandId = CommandId('causal-command')
  session.append('command/run', {
    commandId, name: 'rp-tavern-state', args: '{}', source: { kind: 'user' },
  })
  session.append('command/done', { commandId, kind: 'success', text: inactiveText })
  assert.equal(readTavernHelperStateSnapshot(sessionEvents(session)), undefined)
  assert.deepEqual(readTavernHelperStateSnapshotAt(sessionEvents(session), 1), { eventSeq: 1, state })

  let projected = agentRpProjectionDefinition.init(session.header, session.inheritedEventCount)
  for (const event of sessionEvents(session)) projected = agentRpProjectionDefinition.apply(projected, event)
  assert.equal(projected.tavern, undefined)
})

test('persists a causal script mutation through command/done on the published Host', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '兼容角色', description: '', personality: '', scenario: '', first_mes: '你好', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [],
      creator: 'fixture', character_version: '1.0', extensions: {},
    },
  }))
  const seed = createCharacterCardSessionSeed(card, {
    kind: 'file', attachmentId: AttachmentId('sha256:published-tavern-command'), bytes: 1,
    name: 'card.json', mediaType: 'application/json',
  }, 0, '你好')
  const session = Session.create(SessionId('published-tavern-command'), seed)
  const replySeq = session.surface.nodes.at(-1)
  assert.notEqual(replySeq, undefined)
  const commandId = CommandId('published-tavern-command-write')
  session.append('command/run', {
    commandId, name: 'rp-tavern-variables', source: { kind: 'user' },
  })
  const rawInput = JSON.stringify({
    format: 0,
    scope: 'chat',
    variables: { mood: 'calm' },
    cause: { format: 0, sessionId: String(session.id), replySeq },
  })

  const result = executeTavernHelperMutation({ agent: { session } as Agent, rawInput })
  assert.equal(typeof result.sourceEventSeq, 'number')
  assert.equal(result.text, undefined)
  assert.equal(sessionEvents(session)[result.sourceEventSeq!]?.type, 'agent-rp/tavern-state-attachment')
  session.append('command/done', { commandId, ...result })

  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/tavern-state-attachment'), true)
  assert.deepEqual(readTavernHelperStateSnapshot(sessionEvents(session))?.state.scopes.chat, { mood: 'calm' })
  const reopened = Session.create(SessionId('published-tavern-command-replay'), sessionEvents(session))
  assert.deepEqual(readTavernHelperStateSnapshot(sessionEvents(reopened)), readTavernHelperStateSnapshot(sessionEvents(session)))
})

test('keeps script-owned message annotations across reloads and reply-version selection', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '数据库验收', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [],
      creator: 'fixture', character_version: '1.0',
      extensions: {
        tavern_helper: {
          variables: {},
          scripts: [{ id: 'database', name: '数据库', content: '', enabled: true, data: {} }],
        },
      },
    },
  }))
  const seed = createCharacterCardSessionSeed(card, {
    kind: 'file', attachmentId: AttachmentId('sha256:tavern-message-annotation'), bytes: 1,
    name: 'card.json', mediaType: 'application/json',
  }, 0, '')
  const session = Session.create(SessionId('tavern-message-annotation'), seed)
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '开始' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const original = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '原回复' }], source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  const annotation = {
    TavernDB_ACU_IsolatedData: {
      default: {
        storageFrame: {
          revision: 1,
          checkpoint: { 纪要表: [{ row_id: 'AM0001' }] },
          operationLog: [],
        },
      },
    },
    TavernDB_ACU_Identity: 'fixture',
  } as const
  const annotationCommand = CommandId('save-tavern-message-annotation')
  session.append('command/run', {
    commandId: annotationCommand, name: 'rp-tavern-variables', source: { kind: 'user' },
  })
  const persisted = executeTavernHelperMutation({
    agent: { session } as Agent,
    rawInput: JSON.stringify({
      format: 0,
      operation: 'replace-message-annotations',
      owner: { scriptScope: 'character', scriptId: 'database' },
      messages: [{ message_id: 1, value: annotation }],
    }),
  })
  assert.equal(typeof persisted.sourceEventSeq, 'number')
  assert.equal(persisted.text, undefined)
  assert.equal(sessionEvents(session)[persisted.sourceEventSeq!]?.type, 'agent-rp/tavern-message-annotation')
  session.append('command/done', { commandId: annotationCommand, ...persisted })
  assert.deepEqual(Object.values(readTavernMessageAnnotations(sessionEvents(session))).map(record => record.value), [annotation])

  const project = (source: Session) => {
    let state = agentRpProjectionDefinition.init(source.header, source.inheritedEventCount)
    for (const event of sessionEvents(source)) state = agentRpProjectionDefinition.apply(state, event)
    return agentRpProjectionDefinition.wire.view(state)
  }
  const owner = tavernScriptIdentity('character', 'database')
  assert.deepEqual(project(session).tavern?.messages.at(-1)?.annotations?.[owner], annotation)

  const alternative = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '新回复' }], source: { provider: 'fixture', model: 'fixture' },
    }),
  }, {
    surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
    sourceEventSeqs: [original.seq],
  })
  const groupId = '12345678-1234-4234-8234-123456789abc'
  const versions = [
    { seq: original.seq, text: '原回复' },
    { seq: alternative.seq, text: '新回复' },
  ] as const
  const alternativeCommand = CommandId('select-alternative-annotation-branch')
  session.append('command/run', {
    commandId: alternativeCommand, name: 'rp-generation', source: { kind: 'user' },
  })
  session.append('command/done', {
    commandId: alternativeCommand,
    kind: 'success',
    text: encodeGenerationState({
      format: 0,
      groupId,
      operation: 'regenerate',
      originSeq: original.seq,
      anchorSeq: original.seq,
      assistantSeqs: [original.seq, alternative.seq],
      versions,
      selectedVersionSeq: alternative.seq,
      surfaceSeq: alternative.seq,
    }),
  })
  assert.equal(project(session).tavern?.messages.at(-1)?.annotations, undefined)

  const selectedOriginal = session.append('assistant/message', original.data, {
    surfaceOp: { op: 'replace', start: alternative.seq, end: alternative.seq },
    sourceEventSeqs: [alternative.seq, original.seq],
  })
  const selectCommand = CommandId('restore-original-annotation-branch')
  session.append('command/run', {
    commandId: selectCommand, name: 'rp-generation', source: { kind: 'user' },
  })
  session.append('command/done', {
    commandId: selectCommand,
    kind: 'success',
    text: encodeGenerationState({
      format: 0,
      groupId,
      operation: 'select',
      originSeq: original.seq,
      anchorSeq: original.seq,
      assistantSeqs: [original.seq, alternative.seq],
      versions,
      selectedVersionSeq: original.seq,
      surfaceSeq: selectedOriginal.seq,
    }),
  })
  const reopened = Session.create(SessionId('tavern-message-annotation-reopened'), sessionEvents(session))
  assert.deepEqual(project(reopened).tavern?.messages.at(-1)?.annotations?.[owner], annotation)
})

test('persists isolated Tavern Helper variable namespaces', () => {
  const state = initializeTavernHelperState({
    regexScripts: [],
    tavernHelperScriptNames: ['状态同步'],
    tavernHelperVariables: { theme: 'night' },
    tavernHelperScripts: [{
      id: 'sync', name: '状态同步', content: '', info: '', enabled: true,
      buttonEnabled: true, buttons: [], data: { runs: 1 },
    }],
  }, 'card-1')
  const request = parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'message', variables: { stat_data: { trust: 3 } },
  }))
  const updated = applyTavernHelperMutation(state, request)
  const decoded = decodeTavernHelperState(encodeTavernHelperState(updated))

  assert.deepEqual(decoded?.scopes.character, { theme: 'night' })
  assert.deepEqual(decoded?.scopes.message, { stat_data: { trust: 3 } })
  assert.deepEqual(decoded?.scripts[tavernScriptIdentity('character', 'sync')], { runs: 1 })
  assert.equal(decoded?.revision, 1)
  assert.deepEqual(decoded?.lastMutation, { scope: 'message' })
})

test('replays one bounded status panel per Tavern Helper script owner', () => {
  const initial = initializeTavernHelperState({
    regexScripts: [],
    tavernHelperScriptNames: ['状态栏'],
    tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'status', name: '状态栏', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }],
  }, 'card-status-panel')
  const created = applyTavernHelperMutation(initial, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0,
    operation: 'replace-script-status-panel',
    scriptScope: 'character',
    scriptId: 'status',
    html: '<style>.hp{color:red}</style><div class="hp">12 / 20</div>',
  })))
  const replayed = decodeTavernHelperState(encodeTavernHelperState(created))
  assert.deepEqual(replayed?.statusPanels, [{
    format: 0,
    owner: { scriptScope: 'character', scriptId: 'status' },
    target: { kind: 'session' },
    html: '<style>.hp{color:red}</style><div class="hp">12 / 20</div>',
  }])
  assert.deepEqual(replayed?.lastMutation, {
    scope: 'presentation', scriptScope: 'character', scriptId: 'status',
  })
  const removed = applyTavernHelperMutation(replayed!, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0,
    operation: 'replace-script-status-panel',
    scriptScope: 'character',
    scriptId: 'status',
    html: null,
  })))
  assert.deepEqual(decodeTavernHelperState(encodeTavernHelperState(removed))?.statusPanels, [{
    format: 0,
    owner: { scriptScope: 'character', scriptId: 'status' },
    target: { kind: 'session' },
    html: null,
  }])
})

test('keeps shared and script variable scopes distinct at the Tavern capability limit', () => {
  let state = initializeTavernHelperState({
    regexScripts: [],
    tavernHelperScriptNames: ['state'],
    tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'state', name: 'state', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }],
  }, 'card-variable-scopes')
  for (const scope of ['global', 'preset', 'character', 'chat', 'message'] as const) {
    state = applyTavernHelperMutation(state, parseTavernHelperMutationRequest(JSON.stringify({
      format: 0, scope, variables: { scope },
    })))
    assert.deepEqual(state.scopes[scope], { scope })
  }
  state = applyTavernHelperMutation(state, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'script', scriptScope: 'character', scriptId: 'state', variables: { isolated: true },
  })))
  assert.deepEqual(state.scripts[tavernScriptIdentity('character', 'state')], { isolated: true })
  assert.equal(state.revision, 6)
  assert.deepEqual(state.lastMutation, { scope: 'script', scriptScope: 'character', scriptId: 'state' })
  assert.throws(() => applyTavernHelperMutation(state, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, scope: 'script', scriptScope: 'character', scriptId: 'forged', variables: {},
  }))), /unknown scriptId/u)

  const limit = AGENT_RP_CAPABILITIES['session.variables.replace']
    .runtimePolicies['tavern-script-frame-v0'].requestBytes
  const empty = JSON.stringify({ format: 0, scope: 'chat', variables: { payload: '' } })
  const atLimit = JSON.stringify({
    format: 0, scope: 'chat', variables: { payload: 'a'.repeat(limit - Buffer.byteLength(empty)) },
  })
  assert.equal(Buffer.byteLength(atLimit), limit)
  assert.doesNotThrow(() => parseTavernHelperMutationRequest(atLimit))
  assert.throws(() => parseTavernHelperMutationRequest(`${atLimit} `), /too large/u)
})

test('keeps preset and character script state independent across reloads', () => {
  const character = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: ['角色脚本'], tavernHelperVariables: { card: true },
    tavernHelperScripts: [{
      id: 'character', name: '角色脚本', content: '', info: '', enabled: true,
      buttonEnabled: true, buttons: [], data: { characterRuns: 1 },
    }],
  }, 'card-1')
  const preset = initializeTavernHelperPresetState(character, [{
    id: 'preset', name: '预设脚本', content: '', info: '', enabled: true,
    buttonEnabled: true, buttons: [], data: { presetRuns: 2 },
  }], { theme: 'fox' }, 'preset-1')
  const changed = applyTavernHelperMutation(preset, {
    format: 0, scope: 'script', scriptScope: 'preset', scriptId: 'preset', variables: { presetRuns: 3 },
  })
  const reloaded = initializeTavernHelperPresetState(
    initializeTavernHelperState({
      regexScripts: [], tavernHelperScriptNames: ['角色脚本'], tavernHelperVariables: { card: true },
      tavernHelperScripts: [{
        id: 'character', name: '角色脚本', content: '', info: '', enabled: true,
        buttonEnabled: true, buttons: [], data: { characterRuns: 1 },
      }],
    }, 'card-1', changed),
    [{
      id: 'preset', name: '预设脚本', content: '', info: '', enabled: true,
      buttonEnabled: true, buttons: [], data: { presetRuns: 2 },
    }],
    { theme: 'fox' },
    'preset-1',
  )

  assert.deepEqual(reloaded.scopes.character, { card: true })
  assert.deepEqual(reloaded.scopes.preset, { theme: 'fox' })
  assert.deepEqual(reloaded.scripts[tavernScriptIdentity('character', 'character')], { characterRuns: 1 })
  assert.deepEqual(reloaded.scripts[tavernScriptIdentity('preset', 'preset')], { presetRuns: 3 })
})

test('keeps duplicate script ids independent across scopes and prompt owners', () => {
  const character = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: ['角色同名脚本'], tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'shared', name: '角色同名脚本', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: { owner: 'character' },
    }],
  }, 'card-shared')
  let state = initializeTavernHelperPresetState(character, [{
    id: 'shared', name: '预设同名脚本', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: { owner: 'preset' },
  }], {}, 'preset-shared')
  state = applyTavernHelperMutation(state, {
    format: 0, scope: 'script', scriptScope: 'preset', scriptId: 'shared', variables: { owner: 'preset-updated' },
  })
  state = applyTavernHelperMutation(state, {
    format: 0, operation: 'replace-script-injections', scriptScope: 'preset', scriptId: 'shared',
    prompts: [{
      id: 'same-prompt', position: 'in_chat', depth: 1, role: 'system', content: '预设提示',
      shouldScan: false, once: false,
    }],
  })
  state = applyTavernHelperMutation(state, {
    format: 0, operation: 'replace-script-injections', scriptScope: 'character', scriptId: 'shared',
    prompts: [{
      id: 'same-prompt', position: 'in_chat', depth: 1, role: 'system', content: '角色提示',
      shouldScan: false, once: false,
    }],
  })
  const decoded = decodeTavernHelperState(encodeTavernHelperState(state))

  assert.deepEqual(decoded?.scripts[tavernScriptIdentity('character', 'shared')], { owner: 'character' })
  assert.deepEqual(decoded?.scripts[tavernScriptIdentity('preset', 'shared')], { owner: 'preset-updated' })
  assert.deepEqual(decoded?.injectedPrompts?.map(prompt => [prompt.scriptScope, prompt.content]), [
    ['preset', '预设提示'],
    ['character', '角色提示'],
  ])
})

test('conservatively copies legacy unscoped variables into each matching active scope', () => {
  const card = {
    regexScripts: [], tavernHelperScriptNames: ['角色同名脚本'], tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'shared', name: '角色同名脚本', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: { owner: 'character-default' },
    }],
  }
  const presetScripts = [{
    id: 'shared', name: '预设同名脚本', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: { owner: 'preset-default' },
  }]
  const current = initializeTavernHelperPresetState(
    initializeTavernHelperState(card, 'card-legacy'), presetScripts, {}, 'preset-legacy',
  )
  const legacy = decodeTavernHelperState(encodeTavernHelperState({
    ...current,
    scripts: { shared: { owner: 'legacy' } },
  }))
  const migrated = initializeTavernHelperPresetState(
    initializeTavernHelperState(card, 'card-legacy', legacy), presetScripts, {}, 'preset-legacy',
  )

  assert.deepEqual(migrated.scripts[tavernScriptIdentity('character', 'shared')], { owner: 'legacy' })
  assert.deepEqual(migrated.scripts[tavernScriptIdentity('preset', 'shared')], { owner: 'legacy' })
  assert.equal(Object.hasOwn(migrated.scripts, 'shared'), false)
})

test('persists Session-local script tree replacements and their new script variables', () => {
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: ['旧脚本'], tavernHelperVariables: {}, tavernHelperScripts: [{
      id: 'old-script', name: '旧脚本', content: 'void 0', info: '', enabled: true,
      buttonEnabled: true, buttons: [], data: { old: true },
    }],
  }, 'card-script-tree')
  const request = parseTavernHelperMutationRequest(JSON.stringify({
    format: 0,
    operation: 'replace-script-trees',
    scope: 'character',
    trees: [{
      type: 'folder', enabled: true, name: '工具', id: 'tools', icon: 'folder', color: '#123456',
      scripts: [{
        type: 'script', enabled: true, name: '新脚本', id: 'new-script', content: 'void 0', info: '状态工具',
        button: { enabled: true, buttons: [{ name: '查看', visible: true }] },
        data: { runs: 2 }, export_with: { data: true, button: true },
      }],
    }],
  }))
  const withGlobal = applyTavernHelperMutation(initial, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0, operation: 'replace-script-trees', scope: 'global', trees: [{
      type: 'script', enabled: true, name: '全局脚本', id: 'global-script', content: 'void 0', info: '',
      button: { enabled: true, buttons: [] }, data: { global: true },
      export_with: { data: true, button: true },
    }],
  })))
  const updated = applyTavernHelperMutation(withGlobal, request)
  const decoded = decodeTavernHelperState(encodeTavernHelperState(updated))

  assert.equal(decoded?.lastMutation?.scope, 'script-tree')
  assert.equal(decoded?.scriptTrees?.character?.[0]?.type, 'folder')
  assert.deepEqual(decoded?.scripts, {
    [tavernScriptIdentity('global', 'global-script')]: { global: true },
    [tavernScriptIdentity('character', 'new-script')]: { runs: 2 },
  })

  const reloaded = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'different-card', decoded)
  assert.equal(reloaded.scriptTrees?.character, undefined)
  assert.equal(reloaded.scriptTrees?.global?.[0]?.id, 'global-script')
  assert.deepEqual(reloaded.scripts, {
    [tavernScriptIdentity('global', 'global-script')]: { global: true },
  })
})

test('persists script-created worldbooks and activates them only after binding', () => {
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'card-1')
  const replaced = applyTavernHelperMutation(initial, parseTavernHelperMutationRequest(JSON.stringify({
    format: 0,
    operation: 'replace-worldbook',
    name: '旅店记忆',
    entries: [
      { name: '钥匙', content: '钥匙藏在钟下。', strategy: { type: 'constant' } },
      {
        name: '耳语', content: '最近的耳语。', strategy: { type: 'constant' },
        position: { type: 'at_depth', role: 'user', depth: 1, order: 80 },
      },
      {
        name: '坏深度', content: '不能注入。', strategy: { type: 'constant' },
        position: { type: 'at_depth', role: 'system', depth: -1, order: 70 },
      },
    ],
  })))
  const sources = withTavernWorldbooks([], decodeTavernHelperState(encodeTavernHelperState(replaced)))

  assert.equal(sources[0]?.name, '旅店记忆')
  assert.equal(sources[0]?.lorebook.entries[0]?.content, '钥匙藏在钟下。')
  assert.deepEqual(inspectLorebook(sources[0]!.lorebook, []).inChat, [
    { role: 'user', content: '最近的耳语。', depth: 1, order: 80 },
    { role: 'system', content: '钥匙藏在钟下。', depth: 4, order: 100 },
  ])
  assert.deepEqual(sources[0]?.lorebook.entries[2]?.compatibilityBlockers, ['entry-unsupported-position'])
  assert.deepEqual(activeTavernWorldbooks(sources, replaced), [])

  const bound = applyTavernHelperMutation(replaced, {
    format: 0, operation: 'bind-chat-worldbook', name: '旅店记忆',
  })
  assert.deepEqual(activeTavernWorldbooks(sources, bound).map(source => source.name), ['旅店记忆'])
})

test('persists script-owned prompt injections and projects only model-visible entries', () => {
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: ['状态提示'], tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'status', name: '状态提示', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }],
  }, 'card-1')
  const request = parseTavernHelperMutationRequest(JSON.stringify({
    format: 0,
    operation: 'replace-script-injections',
    scriptScope: 'character',
    scriptId: 'status',
    prompts: [
      { id: 'visible', position: 'in_chat', depth: 1, role: 'assistant', content: '保持安静', shouldScan: true, once: true },
      { id: 'scan-only', position: 'none', depth: 0, role: 'system', content: '只用于扫描', shouldScan: true, once: false },
    ],
  }))
  const decoded = decodeTavernHelperState(encodeTavernHelperState(applyTavernHelperMutation(initial, request)))
  assert.deepEqual(decoded?.injectedPrompts, [
    {
      id: 'visible', scriptScope: 'character', scriptId: 'status', position: 'in_chat', depth: 1,
      role: 'assistant', content: '保持安静', shouldScan: true, once: true,
    },
    {
      id: 'scan-only', scriptScope: 'character', scriptId: 'status', position: 'none', depth: 0,
      role: 'system', content: '只用于扫描', shouldScan: true, once: false,
    },
  ])
  assert.deepEqual(tavernInjectedInChatPrompts(decoded), [
    { role: 'assistant', content: '保持安静', depth: 1, order: 100 },
  ])
  assert.deepEqual(tavernInjectedScanText(decoded), ['保持安静', '只用于扫描'])
  assert.deepEqual(decoded?.lastMutation, { scope: 'injection', scriptScope: 'character', scriptId: 'status' })
})

test('persists installed-extension prompts without inventing a role-card script owner', () => {
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperVariables: {}, tavernHelperScripts: [],
  }, 'card-1')
  const request = parseTavernHelperMutationRequest(JSON.stringify({
    format: 0,
    operation: 'replace-installed-extension-prompts',
    prompts: [{
      id: 'woven_imprint_memory', position: 'in_chat', depth: 2, role: 'system',
      content: '长篇记忆', shouldScan: true, once: false,
    }],
  }))
  const decoded = decodeTavernHelperState(encodeTavernHelperState(
    applyTavernHelperMutation(initial, request),
  ))

  assert.deepEqual(decoded?.installedExtensionPrompts, [{
    id: 'woven_imprint_memory', position: 'in_chat', depth: 2, role: 'system',
    content: '长篇记忆', shouldScan: true, once: false,
  }])
  assert.deepEqual(tavernInjectedInChatPrompts(decoded), [
    { role: 'system', content: '长篇记忆', depth: 2, order: 100 },
  ])
  assert.deepEqual(tavernInjectedScanText(decoded), ['长篇记忆'])
  assert.deepEqual(decoded?.lastMutation, { scope: 'installed-extension-injection' })
  assert.equal('scriptId' in decoded!.installedExtensionPrompts![0]!, false)
})

test('includes durable Tavern Helper injections in auxiliary prompt previews', async () => {
  const session = Session.create(SessionId('injected-preview'))
  const initial = initializeTavernHelperState({
    regexScripts: [], tavernHelperScriptNames: ['提示脚本'], tavernHelperVariables: {},
    tavernHelperScripts: [{
      id: 'injector', name: '提示脚本', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }],
  }, 'card-1')
  const state = applyTavernHelperMutation(initial, {
    format: 0,
    operation: 'replace-script-injections',
    scriptScope: 'character',
    scriptId: 'injector',
    prompts: [{
      id: 'tone', position: 'in_chat', depth: 1, role: 'assistant', content: '当前语气：轻声',
      shouldScan: false, once: false,
    }],
  })
  session.append('command/done', {
    commandId: CommandId('injected-preview-state'), kind: 'success', text: encodeTavernHelperState(state),
  })
  const agent = {
    session,
    options: { model: 'test-model' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal)
    },
  }
  const preview = await runTavernPromptPreview({
    get: (name: string) => name === 'agents' ? { get: () => agent } : undefined,
    systemPrompt: {
      assemble: async () => ({
        sections: [{ name: 'base', text: '角色设定' }], contexts: [], tools: [], variables: {},
      }),
    },
  } as never, {
    format: 0,
    sessionId: 'injected-preview',
    mode: 'raw',
    config: { user_input: '继续说', ordered_prompts: ['system_prompt', 'user_input'] },
  })
  assert.deepEqual(preview.prompts, [
    { role: 'system', content: '角色设定' },
    { role: 'assistant', content: '当前语气：轻声' },
    { role: 'user', content: '继续说' },
  ])
})
