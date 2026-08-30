/** Source-neutral, approval-ready editing for one reusable Roleplay actor. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool, type GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { isDeepStrictEqual } from 'node:util'
import type { RoleplayResourceReference } from './roleplay-resource-catalog-protocol.ts'

export const ROLEPLAY_ACTOR_REVISION_TOOL = 'revise_actor'
export const ROLEPLAY_ACTOR_INSPECTION_TOOL = 'inspect_actor'
export const ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY = 'agentRp.actorRevisions'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Writable actor providers available to the current Agent RP profile. */
    'agentRp.actorRevisions': RoleplayActorRevisionRegistry
  }
}

export const ROLEPLAY_ACTOR_DEFINITION_FIELDS = [
  'name', 'description', 'personality', 'scenario', 'exampleDialogue', 'openings',
] as const

export type RoleplayActorDefinitionField = typeof ROLEPLAY_ACTOR_DEFINITION_FIELDS[number]

/** Editable actor definition independent from any Character Card transport. */
export interface RoleplayActorDefinition {
  readonly name: string
  readonly description: string
  readonly personality: string
  readonly scenario: string
  readonly exampleDialogue: string
  /** Default opening first, followed by optional alternatives. */
  readonly openings: readonly string[]
}

type RoleplayActorTextField = Exclude<RoleplayActorDefinitionField, 'openings'>

export interface RoleplayActorTextChange {
  readonly before: string
  readonly after: string
}

export interface RoleplayActorOpeningsChange {
  readonly before: readonly string[]
  readonly after: readonly string[]
}

/** Exact before/after values proposed by the model; omitted fields stay untouched. */
export type RoleplayActorRevisionChanges = {
  readonly [Field in RoleplayActorTextField]?: RoleplayActorTextChange
} & {
  readonly openings?: RoleplayActorOpeningsChange
}

/** Current provider-owned actor value and its opaque optimistic revision token. */
export interface RoleplayActorRevisionSnapshot {
  readonly actor: { readonly kind: 'actor'; readonly id: RoleplayResourceReference['id'] }
  readonly revision: string
  readonly definition: RoleplayActorDefinition
}

export interface RoleplayActorRevisionInput {
  readonly actor: { readonly kind: 'actor'; readonly id: string }
  readonly expectedRevision: string
  readonly changes: RoleplayActorRevisionChanges
}

export interface RoleplayActorRevisionProvider {
  readonly id: string
  /** Return undefined only when this provider does not own the reference. */
  inspect(actor: { readonly kind: 'actor'; readonly id: string }): RoleplayActorRevisionSnapshot | undefined
  /** Apply atomically against expectedRevision or throw RoleplayActorRevisionConflictError. */
  revise(input: RoleplayActorRevisionInput): RoleplayActorRevisionSnapshot
}

interface RegisteredRoleplayActorRevisionProvider {
  readonly token: symbol
  readonly id: string
  readonly inspect: RoleplayActorRevisionProvider['inspect']
  readonly revise: RoleplayActorRevisionProvider['revise']
}

export class RoleplayActorRevisionConflictError extends Error {
  constructor(readonly current: RoleplayActorRevisionSnapshot) {
    super('角色设定已在别处改变，未覆盖新的修订')
    this.name = 'RoleplayActorRevisionConflictError'
  }
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const extra = Object.keys(value).find(key => !keys.includes(key))
  if (extra !== undefined) throw new Error(`${label} has unsupported field ${JSON.stringify(extra)}`)
}

function stableText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function stableId(value: unknown, label: string): string {
  const id = stableText(value, label)
  if (id === '' || id.length > 512 || id.trim() !== id || /\s/u.test(id)) {
    throw new Error(`${label} must be a non-empty stable id without whitespace`)
  }
  return id
}

function revisionToken(value: unknown): string {
  const revision = stableText(value, 'actor revision')
  if (revision === '' || revision.length > 256 || revision.trim() !== revision) {
    throw new Error('actor revision must be a non-empty bounded token')
  }
  return revision
}

function actorReference(value: unknown): { readonly kind: 'actor'; readonly id: string } {
  const record = plainObject(value, 'actor reference')
  exactKeys(record, ['kind', 'id'], 'actor reference')
  if (record.kind !== 'actor') throw new Error('actor reference kind must be actor')
  return Object.freeze({ kind: 'actor', id: stableId(record.id, 'actor reference id') })
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 257
    || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} must contain between 1 and 257 strings`)
  }
  return Object.freeze([...value] as string[])
}

/** Validate and detach one source-neutral actor definition. */
export function parseRoleplayActorDefinition(value: unknown): RoleplayActorDefinition {
  const record = plainObject(value, 'actor definition')
  exactKeys(record, ROLEPLAY_ACTOR_DEFINITION_FIELDS, 'actor definition')
  const name = stableText(record.name, 'actor name')
  if (name === '' || name.length > 200 || name.trim() !== name) {
    throw new Error('actor name must be non-empty, trimmed, and at most 200 characters')
  }
  return Object.freeze({
    name,
    description: stableText(record.description, 'actor description'),
    personality: stableText(record.personality, 'actor personality'),
    scenario: stableText(record.scenario, 'actor scenario'),
    exampleDialogue: stableText(record.exampleDialogue, 'actor example dialogue'),
    openings: stringArray(record.openings, 'actor openings'),
  })
}

function textChange(value: unknown, field: RoleplayActorTextField): RoleplayActorTextChange {
  const record = plainObject(value, `actor ${field} change`)
  exactKeys(record, ['before', 'after'], `actor ${field} change`)
  const before = stableText(record.before, `actor ${field} before`)
  const after = stableText(record.after, `actor ${field} after`)
  if (field === 'name' && (after === '' || after.length > 200 || after.trim() !== after)) {
    throw new Error('actor name must be non-empty, trimmed, and at most 200 characters')
  }
  if (before === after) throw new Error(`actor ${field} change does not change its value`)
  return Object.freeze({ before, after })
}

function openingsChange(value: unknown): RoleplayActorOpeningsChange {
  const record = plainObject(value, 'actor openings change')
  exactKeys(record, ['before', 'after'], 'actor openings change')
  const before = stringArray(record.before, 'actor openings before')
  const after = stringArray(record.after, 'actor openings after')
  if (isDeepStrictEqual(before, after)) throw new Error('actor openings change does not change its value')
  return Object.freeze({ before, after })
}

/** Parse the exact field changes shown to the player before approval. */
export function parseRoleplayActorRevisionChanges(value: unknown): RoleplayActorRevisionChanges {
  const record = plainObject(value, 'actor revision changes')
  exactKeys(record, ROLEPLAY_ACTOR_DEFINITION_FIELDS, 'actor revision changes')
  if (Object.keys(record).length === 0) throw new Error('actor revision must change at least one field')
  const parsed: Record<string, RoleplayActorTextChange | RoleplayActorOpeningsChange> = {}
  for (const field of ROLEPLAY_ACTOR_DEFINITION_FIELDS) {
    if (record[field] === undefined) continue
    parsed[field] = field === 'openings'
      ? openingsChange(record[field])
      : textChange(record[field], field)
  }
  return Object.freeze(parsed) as RoleplayActorRevisionChanges
}

export interface RoleplayActorRevisionToolInput {
  readonly actorId: string
  readonly revision: string
  readonly changes: RoleplayActorRevisionChanges
}

export function parseRoleplayActorRevisionToolInput(value: unknown): RoleplayActorRevisionToolInput {
  const record = plainObject(value, 'actor revision proposal')
  exactKeys(record, ['actorId', 'revision', 'changes'], 'actor revision proposal')
  return Object.freeze({
    actorId: stableId(record.actorId, 'actor revision actorId'),
    revision: revisionToken(record.revision),
    changes: parseRoleplayActorRevisionChanges(record.changes),
  })
}

function snapshot(value: RoleplayActorRevisionSnapshot): RoleplayActorRevisionSnapshot {
  return Object.freeze({
    actor: actorReference(value.actor),
    revision: revisionToken(value.revision),
    definition: parseRoleplayActorDefinition(value.definition),
  })
}

function providerId(value: unknown): string {
  return stableId(value, 'actor revision provider id')
}

function changedDefinition(
  current: RoleplayActorDefinition,
  changes: RoleplayActorRevisionChanges,
): RoleplayActorDefinition | undefined {
  const next: Record<RoleplayActorDefinitionField, string | readonly string[]> = {
    name: current.name,
    description: current.description,
    personality: current.personality,
    scenario: current.scenario,
    exampleDialogue: current.exampleDialogue,
    openings: current.openings,
  }
  for (const field of ROLEPLAY_ACTOR_DEFINITION_FIELDS) {
    const change = changes[field]
    if (change === undefined) continue
    if (!isDeepStrictEqual(current[field], change.before)) return undefined
    next[field] = change.after
  }
  return parseRoleplayActorDefinition(next)
}

/** Mutable provider directory; resource formats retain their own storage and export policy. */
export class RoleplayActorRevisionRegistry {
  readonly #providers = new Map<string, RegisteredRoleplayActorRevisionProvider>()

  register(provider: RoleplayActorRevisionProvider): () => void {
    const id = providerId(provider.id)
    if (this.#providers.has(id)) throw new Error(`actor revision provider ${JSON.stringify(id)} is already registered`)
    const registration = {
      token: Symbol(id), id,
      inspect: provider.inspect.bind(provider),
      revise: provider.revise.bind(provider),
    }
    this.#providers.set(id, registration)
    return () => {
      if (this.#providers.get(id)?.token === registration.token) this.#providers.delete(id)
    }
  }

  #locate(actor: { readonly kind: 'actor'; readonly id: string }): {
    readonly provider: RegisteredRoleplayActorRevisionProvider
    readonly current: RoleplayActorRevisionSnapshot
  } {
    const reference = actorReference(actor)
    const matches = [...this.#providers.values()].sort((left, right) => left.id.localeCompare(right.id))
      .flatMap(provider => {
        const inspected = provider.inspect(reference)
        return inspected === undefined ? [] : [{ provider, current: snapshot(inspected) }]
      })
    if (matches.length === 0) throw new Error('当前角色资源没有可编辑的本机提供方')
    if (matches.length > 1) throw new Error(`actor resource ${JSON.stringify(reference.id)} has multiple revision providers`)
    const located = matches[0]!
    if (!isDeepStrictEqual(located.current.actor, reference)) {
      throw new Error(`actor revision provider ${JSON.stringify(located.provider.id)} returned a mismatched reference`)
    }
    return located
  }

  inspect(actor: { readonly kind: 'actor'; readonly id: string }): RoleplayActorRevisionSnapshot {
    return this.#locate(actor).current
  }

  revise(input: RoleplayActorRevisionInput):
    | { readonly outcome: 'applied'; readonly value: RoleplayActorRevisionSnapshot }
    | { readonly outcome: 'conflict'; readonly value: RoleplayActorRevisionSnapshot } {
    const actor = actorReference(input.actor)
    const expectedRevision = revisionToken(input.expectedRevision)
    const changes = parseRoleplayActorRevisionChanges(input.changes)
    const located = this.#locate(actor)
    if (located.current.revision !== expectedRevision) return { outcome: 'conflict', value: located.current }
    const expected = changedDefinition(located.current.definition, changes)
    if (expected === undefined) return { outcome: 'conflict', value: located.current }
    let revised: RoleplayActorRevisionSnapshot
    try {
      revised = snapshot(located.provider.revise({ actor, expectedRevision, changes }))
    } catch (error: unknown) {
      if (error instanceof RoleplayActorRevisionConflictError) return { outcome: 'conflict', value: snapshot(error.current) }
      throw error
    }
    if (!isDeepStrictEqual(revised.actor, actor) || revised.revision === expectedRevision
      || !isDeepStrictEqual(revised.definition, expected)) {
      throw new Error(`actor revision provider ${JSON.stringify(located.provider.id)} returned an invalid revision`)
    }
    return { outcome: 'applied', value: revised }
  }
}

/** Register one writable actor provider through the caller's owned Cordis lifetime. */
export function registerRoleplayActorRevisionProvider(
  ctx: Context,
  provider: RoleplayActorRevisionProvider,
): void {
  const registry = ctx.get(ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY)
  if (registry === undefined || typeof registry.register !== 'function') {
    throw new Error('Agent RP actor revision service is unavailable')
  }
  ctx.effect(
    () => registry.register(provider),
    `agent-rp: actor revision provider ${provider.id}`,
  )
}

export interface RoleplayActorInspectionValue {
  readonly version: 0
  readonly actorId: string
  readonly revision: string
  readonly definition: RoleplayActorDefinition
}

export interface RoleplayActorRevisionValue {
  readonly version: 0
  readonly outcome: 'applied' | 'conflict'
  readonly actorName: string
  readonly baseRevision: string
  readonly revision: string
  readonly changedFields: readonly RoleplayActorDefinitionField[]
}

const ACTOR_DEFINITION_SCHEMA = {
  type: 'object', additionalProperties: false, required: true,
  properties: {
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    personality: { type: 'string', required: true },
    scenario: { type: 'string', required: true },
    exampleDialogue: { type: 'string', required: true },
    openings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

export const ROLEPLAY_ACTOR_INSPECTION_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true, const: 0 },
    actorId: { type: 'string', required: true },
    revision: { type: 'string', required: true },
    definition: ACTOR_DEFINITION_SCHEMA,
  },
} as const

export const ROLEPLAY_ACTOR_REVISION_VALUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    version: { type: 'integer', required: true, const: 0 },
    outcome: { type: 'string', required: true, enum: ['applied', 'conflict'] },
    actorName: { type: 'string', required: true },
    baseRevision: { type: 'string', required: true },
    revision: { type: 'string', required: true },
    changedFields: {
      type: 'array', required: true,
      items: { type: 'string', enum: ROLEPLAY_ACTOR_DEFINITION_FIELDS },
    },
  },
} as const

const TEXT_CHANGE_PARAMETER = {
  type: 'object', additionalProperties: false,
  properties: {
    before: { type: 'string', required: true, description: 'Exact current value returned by inspect_actor.' },
    after: { type: 'string', required: true, description: 'Complete replacement value to show to the player.' },
  },
} as const

const OPENINGS_CHANGE_PARAMETER = {
  type: 'object', additionalProperties: false,
  properties: {
    before: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact current opening list.' },
    after: { type: 'array', required: true, items: { type: 'string' }, description: 'Complete replacement opening list, default first.' },
  },
} as const

const FIELD_LABELS: Readonly<Record<RoleplayActorDefinitionField, string>> = {
  name: '名称',
  description: '角色描述',
  personality: '性格',
  scenario: '场景',
  exampleDialogue: '示例对话',
  openings: '开场白',
}

function changeFields(changes: RoleplayActorRevisionChanges): RoleplayActorDefinitionField[] {
  return ROLEPLAY_ACTOR_DEFINITION_FIELDS.filter(field => changes[field] !== undefined)
}

function valueText(value: string | readonly string[]): string {
  return typeof value === 'string'
    ? value
    : value.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

function revisionCall(args: unknown): GenericCallView {
  try {
    const parsed = parseRoleplayActorRevisionToolInput(args)
    const content = changeFields(parsed.changes).map(field => {
      const change = parsed.changes[field]!
      return `### ${FIELD_LABELS[field]}\n旧值：\n${valueText(change.before)}\n\n新值：\n${valueText(change.after)}`
    }).join('\n\n')
    return {
      card: 'generic', title: '提议修改角色设定', kind: 'edit',
      content: [{ type: 'text', text: content }],
    }
  } catch {
    return { card: 'generic', title: '提议修改角色设定', kind: 'edit' }
  }
}

function parseInspectionValue(value: unknown): RoleplayActorInspectionValue {
  const record = plainObject(value, 'actor inspection result')
  exactKeys(record, ['version', 'actorId', 'revision', 'definition'], 'actor inspection result')
  if (record.version !== 0) throw new Error('actor inspection result has an unsupported version')
  return {
    version: 0,
    actorId: stableId(record.actorId, 'actor inspection result actorId'),
    revision: revisionToken(record.revision),
    definition: parseRoleplayActorDefinition(record.definition),
  }
}

function parseRevisionValue(value: unknown): RoleplayActorRevisionValue {
  const record = plainObject(value, 'actor revision result')
  exactKeys(record, ['version', 'outcome', 'actorName', 'baseRevision', 'revision', 'changedFields'], 'actor revision result')
  if (record.version !== 0 || (record.outcome !== 'applied' && record.outcome !== 'conflict')) {
    throw new Error('actor revision result has invalid outcome')
  }
  const actorName = stableText(record.actorName, 'actor revision result name')
  const changedFields = Array.isArray(record.changedFields)
    ? record.changedFields.map(field => {
      if (!ROLEPLAY_ACTOR_DEFINITION_FIELDS.includes(field as RoleplayActorDefinitionField)) {
        throw new Error('actor revision result has an invalid changed field')
      }
      return field as RoleplayActorDefinitionField
    })
    : (() => { throw new Error('actor revision result changedFields must be an array') })()
  return {
    version: 0,
    outcome: record.outcome,
    actorName,
    baseRevision: revisionToken(record.baseRevision),
    revision: revisionToken(record.revision),
    changedFields,
  }
}

export interface RoleplayActorRevisionCapabilityOptions {
  /** Resolve the actor resource currently owned by this exact top-level Agent. */
  readonly resolveActor: (agent: Agent) => { readonly kind: 'actor'; readonly id: string } | undefined
}

/** Install the read → diff → native approval → optimistic write workflow. */
export function installRoleplayActorRevisionCapability(
  ctx: Context,
  revisions: RoleplayActorRevisionRegistry,
  options: RoleplayActorRevisionCapabilityOptions,
): void {
  const resolve = (agent: Agent | undefined): {
    readonly actor: { readonly kind: 'actor'; readonly id: string }
    readonly snapshot: RoleplayActorRevisionSnapshot
  } => {
    if (agent === undefined) throw new Error('角色设定工具需要一个 Agent Session')
    const actor = options.resolveActor(agent)
    if (actor === undefined) throw new Error('当前会话没有可编辑的本机角色资源')
    return { actor, snapshot: revisions.inspect(actor) }
  }

  ctx.tools.register(defineTool({
    name: ROLEPLAY_ACTOR_INSPECTION_TOOL,
    description: 'Read the current editable definition and optimistic revision of the active actor. Use only when the user explicitly asks to inspect, create, or revise the actor definition. Call this immediately before revise_actor; it does not read world, state, memory, or hidden reasoning.',
    parameters: {},
    output: {
      schema: ROLEPLAY_ACTOR_INSPECTION_VALUE_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => value as unknown as JsonValue,
    },
    execute(_args, exec) {
      if (exec.parent !== undefined) throw new Error('inspect_actor must be called directly by the character Agent')
      const current = resolve(exec.agent).snapshot
      return Promise.resolve({
        version: 0 as const,
        actorId: current.actor.id,
        revision: current.revision,
        definition: { ...current.definition, openings: [...current.definition.openings] },
      })
    },
    presentCall: () => ({ card: 'generic', title: '读取可编辑角色设定', kind: 'read' }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '角色设定读取失败' : '已读取角色设定',
    }),
    isConcurrencySafe: () => true,
  }))

  ctx.tools.register(defineTool({
    name: ROLEPLAY_ACTOR_REVISION_TOOL,
    description: 'Propose exact field changes to the active reusable actor after inspect_actor. Copy the returned actorId, revision, and exact before values; include only fields the user asked to change. The player sees the before/after proposal and must approve it once before any local write. A changed actor, stale revision, or mismatched before value never overwrites newer work. Saving creates a reversible local revision for future Sessions; the current Session snapshot remains immutable and replayable.',
    parameters: {
      actorId: {
        type: 'string', required: true,
        description: 'Opaque actor id returned by the immediately preceding inspect_actor call.',
      },
      revision: {
        type: 'string', required: true,
        description: 'Opaque current revision returned by the immediately preceding inspect_actor call.',
      },
      changes: {
        type: 'object', required: true, additionalProperties: false,
        description: 'Only fields explicitly requested by the user, each with exact before and complete after values.',
        properties: {
          name: TEXT_CHANGE_PARAMETER,
          description: TEXT_CHANGE_PARAMETER,
          personality: TEXT_CHANGE_PARAMETER,
          scenario: TEXT_CHANGE_PARAMETER,
          exampleDialogue: TEXT_CHANGE_PARAMETER,
          openings: OPENINGS_CHANGE_PARAMETER,
        },
      },
    },
    output: {
      schema: ROLEPLAY_ACTOR_REVISION_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.outcome === 'applied'
          ? `已将“${value.actorName}”保存为本机修订 ${value.revision}。当前会话继续使用开始时的可回放快照；之后的新会话会使用修改版。`
          : `“${value.actorName}”在批准期间已变为修订 ${value.revision}；没有覆盖任何内容。请重新读取后再提议。`,
      }],
      presentationMeta: (_args, value) => value as unknown as JsonValue,
    },
    execute(args, exec) {
      if (exec.parent !== undefined) throw new Error('revise_actor must be called directly by the character Agent')
      const parsed = parseRoleplayActorRevisionToolInput(args)
      const target = resolve(exec.agent)
      if (target.actor.id !== parsed.actorId) throw new Error('当前角色已改变，请重新读取后再修改')
      const result = revisions.revise({
        actor: target.actor,
        expectedRevision: parsed.revision,
        changes: parsed.changes,
      })
      return Promise.resolve({
        version: 0 as const,
        outcome: result.outcome,
        actorName: result.value.definition.name,
        baseRevision: parsed.revision,
        revision: result.value.revision,
        changedFields: changeFields(parsed.changes),
      })
    },
    presentCall: revisionCall,
    presentResult: (_args, result) => {
      if (result.isError) return { card: 'generic', title: '角色修改未执行' }
      try {
        const value = parseRevisionValue(result.meta)
        return {
          card: 'generic',
          title: value.outcome === 'applied' ? '角色设定已保存' : '角色设定有新版本，未覆盖',
        }
      } catch {
        return { card: 'generic', title: '角色修改已结束' }
      }
    },
    isConcurrencySafe: () => false,
  }))

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== ROLEPLAY_ACTOR_REVISION_TOOL) return next()
    if (exec.parent !== undefined) return { kind: 'deny', reason: '角色设定修改只能由顶层角色 Agent 直接提出' }
    try {
      const parsed = parseRoleplayActorRevisionToolInput(exec.arguments)
      const target = resolve(exec.agent)
      if (target.actor.id !== parsed.actorId) {
        return { kind: 'deny', reason: '当前角色已改变，请重新读取后再修改' }
      }
      if (target.snapshot.revision !== parsed.revision) {
        return { kind: 'deny', reason: '角色设定已在提议前改变，请重新读取后再修改' }
      }
      for (const field of changeFields(parsed.changes)) {
        if (!isDeepStrictEqual(target.snapshot.definition[field], parsed.changes[field]!.before)) {
          return { kind: 'deny', reason: `角色的“${FIELD_LABELS[field]}”已改变，请重新读取后再修改` }
        }
      }
      const labels = changeFields(parsed.changes).map(field => FIELD_LABELS[field]).join('、')
      return {
        kind: 'ask',
        reason: `将“${target.snapshot.definition.name}”的${labels}保存为本机修订；原始导入资产和当前会话快照保持不变。`,
      }
    } catch (error: unknown) {
      return { kind: 'deny', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

export type RoleplayActorRevisionSettlement =
  | 'awaiting-approval'
  | 'allowed'
  | 'rejected'
  | 'cancelled'
  | 'unavailable'
  | 'applied'
  | 'conflict'
  | 'failed'

export interface RoleplayActorRevisionAttempt {
  readonly callId: string
  readonly sourceEventSeq: number
  readonly input: RoleplayActorRevisionToolInput
  readonly settlement: RoleplayActorRevisionSettlement
  readonly result?: RoleplayActorRevisionValue
}

function resultCallId(event: Extract<SessionEvent, { readonly type: 'tool/result' }>): string | undefined {
  const block = event.data.message.content[0]
  return block === undefined ? undefined : String(block.toolCallId)
}

/** Rebuild every actor proposal and its approval/write settlement from the Session Log alone. */
export function readRoleplayActorRevisionAttempts(
  events: readonly SessionEvent[],
): readonly RoleplayActorRevisionAttempt[] {
  const attempts = new Map<string, {
    callId: string
    sourceEventSeq: number
    input: RoleplayActorRevisionToolInput
    approvalId?: string
    approval?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
    failed?: boolean
    result?: RoleplayActorRevisionValue
  }>()
  const approvals = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === ROLEPLAY_ACTOR_REVISION_TOOL) {
      const callId = String(event.data.callId)
      if (attempts.has(callId)) throw new Error(`actor revision call id ${JSON.stringify(callId)} is repeated`)
      let args: unknown
      try { args = JSON.parse(event.data.arguments) } catch (error: unknown) {
        throw new Error('actor revision tool call arguments are invalid JSON', { cause: error })
      }
      attempts.set(callId, {
        callId, sourceEventSeq: event.seq, input: parseRoleplayActorRevisionToolInput(args),
      })
      continue
    }
    if (event.type === 'approval/asked' && event.data.toolName === ROLEPLAY_ACTOR_REVISION_TOOL
      && event.data.callId !== undefined) {
      const callId = String(event.data.callId)
      const attempt = attempts.get(callId)
      if (attempt === undefined || attempt.approvalId !== undefined) {
        throw new Error('actor revision approval does not cite one pending proposal')
      }
      attempt.approvalId = String(event.data.id)
      approvals.set(String(event.data.id), callId)
      continue
    }
    if (event.type === 'approval/decided') {
      const callId = approvals.get(String(event.data.id))
      if (callId !== undefined) attempts.get(callId)!.approval = event.data.outcome
      continue
    }
    if (event.type !== 'tool/result') continue
    const callId = resultCallId(event)
    const attempt = callId === undefined ? undefined : attempts.get(callId)
    if (attempt === undefined) continue
    if (attempt.failed !== undefined || attempt.result !== undefined) {
      throw new Error(`actor revision call ${JSON.stringify(callId)} has repeated results`)
    }
    attempt.failed = event.data.message.content[0]?.isError === true
    if (!attempt.failed) {
      const result = parseRevisionValue(event.data.meta)
      if (result.baseRevision !== attempt.input.revision
        || !isDeepStrictEqual(result.changedFields, changeFields(attempt.input.changes))) {
        throw new Error('actor revision result does not match its proposal')
      }
      attempt.result = result
    }
  }
  return Object.freeze([...attempts.values()].map(attempt => {
    const settlement: RoleplayActorRevisionSettlement = attempt.approval === undefined
      ? 'awaiting-approval'
      : attempt.approval === 'rejected' ? 'rejected'
        : attempt.approval === 'cancelled' ? 'cancelled'
          : attempt.approval === 'unavailable' ? 'unavailable'
            : attempt.result !== undefined ? attempt.result.outcome
              : attempt.failed === true ? 'failed' : 'allowed'
    return Object.freeze({
      callId: attempt.callId,
      sourceEventSeq: attempt.sourceEventSeq,
      input: attempt.input,
      settlement,
      ...(attempt.result === undefined ? {} : { result: attempt.result }),
    })
  }))
}

/** Parse durable presentation metadata without trusting the UI projection. */
export function parseRoleplayActorRevisionResult(value: unknown): RoleplayActorRevisionValue {
  return parseRevisionValue(value)
}

/** Parse the canonical actor inspection value used by tests and alternative clients. */
export function parseRoleplayActorInspectionResult(value: unknown): RoleplayActorInspectionValue {
  return parseInspectionValue(value)
}
