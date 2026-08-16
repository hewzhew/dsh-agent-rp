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
  traceCharacterPromptView,
  USER_INPUT_PLACEMENT,
  type PromptRegexOutcome,
  type PromptRegexSourceMarker,
  type PromptRegexTraceRecord,
} from './frontend-regex.ts'
import { presetRegexScripts } from './import/sillytavern-preset.ts'
import { readActiveSessionPreset } from './import/session-preset.ts'
import {
  cardFromImportMeta,
  readActiveSessionCharacter,
} from './import/session-character.ts'
import { readSillyTavernChatIdentity } from './import/sillytavern-chat-seed.ts'
import type { ImportedCharacterCard, ImportedRegexScript } from './import/types.ts'
import {
  injectSillyTavernInChatPrompts,
  type SillyTavernInChatPrompt,
} from './preset-prompt.ts'
import { resolveMacros, type MacroMessage } from './macros.ts'
import { resolveSessionPersonaIdentity } from './session-persona.ts'

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
  card: ImportedCharacterCard,
  placement: number,
  depth: number,
  userName: string | undefined,
  presetScripts: readonly ImportedRegexScript[],
): { readonly content: ContentBlock[]; readonly outcomes: readonly PromptRegexOutcome[] } {
  const textBlocks = content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
  const traces = (textBlocks.length === 0 ? [''] : textBlocks.map(block => block.text)).map(text =>
    traceCharacterPromptView(text, card, placement, depth, userName, presetScripts))
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

/** Recognize frozen primary requests even when a linked plugin has a second dsh-llm module instance. */
function isAgentLoopDispatch(options: GenerateOptions): boolean {
  return isAgentLoopRequest(options)
    || (options.sessionId !== undefined && options.purpose === undefined && Object.isFrozen(options))
}

/** Resolve chat-state and identity macros in one request's outgoing messages. */
function resolveChatMacros(
  messages: readonly Message[],
  card: ImportedCharacterCard,
  userName?: string,
  persona?: string,
): Message[] {
  const macroMessages: MacroMessage[] = messages.flatMap(message =>
    message.role === 'user' || message.role === 'assistant'
      ? [{
        role: message.role,
        content: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
      }]
      : [])
  const last = messages.at(-1)
  const pendingInput = last?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  return messages.map(message => {
    if (!message.content.some(block => block.type === 'text')) return message
    const content = message.content.map(block => {
      if (block.type !== 'text') return block
      return {
        ...block,
        text: resolveMacros(
          block.text,
          {
            card,
            ...(userName === undefined ? {} : { userName }),
            ...(persona === undefined ? {} : { persona }),
            messages: macroMessages,
            ...(pendingInput === undefined ? {} : { pendingInput }),
          },
          { dropUnknown: false },
        ).text,
      }
    })
    return { ...message, content }
  })
}

/** Apply one request's prompt view to the durable model surface. */
export function applyPromptRegexSurface(
  session: Session,
  card: ImportedCharacterCard,
  userName?: string,
  presetScripts: readonly ImportedRegexScript[] = [],
): PromptRegexTraceRecord | undefined {
  const position = openStep(session.events)
  if (position === undefined) return undefined
  const nodes = dialogueNodes(session)
  const scripts = [...presetScripts, ...card.frontend.regexScripts]
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
      userName,
      presetScripts,
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
      source: index < presetScripts.length ? 'preset' : 'character',
      index: index < presetScripts.length ? index : index - presetScripts.length,
      scriptName: script.scriptName,
      outcome: summaries[index]?.outcome ?? 'no-match',
      affectedMessages: summaries[index]?.affectedMessages ?? 0,
    })),
  }
  if (replacements.length === 0) {
    const node = nodes.at(-1)
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
  inChatForAgent: (agent: Agent) => readonly SillyTavernInChatPrompt[] = () => [],
): void {
  ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopDispatch(options) || options.sessionId === undefined) return next()
    const agent = agentForSession(String(options.sessionId))
    if (agent === undefined) return next()
    const active = readActiveSessionCharacter(agent.session.events)
    if (active === undefined) return next()
    const card = cardFromImportMeta(active.meta)
    const preset = readActiveSessionPreset(agent.session.events)?.preset
    const scripts = preset === undefined ? [] : presetRegexScripts(preset)
    const inChat = inChatForAgent(agent)
    const identity = resolveSessionPersonaIdentity(
      agent.session.events,
      active.result.userName,
      readSillyTavernChatIdentity(agent.session.events)?.userName,
    )
    const hasManagedSurface = dialogueNodes(agent.session).some(node => sourceMarker(messageOf(node.current).source) !== undefined)
    const hasPromptScripts = [...scripts, ...card.frontend.regexScripts]
      .some(script => !script.markdownOnly || script.promptOnly)
    let messages = options.messages
    if (hasPromptScripts || hasManagedSurface) {
      const trace = applyPromptRegexSurface(agent.session, card, identity.userName, scripts)
      if (trace !== undefined && trace.replacementCount > 0) messages = [...agent.session.deriveMessages()]
    }
    messages = resolveChatMacros(messages, card, identity.userName, identity.persona?.description)
    return ctx.llm.stream({
      ...options,
      messages: injectSillyTavernInChatPrompts(messages, inChat),
    })
  }, { global: true, prepend: true })
}
