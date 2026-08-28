import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import { CharacterWorldBindingStore } from '../src/character-world-binding-store.ts'
import { readActiveSessionCharacter } from '../src/import/session-character.ts'
import { readActiveSessionPreset } from '../src/import/session-preset.ts'
import { readActiveSessionWorldInfos } from '../src/import/session-world-info.ts'
import { parseSillyTavernPresetJson } from '../src/import/sillytavern-preset.ts'
import { PersonaLibrary } from '../src/persona-library.ts'
import { PresetLibrary } from '../src/preset-library.ts'
import { RegexPackLibrary } from '../src/regex-pack-library.ts'
import {
  parseRoleplayExperienceSelection,
  readRoleplayExperienceSelection,
} from '../src/roleplay-experience-selection.ts'
import { RoleplayResourceCatalog } from '../src/roleplay-resource-catalog.ts'
import {
  characterLibraryRoleplayResourceId,
  presetLibraryRoleplayResourceId,
  regexPackLibraryRoleplayResourceId,
  roleplayLibraryResourceProviders,
  worldInfoLibraryRoleplayResourceId,
} from '../src/roleplay-resource-library-providers.ts'
import { resolveConfig } from '../src/config.ts'
import { parseAgentRpSessionLaunchRequest, prepareAgentRpSession } from '../src/session-launch.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { readSessionPersona } from '../src/session-persona.ts'
import { SillyTavernChatLibrary } from '../src/sillytavern-chat-library.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'
import { auditRoleplayExperience } from '../scripts/audit-roleplay-experience.ts'
import {
  IMMERSIVE_STORY_PROMPT_POLICY_ID,
  nativePromptPolicyResourceProvider,
  readNativePromptPolicy,
  renderNativePromptPolicy,
} from '../src/native-prompt-policy.ts'
import { prepareRoleplayTurn } from '../src/roleplay-turn-plan.ts'
import { readSessionRegexPacks } from '../src/session-regex-pack.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'

function fixture(context: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-experience-materialization-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const bindings = new CharacterWorldBindingStore({ root: join(root, 'character-world-bindings') })
  const worldInfos = new WorldInfoLibrary({ root: join(root, 'worlds'), bindings })
  const characters = new CharacterLibrary({
    root: join(root, 'characters'),
    worldInfoLibrary: worldInfos,
    worldBindings: bindings,
  })
  const personas = new PersonaLibrary({ root: join(root, 'personas') })
  const presets = new PresetLibrary({ root: join(root, 'presets') })
  const regexPacks = new RegexPackLibrary({ root: join(root, 'regex-packs') })
  const chats = new SillyTavernChatLibrary({ root: join(root, 'chats') })
  const character = characters.importFile({
    data: new TextEncoder().encode(JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '白露', description: '钟表匠', personality: '沉静', scenario: '海城',
        first_mes: '你好，{{user}}。', alternate_greetings: ['第二幕开始了，{{user}}。'],
        mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '',
        tags: [], creator: 'fixture', character_version: '1', extensions: {},
      },
    })),
    filename: '白露.json',
    mediaType: 'application/json',
  })
  const persona = personas.save({ format: 0, name: '小满', description: '刚到海城的旅人。' })
  const preset = presets.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '保持角色语气。' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  }), '潮汐策略.json'))
  const world = worldInfos.importFile({
    filename: '海城.json',
    data: new TextEncoder().encode(JSON.stringify({
      name: '海城',
      entries: { 0: {
        uid: 0, key: [], keysecondary: [], content: '海城终年多雾。', constant: true,
        selective: false, order: 1, position: 0, disable: false,
      } },
    })),
  })
  const regexPack = regexPacks.importFile({
    filename: '全局规则.json',
    data: new TextEncoder().encode(JSON.stringify([{
      id: 'global-before-preset', scriptName: '全局先行', findRegex: '/海城/g', replaceString: '雾都',
      trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true,
      runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    }])),
  })
  const catalog = new RoleplayResourceCatalog()
  for (const provider of roleplayLibraryResourceProviders({ characters, personas, presets, regexPacks, worldInfos })) {
    catalog.register(provider)
  }
  catalog.register(nativePromptPolicyResourceProvider())
  return { characters, personas, presets, regexPacks, worldInfos, chats, character, persona, preset, regexPack, world, catalog }
}

test('materializes five independent resources into one exact replayable character experience', context => {
  const value = fixture(context)
  const actorId = characterLibraryRoleplayResourceId(value.character.id)
  const worldId = worldInfoLibraryRoleplayResourceId(value.world.id)
  const promptPolicyId = presetLibraryRoleplayResourceId(value.preset.id)
  const regexPackId = regexPackLibraryRoleplayResourceId(value.regexPack.id)
  const request = parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source-session',
    kind: 'experience',
    mode: 'character',
    actor: { kind: 'actor', id: actorId, variant: 'greeting:1' },
    participant: { kind: 'persona', id: value.persona.id },
    worlds: [{ kind: 'world', id: worldId }],
    promptPolicy: { kind: 'prompt-policy', id: promptPolicyId },
    regexPacks: [{ kind: 'regex', id: regexPackId }],
  })
  assert.equal(request.kind, 'experience')
  const prepared = prepareAgentRpSession(
    value.characters,
    value.chats,
    value.presets,
    value.worldInfos,
    request,
    value.catalog,
  )
  const first = Session.create(SessionId('native-experience-first'), prepared.seed)
  const replay = Session.create(SessionId('native-experience-replay'), structuredClone(first.events))
  const runtime = resolveSessionRoleplayRuntime({
    session: replay,
    deployment: resolveConfig({ characterName: 'fallback' }),
  }).snapshot

  assert.equal(prepared.title, '白露')
  assert.equal(JSON.stringify(first.deriveMessages()).includes('第二幕开始了，小满。'), true)
  assert.equal(readActiveSessionCharacter(replay.events)?.result.greetingIndex, 1)
  assert.equal(readSessionPersona(replay.events)?.description, value.persona.description)
  assert.equal(readActiveSessionPreset(replay.events)?.libraryId, value.preset.id)
  assert.deepEqual(readActiveSessionWorldInfos(replay.events).map(entry => entry.result.name), ['海城'])
  assert.deepEqual(readRoleplayExperienceSelection(replay.events), {
    format: 0,
    mode: 'character',
    actor: { kind: 'actor', id: actorId, variant: 'greeting:1' },
    participant: { kind: 'persona', id: value.persona.id },
    worlds: [{ kind: 'world', id: worldId }],
    promptPolicy: { kind: 'prompt-policy', id: promptPolicyId },
    regexPacks: [{ kind: 'regex', id: regexPackId }],
  })
  assert.deepEqual(readSessionRegexPacks(replay.events).map(pack => pack.id), [value.regexPack.id])
  let projectionState = agentRpProjectionDefinition.init(replay.header)
  for (const event of replay.events) projectionState = agentRpProjectionDefinition.apply(projectionState, event)
  assert.deepEqual(agentRpProjectionDefinition.wire.view(projectionState).regexPacks.map(pack => ({
    id: pack.id,
    scriptCount: pack.scriptCount,
    enabledCount: pack.enabledCount,
    displayCount: pack.displayCount,
    promptCount: pack.promptCount,
  })), [{ id: value.regexPack.id, scriptCount: 1, enabledCount: 1, displayCount: 0, promptCount: 1 }])
  assert.equal(runtime.experience.id, actorId)
  assert.equal(runtime.actor?.id, actorId)
  assert.equal(runtime.participant?.id, value.persona.id)
  assert.equal(runtime.world.bindings.some(binding => binding.id === worldId), true)
  assert.equal(runtime.prompt.resource?.id, promptPolicyId)
  const plan = prepareRoleplayTurn({
    session: replay,
    deployment: resolveConfig({ characterName: 'fallback' }),
    resolved: resolveSessionRoleplayRuntime({
      session: replay,
      deployment: resolveConfig({ characterName: 'fallback' }),
    }),
  })
  assert.equal(plan.prompt.transforms.operations[0]?.owner, 'regex')
})

test('keeps one snapshot when an actor-bound world is also selected explicitly', context => {
  const value = fixture(context)
  const binding = value.characters.get(value.character.id).worldBinding
  assert.ok(binding !== undefined)
  value.characters.updateWorldBinding(value.character.id, {
    format: 0,
    revision: binding.revision,
    primaryWorldInfoId: value.world.id,
    additionalWorldInfoIds: [],
  })
  const actorId = characterLibraryRoleplayResourceId(value.character.id)
  const worldId = worldInfoLibraryRoleplayResourceId(value.world.id)
  const request = parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source-session',
    kind: 'experience',
    mode: 'character',
    actor: { kind: 'actor', id: actorId },
    worlds: [{ kind: 'world', id: worldId }],
  })
  if (request.kind !== 'experience') assert.fail('experience request was not parsed')
  const prepared = prepareAgentRpSession(
    value.characters,
    value.chats,
    value.presets,
    value.worldInfos,
    request,
    value.catalog,
  )
  const session = Session.create(SessionId('bound-world-selected-explicitly'), prepared.seed)

  assert.deepEqual(readActiveSessionWorldInfos(session.events).map(entry => ({
    attachmentId: entry.result.sourceAttachmentId,
    placement: entry.placement,
    purpose: entry.purpose,
  })), [{
    attachmentId: `library:${value.world.id}`,
    placement: 'actor',
    purpose: 'character-binding',
  }])
  assert.deepEqual(readRoleplayExperienceSelection(session.events)?.worlds, [{
    kind: 'world', id: worldId,
  }])
})

test('normalizes older experience provenance without a regex-pack selection', () => {
  assert.deepEqual(parseRoleplayExperienceSelection({
    format: 0,
    mode: 'character',
    actor: { kind: 'actor', id: 'actor:legacy' },
    worlds: [],
  }), {
    format: 0,
    mode: 'character',
    actor: { kind: 'actor', id: 'actor:legacy' },
    worlds: [],
    regexPacks: [],
  })
})

test('materializes a scene without fabricating an actor and preserves its primary world reference', context => {
  const value = fixture(context)
  const worldId = worldInfoLibraryRoleplayResourceId(value.world.id)
  const request = parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source-session',
    kind: 'experience',
    mode: 'scene',
    participant: { kind: 'persona', id: value.persona.id },
    worlds: [{ kind: 'world', id: worldId }],
  })
  if (request.kind !== 'experience') assert.fail('experience request was not parsed')
  const prepared = prepareAgentRpSession(
    value.characters,
    value.chats,
    value.presets,
    value.worldInfos,
    request,
    value.catalog,
  )
  const session = Session.create(SessionId('native-scene'), prepared.seed)
  const runtime = resolveSessionRoleplayRuntime({
    session,
    deployment: resolveConfig({ characterName: 'fallback' }),
  }).snapshot

  assert.equal(prepared.title, '海城')
  assert.equal(runtime.experience.mode, 'scene')
  assert.equal(runtime.experience.id, worldId)
  assert.equal(runtime.actor, undefined)
  assert.equal(session.events.filter(event => event.type === 'turn/start').length, 1)
  assert.equal(session.events.some(event => event.type === 'user/message' || event.type === 'assistant/message'), false)
})

test('freezes and applies the built-in immersive story policy as one replayable experience resource', context => {
  const value = fixture(context)
  const actorId = characterLibraryRoleplayResourceId(value.character.id)
  const request = parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source-session',
    kind: 'experience',
    mode: 'character',
    actor: { kind: 'actor', id: actorId },
    worlds: [],
    promptPolicy: { kind: 'prompt-policy', id: IMMERSIVE_STORY_PROMPT_POLICY_ID },
  })
  if (request.kind !== 'experience') assert.fail('experience request was not parsed')
  const prepared = prepareAgentRpSession(
    value.characters,
    value.chats,
    value.presets,
    value.worldInfos,
    request,
    value.catalog,
  )
  const session = Session.create(SessionId('native-prompt-policy-replay'), structuredClone(prepared.seed))
  const resolved = resolveSessionRoleplayRuntime({
    session,
    deployment: resolveConfig({ characterName: 'fallback' }),
  })
  const policy = readNativePromptPolicy(session.events)
  assert.ok(policy !== undefined)
  const plan = prepareRoleplayTurn({
    session,
    deployment: resolveConfig({ characterName: 'fallback' }),
    resolved,
  })

  assert.equal(resolved.snapshot.prompt.strategy, 'native')
  assert.equal(resolved.snapshot.prompt.resource?.id, IMMERSIVE_STORY_PROMPT_POLICY_ID)
  assert.deepEqual(policy.modules.map(module => [module.layer, module.id]), [
    ['frontstage', 'frontstage:presence'],
    ['stage', 'stage:causality'],
    ['frontstage', 'frontstage:concrete-prose'],
    ['stage', 'stage:player-space'],
  ])
  assert.equal(plan.prompt.systemPromptText.endsWith(renderNativePromptPolicy(policy)), true)
  assert.equal(plan.prompt.diagnostics.enabledModules, 4)
})

test('rejects malformed cross-kind and duplicate source-neutral selections', () => {
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source-session',
    kind: 'experience',
    mode: 'character',
    actor: { kind: 'world', id: 'standalone:fixture' },
    worlds: [],
  }), /角色资源/u)
  assert.throws(() => parseAgentRpSessionLaunchRequest({
    format: 0,
    sourceSessionId: 'source-session',
    kind: 'experience',
    mode: 'scene',
    worlds: [
      { kind: 'world', id: 'standalone:fixture' },
      { kind: 'world', id: 'standalone:fixture' },
    ],
  }), /不能重复/u)
})

test('audits the checked-in real-format fixtures without exposing their content', () => {
  const result = auditRoleplayExperience({
    cardPath: 'tests/fixtures/manual-character-card.png',
    presetPath: 'tests/fixtures/manual-sillytavern-preset.json',
    worldInfoPath: 'tests/fixtures/manual-world-info.json',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.catalog.kinds, { actor: 1, persona: 1, world: 1, 'prompt-policy': 1 })
  assert.equal(Object.values(result.session).every(Boolean), true)
})
