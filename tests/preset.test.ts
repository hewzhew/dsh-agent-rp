import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { isAgentRpCapabilityComposition } from '../src/agent-capability-preset.ts'
import { resolveConfig } from '../src/config.ts'
import { installAgentRp } from '../src/index.ts'
import { parseSillyTavernPresetJson } from '../src/import/sillytavern-preset.ts'
import { createPresetSessionSeed, readActiveSessionPreset } from '../src/import/session-preset.ts'
import { installBundledAgentRpPreset } from '../src/preset.ts'
import { sessionEvents } from '../src/session-events.ts'

const SOURCE = resolve('preset')

test('profile bundle keeps its managed Agent preset discoverable', () => {
  const patch = readFileSync('cordis.patch.yml', 'utf8')
  assert.match(patch, /- id: agent-presets\s+config:\s+[^]*?default: standard\s+includeUserRoot: true/u)
})

test('roleplay preset exposes search without inheriting coding authority', () => {
  const composition = readFileSync('preset/agent.cordis.yml', 'utf8')
  assert.match(composition, /name: cordis:group\s+isolate:\s+agentRp\.actorRevisions: true/u)
  assert.match(composition, /name: '@deepseek-ai\/dsh-tool-web'/u)
  assert.doesNotMatch(composition, /dsh-tool-(?:bash|fs|skill|subagent)/u)
  assert.match(readFileSync('preset/preset.yml', 'utf8'), /受控联网搜索/u)
})

test('discovers the managed Agent preset with Windows line endings', () => {
  const composition = readFileSync('preset/agent.cordis.yml', 'utf8')
  assert.equal(isAgentRpCapabilityComposition(composition.replaceAll('\n', '\r\n')), true)
})

function temporaryRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-agent-rp-preset-'))
}

test('installs one idempotent managed preset', (context) => {
  const root = temporaryRoot()
  context.after(() => rmSync(root, { recursive: true, force: true }))

  assert.equal(installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE }), 'created')
  assert.equal(installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE }), 'unchanged')
  assert.match(readFileSync(join(root, 'agent-rp', 'agent.cordis.yml'), 'utf8'), /mode: character/u)
  assert.match(readFileSync(join(root, 'agent-rp', 'preset.yml'), 'utf8'), /角色会话/u)
})

test('migrates the managed preset owner without replacing local content', (context) => {
  const root = temporaryRoot()
  context.after(() => rmSync(root, { recursive: true, force: true }))

  assert.equal(installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE }), 'created')
  const manifestPath = join(root, 'agent-rp', '.dsh-agent-rp-owner.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, `${JSON.stringify({
    ...manifest,
    owner: '@dsh-external/dsh-agent-rp',
  }, null, 2)}\n`, 'utf8')

  assert.equal(installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE }), 'updated')
  assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).owner, '@hewzhew/dsh-agent-rp')
})

test('refuses to replace a locally edited managed preset', (context) => {
  const root = temporaryRoot()
  context.after(() => rmSync(root, { recursive: true, force: true }))
  installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE })
  writeFileSync(join(root, 'agent-rp', 'preset.yml'), 'name: 我的角色\n', 'utf8')

  assert.throws(
    () => installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE }),
    /edited locally/u,
  )
})

test('refuses to claim an existing user preset with the reserved id', (context) => {
  const root = temporaryRoot()
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(root, 'agent-rp')
  mkdirSync(target)
  writeFileSync(join(target, 'agent.cordis.yml'), '[]\n', 'utf8')
  assert.throws(
    () => installBundledAgentRpPreset({ presetRoot: root, sourceDir: SOURCE }),
    /not managed/u,
  )
})

test('mounts public Agent RP commands', async (context) => {
  const root = new Context()
  await root.plugin(AgentRegistry)
  const preset = createScope(root, {})
  const commands: string[] = []
  const commandInputs = new Map<string, { readonly hint: string } | undefined>()
  root.provide('systemPrompt' as never, { section: () => () => {}, context: () => () => {} } as never)
  root.provide('tools' as never, { register: () => () => {} } as never)
  root.provide('commands' as never, {
    register(definition: { readonly name: string; readonly input?: { readonly hint: string } }) {
      if (definition.input !== undefined) assert.notEqual(definition.input.hint.trim(), '')
      commands.push(definition.name)
      commandInputs.set(definition.name, definition.input)
      return () => {}
    },
  } as never)
  root.provide('attachments' as never, {} as never)
  root.provide('credentials' as never, {} as never)
  const characterLibraryRoot = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-public-gateway-'))
  context.after(() => { rmSync(characterLibraryRoot, { recursive: true, force: true }) })

  installAgentRp(preset.ctx, resolveConfig({ mode: 'character' }), { characterLibraryRoot })
  assert.deepEqual(commands, [
    'rp-tavern-variables',
    'rp-tavern-trigger',
    'rp-character-library',
    'rp-chat-import',
    'rp-persona',
    'rp-story-workspace',
    'rp-memory',
    'rp-state',
    'rp-turn-mode',
    'rp-preset-configure',
    'rp-preset-library',
    'rp-generation',
    'rp-draw',
    'rp-world-info',
    'rp-world-info-import',
  ])
  assert.equal(commandInputs.get('rp-tavern-trigger'), undefined)

  context.after(async () => {
    await preset.dispose()
    await root.fiber.dispose()
  })
})

test('preserves a scoped worker persona during Agent RP prompt assembly', async (context) => {
  const root = new Context()
  await root.plugin(LlmRuntime)
  await root.plugin(SystemPrompt, { persona: '部署默认人物' })
  await root.plugin(ToolRegistry)
  await root.plugin(AgentRegistry)
  root.provide('commands' as never, { register: () => () => {} } as never)
  root.provide('attachments' as never, {} as never)
  root.provide('credentials' as never, {} as never)
  const presetKey = {}
  const preset = createScope(root, presetKey)
  const characterLibraryRoot = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-worker-persona-'))
  let agentParentCtx: Context | undefined
  await preset.ctx.plugin({
    inject: ['llm', 'systemPrompt', 'tools'],
    apply(pluginCtx: Context) {
      installAgentRp(pluginCtx, resolveConfig({ mode: 'character' }), { characterLibraryRoot })
      agentParentCtx = pluginCtx
    },
  })
  assert.ok(agentParentCtx)

  const session = Session.create(SessionId('scoped-worker-persona'))
  const agent = { id: session.id, session } as Agent
  const agentScope = createScope(agentParentCtx, agent, { parent: presetKey })
  Object.assign(agent, { ctx: agentScope.ctx })
  const unregister = root.agents.register(agent)
  agentScope.ctx.systemPrompt.section({
    name: 'deployment:persona',
    order: agentScope.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA'),
    text: '只执行指定人物的结构化判断。',
  })

  const assembly = await root.systemPrompt.assemble({ scope: agent })
  assert.equal(assembly.sections.find(section => section.name === 'deployment:persona')?.text,
    '只执行指定人物的结构化判断。')

  context.after(async () => {
    unregister()
    await agentScope.dispose()
    await preset.dispose()
    await root.fiber.dispose()
    rmSync(characterLibraryRoot, { recursive: true, force: true })
  })
})

test('creates an imported preset Session seed before a model turn', () => {
  const preset = parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: '角色规则' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  }), 'V18.json')
  const source = Session.create(SessionId('preset-source'))
  const attachment = {
    kind: 'file' as const,
    attachmentId: 'sha256:preset' as never,
    bytes: 100,
    name: 'V18.json',
    mediaType: 'application/json',
  }
  const imported = Session.create(SessionId('preset-imported'), createPresetSessionSeed(sessionEvents(source), preset, attachment))

  assert.equal(readActiveSessionPreset(sessionEvents(imported))?.preset.name, 'V18')
  assert.equal(readActiveSessionPreset(sessionEvents(imported))?.result.enabledCount, 1)
  assert.equal(imported.deriveMessages().length, 0)
})
