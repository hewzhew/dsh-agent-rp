import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  createUserMessage,
  markAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { installStoryTurnCompletion, type StoryTurnCompletion } from '../src/story-turn-completion.ts'

type StreamHandler = (
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
) => AsyncIterable<StreamChunk>

function request(sessionId: SessionId, agentLoop: boolean): GenerateOptions {
  const options = {
    provider: 'fixture',
    model: 'fixture',
    sessionId,
    messages: [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: '继续' }],
    })],
  }
  return Object.freeze(agentLoop ? markAgentLoopRequest(options) : options)
}

test('uses the prepared story draft as the active Agent step response', async () => {
  const session = Session.create(SessionId('story-turn-completion'))
  session.append('turn/start', { turn: 2 })
  const agent = { session } as Agent
  const completion: StoryTurnCompletion = { turn: 2, step: 1, finalDraft: '魔理沙把骰子推回棋盘中央。' }
  let handler: StreamHandler | undefined
  let prepend = false
  const ctx = {
    on(event: string, callback: StreamHandler, options: { readonly prepend?: boolean }) {
      assert.equal(event, 'llm/stream')
      handler = callback
      prepend = options.prepend === true
    },
  } as unknown as Context
  installStoryTurnCompletion(ctx, id => id === String(session.id) ? agent : undefined, () => completion)

  assert.ok(handler)
  assert.equal(prepend, true)
  let providerCalls = 0
  const output: StreamChunk[] = []
  for await (const chunk of handler(request(session.id, true), () => {
    providerCalls += 1
    throw new Error('authoritative story draft must bypass the provider')
  })) output.push(chunk)

  assert.equal(providerCalls, 0)
  assert.deepEqual(output, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: completion.finalDraft },
    { type: 'block-end', index: 0, block: { type: 'text', text: completion.finalDraft } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])

  const linkedCopyOutput: StreamChunk[] = []
  for await (const chunk of handler(request(session.id, false), () => {
    providerCalls += 1
    throw new Error('a frozen Host request from another dsh-llm instance must still be recognized')
  })) linkedCopyOutput.push(chunk)
  assert.deepEqual(linkedCopyOutput, output)
  assert.equal(providerCalls, 0)
})

test('does not intercept auxiliary requests or an Agent without a prepared draft', async () => {
  const session = Session.create(SessionId('story-turn-completion-bypass'))
  session.append('turn/start', { turn: 1 })
  const agent = { session } as Agent
  const completion: StoryTurnCompletion = { turn: 1, step: 1, finalDraft: '准备好的正文' }
  let handler: StreamHandler | undefined
  const ctx = { on(_event: string, callback: StreamHandler) { handler = callback } } as unknown as Context
  let prepared: StoryTurnCompletion | undefined = completion
  installStoryTurnCompletion(ctx, () => agent, () => prepared)
  assert.ok(handler)

  let nextCalls = 0
  const fallback = (): AsyncIterable<StreamChunk> => {
    nextCalls += 1
    return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } as const })()
  }
  const auxiliary = {
    provider: 'fixture',
    model: 'fixture',
    messages: [createUserMessage({ source: { kind: 'plugin', plugin: 'fixture' }, content: [] })],
  } as GenerateOptions
  for await (const _chunk of handler(auxiliary, fallback)) { /* consume */ }
  prepared = undefined
  for await (const _chunk of handler(request(session.id, true), fallback)) { /* consume */ }

  assert.equal(nextCalls, 2)
})
