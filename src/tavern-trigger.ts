/** Host command for generating a reply after a Tavern script appends a user message. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { sessionEvents } from './session-events.ts'

function visibleRole(event: SessionEvent | undefined): 'assistant' | 'user' | undefined {
  if (event?.type === 'user/message'
    && (event.data.source.kind === 'user' || event.data.source.kind === 'model')) return 'user'
  if (event?.type === 'assistant/message' && event.data.message.source.kind === 'model') return 'assistant'
  return undefined
}

function latestVisibleRole(agent: Agent): 'assistant' | 'user' | undefined {
  for (let index = agent.session.surface.nodes.length - 1; index >= 0; index -= 1) {
    const role = visibleRole(sessionEvents(agent.session)[agent.session.surface.nodes[index]!])
    if (role !== undefined) return role
  }
  return undefined
}

/** Generate one normal character reply to the latest script-created user message. */
export async function executeTavernTrigger(invocation: {
  readonly agent: Agent
  readonly rawInput: string
  readonly signal: AbortSignal
}): Promise<{ readonly kind: 'success'; readonly text: string }> {
  if (invocation.rawInput.trim() !== '') throw new Error('/trigger 不接受额外参数')
  const agent = invocation.agent
  if (agent.status !== 'idle' || agent.inbox.hasPending) throw new Error('请等待当前回复完成后再操作')
  if (latestVisibleRole(agent) !== 'user') throw new Error('/trigger 前需要先添加一条用户消息')

  const onAbort = (): void => { agent.cancel({ kind: 'user' }) }
  invocation.signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: attempt === 0
          ? 'Respond to the latest user-authored roleplay message. Output only the in-character response.'
          : 'The previous attempt ended without a visible answer. Produce the in-character response now. Output dialogue or narration, not reasoning or an explanation.' }],
        source: {
          kind: 'plugin', plugin: 'dsh-agent-rp-tavern-trigger', form: 'notice',
          summary: attempt === 0 ? '正在继续角色回复' : '正在补全角色回复',
        },
      }))
      await agent.whenIdle()
      invocation.signal.throwIfAborted()
      const generated = sessionEvents(agent.session).slice(before)
        .findLast((event): event is Extract<SessionEvent, { type: 'assistant/message' }> =>
          event.type === 'assistant/message' && event.surfaceOp === 'append')
      const text = generated?.data.message.content
        .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
      if (generated !== undefined && text !== '') {
        return { kind: 'success', text: JSON.stringify({ format: 0, assistantSeq: generated.seq }) }
      }
    }
  } finally {
    invocation.signal.removeEventListener('abort', onAbort)
  }
  throw new Error('模型连续两次没有生成可见的角色回复')
}
