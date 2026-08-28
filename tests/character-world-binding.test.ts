import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import { CharacterWorldBindingStore } from '../src/character-world-binding-store.ts'
import { resolveConfig } from '../src/config.ts'
import { parseCharacterCardJsonBytes } from '../src/import/character-card.ts'
import { prepareAgentRpSession } from '../src/session-launch.ts'
import { PresetLibrary } from '../src/preset-library.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { SillyTavernChatLibrary } from '../src/sillytavern-chat-library.ts'
import { readSessionLorebookSourcesFromEvents } from '../src/world-info-configuration.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'

function integratedLibraries(context: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-world-binding-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const bindings = new CharacterWorldBindingStore({ root: join(root, 'bindings') })
  const worlds = new WorldInfoLibrary({ root: join(root, 'worlds'), bindings })
  const characters = new CharacterLibrary({
    root: join(root, 'characters'),
    worldInfoLibrary: worlds,
    worldBindings: bindings,
  })
  return { root, bindings, worlds, characters }
}

function characterBytes(name = '白露', withBook = true): Uint8Array {
  const raw = JSON.parse(readFileSync('tests/fixtures/manual-character-card.json', 'utf8')) as Record<string, unknown>
  const data = raw.data as Record<string, unknown>
  data.name = name
  if (withBook) {
    data.character_book = {
      name: '海城', scan_depth: 6, token_budget: 2048, recursive_scanning: true, extensions: {}, entries: [{
        id: 7,
        name: '钟楼',
        comment: '钟楼设定',
        keys: ['午夜'],
        secondary_keys: [],
        content: '钟楼每天午夜停摆。',
        enabled: true,
        insertion_order: 10,
        selective: false,
        constant: false,
        case_sensitive: false,
        match_whole_words: false,
        position: 'after_char',
        extensions: {},
      }],
    }
  } else delete data.character_book
  return new TextEncoder().encode(JSON.stringify(raw))
}

function characterBytesWithMvu(): Uint8Array {
  const raw = JSON.parse(new TextDecoder().decode(characterBytes())) as Record<string, unknown>
  const data = raw.data as Record<string, unknown>
  const book = data.character_book as { entries: object[] }
  book.entries.push({
    id: 8,
    comment: '[initvar] 初始变量',
    keys: [],
    secondary_keys: [],
    content: '角色:\n  等级: 1',
    enabled: false,
    insertion_order: 20,
    selective: false,
    constant: false,
    case_sensitive: false,
    match_whole_words: false,
    position: 'after_char',
    extensions: {},
  })
  return new TextEncoder().encode(JSON.stringify(raw))
}

function worldInfoBytes(name: string, content: string): Uint8Array {
  const raw = JSON.parse(readFileSync('tests/fixtures/manual-world-info.json', 'utf8')) as {
    name: string
    entries: Record<string, { content: string }>
  }
  raw.name = name
  raw.entries['10']!.content = content
  return new TextEncoder().encode(JSON.stringify(raw))
}

test('splits an embedded book into a reusable world and persists its relationship', context => {
  const { bindings, worlds, characters } = integratedLibraries(context)
  const bytes = characterBytes()
  const sourceCard = parseCharacterCardJsonBytes(bytes)
  const character = characters.importFile({ data: bytes, filename: '白露.json', mediaType: 'application/json' })
  const binding = bindings.get(character.id)
  const primary = binding?.primary
  assert.equal(primary?.provenance, 'embedded-import')
  assert.equal(worlds.list().length, 1)
  assert.equal(worlds.list()[0]?.id, primary?.worldInfoId)
  const splitWorld = worlds.resolve(primary!.worldInfoId).worldInfo
  assert.equal(splitWorld.name, sourceCard.lorebook?.name)
  const { name: _name, ...expectedLorebook } = sourceCard.lorebook!
  assert.deepEqual(splitWorld.lorebook, expectedLorebook)
  assert.deepEqual(characters.asset(character.id).data, bytes)
  assert.deepEqual(parseCharacterCardJsonBytes(characters.exportModified(character.id).data).lorebook, sourceCard.lorebook)
  assert.throws(() => worlds.remove(primary!.worldInfoId), /角色绑定/u)

  characters.archive(character.id)
  characters.deleteArchived(character.id)
  assert.equal(bindings.get(character.id), undefined)
  assert.equal(worlds.remove(primary!.worldInfoId).id, primary!.worldInfoId)
})

test('reuses equal embedded books while keeping one relationship per character', context => {
  const { bindings, worlds, characters } = integratedLibraries(context)
  const firstRaw = JSON.parse(new TextDecoder().decode(characterBytes())) as Record<string, unknown>
  const secondRaw = structuredClone(firstRaw)
  const secondData = secondRaw.data as Record<string, unknown>
  secondData.name = '白露的镜像角色'
  const first = characters.importFile({
    data: new TextEncoder().encode(JSON.stringify(firstRaw)), filename: 'first.json', mediaType: 'application/json',
  })
  const second = characters.importFile({
    data: new TextEncoder().encode(JSON.stringify(secondRaw)), filename: 'second.json', mediaType: 'application/json',
  })
  assert.notEqual(first.id, second.id)
  assert.equal(bindings.get(first.id)?.primary?.worldInfoId, bindings.get(second.id)?.primary?.worldInfoId)
  assert.equal(worlds.list().length, 1)
  assert.deepEqual(bindings.referencingCharacters(bindings.get(first.id)!.primary!.worldInfoId), [first.id, second.id].sort())
})

test('migrates old cards once and records cards without embedded books', context => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-world-migration-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const characterRoot = join(root, 'characters')
  const legacy = new CharacterLibrary({ root: characterRoot })
  const withBook = legacy.importFile({
    data: characterBytes(),
    filename: 'legacy.json', mediaType: 'application/json',
  })
  const withoutBook = legacy.importFile({
    data: characterBytes('没有世界书的白露', false),
    filename: 'plain.json', mediaType: 'application/json',
  })

  const bindings = new CharacterWorldBindingStore({ root: join(root, 'bindings') })
  const worlds = new WorldInfoLibrary({ root: join(root, 'worlds'), bindings })
  const migrated = new CharacterLibrary({ root: characterRoot, worldInfoLibrary: worlds, worldBindings: bindings })
  assert.equal(migrated.migrateEmbeddedWorldInfos(), 2)
  assert.equal(migrated.migrateEmbeddedWorldInfos(), 0)
  assert.notEqual(bindings.get(withBook.id)?.primary, null)
  assert.equal(bindings.get(withoutBook.id)?.primary, null)
})

test('edits a character world composition across future launch, runtime, projection, and current export', context => {
  const { root, worlds, characters } = integratedLibraries(context)
  const bytes = characterBytesWithMvu()
  const character = characters.importFile({
    data: bytes,
    filename: 'character.json', mediaType: 'application/json',
  })
  const embeddedWorldId = characters.worldBinding(character.id)?.primary?.worldInfoId
  assert.ok(embeddedWorldId)
  const oldPrepared = prepareAgentRpSession(
    characters,
    new SillyTavernChatLibrary({ root: join(root, 'old-chats') }),
    new PresetLibrary({ root: join(root, 'old-presets') }),
    worlds,
    {
      format: 0,
      sourceSessionId: 'old-source',
      kind: 'character',
      characterId: character.id,
      greetingIndex: 0,
    },
  )
  const legacySeed = oldPrepared.seed.filter(event => event.type !== 'agent-rp/world-info-library-seed')
  const oldSession = Session.create(SessionId('character-world-binding-old-runtime'), legacySeed)

  const primary = worlds.importFile({ filename: '新主世界.json', data: worldInfoBytes('新主世界', '主世界采用新的潮汐纪年。') })
  const supporting = worlds.importFile({ filename: '附加世界.json', data: worldInfoBytes('附加世界', '附加世界记录港口航线。') })
  const initialBinding = characters.get(character.id).worldBinding
  assert.ok(initialBinding)
  const updated = characters.updateWorldBinding(character.id, {
    format: 0,
    revision: initialBinding.revision,
    primaryWorldInfoId: primary.id,
    additionalWorldInfoIds: [supporting.id, embeddedWorldId],
  })
  assert.equal(updated.worldBinding?.primary?.worldInfoId, primary.id)
  assert.deepEqual(updated.worldBinding?.additional.map(reference => reference.worldInfoId), [
    supporting.id,
    embeddedWorldId,
  ])
  assert.deepEqual([
    updated.worldBinding?.primary?.provenance,
    ...updated.worldBinding!.additional.map(reference => reference.provenance),
  ], ['user-bound', 'user-bound', 'user-bound'])
  assert.throws(() => characters.updateWorldBinding(character.id, {
    format: 0,
    revision: initialBinding.revision,
    primaryWorldInfoId: null,
    additionalWorldInfoIds: [],
  }), /已在别处改变/u)

  const prepared = prepareAgentRpSession(
    characters,
    new SillyTavernChatLibrary({ root: join(root, 'chats') }),
    new PresetLibrary({ root: join(root, 'presets') }),
    worlds,
    {
      format: 0,
      sourceSessionId: 'source',
      kind: 'character',
      characterId: character.id,
      greetingIndex: 0,
    },
  )
  const worldSeeds = prepared.seed.filter(event => event.type === 'agent-rp/world-info-library-seed')
  assert.deepEqual(worldSeeds.map(event => event.data.worldInfoLibraryId), [primary.id, supporting.id, embeddedWorldId])
  assert.ok(worldSeeds.every(event => event.data.placement === 'actor'))
  assert.ok(worldSeeds.every(event => event.data.purpose === 'character-binding'))

  const session = Session.create(SessionId('character-world-binding-runtime'), prepared.seed)
  const sources = readSessionLorebookSourcesFromEvents(session.events)
  assert.deepEqual(sources.map(source => source.id), [
    `character:library:${primary.id}`,
    `character:library:${supporting.id}`,
    `character:library:${embeddedWorldId}`,
  ])
  assert.ok(sources.every(source => source.source === 'character'))

  const runtime = resolveSessionRoleplayRuntime({
    session,
    deployment: resolveConfig({ characterName: 'fallback' }),
  })
  assert.equal(runtime.card?.lorebook, undefined)
  assert.equal(runtime.lorebooks.length, 3)
  assert.ok(runtime.lorebooks.every(lorebook => lorebook.source.source === 'character'))
  assert.deepEqual(runtime.mvu?.statData, { 角色: { 等级: 1 } })

  let projectionState = agentRpProjectionDefinition.init(session.header)
  for (const event of session.events) projectionState = agentRpProjectionDefinition.apply(projectionState, event)
  const projection = agentRpProjectionDefinition.wire.view(projectionState)
  assert.equal(projection.worldInfo.books.length, 3)
  assert.ok(projection.worldInfo.books.every(book => book.source === 'character'))
  assert.deepEqual(projection.mvu?.statData, { 角色: { 等级: 1 } })

  const oldSources = readSessionLorebookSourcesFromEvents(oldSession.events)
  assert.equal(oldSources.length, 1)
  assert.equal(oldSources[0]?.source, 'character')
  const oldRuntime = resolveSessionRoleplayRuntime({
    session: oldSession,
    deployment: resolveConfig({ characterName: 'fallback' }),
  })
  assert.equal(oldRuntime.lorebooks.length, 1)
  let oldProjectionState = agentRpProjectionDefinition.init(oldSession.header)
  for (const event of oldSession.events) {
    oldProjectionState = agentRpProjectionDefinition.apply(oldProjectionState, event)
  }
  const oldProjection = agentRpProjectionDefinition.wire.view(oldProjectionState)
  assert.equal(oldProjection.worldInfo.books.length, 1)
  assert.equal(oldProjection.worldInfo.books[0]?.source, 'character')
  assert.deepEqual(oldProjection.mvu?.statData, { 角色: { 等级: 1 } })
  assert.deepEqual(characters.asset(character.id).data, bytes)
  const exported = JSON.parse(new TextDecoder().decode(characters.exportModified(character.id).data)) as {
    data: { character_book: { entries: readonly Record<string, unknown>[] } }
  }
  assert.equal(typeof exported.data.character_book.entries[0]?.insertion_order, 'number')
  const exportedLorebook = parseCharacterCardJsonBytes(characters.exportModified(character.id).data).lorebook
  const primaryWorldInfo = worlds.asset(primary.id).worldInfo
  assert.equal(exportedLorebook?.name, primaryWorldInfo.name)
  assert.deepEqual(
    exportedLorebook?.entries.map(entry => entry.content),
    primaryWorldInfo.lorebook.entries.map(entry => entry.content),
  )

  const cleared = characters.updateWorldBinding(character.id, {
    format: 0,
    revision: updated.worldBinding!.revision,
    primaryWorldInfoId: null,
    additionalWorldInfoIds: [],
  })
  assert.equal(cleared.worldBinding?.primary, null)
  assert.equal(parseCharacterCardJsonBytes(characters.exportModified(character.id).data).lorebook, undefined)
  assert.deepEqual(characters.asset(character.id).data, bytes)
})
