import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import { CharacterLibrary } from '../src/character-library.ts'
import { readActiveSessionCharacter } from '../src/import/session-character.ts'
import { readActiveSessionPreset } from '../src/import/session-preset.ts'
import { readActiveSessionWorldInfos } from '../src/import/session-world-info.ts'
import { parseSillyTavernPresetJson } from '../src/import/sillytavern-preset.ts'
import { PresetLibrary } from '../src/preset-library.ts'
import { PersonaLibrary } from '../src/persona-library.ts'
import { readRoleplayExperienceSelection } from '../src/roleplay-experience-selection.ts'
import { RoleplayResourceCatalog } from '../src/roleplay-resource-catalog.ts'
import {
  roleplayLibraryResourceProviders,
  worldInfoLibraryRoleplayResourceId,
} from '../src/roleplay-resource-library-providers.ts'
import {
  prepareAgentRpRewriteSession,
  prepareAgentRpSession,
  parseAgentRpSessionLaunchRequest,
} from '../src/session-launch.ts'
import { SillyTavernChatLibrary } from '../src/sillytavern-chat-library.ts'
import { readSessionPersona } from '../src/session-persona.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'
import { launchAgentRpSession } from '../src/session-launch-http.ts'

const FIXTURE_WORKSPACE_PATH = process.platform === 'win32' ? 'C:\\fixture-workspace' : '/fixture-workspace'

function libraries(context: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-session-launch-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  return {
    characters: new CharacterLibrary({ root: join(root, 'characters') }),
    chats: new SillyTavernChatLibrary({ root: join(root, 'chats') }),
    presets: new PresetLibrary({ root: join(root, 'presets') }),
    personas: new PersonaLibrary({ root: join(root, 'personas') }),
    worldInfos: new WorldInfoLibrary({ root: join(root, 'world-info') }),
  }
}

function appendConversationTurn(session: Session, turn: number, user: string, assistant: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: user }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: assistant }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

async function launchExperienceWithWorkspaces(
  context: test.TestContext,
  workspaceEntries: readonly {
    readonly id: string
    readonly path?: string
    readonly sessionIds?: readonly SessionId[]
  }[],
  sourceCwd = FIXTURE_WORKSPACE_PATH,
) {
  const { characters, chats, presets, personas, worldInfos } = libraries(context)
  const worldInfo = worldInfos.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-world-info.json')),
    filename: '海城.json',
  })
  const sourceId = SessionId('world-info-source')
  const sourceSession = Session.create(sourceId, [], {
    version: 0, id: sourceId, createdAt: 0, cwd: sourceCwd,
  })
  const sourceAgent = { id: sourceId, session: sourceSession, status: 'idle', inbox: { hasPending: false } }
  let createdSession: Session | undefined
  let attachedSessionId: SessionId | undefined
  let renamedTitle: string | undefined
  const agents = {
    get: (id: SessionId) => id === sourceId ? sourceAgent : undefined,
    create: async (options: {
      readonly sessionId: SessionId
      readonly seed: readonly import('@deepseek-ai/dsh-session').SessionEvent[]
      readonly meta: { readonly cwd?: string; readonly agentPreset?: string }
    }) => {
      createdSession = Session.create(options.sessionId, options.seed, {
        version: 0,
        id: options.sessionId,
        createdAt: 0,
        ...options.meta,
      })
      return {
        agent: { id: options.sessionId, session: createdSession },
        dispose: async () => {},
      }
    },
  }
  const ctx = {
    get: (name: string): unknown => {
      if (name === 'agents') return agents
      if (name === 'apiProxy') return {
        sessions: {
          models: async () => ({ result: { ok: true, value: { current: { provider: 'fixture', model: 'fixture' } } } }),
          selectModel: async () => ({ result: { ok: true, value: {} } }),
        },
      }
      if (name === 'agentPresets') return {
        resolve: async () => ({ id: 'agent-rp', trust: 'user' }),
        read: async () => `
- id: agent-rp-runtime
  name: cordis:group
  isolate:
    agentRp.actorRevisions: true
  config:
    - id: agent-rp-character
      name: '@hewzhew/dsh-agent-rp'
      config:
        mode: character
`,
        mount: async () => {},
        serviceFor: () => ({}),
      }
      if (name === 'sessionTitle') return {
        get: () => undefined,
        rename: (_session: Session, title: string) => { renamedTitle = title },
      }
      if (name === 'workspaceRegistry') return {
        list: () => workspaceEntries.map(entry => ({
          ...entry,
          sessionIds: entry.sessionIds ?? [],
          attachSession: async (sessionId: SessionId) => { attachedSessionId = sessionId },
        })),
      }
      return undefined
    },
    logger: { warn: () => {} },
  } as unknown as Context

  const resources = new RoleplayResourceCatalog()
  for (const provider of roleplayLibraryResourceProviders({ characters, personas, presets, worldInfos })) {
    resources.register(provider)
  }

  const result = await launchAgentRpSession(ctx, characters, chats, presets, worldInfos, {
    format: 0,
    sourceSessionId: sourceId,
    kind: 'experience',
    mode: 'scene',
    worlds: [{ kind: 'world', id: worldInfoLibraryRoleplayResourceId(worldInfo.id) }],
  }, resources)

  return { result, createdSession, attachedSessionId, renamedTitle }
}

test('prepares a library character before the Agent is constructed', (context) => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const character = characters.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0, sourceSessionId: 'source', kind: 'character', characterId: character.id, greetingIndex: 0,
  })
  const session = Session.create(SessionId('launched-character'), prepared.seed)
  assert.equal(session.events.findLast(event => event.type === 'turn/start')?.data.turn, 1)
  assert.equal(readActiveSessionCharacter(session.events)?.result.libraryId, character.id)
  assert.equal(session.events[0]?.type, 'agent-rp/character-card-seed')
  if (session.events[0]?.type !== 'agent-rp/character-card-seed') assert.fail('missing character seed')
  assert.deepEqual(session.events[0].data.source, { characterLibraryId: character.id })
})

test('seeds a selected library preset into a new character Session', (context) => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const character = characters.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const preset = presets.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '保持角色语气' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  }), '会话预设.json'))
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId: character.id,
    greetingIndex: 0,
    presetId: preset.id,
  })
  const session = Session.create(SessionId('launched-with-preset'), prepared.seed)
  const active = readActiveSessionPreset(session.events)
  assert.equal(active?.result.name, '会话预设')
  assert.equal(active?.libraryId, preset.id)
})

test('composes ordered standalone World Info with a library character', context => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const character = characters.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const city = worldInfos.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-world-info.json')),
    filename: '海城.json',
  })
  const style = worldInfos.importFile({
    data: new TextEncoder().encode(JSON.stringify({
      name: '叙事风格',
      entries: { 1: {
        uid: 1, key: [], keysecondary: [], comment: '语气', content: '保持克制的叙事语气。',
        constant: true, selective: false, order: 1, position: 1, disable: false,
      } },
    })),
    filename: '叙事风格.json',
  })
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId: character.id,
    greetingIndex: 0,
    worldInfoIds: [city.id, style.id],
  })
  const first = Session.create(SessionId('composed-character'), prepared.seed)
  const replay = Session.create(SessionId('replayed-composed-character'), [...first.events])

  assert.equal(readActiveSessionCharacter(replay.events)?.result.libraryId, character.id)
  assert.deepEqual(readActiveSessionWorldInfos(replay.events).map(value => ({
    id: value.result.sourceAttachmentId,
    name: value.result.name,
  })), [
    { id: `library:${city.id}`, name: '海城' },
    { id: `library:${style.id}`, name: '叙事风格' },
  ])
})

test('loads library defaults into new RP Sessions while preserving an explicit empty selection', context => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const character = characters.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const city = worldInfos.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-world-info.json')),
    filename: '海城.json',
  })
  worldInfos.setDefault(city.id, true)

  const inherited = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0, sourceSessionId: 'source', kind: 'character', characterId: character.id, greetingIndex: 0,
  })
  const optedOut = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0, sourceSessionId: 'source', kind: 'character', characterId: character.id, greetingIndex: 0,
    worldInfoIds: [],
  })

  assert.deepEqual(readActiveSessionWorldInfos(inherited.seed).map(value => value.result.name), ['海城'])
  assert.deepEqual(readActiveSessionWorldInfos(optedOut.seed), [])
})

test('starts a replayable roleplay Session from standalone World Info without fabricating a character', context => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const worldInfo = worldInfos.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-world-info.json')),
    filename: '海城.json',
  })
  const supportingWorldInfo = worldInfos.importFile({
    data: new TextEncoder().encode(JSON.stringify({
      name: '剧情规则',
      entries: { 1: {
        uid: 1, key: [], keysecondary: [], comment: '规则', content: '让城市保持连贯。',
        constant: true, selective: false, order: 1, position: 1, disable: false,
      } },
    })),
    filename: '剧情规则.json',
  })
  const preset = presets.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '推动世界剧情' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  }), '剧情预设.json'))
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0,
    sourceSessionId: 'source',
    kind: 'world-info',
    importId: worldInfo.id,
    persona: { id: 'persona-01234567', name: '旅人', description: '刚刚抵达海城。' },
    presetId: preset.id,
    worldInfoIds: [supportingWorldInfo.id],
  })
  const first = Session.create(SessionId('launched-world-info'), prepared.seed)
  const replay = Session.create(SessionId('replayed-world-info'), [...first.events])

  assert.equal(prepared.title, '海城')
  assert.equal(first.events[0]?.type, 'agent-rp/world-info-library-seed')
  assert.deepEqual(
    first.events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
      .map(event => event.type),
    ['turn/start', 'turn/end'],
  )
  assert.equal(first.events.some(event => event.type === 'step/start' || event.type === 'step/end'), false)
  assert.equal(first.events.some(event => event.type === 'user/message' || event.type === 'assistant/message'), false)
  assert.deepEqual(first.deriveMessages(), [])
  assert.equal(readActiveSessionCharacter(replay.events), undefined)
  assert.deepEqual(readActiveSessionWorldInfos(replay.events).map(value => value.result.name), ['海城', '剧情规则'])
  assert.equal(readSessionPersona(replay.events)?.name, '旅人')
  assert.equal(readActiveSessionPreset(replay.events)?.libraryId, preset.id)

  appendConversationTurn(replay, 2, '请告诉我这里是哪里。', '这里是海城。')
  assert.equal(replay.events.findLast(event => event.type === 'turn/start')?.data.turn, 2)
})

test('publishes a source-neutral World Info experience into the source Workspace', async context => {
  const { result, createdSession, attachedSessionId, renamedTitle } = await launchExperienceWithWorkspaces(context, [{
    id: 'workspace-fixture',
    path: `${FIXTURE_WORKSPACE_PATH}/`,
  }])

  assert.equal(attachedSessionId, result.sessionId)
  assert.equal(renamedTitle, '海城')
  assert.equal(createdSession?.events.some(event => event.type === 'turn/start'), true)
  assert.deepEqual(createdSession?.deriveMessages(), [])
  assert.equal(readRoleplayExperienceSelection(createdSession?.events ?? [])?.mode, 'scene')
})

test('leaves the launched Session ungrouped when multiple Workspaces match the source cwd', async context => {
  const { result, createdSession, attachedSessionId } = await launchExperienceWithWorkspaces(context, [
    { id: 'workspace-fixture-a', path: `${FIXTURE_WORKSPACE_PATH}/` },
    { id: 'workspace-fixture-b', path: FIXTURE_WORKSPACE_PATH },
  ])

  assert.equal(attachedSessionId, undefined)
  assert.equal(result.workspaceWarning, '多个工作区与来源工作目录匹配，拒绝猜测，新角色会话保留在“未分组”')
  assert.equal(createdSession?.events.some(event => event.type === 'turn/start'), true)
})

test('prepares imported JSONL with consecutive turns before the Agent is constructed', (context) => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const upload = chats.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl')),
    filename: 'chat.jsonl',
  })
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0, sourceSessionId: 'source', kind: 'chat', importId: upload.id,
  })
  const session = Session.create(SessionId('launched-chat'), prepared.seed)
  const turns = session.events.filter(event => event.type === 'turn/start').map(event => event.data.turn)
  assert.deepEqual(turns, Array.from({ length: turns.length }, (_value, index) => index + 1))
  assert.equal(turns.length > 0, true)
  assert.equal(session.events.filter(event => event.type === 'turn/end').length, turns.length)
})

test('seeds a selected library preset after imported JSONL history', (context) => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const upload = chats.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl')),
    filename: 'chat.jsonl',
  })
  const preset = presets.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '继续原有语气' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  }), '迁移预设.json'))
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0,
    sourceSessionId: 'source',
    kind: 'chat',
    importId: upload.id,
    presetId: preset.id,
  })
  const session = Session.create(SessionId('migrated-with-preset'), prepared.seed)
  const active = readActiveSessionPreset(session.events)
  assert.equal(active?.result.name, '迁移预设')
  assert.equal(active?.libraryId, preset.id)
})

test('prepares Character Card and JSONL history as one replayable seed', (context) => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const character = characters.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const upload = chats.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-sillytavern-chat.jsonl')),
    filename: 'chat.jsonl',
  })
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0, sourceSessionId: 'source', kind: 'chat', importId: upload.id, characterId: character.id,
  })
  const first = Session.create(SessionId('migration-first'), prepared.seed)
  const replay = Session.create(SessionId('migration-replay'), [...first.events])
  const turns = replay.events.filter(event => event.type === 'turn/start').map(event => event.data.turn)
  assert.deepEqual(turns, Array.from({ length: turns.length }, (_value, index) => index + 1))
  assert.equal(readActiveSessionCharacter(replay.events)?.result.libraryId, character.id)
})

test('rewrites a completed turn by branching immediately before its user message', (context) => {
  const { characters, chats, presets, worldInfos } = libraries(context)
  const character = characters.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: 'character.json',
    mediaType: 'application/json',
  })
  const preset = presets.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '保持角色语气' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  }), '改写预设.json'))
  const prepared = prepareAgentRpSession(characters, chats, presets, worldInfos, {
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId: character.id,
    greetingIndex: 0,
    persona: { id: 'persona-01234567', name: '旅人', description: '来自海边。' },
    presetId: preset.id,
  })
  const source = Session.create(SessionId('rewrite-source'), prepared.seed)
  const previousTurn = Math.max(...source.events.flatMap(event => event.type === 'turn/start' ? [event.data.turn] : [])) + 1
  appendConversationTurn(source, previousTurn, '先去港口。', '好，我们沿着潮声往前走。')
  appendConversationTurn(source, previousTurn + 1, '改去钟楼。', '那就转向钟楼。')

  const rewritten = prepareAgentRpRewriteSession(source, previousTurn + 1, '白露')
  const replay = Session.create(SessionId('rewrite-child'), rewritten.seed)
  const transcript = replay.deriveMessages().flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
  assert.equal(rewritten.title, '白露 · 改写')
  assert.equal(transcript.includes('先去港口。'), true)
  assert.equal(transcript.includes('好，我们沿着潮声往前走。'), true)
  assert.equal(transcript.includes('改去钟楼。'), false)
  assert.equal(transcript.includes('那就转向钟楼。'), false)
  assert.equal(readActiveSessionCharacter(replay.events)?.result.libraryId, character.id)
  assert.equal(readActiveSessionCharacter(replay.events)?.result.userName, '旅人')
  assert.equal(readActiveSessionPreset(replay.events)?.libraryId, preset.id)
})

test('rejects an absent, unfinished, or assistant-only rewrite turn', () => {
  const source = Session.create(SessionId('invalid-rewrite'))
  source.append('turn/start', { turn: 1 })
  assert.throws(() => prepareAgentRpRewriteSession(source, 2), /不存在/u)
  assert.throws(() => prepareAgentRpRewriteSession(source, 1), /尚未完成/u)
  source.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: '开场白' }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.throws(() => prepareAgentRpRewriteSession(source, 1), /没有可改写/u)
  assert.throws(() => prepareAgentRpRewriteSession(source, 0), /轮次无效/u)
})

test('rejects paths and extra browser-owned launch fields', () => {
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'chat',
    importId: 'chat-0123456789abcdef0123456789abcdef',
    path: 'C:/private/chat.jsonl',
  }), /字段无效/u)
  assert.deepEqual(parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'world-info',
    importId: 'world-info-0123456789abcdef0123456789abcdef',
    persona: { id: 'persona-01234567', name: '旅人', description: '来自海边。' },
  }), {
    format: 0,
    sourceSessionId: 'source',
    kind: 'world-info',
    importId: 'world-info-0123456789abcdef0123456789abcdef',
    persona: { id: 'persona-01234567', name: '旅人', description: '来自海边。' },
  })
  assert.deepEqual(parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId: 'card-0123456789abcdef0123456789abcdef',
    greetingIndex: 0,
    worldInfoIds: [
      'world-info-11111111111111111111111111111111',
      'world-info-22222222222222222222222222222222',
    ],
  }), {
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId: 'card-0123456789abcdef0123456789abcdef',
    greetingIndex: 0,
    worldInfoIds: [
      'world-info-11111111111111111111111111111111',
      'world-info-22222222222222222222222222222222',
    ],
  })
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'world-info',
    importId: 'world-info-11111111111111111111111111111111',
    worldInfoIds: ['world-info-11111111111111111111111111111111'],
  }), /不能重复/u)
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId: 'card-0123456789abcdef0123456789abcdef',
    greetingIndex: 0,
    worldInfoIds: [
      'world-info-11111111111111111111111111111111',
      'world-info-11111111111111111111111111111111',
    ],
  }), /不能重复/u)
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'world-info',
    importId: 'world-info-0123456789abcdef0123456789abcdef',
    path: 'C:/private/world-info.json',
  }), /字段无效/u)
  assert.deepEqual(parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'rewrite',
    turn: 3,
    text: '换一种说法。',
  }), { format: 0, sourceSessionId: 'source', kind: 'rewrite', turn: 3, text: '换一种说法。' })
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'rewrite',
    turn: 0,
    text: '无效轮次',
  }), /字段无效/u)
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'rewrite',
    turn: 1,
    text: '   ',
  }), /字段无效/u)
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'story-workspace',
    workspaceId: 'story-------------------------------------',
  }), /字段无效/u)
})

test('accepts opt-in memory only for character launches', () => {
  const characterId = 'card-0123456789abcdef0123456789abcdef'
  assert.deepEqual(parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId,
    greetingIndex: 0,
    memory: 'copy-active',
  }), {
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId,
    greetingIndex: 0,
    memory: 'copy-active',
  })
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'character',
    characterId,
    greetingIndex: 0,
    memory: 'everything',
  }), /字段无效/u)
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source',
    kind: 'chat',
    importId: 'chat-0123456789abcdef0123456789abcdef',
    memory: 'copy-active',
  }), /字段无效/u)
})
