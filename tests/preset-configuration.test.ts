import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  canTogglePresetPrompt,
  configurePreset,
  parsePresetConfigurationRequest,
} from '../src/preset-configuration.ts'
import { createPresetSessionSeed, readActiveSessionPreset } from '../src/import/session-preset.ts'
import { parseSillyTavernPresetJson } from '../src/import/sillytavern-preset.ts'
import { assembleSillyTavernPreset } from '../src/preset-prompt.ts'
import { exportSillyTavernPresetJson } from '../src/preset-export.ts'
import type { FileAttachmentRef } from '../src/import/session-character.ts'
import { importTavernRegex } from '../src/tavern-regex.ts'

const source = {
  attachmentId: 'preset-source',
  name: '可编辑预设.json',
  mediaType: 'application/json',
} as FileAttachmentRef

function importedPreset() {
  return parseSillyTavernPresetJson(JSON.stringify({
    prompts: [
      { identifier: 'main', name: '主提示', role: 'system', content: 'main', marker: true },
      { identifier: 'style', name: '文风', role: 'system', content: 'style', marker: false },
      { identifier: 'private-marker', name: '扩展结构位', role: 'system', content: '', marker: true },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'main', enabled: true },
      { identifier: 'style', enabled: false },
      { identifier: 'private-marker', enabled: false },
    ] }],
    temperature: 0.8,
    openai_max_tokens: 2048,
  }), source.name)
}

function activePreset() {
  const preset = importedPreset()
  return {
    result: {
      version: 0 as const,
      name: preset.name,
      sourceEventSeq: 0,
      sourceAttachmentId: String(source.attachmentId),
      promptCount: preset.prompts.length,
      enabledCount: 1,
      regexScriptCount: 0,
    },
    importedPreset: preset,
    preset,
    revision: 0,
  }
}

test('edits module switches, order, and generation without changing imported defaults', () => {
  const active = activePreset()
  const edited = configurePreset(active, {
    operation: 'replace',
    revision: 0,
    order: [
      { identifier: 'style', enabled: true },
      { identifier: 'main', enabled: true },
    ],
    content: [],
    generation: { temperature: 1.1, maxTokens: null, reasoningEffort: 'high' },
    regex: [],
  })

  assert.deepEqual(edited.order, [
    { identifier: 'style', enabled: true },
    { identifier: 'main', enabled: true },
  ])
  assert.deepEqual(edited.generation, { temperature: 1.1, reasoningEffort: 'high' })
  assert.equal(active.importedPreset.order[0]?.identifier, 'main')
  assert.deepEqual(active.importedPreset.generation, { temperature: 0.8, maxTokens: 2048 })
})

test('adds, runs, edits, and deletes one session-owned module', () => {
  const active = activePreset()
  const prompts = active.preset.prompts.map(prompt => ({
    identifier: prompt.identifier, name: prompt.name, role: prompt.role, content: prompt.content,
  }))
  const added = configurePreset(active, {
    operation: 'replace', revision: 0,
    prompts: [...prompts, {
      identifier: 'custom', name: '自定义', role: 'user', content: '只在本会话使用',
      injectionPosition: 0, injectionDepth: 4, injectionOrder: 100,
    }],
    order: [...active.preset.order, { identifier: 'custom', enabled: true }],
    content: [], generation: {}, regex: [],
  })
  assert.equal(added.prompts.at(-1)?.systemPrompt, false)
  assert.equal(added.prompts.at(-1)?.marker, false)
  assert.equal(added.prompts.at(-1)?.injectionPosition, 0)
  const assembled = assembleSillyTavernPreset(added, {
    card: {
      format: 0, version: 2, specVersion: '2.0', name: '角色', description: '', personality: '', scenario: '',
      firstMessage: '', messageExample: '', alternateGreetings: [], systemPrompt: '', postHistoryInstructions: '',
      frontend: { regexScripts: [], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {} }, degradations: [], raw: {},
    },
    worldInfoBefore: [], worldInfoAfter: [], session: Session.create(SessionId('custom-preset-prompt')), pendingMessages: [],
  })
  assert.deepEqual(assembled.beforeHistory.at(-1), { role: 'user', content: '只在本会话使用' })

  const deleted = configurePreset({ ...active, preset: added, revision: 1 }, {
    operation: 'replace', revision: 1, prompts,
    order: active.preset.order, content: [], generation: {}, regex: [],
  })
  assert.equal(deleted.prompts.some(prompt => prompt.identifier === 'custom'), false)
  assert.throws(() => configurePreset(active, {
    operation: 'replace', revision: 0,
    prompts: prompts.filter(prompt => prompt.identifier !== 'main'),
    order: active.preset.order.filter(entry => entry.identifier !== 'main'),
    content: [], generation: {}, regex: [],
  }), /built-in module.*cannot be deleted/u)
  const invalidDepth = parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0,
    prompts: [...prompts, {
      identifier: 'bad-depth', name: '错误深度', role: 'system', content: '',
      injectionPosition: 1, injectionDepth: -1, injectionOrder: 100,
    }],
    order: active.preset.order, content: [], generation: {}, regex: [],
  }))
  assert.throws(() => configurePreset(active, invalidDepth), /injectionDepth/u)
})

test('round-trips legacy injection metadata while rejecting newly invalid values', () => {
  const imported = parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{
      identifier: 'legacy-in-chat', name: '旧聊天内注入', role: 'system', content: 'legacy',
      injection_position: 1, injection_depth: 4, injection_order: 10_001,
    }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'legacy-in-chat', enabled: true }] }],
  }), 'legacy-injection-order.json')
  const active = {
    result: {
      version: 0 as const, name: imported.name, sourceEventSeq: 0, sourceAttachmentId: 'legacy-source',
      promptCount: 1, enabledCount: 1, regexScriptCount: 0,
    },
    importedPreset: imported,
    preset: imported,
    revision: 0,
  }
  const unchanged = parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0,
    prompts: [{
      identifier: 'legacy-in-chat', name: '只改名称', role: 'system', content: 'legacy',
      injectionPosition: 1, injectionDepth: 4, injectionOrder: 10_001,
    }],
    order: imported.order, content: [], generation: {}, regex: [],
  }))
  const configured = configurePreset(active, unchanged)
  assert.equal(configured.prompts[0]?.name, '只改名称')
  assert.equal(configured.prompts[0]?.injectionOrder, 10_001)
  assert.equal(JSON.parse(exportSillyTavernPresetJson(configured)).prompts[0].injection_order, 10_001)

  const invalidEdit = parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0,
    prompts: [{
      identifier: 'legacy-in-chat', name: '旧聊天内注入', role: 'system', content: 'legacy',
      injectionPosition: 1, injectionDepth: 4, injectionOrder: 10_002,
    }],
    order: imported.order, content: [], generation: {}, regex: [],
  }))
  assert.throws(() => configurePreset(active, invalidEdit), /injectionOrder must be an integer from 0 to 9999/u)
})

test('round-trips the author module catalog independently from the active order', () => {
  const imported = parseSillyTavernPresetJson(JSON.stringify({
    prompts: [
      { identifier: 'system', name: '系统', role: 'system', content: 'system', marker: true },
      { identifier: 'style-default', name: '默认文风', role: 'system', content: 'default' },
      { identifier: 'style-a', name: '备选文风 A', role: 'system', content: 'style a' },
      { identifier: 'style-b', name: '备选文风 B', role: 'system', content: 'style b' },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'system', enabled: true },
      { identifier: 'style-default', enabled: true },
    ] }],
  }), 'module-catalog.json')
  const active = {
    result: {
      version: 0 as const, name: imported.name, sourceEventSeq: 0, sourceAttachmentId: 'catalog-source',
      promptCount: imported.prompts.length, enabledCount: 2, regexScriptCount: 0,
    },
    importedPreset: imported,
    preset: imported,
    revision: 0,
  }
  const configured = configurePreset(active, {
    operation: 'replace', revision: 0,
    prompts: imported.prompts.map(prompt => ({
      identifier: prompt.identifier, name: prompt.name, role: prompt.role, content: prompt.content,
    })),
    order: [
      { identifier: 'system', enabled: true },
      { identifier: 'style-a', enabled: true },
    ],
    content: [], generation: {}, regex: [],
  })

  assert.equal(configured.prompts.length, 4)
  assert.deepEqual(configured.order.map(entry => entry.identifier), ['system', 'style-a'])
  assert.equal(configured.prompts.find(prompt => prompt.identifier === 'style-default')?.content, 'default')
  assert.equal(configured.prompts.find(prompt => prompt.identifier === 'style-b')?.content, 'style b')

  const exported = JSON.parse(exportSillyTavernPresetJson(configured)) as {
    prompts: Array<{ identifier: string }>
    prompt_order: Array<{ order: Array<{ identifier: string; enabled: boolean }> }>
  }
  assert.deepEqual(exported.prompts.map(prompt => prompt.identifier), ['system', 'style-default', 'style-a', 'style-b'])
  assert.deepEqual(exported.prompt_order[0]?.order, [
    { identifier: 'system', enabled: true },
    { identifier: 'style-a', enabled: true },
  ])
})

test('keeps extension markers fixed and restores the exact imported defaults', () => {
  const active = activePreset()
  assert.equal(canTogglePresetPrompt(active.preset, 'style'), true)
  assert.equal(canTogglePresetPrompt(active.preset, 'main'), true)
  assert.equal(canTogglePresetPrompt(active.preset, 'private-marker'), false)
  assert.throws(() => configurePreset(active, {
    operation: 'toggle', revision: 0, identifier: 'private-marker', enabled: true,
  }), /no configurable switch/u)

  const reset = configurePreset({
    ...active,
    preset: { ...active.preset, order: [{ identifier: 'style', enabled: true }] },
    revision: 3,
  }, { operation: 'reset', revision: 3 })
  assert.deepEqual(reset, active.importedPreset)
})

test('replays the latest session configuration and rejects stale editor revisions', () => {
  const preset = importedPreset()
  const seed = createPresetSessionSeed([], preset, source)
  const configured: SessionEvent<'command/run'> = {
    type: 'command/run',
    seq: SessionSeq(1),
    time: Date.now(),
    data: {
      commandId: CommandId('preset-test'),
      name: 'rp-preset-configure',
      args: JSON.stringify({
        operation: 'replace',
        revision: 0,
        order: preset.order.map(entry => ({ ...entry, enabled: entry.identifier !== 'private-marker' })),
        content: [{ identifier: 'style', content: 'edited style' }],
        generation: {},
        regex: [],
      }),
      source: { kind: 'user' },
    },
  }
  const replayed = readActiveSessionPreset([...seed, configured])
  assert.equal(replayed?.revision, 1)
  assert.equal(replayed?.preset.order.find(entry => entry.identifier === 'style')?.enabled, true)
  assert.equal(replayed?.preset.prompts.find(entry => entry.identifier === 'style')?.content, 'edited style')
  assert.equal(replayed?.importedPreset.prompts.find(entry => entry.identifier === 'style')?.content, 'style')
  const assembled = assembleSillyTavernPreset(replayed!.preset, {
    card: {
      format: 0, version: 2, specVersion: '2.0', name: '角色', description: '', personality: '', scenario: '',
      firstMessage: '', messageExample: '', alternateGreetings: [], systemPrompt: '', postHistoryInstructions: '',
      frontend: { regexScripts: [], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {} }, degradations: [], raw: {},
    },
    worldInfoBefore: [], worldInfoAfter: [], session: Session.create(SessionId('configured-preset-prompt')), pendingMessages: [],
  })
  const assembledText = assembled.beforeHistory.map(prompt => prompt.content).join('\n')
  assert.match(assembledText, /edited style/u)
  assert.doesNotMatch(assembledText, /^style$/mu)
  assert.equal(replayed?.importedPreset.order[1]?.enabled, false)
  assert.throws(() => configurePreset(replayed!, {
    operation: 'toggle', revision: 0, identifier: 'style', enabled: false,
  }), /expected revision 1/u)
})

test('decodes the private manager command at its Host boundary', () => {
  assert.deepEqual(parsePresetConfigurationRequest(JSON.stringify({
    operation: 'move', revision: 4, identifier: 'style', before: 'main',
  })), { operation: 'move', revision: 4, identifier: 'style', before: 'main' })
  assert.throws(() => parsePresetConfigurationRequest('{'), /valid JSON/u)
  assert.throws(() => parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0,
    order: [{ identifier: 'style', enabled: true }, { identifier: 'style', enabled: false }],
    content: [], generation: {}, regex: [],
  })), /repeats module/u)
  assert.throws(() => configurePreset(activePreset(), {
    operation: 'replace', revision: 0, order: activePreset().preset.order,
    content: [{ identifier: 'main', content: 'cannot edit a marker' }], generation: {}, regex: [],
  }), /no editable content/u)
  assert.deepEqual(parsePresetConfigurationRequest(JSON.stringify({
    operation: 'generation', revision: 0, reasoningEffort: 'provider-owned-level',
  })), { operation: 'generation', revision: 0, reasoningEffort: 'provider-owned-level' })
  const blankName = parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0,
    prompts: [{ identifier: 'unnamed-module', name: '', role: 'system', content: '保留模块正文' }],
    order: [{ identifier: 'unnamed-module', enabled: false }],
    content: [], generation: {}, regex: [],
  }))
  assert.equal(blankName.operation, 'replace')
  if (blankName.operation !== 'replace') assert.fail('expected replace operation')
  assert.equal(blankName.prompts?.[0]?.name, 'unnamed-module')
})

test('edits preset regex switches and depths independently from prompt modules', () => {
  const preset = parseSillyTavernPresetJson(JSON.stringify({
    prompts: [{ identifier: 'main', name: '主提示', role: 'system', content: 'main', marker: true }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    extensions: { regex_scripts: [{
      scriptName: '隐藏元数据', findRegex: '/<meta>[\\s\\S]*?<\\/meta>/gu', replaceString: '',
      trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: true,
      runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null,
    }] },
  }), 'regex.json')
  const active = {
    ...activePreset(),
    importedPreset: preset,
    preset,
    result: { ...activePreset().result, regexScriptCount: 1 },
  }
  const disabled = configurePreset(active, {
    operation: 'replace', revision: 0, order: preset.order, content: [], generation: {},
    regex: [{ index: 0, disabled: true, minDepth: 2, maxDepth: 8 }],
  })
  assert.equal(disabled.regexScripts[0]?.disabled, true)
  assert.equal(disabled.regexScripts[0]?.minDepth, 2)
  assert.equal(disabled.regexScripts[0]?.maxDepth, 8)
  assert.equal(disabled.order[0]?.enabled, true)
  const decoded = parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0, order: preset.order, content: [], generation: {},
    regex: [{ index: 0, disabled: false, minDepth: null, maxDepth: -1 }],
  }))
  assert.equal(decoded.operation, 'replace')
  if (decoded.operation !== 'replace') assert.fail('expected replace operation')
  assert.deepEqual(decoded.regex, [{ index: 0, disabled: false, minDepth: null, maxDepth: -1 }])
  assert.throws(() => parsePresetConfigurationRequest(JSON.stringify({
    operation: 'replace', revision: 0, order: preset.order, content: [], generation: {},
    regex: [{ index: 0, disabled: false, minDepth: '2' }],
  })), /minDepth/u)
  assert.throws(() => configurePreset(active, {
    operation: 'replace', revision: 0, order: preset.order, content: [], generation: {}, regex: [{ index: 1, disabled: true }],
  }), /does not match/u)

  const added = importTavernRegex({
    id: 'added-by-script', script_name: '', enabled: true,
    find_regex: '/status/gu', replace_string: '状态', trim_strings: [],
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false }, run_on_edit: true, min_depth: 0, max_depth: 4,
  }, 1)
  const replaced = configurePreset(active, {
    operation: 'replace', revision: 0, order: preset.order, content: [], generation: {},
    regexScripts: [{ ...preset.regexScripts[0]!, disabled: true }, added],
    regex: [
      { index: 0, disabled: true, minDepth: null, maxDepth: null },
      { index: 1, disabled: false, minDepth: 0, maxDepth: 4 },
    ],
  })
  assert.equal(replaced.regexScripts.length, 2)
  assert.equal(replaced.regexScripts[0]?.disabled, true)
  assert.deepEqual(replaced.regexScripts[1], {
    id: 'added-by-script', scriptName: '未命名-added-by-script', findRegex: '/status/gu', replaceString: '状态',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
    runOnEdit: true, substituteRegex: 0, minDepth: 0, maxDepth: 4,
  })
  assert.equal(replaced.extensionSummary.regexScriptCount, 2)

  const removed = configurePreset({ ...active, preset: replaced, revision: 1 }, {
    operation: 'replace', revision: 1, order: preset.order, content: [], generation: {},
    regexScripts: [], regex: [],
  })
  assert.equal(removed.regexScripts.length, 0)
  assert.equal(removed.extensionSummary.regexScriptCount, 0)

  const seed = createPresetSessionSeed([], preset, source)
  const args = JSON.stringify({
    operation: 'replace', revision: 0, order: preset.order, content: [], generation: {},
    regexScripts: [added], regex: [{ index: 0, disabled: false, minDepth: 0, maxDepth: 4 }],
  })
  const configured: SessionEvent<'command/run'> = {
    type: 'command/run', seq: SessionSeq(seed.length), time: Date.now(),
    data: { commandId: CommandId('regex-replace'), name: 'rp-preset-configure', args, source: { kind: 'user' } },
  }
  const reopened = readActiveSessionPreset([...seed, configured])
  assert.deepEqual(reopened?.preset.regexScripts, [added])
  assert.equal(reopened?.preset.extensionSummary.regexScriptCount, 1)
  assert.deepEqual(
    (parsePresetConfigurationRequest(args) as Extract<ReturnType<typeof parsePresetConfigurationRequest>, { operation: 'replace' }>).regexScripts,
    [added],
  )
  assert.throws(() => importTavernRegex({
    script_name: 'broken', find_regex: '/x/u', replace_string: '', trim_strings: [],
    source: null, destination: { display: true, prompt: false }, min_depth: null, max_depth: null,
  }, 0), /source/u)
})
