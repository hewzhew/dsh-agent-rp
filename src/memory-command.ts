/** Model-free user management of persistent Roleplay memory. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import {
  encodeAgentRpMemoryCommandRecord,
  findAgentRpMemorySubjectConflict,
  parseAgentRpMemoryCommandRequest,
  readAgentRpMemoryHistory,
} from './memory.ts'
import { sessionEvents } from './session-events.ts'

/** Apply one private memory-manager request without invoking the character model. */
export function executeAgentRpMemoryCommand(invocation: {
  readonly commandId: CommandId
  readonly agent: Agent
  readonly rawInput: string
}): { readonly kind: 'success'; readonly text: string } {
  const request = parseAgentRpMemoryCommandRequest(invocation.rawInput)
  const source = sessionEvents(invocation.agent.session).at(-1)
  if (source?.type !== 'command/run' || source.data.name !== 'rp-memory'
    || String(source.data.commandId) !== String(invocation.commandId)) {
    throw new Error('记忆操作命令不是当前 Session 事件')
  }
  const history = readAgentRpMemoryHistory(sessionEvents(invocation.agent.session))
  if (request.operation === 'add') {
    const conflict = findAgentRpMemorySubjectConflict(history.active, request.subject)
    if (conflict !== undefined) throw new Error(`“${request.subject}”已经有一条有效记忆，请直接纠正原记录`)
  } else {
    if (!history.active.some(record => record.id === request.id)) {
      throw new Error('这条记忆已经被纠正或忘记，请刷新后再试')
    }
    if (request.operation === 'correct') {
      const conflict = findAgentRpMemorySubjectConflict(history.active, request.subject, request.id)
      if (conflict !== undefined) throw new Error(`“${request.subject}”已经是另一条有效记忆的主题，请先整理其中一条`)
    }
  }
  return {
    kind: 'success',
    text: encodeAgentRpMemoryCommandRecord({ ...request, sourceEventSeq: source.seq }),
  }
}
