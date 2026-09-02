import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import { executeCharacterLibraryCommand } from '../src/character-library-command.ts'
import { sessionEvents } from '../src/session-events.ts'

test('rejects the obsolete live-Agent character launch command', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-command-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new CharacterLibrary({ root })
  const entry = library.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const agent = { session: Session.create(SessionId('character-library-command')) } as Agent
  const commandId = CommandId('character-library-1')
  agent.session.append('command/run', {
    commandId,
    name: 'rp-character-library',
    source: { kind: 'user' },
  })
  assert.throws(() => executeCharacterLibraryCommand(library, {
    commandId,
    agent,
    rawInput: JSON.stringify({ format: 0, characterId: entry.id, greetingIndex: 1 }),
  }), /旧角色启动入口已停用/u)
  assert.equal(sessionEvents(agent.session).some(event => event.type === 'turn/start'), false)
})
