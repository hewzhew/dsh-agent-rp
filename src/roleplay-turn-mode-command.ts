/** Model-free player selection of the per-Session Roleplay turn mode. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import {
  appendUserRoleplayTurnMode,
  parseRoleplayTurnModeCommandRequest,
} from './roleplay-turn-mode.ts'
import { sessionEvents } from './session-events.ts'

/** Apply one private turn-mode request without invoking the character model. */
export function executeRoleplayTurnModeCommand(invocation: {
  readonly commandId: CommandId
  readonly agent: Agent
  readonly rawInput: string
}): { readonly kind: 'success'; readonly sourceEventSeq: SessionSeq } {
  const request = parseRoleplayTurnModeCommandRequest(invocation.rawInput)
  const source = sessionEvents(invocation.agent.session).findLast(event => event.type === 'command/run'
    && String(event.data.commandId) === String(invocation.commandId))
  if (source?.type !== 'command/run' || source.data.name !== 'rp-turn-mode'
    || source.data.source.kind !== 'user' || source.data.args !== invocation.rawInput) {
    throw new Error('回合方式命令不是当前 Session 事件')
  }
  appendUserRoleplayTurnMode(invocation.agent.session, request, source.seq)
  return { kind: 'success', sourceEventSeq: source.seq }
}
