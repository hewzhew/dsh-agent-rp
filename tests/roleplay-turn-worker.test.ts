import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { executeGenerationCommand, readGenerationGroups } from '../src/generation.ts'
import { createRoleplayNarrativeReviewWorker } from '../src/roleplay-narrative-review-worker.ts'
import { RoleplayTurnWorkerRegistry, type RoleplayTurnWorkerInput } from '../src/roleplay-turn-worker.ts'
import type { BoundRoleplayTurnPlan } from '../src/roleplay-turn-settlement.ts'

function input(session: Session, step = 1): RoleplayTurnWorkerInput {
  return {
    ctx: {} as Context,
    agent: { id: session.id, session } as Agent,
    turn: 1,
    plan: { step, plan: { act: { strategy: 'agent' } } } as BoundRoleplayTurnPlan,
    signal: new AbortController().signal,
  }
}

test('runs review before settlement and isolates one Worker failure', async () => {
  const session = Session.create(SessionId('turn-worker-order'))
  const registry = new RoleplayTurnWorkerRegistry()
  const calls: string[] = []
  registry.register({
    id: 'state',
    phase: 'settle',
    async run() { calls.push('state'); return { outcome: 'applied' } },
  })
  registry.register({
    id: 'review',
    phase: 'review',
    async run() { calls.push('review'); throw new Error('fixture failure') },
  })

  const results = await registry.run(input(session))
  assert.deepEqual(calls, ['review', 'state'])
  assert.deepEqual(results.map(result => [result.workerId, result.outcome]), [
    ['review', 'failed'],
    ['state', 'applied'],
  ])
  assert.equal(session.events.every(event => event.type !== 'agent-rp/turn-worker-result'
    || event.ignorable === true), true)
  assert.deepEqual(await registry.run(input(session)), [])
})

test('reviews one reply through an isolated request and preserves the original as a selectable version', async () => {
  const session = Session.create(SessionId('narrative-review-worker'))
  session.append('turn/start', { turn: 1 })
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const original = session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '她向前走。她向前走，然后推开门。' }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 1 })
  let system = ''
  let messages = ''
  const workerInput = input(session)
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages: readonly unknown[] }) {
        system = options.system ?? ''
        messages = JSON.stringify(options.messages)
        return (async function* () {
          const text = '她向前走去，然后推开门。'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const worker = createRoleplayNarrativeReviewWorker(() => true)
  const outcome = await worker.run({ ...workerInput, ctx: fake })

  assert.equal(outcome.outcome, 'applied')
  assert.match(system, /不要重新推演剧情/u)
  assert.match(messages, /她向前走。她向前走/u)
  assert.doesNotMatch(messages, /世界书|预设模块/u)
  assert.deepEqual(session.deriveMessages().flatMap(message => message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])), ['她向前走去，然后推开门。'])
  const group = readGenerationGroups(session.events)[0]
  assert.deepEqual(group?.versions.map(version => version.text), [
    '她向前走。她向前走，然后推开门。',
    '她向前走去，然后推开门。',
  ])
  const resultEvent = session.events.find(event => event.type === 'agent-rp/narrative-review-result'
    && event.seq === outcome.resultEventSeq)
  assert.equal(resultEvent?.type, 'agent-rp/narrative-review-result')
  assert.equal(resultEvent?.type === 'agent-rp/narrative-review-result'
    && resultEvent.data.result.kind === 'success'
    ? resultEvent.data.result.reviewedReplySeq
    : undefined, group?.selectedVersionSeq)

  await executeGenerationCommand({
    agent: workerInput.agent,
    rawInput: JSON.stringify({ operation: 'select', replySeq: original.seq, versionIndex: 0 }),
    signal: new AbortController().signal,
  })
  assert.deepEqual(session.deriveMessages().flatMap(message => message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])), ['她向前走。她向前走，然后推开门。'])
})
