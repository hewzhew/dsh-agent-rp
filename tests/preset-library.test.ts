import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { readActiveSessionPreset } from '../src/import/session-preset.ts'
import { parseSillyTavernPresetJson } from '../src/import/sillytavern-preset.ts'
import { configurePreset } from '../src/preset-configuration-core.ts'
import { PresetLibrary } from '../src/preset-library.ts'
import { executePresetLibraryCommand } from '../src/preset-library-command.ts'
import { parsePresetLibraryResult } from '../src/preset-library-protocol.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'
import { presetLibraryOptionLabel, type PresetLibrarySummary } from '../src/preset-library-http-protocol.ts'

function preset(name = '通用预设') {
  return parseSillyTavernPresetJson(JSON.stringify({
    prompts: [
      { identifier: 'main', name: '主提示', role: 'system', content: '默认正文' },
      { identifier: 'style', name: '风格', role: 'system', content: '简短' },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'main', enabled: true },
      { identifier: 'style', enabled: false },
    ] }],
    extensions: { regex_scripts: [], SPreset: { MacroNest: true } },
  }), `${name}.json`)
}

let commandSequence = 0

function invoke(agent: Agent, library: PresetLibrary, request: object): void {
  const commandId = CommandId(`preset-library-${commandSequence++}`)
  const rawInput = JSON.stringify(request)
  agent.session.append('command/run', {
    commandId,
    name: 'rp-preset-library',
    args: ` ${rawInput}`,
    source: { kind: 'user' },
  })
  const result = executePresetLibraryCommand(library, { agent, rawInput })
  agent.session.append('command/done', { commandId, ...result })
}

function projected(agent: Agent) {
  let state = agentRpProjectionDefinition.init(agent.session.header)
  for (const event of agent.session.events) state = agentRpProjectionDefinition.apply(state, event)
  return agentRpProjectionDefinition.wire.view(state)
}

test('stores reusable presets outside settings and returns detached session defaults', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-preset-library-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new PresetLibrary({ root })
  const imported = library.import(preset())
  assert.equal(library.import(preset()).id, imported.id)
  assert.deepEqual(library.list().map(item => item.name), ['通用预设'])
  assert.equal(library.get(imported.id).preset.extensionSummary.hasSPreset, true)
  assert.deepEqual(library.get(imported.id).preset.extensionCompatibility, { macroNestEnabled: true })
  const withContinuePrefill = library.import({
    ...preset(),
    continuation: { prefill: true, postfix: '\n\n', nudgePrompt: '继续上一条回复' },
  })
  assert.notEqual(withContinuePrefill.id, imported.id)
  assert.deepEqual(library.get(withContinuePrefill.id).preset.continuation, {
    prefill: true, postfix: '\n\n', nudgePrompt: '继续上一条回复',
  })
  const withoutMacroNest = library.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '默认正文' },
      { identifier: 'style', name: '风格', role: 'system', content: '简短' }],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'main', enabled: true }, { identifier: 'style', enabled: false },
    ] }],
    extensions: { regex_scripts: [], SPreset: { MacroNest: false } },
  }), '通用预设.json'))
  assert.notEqual(withoutMacroNest.id, imported.id)

  const selected = library.get(imported.id)
  const active = {
    result: {
      version: 0 as const, name: selected.name, sourceEventSeq: 0,
      sourceAttachmentId: `library:${selected.id}`, promptCount: 2, enabledCount: 1, regexScriptCount: 0,
    },
    importedPreset: selected.preset,
    preset: selected.preset,
    revision: 0,
    libraryId: selected.id,
  }
  const edited = configurePreset(active, { operation: 'toggle', revision: 0, identifier: 'style', enabled: true })
  assert.equal(edited.order.find(item => item.identifier === 'style')?.enabled, true)
  assert.equal(library.get(imported.id).preset.order.find(item => item.identifier === 'style')?.enabled, false)
})

test('retains Tavern Helper source diagnostics after a preset library round trip', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-preset-library-helper-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new PresetLibrary({ root })
  const imported = library.import(parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: '默认正文' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    extensions: { tavern_helper: [
      ['scripts', [{ id: 'on', name: '启用', content: 'secret', enabled: true },
        { id: 'off', name: '关闭', content: 'secret', enabled: false }]],
      ['variables', { privateValue: 'not exposed' }],
      ['legacy_ui', true],
    ] },
  }), '条目预设.json'))

  assert.deepEqual(imported.tavernHelper, {
    format: 'entries', scriptCount: 2, enabledScriptCount: 1, expectedScriptCount: 2,
    variableCount: 1, ignoredFieldCount: 1,
  })
  assert.deepEqual(library.list()[0]?.tavernHelper, imported.tavernHelper)
  assert.deepEqual(library.get(imported.id).preset.extensionCompatibility, {
    tavernHelperScriptCount: 2,
    enabledTavernHelperScriptCount: 1,
    tavernHelperFormat: 'entries',
    tavernHelperVariableCount: 1,
    tavernHelperIgnoredFieldCount: 1,
  })
  const agent = { session: Session.create(SessionId('helper-diagnostics')) } as Agent
  invoke(agent, library, { operation: 'select', id: imported.id })
  assert.deepEqual(projected(agent).preset?.extensionStatus, [{
    name: 'Tavern Helper 脚本',
    detail: '条目数组 · 1/2 个脚本接管 · 1 个变量 · 1 个扩展字段未接管',
    state: 'active',
  }])
  assert.deepEqual(projected(agent).presetLibrary[0]?.tavernHelper, imported.tavernHelper)
})

test('disambiguates an incomplete old import from a complete same-name preset', () => {
  const base = {
    name: '同名预设', promptCount: 217, enabledCount: 62, regexScriptCount: 40,
  }
  const entries: PresetLibrarySummary[] = [{
    ...base, id: 'import-old', updatedAt: 1_786_650_371_352,
    tavernHelper: { scriptCount: 0, enabledScriptCount: 0, expectedScriptCount: 3 },
  }, {
    ...base, id: 'import-complete', updatedAt: 1_786_688_182_091,
    tavernHelper: { scriptCount: 3, enabledScriptCount: 2, expectedScriptCount: 3 },
  }]

  assert.match(presetLibraryOptionLabel(entries[0]!, entries), /旧导入，缺 3 个 TH 脚本/u)
  assert.match(presetLibraryOptionLabel(entries[1]!, entries), /TH 2\/3/u)
})

test('selects, saves, lists, and deletes library presets without mutating an active snapshot', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-preset-library-command-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new PresetLibrary({ root })
  const imported = library.import(preset())
  const agent = { session: Session.create(SessionId('library-session')) } as Agent

  invoke(agent, library, { operation: 'select', id: imported.id })
  const active = readActiveSessionPreset(agent.session.events)
  assert.equal(active?.libraryId, imported.id)
  assert.equal(active?.preset.name, '通用预设')
  assert.equal(projected(agent).preset?.libraryId, imported.id)
  assert.deepEqual(projected(agent).preset?.extensionStatus, [{
    name: '嵌套宏', detail: '已由 Agent RP 组装器执行', state: 'active',
  }])
  assert.deepEqual(projected(agent).presetLibrary.map(item => item.id), [imported.id])

  invoke(agent, library, { operation: 'rename', id: imported.id, name: '通用预设（自定义）' })
  assert.equal(library.get(imported.id).name, '通用预设（自定义）')
  assert.equal(projected(agent).presetLibrary.find(item => item.id === imported.id)?.name, '通用预设（自定义）')
  assert.equal(readActiveSessionPreset(agent.session.events)?.result.name, '通用预设')

  invoke(agent, library, { operation: 'save', name: '我的副本' })
  assert.deepEqual(library.list().map(item => item.name).sort(), ['我的副本', '通用预设（自定义）'])
  const saved = library.list().find(item => item.name === '我的副本')!
  invoke(agent, library, { operation: 'delete', id: saved.id })
  assert.deepEqual(library.list().map(item => item.name), ['通用预设（自定义）'])
  assert.equal(readActiveSessionPreset(agent.session.events)?.preset.name, '通用预设')
  assert.equal(agent.session.events.at(-1)?.type, 'command/done')
})

test('adopts an older session preset into the library without replacing its edited state', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-preset-library-adopt-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new PresetLibrary({ root })
  const imported = preset()
  const oldAgent = { session: Session.create(SessionId('pre-library'), [{
    type: 'agent-rp/sillytavern-preset-seed', seq: 0, time: Date.now(),
    data: {
      format: 0,
      source: { attachmentConsumer: 'dsh-agent-rp', attachments: [{
        kind: 'file', attachmentId: 'sha256:old' as never, bytes: 1, name: 'old.json', mediaType: 'application/json',
      }] },
      result: { version: 0, name: imported.name, sourceEventSeq: 0, sourceAttachmentId: 'sha256:old',
        promptCount: 2, enabledCount: 1, regexScriptCount: 0 },
      preset: imported,
    },
  }]) } as Agent
  const configureId = CommandId('configure-old-preset')
  oldAgent.session.append('command/run', {
    commandId: configureId,
    name: 'rp-preset-configure',
    args: JSON.stringify({ operation: 'toggle', revision: 0, identifier: 'style', enabled: true }),
    source: { kind: 'user' },
  })
  oldAgent.session.append('command/done', { commandId: configureId, kind: 'success' })
  invoke(oldAgent, library, { operation: 'list' })
  const adopted = readActiveSessionPreset(oldAgent.session.events)!
  assert.equal(adopted.preset.order.find(item => item.identifier === 'style')?.enabled, true)
  assert.ok(adopted.libraryId)
  assert.equal(library.list().length, 1)
  assert.equal(projected(oldAgent).preset?.enabledCount, 2)
  assert.equal(projected(oldAgent).preset?.libraryId, adopted.libraryId)
})

test('keeps a selected session snapshot after its reusable library copy is deleted', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-preset-library-delete-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const library = new PresetLibrary({ root })
  const imported = library.import(preset())
  const agent = { session: Session.create(SessionId('deleted-library-source')) } as Agent
  invoke(agent, library, { operation: 'select', id: imported.id })
  invoke(agent, library, { operation: 'delete', id: imported.id })
  assert.equal(library.list().length, 0)
  assert.equal(readActiveSessionPreset(agent.session.events)?.preset.name, '通用预设')
  assert.equal(projected(agent).preset?.name, '通用预设')
  assert.equal(projected(agent).presetLibrary.length, 0)
})

test('ignores unrelated command text and rejects malformed marked results', () => {
  assert.equal(parsePresetLibraryResult('普通命令结果'), undefined)
  assert.throws(() => parsePresetLibraryResult('agent-rp:preset-library:v0:{'), /不是有效 JSON/u)
  assert.throws(() => parsePresetLibraryResult('agent-rp:preset-library:v0:{"format":0,"operation":"list","entries":{}}'), /无效字段/u)
})

test('projects the Host-recorded request instead of reconstructing an inspection guess', () => {
  const imported = preset()
  const agent = { session: Session.create(SessionId('request-inspection'), [{
    type: 'agent-rp/sillytavern-preset-seed', seq: 0, time: 1,
    data: {
      format: 0,
      source: { attachmentConsumer: 'dsh-agent-rp', attachments: [{
        kind: 'file', attachmentId: 'sha256:request' as never, bytes: 1,
        name: 'request.json', mediaType: 'application/json',
      }] },
      result: {
        version: 0, name: imported.name, sourceEventSeq: 0, sourceAttachmentId: 'sha256:request',
        promptCount: 2, enabledCount: 1, regexScriptCount: 0,
      },
      preset: imported,
    },
  }]) } as Agent
  agent.session.append('request/header', {
    reason: 'initial',
    header: {
      config: {
        provider: 'real-provider', model: 'real-model', reasoningEffort: 'high' as never,
        temperature: 0.7, maxTokens: 4096,
      },
      system: 'Host 最终组装内容',
      tools: [{ name: 'remember', description: 'memory', parameters: { type: 'object', properties: {} } }],
    },
  })
  const view = projected(agent)
  assert.equal(view.lastRequest?.system, 'Host 最终组装内容')
  assert.deepEqual(view.lastRequest?.config, {
    provider: 'real-provider', model: 'real-model', reasoningEffort: 'high', temperature: 0.7, maxTokens: 4096,
  })
  assert.deepEqual(view.lastRequest?.toolNames, ['remember'])
  assert.equal(view.lastRequest?.presetName, imported.name)
  assert.equal(view.lastRequest?.presetRevision, 0)
})
