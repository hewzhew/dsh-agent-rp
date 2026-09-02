import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../src/config.ts'
import { parseCharacterCardJson } from '../src/import/character-card.ts'
import { createCharacterCardSessionSeed } from '../src/import/character-card-seed.ts'
import { createPresetSessionSeed } from '../src/import/session-preset.ts'
import { parseWorldInfoJson } from '../src/import/world-info.ts'
import { createWorldInfoLibrarySessionSeed } from '../src/import/world-info-seed.ts'
import type { ImportedSillyTavernPreset } from '../src/import/sillytavern-preset.ts'
import { ROLEPLAY_TURN_PHASES } from '../src/roleplay-runtime.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'

const deployment = resolveConfig({ characterName: '岚' })

test('describes a fresh deployment character without an import-format dependency', () => {
  const runtime = resolveSessionRoleplayRuntime({
    session: Session.create(SessionId('runtime-native')),
    deployment,
    memoryWriteAvailable: true,
  })

  assert.equal(runtime.snapshot.experience.mode, 'character')
  assert.equal(runtime.snapshot.actor?.name, '岚')
  assert.equal(runtime.snapshot.actor?.adapter, undefined)
  assert.equal(runtime.snapshot.prompt.strategy, 'native')
  assert.deepEqual(runtime.snapshot.world.bindings, [])
  assert.deepEqual(runtime.snapshot.lifecycle, ROLEPLAY_TURN_PHASES)
  assert.deepEqual(runtime.snapshot.lifecycle, ['prepare', 'recall', 'act', 'settle', 'present'])
  assert.deepEqual(runtime.snapshot.memory, { read: true, write: true })
})

test('executes a recorded Agent preference through the registered event owner', () => {
  const session = Session.create(SessionId('runtime-effective-turn-mode'), [{
    type: 'agent-rp/turn-mode',
    seq: SessionSeq(0),
    time: 1,
    data: { format: 0, mode: 'agent', source: 'default' },
  }])
  const runtime = resolveSessionRoleplayRuntime({ session, deployment })

  assert.equal(runtime.turnMode, 'agent')
})

test('maps card, Persona, world, and preset assets into independent runtime bindings', () => {
  const card = parseCharacterCardJson(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '白露', description: '钟表匠', personality: '沉静', scenario: '修理铺打烊前',
      first_mes: '门还没锁。', mes_example: '', creator_notes: '', system_prompt: '',
      post_history_instructions: '', alternate_greetings: [], tags: [], creator: 'fixture',
      character_version: '1', extensions: {},
      character_book: {
        name: '海城', recursive_scanning: false, extensions: {},
        entries: [{
          keys: ['钟楼'], secondary_keys: [], content: '旧钟楼在午夜停摆。', enabled: true,
          insertion_order: 1, constant: false, selective: false, position: 'before_char',
          name: '钟楼', use_regex: false, extensions: {},
        }],
      },
    },
  }))
  const cardAttachment = {
    kind: 'file' as const,
    attachmentId: AttachmentId('sha256:runtime-card'),
    bytes: 100,
    name: '白露.json',
    mediaType: 'application/json',
  }
  const persona = {
    id: 'persona-00000000-0000-4000-8000-000000000001',
    name: '小满',
    description: '刚到海城的旅人。',
  }
  const characterSeed = createCharacterCardSessionSeed(
    card,
    cardAttachment,
    0,
    card.firstMessage,
    { transport: 'json' },
    persona.name,
    persona,
  )
  const preset: ImportedSillyTavernPreset = {
    format: 0,
    name: '潮汐预设',
    prompts: [{
      identifier: 'chatHistory', name: '历史', role: 'system', content: '', marker: true,
      systemPrompt: true, forbidOverrides: false,
    }],
    order: [{ identifier: 'chatHistory', enabled: true }],
    generation: {},
    formats: { worldInfo: '{0}', scenario: '{{scenario}}', personality: '{{personality}}' },
    regexScripts: [],
    extensionSummary: { regexScriptCount: 0, hasSPreset: false, hasTavernHelper: false },
  }
  const presetAttachment = {
    kind: 'file' as const,
    attachmentId: AttachmentId('sha256:runtime-preset'),
    bytes: 100,
    name: '潮汐预设.json',
    mediaType: 'application/json',
  }
  const session = Session.create(
    SessionId('runtime-card'),
    createPresetSessionSeed(characterSeed, preset, presetAttachment),
  )

  const runtime = resolveSessionRoleplayRuntime({ session, deployment, templateEngineAvailable: true })

  assert.deepEqual(runtime.snapshot.actor, {
    id: 'character:sha256:runtime-card',
    name: '白露',
    owner: 'session',
    adapter: 'sillytavern:character-card',
  })
  assert.equal(runtime.snapshot.participant?.id, persona.id)
  assert.equal(runtime.snapshot.participant?.description, persona.description)
  assert.equal(runtime.snapshot.prompt.strategy, 'modules')
  assert.equal(runtime.snapshot.prompt.resource?.name, '潮汐预设')
  assert.deepEqual(runtime.snapshot.world.bindings.map(binding => ({
    name: binding.name, placement: binding.placement,
  })), [{ name: '海城', placement: 'actor' }])
  assert.equal(runtime.card?.name, '白露')
  assert.deepEqual(runtime.preset?.preset, preset)
  assert.ok(runtime.snapshot.modules.some(item => item.id === 'adapter:ejs'))
})

test('lets a standalone world own a scene without inventing an actor', () => {
  const source = JSON.stringify({
    name: '海城剧情',
    entries: {
      0: {
        uid: 0, key: [], keysecondary: [], content: '海城终年多雾。', constant: true,
        selective: false, order: 1, position: 0, disable: false,
      },
    },
  })
  const worldInfo = parseWorldInfoJson(source)
  const seed = createWorldInfoLibrarySessionSeed({
    upload: {
      id: 'world-info-00000000000000000000000000000001',
      name: '海城剧情',
      entryCount: 1,
      degradations: [],
      defaultForNewSessions: false,
    },
    worldInfo,
    filename: '海城剧情.json',
    data: new TextEncoder().encode(source),
  })
  const runtime = resolveSessionRoleplayRuntime({
    session: Session.create(SessionId('runtime-scene'), seed),
    deployment,
  })

  assert.equal(runtime.snapshot.experience.mode, 'scene')
  assert.equal(runtime.snapshot.experience.name, '海城剧情')
  assert.equal(runtime.snapshot.actor, undefined)
  assert.deepEqual(runtime.snapshot.world.bindings.map(binding => binding.placement), ['experience'])
})
