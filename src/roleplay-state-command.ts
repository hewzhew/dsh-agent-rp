/** Model-free player editing of durable native Roleplay state. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import {
  appendUserRoleplayState,
  parseRoleplayStateCommandRequest,
} from './roleplay-state.ts'
import { sessionEvents } from './session-events.ts'

/** Apply one private player state request without invoking the character model. */
export function executeRoleplayStateCommand(invocation: {
  readonly commandId: CommandId
  readonly agent: Agent
  readonly rawInput: string
}): CommandResult {
  const request = parseRoleplayStateCommandRequest(invocation.rawInput)
  const source = sessionEvents(invocation.agent.session).findLast(event =>
    event.type === 'command/run' && String(event.data.commandId) === String(invocation.commandId))
  if (source?.type !== 'command/run' || source.data.name !== 'rp-state'
    || source.data.source.kind !== 'user'
    || source.data.args !== invocation.rawInput
    || String(source.data.commandId) !== String(invocation.commandId)) {
    throw new Error('状态操作命令不是当前 Session 事件')
  }
  const written = appendUserRoleplayState(invocation.agent.session, request, source.seq)
  return { kind: 'success', sourceEventSeq: SessionSeq(written.eventSeq) }
}
