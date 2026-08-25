/** Logged SillyTavern prompt-regex views for Agent Loop requests. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  createMessage,
  createUserMessage,
  isAgentLoopRequest,
  type ContentBlock,
  type GenerateOptions,
  type Message,
  type MessageSource,
} from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  AI_OUTPUT_PLACEMENT,
  PROMPT_REGEX_SOURCE_MARKER,
  readPromptRegexSourceMarker,
  tracePromptRegexView,
  USER_INPUT_PLACEMENT,
  type PromptRegexOutcome,
  type RegexCharacter,
  type PromptRegexSourceMarker,
  type PromptRegexTraceRecord,
} from './frontend-regex.ts'
import type { ImportedRegexScript } from './import/types.ts'
import {
  prepareSillyTavernProviderMessages,
} from './preset-prompt.ts'
import type {
  RoleplayPromptRegexTransform,
  RoleplayPromptTransformPlan,
  RoleplayTurnPromptPlan,
} from './roleplay-turn-plan.ts'

interface DialogueNode {
  readonly current: Extract<SessionEvent, { type: 'user/message' | 'assistant/message' }>
  readonly original: Extract<SessionEvent, { type: 'user/message' | 'assistant/message' }>
  readonly role: 'user' | 'assistant'
}

interface OpenStep {
  readonly turn: number
  readonly step: number
}

function messageOf(event: DialogueNode['current']): Message {
  return event.type === 'user/message' ? event.data : event.data.message
}

function sourceMarker(source: MessageSource): PromptRegexSourceMarker | undefined {
  return readPromptRegexSourceMarker(
    (source as unknown as Record<string, unknown>)[PROMPT_REGEX_SOURCE_MARKER],
  )
}

function dialogueEvent(event: SessionEvent | undefined): event is DialogueNode['current'] {
  if (event?.type === 'user/message') return event.data.source.kind === 'user'
  return event?.type === 'assistant/message' && event.data.message.source.kind === 'model'
}

function dialogueNodes(session: Session): DialogueNode[] {
  return session.surface.nodes.flatMap(seq => {
    const current = session.events[seq]
    if (!dialogueEvent(current)) return []
    const marker = sourceMarker(messageOf(current).source)
    const candidate = marker === undefined ? current : session.events[marker.originalSeq]
    const original = dialogueEvent(candidate) && candidate.type === current.type ? candidate : current
    return [{ current, original, role: current.type === 'user/message' ? 'user' as const : 'assistant' as const }]
  })
}

function openStep(events: readonly SessionEvent[]): OpenStep | undefined {
  let current: OpenStep | undefined
  for (const event of events) {
    if (event.type === 'step/start') current = { turn: event.data.turn, step: event.data.step }
    else if (event.type === 'step/end') current = undefined
  }
  return current
}

function transformedContent(
  content: readonly ContentBlock[],
  card: RegexCharacter,
  placement: number,
  depth: number,
  userName: string | undefined,
  scripts: readonly ImportedRegexScript[],
): { readonly content: ContentBlock[]; readonly outcomes: readonly PromptRegexOutcome[] } {
  const textBlocks = content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
  const traces = (textBlocks.length === 0 ? [''] : textBlocks.map(block => block.text)).map(text =>
    tracePromptRegexView(text, card, scripts, placement, depth, userName))
  let traceIndex = 0
  return {
    content: content.map(block => {
      if (block.type !== 'text') return block
      const trace = traces[traceIndex++]
      return trace === undefined ? block : { ...block, text: trace.text }
    }),
    outcomes: traces[0]?.scripts.map((_script, index) => {
      const values = traces.map(trace => trace.scripts[index]?.outcome ?? 'no-match')
      return values.reduce((best, value) => outcomeRank(value) > outcomeRank(best) ? value : best, 'disabled')
    }) ?? [],
  }
}

function sameContent(left: readonly ContentBlock[], right: readonly ContentBlock[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function traceCarrier(nodes: readonly DialogueNode[]): DialogueNode | undefined {
  return nodes.findLast(node => !messageOf(node.current).content.some(block => block.type === 'tool-call'))
}

function sourceWithMarker(
  source: MessageSource,
  originalSeq: number,
  trace?: PromptRegexTraceRecord,
): MessageSource {
  const { replayState: _replayState, ...stable } = source as MessageSource & { readonly replayState?: unknown }
  return {
    ...stable,
    [PROMPT_REGEX_SOURCE_MARKER]: { format: 0, originalSeq, ...(trace === undefined ? {} : { trace }) },
  } as unknown as MessageSource
}

function appendReplacement(
  session: Session,
  node: DialogueNode,
  content: ContentBlock[],
  position: OpenStep,
  trace?: PromptRegexTraceRecord,
): void {
  const originalMessage = messageOf(node.original)
  const sourceEventSeqs = [...new Set([node.current.seq, node.original.seq])]
  const surfaceOp = { op: 'replace' as const, start: node.current.seq, end: node.current.seq }
  if (node.role === 'user') {
    session.append('user/message', createUserMessage({
      content,
      source: sourceWithMarker(originalMessage.source, node.original.seq, trace),
    }), { surfaceOp, sourceEventSeqs })
    return
  }
  session.append('assistant/message', {
    ...position,
    message: createMessage({
      role: 'assistant',
      content,
      source: sourceWithMarker(originalMessage.source, node.original.seq, trace),
    }) as Extract<SessionEvent, { type: 'assistant/message' }>['data']['message'],
  }, { surfaceOp, sourceEventSeqs })
}

function outcomeRank(value: PromptRegexOutcome): number {
  switch (value) {
    case 'applied': return 7
    case 'invalid': return 6
    case 'display-only': return 5
    case 'no-match': return 4
    case 'depth': return 3
    case 'placement': return 2
    case 'disabled': return 1
  }
}

function importedScript(operation: RoleplayPromptRegexTransform): ImportedRegexScript {
  return {
    scriptName: operation.name,
    findRegex: operation.pattern,
    replaceString: operation.replacement,
    trimStrings: operation.trim,
    placement: operation.placements.map(placement => placement === 'user-input'
      ? USER_INPUT_PLACEMENT : AI_OUTPUT_PLACEMENT),
    disabled: !operation.enabled,
    markdownOnly: false,
    promptOnly: operation.phase === 'prompt-only',
    runOnEdit: false,
    substituteRegex: operation.identitySubstitution === 'raw' ? 1
      : operation.identitySubstitution === 'escaped' ? 2 : 0,
    minDepth: operation.minDepth ?? null,
    maxDepth: operation.maxDepth ?? null,
  }
}

function executionProgram(plan: RoleplayPromptTransformPlan): {
  readonly card: RegexCharacter
  readonly scripts: readonly ImportedRegexScript[]
} {
  return {
    card: {
      name: plan.actorName,
      frontend: {
        regexScripts: [],
        tavernHelperScriptNames: [],
        tavernHelperScripts: [],
        tavernHelperVariables: {},
      },
    },
    scripts: plan.operations.map(importedScript),
  }
}

/** Recognize frozen primary requests even when a linked plugin has a second dsh-llm module instance. */
function isAgentLoopDispatch(options: GenerateOptions): boolean {
  return isAgentLoopRequest(options)
    || (options.sessionId !== undefined && options.purpose === undefined && Object.isFrozen(options))
}

/** Apply one request's prompt view to the durable model surface. */
export function applyPromptRegexSurface(
  session: Session,
  plan: RoleplayPromptTransformPlan,
): PromptRegexTraceRecord | undefined {
  const position = openStep(session.events)
  if (position === undefined) return undefined
  const { card, scripts } = executionProgram(plan)
  const nodes = dialogueNodes(session)
  const summaries = scripts.map((_script, index) => ({ outcome: 'disabled' as PromptRegexOutcome, affectedMessages: 0, index }))
  const replacements: { readonly node: DialogueNode; readonly content: ContentBlock[] }[] = []
  for (const [index, node] of nodes.entries()) {
    const original = messageOf(node.original)
    const current = messageOf(node.current)
    const rendered = transformedContent(
      original.content,
      card,
      node.role === 'user' ? USER_INPUT_PLACEMENT : AI_OUTPUT_PLACEMENT,
      nodes.length - index - 1,
      plan.participantName,
      scripts,
    )
    for (const [scriptIndex, outcome] of rendered.outcomes.entries()) {
      const summary = summaries[scriptIndex]
      if (summary === undefined) continue
      if (outcomeRank(outcome) > outcomeRank(summary.outcome)) summary.outcome = outcome
      if (outcome === 'applied') summary.affectedMessages += 1
    }
    if (sameContent(current.content, rendered.content)) continue
    replacements.push({ node, content: rendered.content })
  }
  const record: PromptRegexTraceRecord = {
    format: 0,
    ...position,
    messageCount: nodes.length,
    replacementCount: replacements.length,
    scripts: scripts.map((script, index) => ({
      source: plan.operations[index]?.owner === 'prompt-policy' ? 'preset' : 'character',
      index: plan.operations[index]?.ownerIndex ?? index,
      scriptName: script.scriptName,
      outcome: summaries[index]?.outcome ?? 'no-match',
      affectedMessages: summaries[index]?.affectedMessages ?? 0,
    })),
  }
  if (replacements.length === 0) {
    const node = traceCarrier(nodes)
    if (node !== undefined) {
      appendReplacement(session, node, [...messageOf(node.current).content], position, record)
    }
  } else {
    replacements.forEach((replacement, index) => {
      appendReplacement(
        session,
        replacement.node,
        replacement.content,
        position,
        index === replacements.length - 1 ? record : undefined,
      )
    })
  }
  return record
}

/** Install the logged prompt-regex view before real Agent Loop provider calls. */
export function installPromptRegexStream(
  ctx: Context,
  agentForSession: (sessionId: string) => Agent | undefined,
  promptPlanForAgent: (agent: Agent) => RoleplayTurnPromptPlan | undefined = () => undefined,
): void {
  ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopDispatch(options) || options.sessionId === undefined) return next()
    const agent = agentForSession(String(options.sessionId))
    if (agent === undefined) return next()
    const plan = promptPlanForAgent(agent)
    if (plan === undefined) return next()
    const hasManagedSurface = dialogueNodes(agent.session).some(node => sourceMarker(messageOf(node.current).source) !== undefined)
    const hasPromptScripts = plan.transforms.operations.length > 0
    if (!hasPromptScripts && !hasManagedSurface
      && plan.beforeHistory.length === 0 && plan.afterHistory.length === 0 && plan.inChat.length === 0
      && plan.includeHistory && plan.continuation === undefined) return next()
    let messages = options.messages
    if (hasPromptScripts || hasManagedSurface) {
      const trace = applyPromptRegexSurface(agent.session, plan.transforms)
      if (trace !== undefined && trace.replacementCount > 0) messages = [...agent.session.deriveMessages()]
    }
    return ctx.llm.stream({
      ...options,
      messages: prepareSillyTavernProviderMessages(messages, plan),
    })
  }, { global: true, prepend: true })
}
