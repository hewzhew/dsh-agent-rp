import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ImportedTavernHelperScript } from '../src/import/types.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import {
  currentTavernPreset,
  tavernPageSnapshot,
  tavernScriptSnapshot,
} from '../src/client/tavern-snapshot.ts'

const script = {
  id: 'snapshot-script',
  name: 'Snapshot script',
  content: '',
  info: '',
  enabled: true,
  buttonEnabled: false,
  buttons: [],
  data: { runs: 1 },
} satisfies ImportedTavernHelperScript

test('projects the initial Session without loading the React client entry', () => {
  const projectionSession = Session.create(SessionId('snapshot-session'))
  const projection = agentRpProjectionDefinition.wire.view(
    agentRpProjectionDefinition.init(projectionSession.header),
  )
  const page = tavernPageSnapshot(projection, SessionId('snapshot-session'))
  const snapshot = tavernScriptSnapshot(
    projection,
    script,
    'character',
    ['https://scripts.example'],
    SessionId('snapshot-session'),
  )

  assert.equal(currentTavernPreset(projection), undefined)
  assert.equal('script' in page.scopes, false)
  assert.deepEqual(page.messages, [])
  assert.deepEqual({
    scriptScope: snapshot.scriptScope,
    scriptId: snapshot.scriptId,
    characterName: snapshot.characterName,
    characterId: snapshot.characterId,
    chatId: snapshot.chatId,
    approvedScriptOrigins: snapshot.approvedScriptOrigins,
    scopes: snapshot.scopes,
    worldbooks: snapshot.worldbooks,
    worldbookBindings: snapshot.worldbookBindings,
    messages: snapshot.messages,
  }, {
    scriptScope: 'character',
    scriptId: 'snapshot-script',
    characterName: '角色会话',
    characterId: '角色会话',
    chatId: 'snapshot-session',
    approvedScriptOrigins: ['https://scripts.example'],
    scopes: {
      global: {},
      preset: {},
      character: {},
      chat: {},
      message: {},
      script: { runs: 1 },
    },
    worldbooks: {},
    worldbookBindings: {
      global: [],
      character: { primary: null, additional: [] },
      chat: null,
    },
    messages: [],
  })
})
