/** Independent lightweight review Worker for a completed character reply. */

import {
  BlockAssembler,
  createUserMessage,
  ReasoningEffortId,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import {
  appendReviewedReplyVersion,
  currentVisibleRoleplayReply,
} from './generation.ts'
import {
  roleplayActModelDispatch,
  roleplayActModelFailure,
  type RoleplayActModelDispatch,
  type RoleplayActModelFailureKind,
} from './roleplay-act-model-log.ts'
import type { RoleplayTurnWorker, RoleplayTurnWorkerOutcome } from './roleplay-turn-worker.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'

/** Exact lightweight request dispatched to the narrative review Worker. */
export interface RoleplayNarrativeReviewRequestRecord {
  readonly format: 0
  readonly requestId: string
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly sourceReplySeq: number
  readonly dispatch: RoleplayActModelDispatch
}

/** Terminal result of one narrative review request. */
export interface RoleplayNarrativeReviewResultRecord {
  readonly format: 0
  readonly requestId: string
  readonly requestSeq: number
  readonly result:
    | {
        readonly kind: 'success'
        readonly outcome: 'applied' | 'unchanged'
        readonly text: string
        readonly reviewedReplySeq?: number
        readonly generationStateEventSeq?: number
      }
    | {
        readonly kind: 'failure'
        readonly failure: RoleplayActModelFailureKind
      }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable exact request sent to the independent narrative review Worker. */
    'agent-rp/narrative-review-request': RoleplayNarrativeReviewRequestRecord
    /** Ignorable terminal result from the independent narrative review Worker. */
    'agent-rp/narrative-review-result': RoleplayNarrativeReviewResultRecord
  }
}

function replyText(reply: ReturnType<typeof currentVisibleRoleplayReply>): string {
  return reply?.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim() ?? ''
}

function reviewRequest(
  input: Parameters<RoleplayTurnWorker['run']>[0],
  source: string,
): GenerateOptions {
  const header = input.agent.session.requestHeader()
  if (header === undefined) throw new Error('Narrative review Worker has no provider request header')
  const requestedMaxTokens = Math.max(1_024, Math.min(8_192, Math.ceil(source.length * 1.2)))
  return {
    ...header.config,
    reasoningEffort: ReasoningEffortId('off'),
    temperature: 0.2,
    maxTokens: Math.min(header.config.maxTokens ?? requestedMaxTokens, requestedMaxTokens),
    system: [
      '你是角色扮演运行时中独立于角色 Agent 的正文审阅 Worker。角色 Agent 已经完成剧情决策；不要重新推演剧情。',
      '只修复明显的复读、病句、衔接断裂和正文外的解释性污染。保留全部事实、因果、行动、对白归属、叙事视角与既有文风。',
      '不要增加或删除事件，不要改变数值、选项、状态栏或工具结果。HTML、XML、模板标记、代码块和结构化片段必须原样保留。',
      '只返回审阅后的完整回复，不要说明修改过程。原文无需修改时逐字返回原文。',
    ].join('\n'),
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-rp-narrative-review' },
      content: [{ type: 'text', text: `<roleplay_reply>\n${source}\n</roleplay_reply>` }],
    })],
    signal: input.signal,
  }
}

function terminalForStep(input: Parameters<RoleplayTurnWorker['run']>[0]): boolean {
  const requests = input.agent.session.events.filter(event => event.type === 'agent-rp/narrative-review-request'
    && event.data.turn === input.turn && event.data.step === input.plan.step)
  return requests.some(request => input.agent.session.events.some(event => event.type === 'agent-rp/narrative-review-result'
    && event.data.requestSeq === request.seq))
}

/** Create the built-in narrative review Worker with live workspace enablement. */
export function createRoleplayNarrativeReviewWorker(enabled: () => boolean): RoleplayTurnWorker {
  return {
    id: 'narrative-review',
    phase: 'review',
    async run(input): Promise<RoleplayTurnWorkerOutcome> {
      if (!enabled() || input.plan.plan.act.strategy !== 'agent') return { outcome: 'skipped' }
      if (terminalForStep(input)) return { outcome: 'skipped' }
      const reply = currentVisibleRoleplayReply(input.agent, input.turn)
      const source = replyText(reply)
      if (reply === undefined || source === '') return { outcome: 'skipped' }
      const request = reviewRequest(input, source)
      const requestId = crypto.randomUUID()
      const requestEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/narrative-review-request', {
        format: 0,
        requestId,
        sessionId: String(input.agent.session.id),
        turn: input.turn,
        step: input.plan.step,
        sourceReplySeq: reply.seq,
        dispatch: roleplayActModelDispatch(request),
      })
      try {
        await input.ctx.sessions.flush(input.agent.session)
        const assembler = new BlockAssembler()
        for await (const chunk of input.ctx.llm.stream(request)) assembler.push(chunk)
        if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
          const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/narrative-review-result', {
            format: 0,
            requestId,
            requestSeq: requestEvent.seq,
            result: {
              kind: 'failure',
              failure: assembler.finish.kind === 'aborted' ? 'aborted' : 'provider',
            },
          })
          return { outcome: 'failed', requestEventSeq: requestEvent.seq, resultEventSeq: resultEvent.seq }
        }
        const text = assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
        if (text === '' || text.length > 128 * 1_024
          || text.length > Math.max(source.length * 2, source.length + 4_096)) {
          throw new Error('Narrative review Worker returned an unusable replacement')
        }
        if (text === source) {
          const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/narrative-review-result', {
            format: 0,
            requestId,
            requestSeq: requestEvent.seq,
            result: { kind: 'success', outcome: 'unchanged', text },
          })
          return { outcome: 'unchanged', requestEventSeq: requestEvent.seq, resultEventSeq: resultEvent.seq }
        }
        const reviewed = appendReviewedReplyVersion(input.agent, input.turn, text)
        const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/narrative-review-result', {
          format: 0,
          requestId,
          requestSeq: requestEvent.seq,
          result: {
            kind: 'success',
            outcome: 'applied',
            text,
            reviewedReplySeq: reviewed.reviewedSeq,
            generationStateEventSeq: reviewed.stateEventSeq,
          },
        })
        return { outcome: 'applied', requestEventSeq: requestEvent.seq, resultEventSeq: resultEvent.seq }
      } catch (error: unknown) {
        const existing = input.agent.session.events.find(event => event.type === 'agent-rp/narrative-review-result'
          && event.data.requestSeq === requestEvent.seq)
        const resultEvent = existing ?? appendAgentRpSessionEvent(input.agent.session, 'agent-rp/narrative-review-result', {
          format: 0,
          requestId,
          requestSeq: requestEvent.seq,
          result: { kind: 'failure', failure: roleplayActModelFailure(error) },
        })
        return { outcome: 'failed', requestEventSeq: requestEvent.seq, resultEventSeq: resultEvent.seq }
      }
    },
  }
}
