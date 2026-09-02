import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import { executeSillyTavernChatCommand } from '../src/sillytavern-chat-command.ts'
import { SillyTavernChatLibrary } from '../src/sillytavern-chat-library.ts'
import { sessionEvents } from '../src/session-events.ts'

function setup(context: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-chat-command-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const chats = new SillyTavernChatLibrary({ root: join(root, 'chats') })
  const characters = new CharacterLibrary({ root: join(root, 'characters') })
  const upload = chats.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl')),
    filename: 'manual-chat.jsonl',
  })
  return { chats, characters, upload }
}

test('rejects the obsolete live-Agent JSONL migration command', (context) => {
  const { chats, characters, upload } = setup(context)
  const agent = { session: Session.create(SessionId('sillytavern-chat-command')) } as Agent
  const commandId = CommandId('sillytavern-chat-1')
  agent.session.append('command/run', { commandId, name: 'rp-chat-import', source: { kind: 'user' } })
  assert.throws(() => executeSillyTavernChatCommand(chats, characters, {
    commandId,
    agent,
    rawInput: JSON.stringify({ format: 0, importId: upload.id }),
  }), /旧聊天迁移入口已停用/u)
  assert.equal(sessionEvents(agent.session).some(event => event.type === 'turn/start'), false)
})
