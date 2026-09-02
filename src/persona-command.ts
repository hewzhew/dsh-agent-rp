/** Model-free Persona selection for an existing Roleplay Session. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeCharacterLibraryLaunch, readActiveSessionCharacter } from './import/session-character.ts'
import { readSillyTavernChatIdentity } from './import/sillytavern-chat-seed.ts'
import {
  encodePersonaCommandRecord,
  parsePersonaCommandRequest,
} from './persona-command-protocol.ts'
import { readSessionPersona } from './session-persona.ts'
import { sessionEvents } from './session-events.ts'

function launchPersonaName(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'command/done' || event.data.kind !== 'success') continue
    const launch = decodeCharacterLibraryLaunch(event.data.text)
    if (launch !== undefined) return launch.persona?.name
  }
  for (const event of events) {
    if (event.type === 'agent-rp/persona-seed') return readSessionPersona([event])?.name
  }
  return undefined
}

function fallbackUserName(agent: Agent): string | undefined {
  const events = sessionEvents(agent.session)
  const originalPersonaName = launchPersonaName(events)
  const characterName = readActiveSessionCharacter(events)?.result.userName
  const chatName = readSillyTavernChatIdentity(events)?.userName
  if (chatName !== undefined && chatName !== originalPersonaName) return chatName
  if (characterName !== undefined && characterName !== originalPersonaName) return characterName
  return undefined
}

/** Apply or clear one Session-owned Persona without invoking a model. */
export function executePersonaCommand(invocation: {
  readonly commandId: CommandId
  readonly agent: Agent
  readonly rawInput: string
}): { readonly kind: 'success'; readonly text: string } {
  const request = parsePersonaCommandRequest(invocation.rawInput)
  const source = sessionEvents(invocation.agent.session).at(-1)
  if (source?.type !== 'command/run' || source.data.name !== 'rp-persona'
    || String(source.data.commandId) !== String(invocation.commandId)) {
    throw new Error('Persona 命令不是当前 Session 事件')
  }
  const fallback = request.persona === undefined ? fallbackUserName(invocation.agent) : undefined
  return {
    kind: 'success',
    text: encodePersonaCommandRecord({
      format: 0,
      sourceEventSeq: source.seq,
      ...(request.persona === undefined ? {} : { persona: request.persona }),
      ...(fallback === undefined ? {} : { fallbackUserName: fallback }),
    }),
  }
}
