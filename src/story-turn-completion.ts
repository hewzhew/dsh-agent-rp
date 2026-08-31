import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Story draft prepared for one active Agent-loop step. */
export interface StoryTurnCompletion {
  readonly turn: number
  readonly step: number
  readonly finalDraft: string
}

function completedDraft(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

/** Recognize frozen primary requests when Host and linked plugin load separate dsh-llm instances. */
function isAgentLoopDispatch(options: GenerateOptions): boolean {
  return isAgentLoopRequest(options)
    || (options.sessionId !== undefined && options.purpose === undefined && Object.isFrozen(options))
}

/** Make a completed story-pipeline draft the authoritative visible Agent reply. */
export function installStoryTurnCompletion(
  ctx: Context,
  agentForSession: (sessionId: string) => Agent | undefined,
  completionForAgent: (agent: Agent) => StoryTurnCompletion | undefined,
): void {
  ctx.on('llm/stream', (options, next) => {
    if (!isAgentLoopDispatch(options) || options.sessionId === undefined) return next()
    const agent = agentForSession(String(options.sessionId))
    if (agent === undefined) return next()
    const completion = completionForAgent(agent)
    if (completion === undefined) return next()
    return completedDraft(completion.finalDraft)
  }, { prepend: true })
}
