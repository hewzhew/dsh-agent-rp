/** Host-side completion for prepared Roleplay replies that omit a requested MVU patch. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  createUserMessage,
  isAgentLoopRequest,
  ReasoningEffortId,
  type GenerateOptions,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  appendRoleplayActModelRequest,
  appendRoleplayActModelResult,
  resolveRoleplayActModelBoundary,
  roleplayActModelDispatch,
  roleplayActModelFailure,
  type RoleplayActModelFailureKind,
} from './roleplay-act-model-log.ts'
import {
  MVU_ROLEPLAY_MODULE_ID,
  MVU_ROLEPLAY_STATE_ID,
  normalizeChoiceSupplement,
  normalizeMvuSupplement,
} from './mvu.ts'
import type { RoleplayTurnPlan } from './roleplay-turn-plan.ts'

export interface PreparedMvuResponseRepair {
  readonly engine: 'mvu-v0'
  readonly moduleId: string
  readonly stateId: string
  readonly current: JsonValue
  readonly updateInstructions?: string
  readonly choiceInstructions?: string
}

/** Resolve exactly one MVU repair from the already prepared act plan and state read. */
export function preparedMvuResponseRepair(plan: RoleplayTurnPlan | undefined): PreparedMvuResponseRepair | undefined {
  if (plan === undefined) return undefined
  const programs = plan.act.responseRepairs.filter(program => program.engine === 'mvu-v0')
  if (programs.length !== 1) return undefined
  const program = programs[0]!
  const owned = plan.runtime.modules.some(module => module.id === program.moduleId
    && module.phases.includes('act') && module.stateIds?.includes(program.stateId) === true)
  if (!owned || program.moduleId !== MVU_ROLEPLAY_MODULE_ID || program.stateId !== MVU_ROLEPLAY_STATE_ID) {
    return undefined
  }
  const state = plan.stateReads.find(read => read.id === program.stateId)
  if (state?.value === undefined) return undefined
  return {
    engine: program.engine,
    moduleId: program.moduleId,
    stateId: program.stateId,
    current: state.value,
    ...(program.updateInstructions === undefined ? {} : { updateInstructions: program.updateInstructions }),
    ...(program.choiceInstructions === undefined ? {} : { choiceInstructions: program.choiceInstructions }),
  }
}

function textFromChunks(chunks: readonly StreamChunk[]): string {
  return chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
}

function lastUserText(options: GenerateOptions): string {
  const message = options.messages.findLast(item => item.role === 'user')
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
}

function addUsage(left: TokenUsage | undefined, right: TokenUsage | undefined): TokenUsage | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  const optional = (key: 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens') => {
    const value = (left[key] ?? 0) + (right[key] ?? 0)
    return value === 0 ? {} : { [key]: value }
  }
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...optional('cacheReadTokens'),
    ...optional('cacheWriteTokens'),
    ...optional('reasoningTokens'),
  }
}

function supplementRequest(
  options: GenerateOptions,
  current: JsonValue,
  mvuRules: string | undefined,
  choiceRules: string | undefined,
  assistantReply: string,
): GenerateOptions {
  return {
    provider: options.provider,
    model: options.model,
    reasoningEffort: ReasoningEffortId('off'),
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-rp' },
      content: [{
        type: 'text',
        text: [
          '<current_stat_data>',
          JSON.stringify(current),
          '</current_stat_data>',
          '<latest_user_message>',
          lastUserText(options),
          '</latest_user_message>',
          '<assistant_reply>',
          assistantReply,
          '</assistant_reply>',
          '<card_mvu_rules>',
          mvuRules ?? 'Not requested.',
          '</card_mvu_rules>',
          '<card_choice_rules>',
          choiceRules ?? 'Not requested.',
          '</card_choice_rules>',
          'Complete only the requested missing structures. If card_mvu_rules is requested, return one complete <UpdateVariable> block; use an empty JSONPatch array when no field changed. If card_choice_rules is requested, return exactly one complete set of <①> through <⑩> tags. Follow the corresponding card rules. Do not continue, summarize, or rewrite the story. Do not add headings or code fences.',
        ].join('\n'),
      }],
    })],
    maxTokens: 8192,
    temperature: 0,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

type SupplementResult =
  | { readonly kind: 'success'; readonly text: string; readonly usage?: TokenUsage }
  | { readonly kind: 'failure'; readonly failure: RoleplayActModelFailureKind; readonly usage?: TokenUsage }

async function requestSupplement(ctx: Context, request: GenerateOptions): Promise<SupplementResult> {
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(request)) assembler.push(chunk)
  if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
    return {
      kind: 'failure',
      failure: assembler.finish.kind === 'aborted' ? 'aborted' : 'provider',
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    }
  }
  const text = assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  return { kind: 'success', text, ...(assembler.usage === undefined ? {} : { usage: assembler.usage }) }
}

/** Install a stream wrapper that applies only the MVU repair frozen into the prepared Agent Loop plan. */
export function installMvuStreamCompletion(
  ctx: Context,
  agentForSession: (sessionId: string) => Agent | undefined,
  planForAgent: (agent: Agent) => RoleplayTurnPlan | undefined = () => undefined,
): void {
  ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopRequest(options) || options.sessionId === undefined) return next()
    const agent = agentForSession(String(options.sessionId))
    if (agent === undefined) return next()
    const plan = planForAgent(agent)
    if (plan === undefined) return next()
    const prepared = preparedMvuResponseRepair(plan)
    if (prepared === undefined) return next()
    const current = prepared.current
    const mvuRules = prepared.updateInstructions
    const choiceRules = prepared.choiceInstructions
    if (mvuRules === undefined && choiceRules === undefined) return next()

    return (async function* (): AsyncIterable<StreamChunk> {
      const observed: StreamChunk[] = []
      let usage: TokenUsage | undefined
      let finish: Extract<StreamChunk, { type: 'finish' }> | undefined
      let maxIndex = -1
      for await (const chunk of next()) {
        observed.push(chunk)
        if ('index' in chunk) maxIndex = Math.max(maxIndex, chunk.index)
        if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') finish = chunk
        else yield chunk
      }
      const reply = textFromChunks(observed)
      const missingMvu = mvuRules !== undefined && !/<UpdateVariable(?:variable)?>/iu.test(reply)
      const missingChoices = choiceRules !== undefined && normalizeChoiceSupplement(reply) === undefined
      if (finish?.reason.kind !== 'stop' || (!missingMvu && !missingChoices)) {
        if (usage !== undefined) yield { type: 'usage', usage }
        if (finish !== undefined) yield finish
        return
      }
      const boundary = resolveRoleplayActModelBoundary(agent.session, plan)
      if (boundary === undefined) {
        ctx.logger.warn('agent-rp: MVU supplement skipped because its prepared step boundary is unavailable')
        if (usage !== undefined) yield { type: 'usage', usage }
        if (finish !== undefined) yield finish
        return
      }
      const request = supplementRequest(
        options,
        current,
        missingMvu ? mvuRules : undefined,
        missingChoices ? choiceRules : undefined,
        reply,
      )
      const requestId = crypto.randomUUID()
      const requestEvent = appendRoleplayActModelRequest(agent.session, {
        format: 0,
        requestId,
        sessionId: String(agent.session.id),
        ...boundary,
        purpose: {
          kind: 'response-repair',
          engine: prepared.engine,
          moduleId: prepared.moduleId,
          stateId: prepared.stateId,
        },
        dispatch: roleplayActModelDispatch(request),
      })
      try {
        await ctx.sessions.flush(agent.session)
        const supplemental = await requestSupplement(ctx, request)
        usage = addUsage(usage, supplemental.usage)
        if (supplemental.kind === 'failure') {
          appendRoleplayActModelResult(agent.session, {
            format: 0,
            requestId,
            requestSeq: requestEvent.seq,
            result: { kind: 'failure', failure: supplemental.failure },
          })
        } else {
          const additions = [
            ...(missingMvu ? [normalizeMvuSupplement(current, supplemental.text)] : []),
            ...(missingChoices ? [normalizeChoiceSupplement(supplemental.text)] : []),
          ].filter((value): value is string => value !== undefined)
          appendRoleplayActModelResult(agent.session, {
            format: 0,
            requestId,
            requestSeq: requestEvent.seq,
            result: {
              kind: 'success',
              text: supplemental.text,
              application: additions.length === 0 ? 'rejected' : 'applied',
            },
          })
          if (additions.length > 0) {
            const index = maxIndex + 1
            const text = `\n\n${additions.join('\n\n')}`
            yield { type: 'block-start', index, blockType: 'text' }
            yield { type: 'text-delta', index, text }
            yield { type: 'block-end', index, block: { type: 'text', text } }
            finish = { type: 'finish', reason: finish.reason }
          }
        }
      } catch (error: unknown) {
        if (!agent.session.events.some(event => event.type === 'agent-rp/act-model-result'
          && event.data.requestSeq === requestEvent.seq)) {
          appendRoleplayActModelResult(agent.session, {
            format: 0,
            requestId,
            requestSeq: requestEvent.seq,
            result: { kind: 'failure', failure: roleplayActModelFailure(error) },
          })
        }
        ctx.logger.warn(`agent-rp: MVU supplement failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (usage !== undefined) yield { type: 'usage', usage }
      if (finish !== undefined) yield finish
    })()
  }, { global: true })
}
