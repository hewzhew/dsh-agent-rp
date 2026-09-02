/** Durable tool-artifact discovery and explicit Roleplay staging. */

import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { RoleplayPresentedArtifact } from './roleplay-turn-presentation-types.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_TOOL_GUIDANCE,
  prepareRoleplayToolPolicy,
  type RoleplayToolPolicyPlan,
  type ResolvedToolGuidanceConfig,
} from './roleplay-tool-guidance.ts'
import { roleplayToolCallFollowsVisibleReply } from './roleplay-tool-continuation.ts'
import { sessionEvents } from './session-events.ts'

export const ROLEPLAY_ARTIFACT_STAGE_TOOL = 'stage_roleplay_artifact'
export const ROLEPLAY_ARTIFACT_PUBLISH_TOOL = 'publish_roleplay_image'
export const TOOL_ARTIFACT_PRESENTATION_FORMAT = 'dsh.tool-artifacts'
export const ROLEPLAY_ARTIFACT_STAGE_FORMAT = 'agent-rp.staged-artifact'
export const ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT = 'agent-rp.artifact-stage-intent'
export const ROLEPLAY_ARTIFACT_PUBLISH_FORMAT = 'agent-rp.published-artifacts'

const IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** One provider-neutral image persisted by DSH rather than embedded in model history. */
export interface RoleplayToolImageArtifact {
  readonly type: 'image'
  readonly attachment: ImageAttachmentRef
}

/** The DSH-owned replay envelope currently emitted in `tool/result.data.meta`. */
export interface ToolArtifactPresentationMeta {
  readonly format: typeof TOOL_ARTIFACT_PRESENTATION_FORMAT
  readonly version: 0
  readonly artifacts: readonly RoleplayToolImageArtifact[]
  readonly data?: JsonValue
}

/** Explicit, replayable decision to place one earlier tool artifact on the RP stage. */
export interface RoleplayArtifactStageRecord {
  readonly format: typeof ROLEPLAY_ARTIFACT_STAGE_FORMAT
  readonly version: 0
  readonly artifact: RoleplayToolImageArtifact
  readonly sourceResultSeq: number
  readonly sourceCallId: string
  readonly sourceToolName: string
  readonly caption?: string
}

/** Tool-owned data inside the canonical DSH artifact envelope that requests immediate RP staging. */
export interface RoleplayArtifactAutoStageIntent {
  readonly format: typeof ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT
  readonly version: 0
  readonly sourceResultSeq?: number
  readonly caption?: string
}

/** Compatibility result of Thetail's public publication tool name. */
export interface RoleplayArtifactPublishValue {
  readonly format: typeof ROLEPLAY_ARTIFACT_PUBLISH_FORMAT
  readonly version: 0
  readonly artifacts: RoleplayToolImageArtifact[]
  readonly sourceResultSeq?: number
  readonly caption?: string
}

/** Arguments retained for compatibility with `Thetail001/dsh-agent-rp`. */
export interface RoleplayArtifactPublishArgs {
  readonly path?: string
  readonly caption?: string
}

/** Successful image result that can move a completed narrative into artifact handoff. */
export interface RoleplayArtifactFollowup {
  readonly turn: number
  readonly step: number
  readonly artifacts: readonly RoleplayToolImageArtifact[]
}

interface RoleplayToolResultArtifactSource {
  readonly isError: boolean
  readonly content: readonly ContentBlock[]
  readonly meta?: JsonValue
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  const record = plainRecord(value)
  if (record === undefined
    || typeof record.attachmentId !== 'string' || record.attachmentId === ''
    || typeof record.mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(record.mediaType as ImageMediaType)
    || typeof record.bytes !== 'number' || !Number.isSafeInteger(record.bytes) || record.bytes <= 0
    || typeof record.width !== 'number' || !Number.isSafeInteger(record.width) || record.width <= 0
    || typeof record.height !== 'number' || !Number.isSafeInteger(record.height) || record.height <= 0
    || (record.name !== undefined && typeof record.name !== 'string')) return undefined
  return value as ImageAttachmentRef
}

function imageArtifact(value: unknown): RoleplayToolImageArtifact | undefined {
  const record = plainRecord(value)
  const attachment = record?.type === 'image' ? imageAttachment(record.attachment) : undefined
  return attachment === undefined ? undefined : { type: 'image', attachment }
}

/** Read the DSH artifact envelope without depending on a not-yet-published package export. */
export function readToolArtifactPresentationMeta(
  value: JsonValue | undefined,
): ToolArtifactPresentationMeta | undefined {
  const record = plainRecord(value)
  if (record?.format !== TOOL_ARTIFACT_PRESENTATION_FORMAT || record.version !== 0
    || !Array.isArray(record.artifacts) || record.artifacts.length === 0) return undefined
  const artifacts = record.artifacts.map(imageArtifact)
  if (artifacts.some(artifact => artifact === undefined)) return undefined
  return {
    format: TOOL_ARTIFACT_PRESENTATION_FORMAT,
    version: 0,
    artifacts: artifacts as RoleplayToolImageArtifact[],
    ...(record.data === undefined ? {} : { data: record.data as JsonValue }),
  }
}

/** Create the canonical DSH artifact envelope consumed by Agent RP and other capable clients. */
export function roleplayToolArtifactPresentationMeta(
  artifacts: readonly RoleplayToolImageArtifact[],
  data?: JsonValue,
): JsonValue {
  return {
    format: TOOL_ARTIFACT_PRESENTATION_FORMAT,
    version: 0,
    artifacts: [...artifacts],
    ...(data === undefined ? {} : { data }),
  } as unknown as JsonValue
}

/** Parse producer-owned automatic stage intent without trusting arbitrary tool metadata. */
export function readRoleplayArtifactAutoStageIntent(
  value: JsonValue | undefined,
): RoleplayArtifactAutoStageIntent | undefined {
  const record = plainRecord(value)
  if (record?.format !== ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT || record.version !== 0
    || (record.sourceResultSeq !== undefined && (typeof record.sourceResultSeq !== 'number'
      || !Number.isSafeInteger(record.sourceResultSeq) || record.sourceResultSeq < 0))
    || (record.caption !== undefined && (typeof record.caption !== 'string'
      || record.caption === '' || record.caption.length > 500))) return undefined
  return {
    format: ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
    version: 0,
    ...(record.sourceResultSeq === undefined ? {} : { sourceResultSeq: record.sourceResultSeq }),
    ...(record.caption === undefined ? {} : { caption: record.caption }),
  }
}

/** Validate one replayed stage decision before it reaches presentation state. */
export function readRoleplayArtifactStageRecord(
  value: JsonValue | undefined,
): RoleplayArtifactStageRecord | undefined {
  const record = plainRecord(value)
  const artifact = imageArtifact(record?.artifact)
  if (record?.format !== ROLEPLAY_ARTIFACT_STAGE_FORMAT || record.version !== 0
    || artifact === undefined
    || typeof record.sourceResultSeq !== 'number' || !Number.isSafeInteger(record.sourceResultSeq)
    || record.sourceResultSeq < 0
    || typeof record.sourceCallId !== 'string' || record.sourceCallId === ''
    || typeof record.sourceToolName !== 'string' || record.sourceToolName === ''
    || (record.caption !== undefined && (typeof record.caption !== 'string'
      || record.caption === '' || record.caption.length > 500))) return undefined
  return {
    format: ROLEPLAY_ARTIFACT_STAGE_FORMAT,
    version: 0,
    artifact,
    sourceResultSeq: record.sourceResultSeq,
    sourceCallId: record.sourceCallId,
    sourceToolName: record.sourceToolName,
    ...(record.caption === undefined ? {} : { caption: record.caption }),
  }
}

function resultCallId(event: Extract<SessionEvent, { readonly type: 'tool/result' }>): string | undefined {
  const first = event.data.message.content[0]
  return first === undefined ? undefined : String(first.toolCallId)
}

function resultFailed(event: Extract<SessionEvent, { readonly type: 'tool/result' }>): boolean {
  return event.data.message.content[0]?.isError === true
}

function currentStageCall(
  session: Session,
  callId: string,
): Extract<SessionEvent, { readonly type: 'tool/call' }> {
  return currentToolCall(session, callId, ROLEPLAY_ARTIFACT_STAGE_TOOL)
}

function currentToolCall(
  session: Session,
  callId: string,
  toolName: string,
): Extract<SessionEvent, { readonly type: 'tool/call' }> {
  const event = sessionEvents(session).findLast(candidate => candidate.type === 'tool/call'
    && String(candidate.data.callId) === callId)
  if (event?.type !== 'tool/call' || event.data.name !== toolName) {
    throw new Error(`${toolName} has no matching durable tool call`)
  }
  return event
}

function sourceToolName(events: readonly SessionEvent[], callId: string, beforeSeq: number): string | undefined {
  const call = events.findLast(event => event.seq < beforeSeq && event.type === 'tool/call'
    && String(event.data.callId) === callId)
  return call?.type === 'tool/call' ? call.data.name : undefined
}

function referencedArtifact(
  session: Session,
  call: Extract<SessionEvent, { readonly type: 'tool/call' }>,
  artifactId: string,
): RoleplayArtifactStageRecord {
  for (let index = sessionEvents(session).length - 1; index >= 0; index -= 1) {
    const event = sessionEvents(session)[index]
    if (event === undefined || event.seq >= call.seq || event.type !== 'tool/result'
      || event.data.turn !== call.data.turn || resultFailed(event)) continue
    const meta = readToolArtifactPresentationMeta(event.data.meta)
    const artifact = meta?.artifacts.find(candidate => String(candidate.attachment.attachmentId) === artifactId)
    if (artifact === undefined) continue
    const callId = resultCallId(event)
    const toolName = callId === undefined ? undefined : sourceToolName(sessionEvents(session), callId, event.seq)
    if (callId === undefined || toolName === undefined) continue
    return {
      format: ROLEPLAY_ARTIFACT_STAGE_FORMAT,
      version: 0,
      artifact,
      sourceResultSeq: event.seq,
      sourceCallId: callId,
      sourceToolName: toolName,
    }
  }
  throw new Error(`artifact ${JSON.stringify(artifactId)} is not available from an earlier tool result in this turn`)
}

function boundedArtifactId(value: string): string {
  if (value === '' || value.length > 512 || value.trim() !== value
    || /[\s\\/]/u.test(value) || value.includes('://') || value.startsWith('data:')) {
    throw new Error('artifactId must be a stable id, not a URL, path, or inline payload')
  }
  return value
}

function boundedCaption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const caption = value.trim()
  if (caption === '' || caption.length > 500) throw new Error('caption must contain 1 to 500 characters')
  return caption
}

function imagesFromContent(content: readonly ContentBlock[]): readonly RoleplayToolImageArtifact[] {
  return content.flatMap(block => {
    if (block.type === 'image') return [{ type: 'image' as const, attachment: block.attachment }]
    if (block.type === 'tool-result') return imagesFromContent(block.content)
    return []
  })
}

function uniqueArtifacts(artifacts: readonly RoleplayToolImageArtifact[]): readonly RoleplayToolImageArtifact[] {
  const seen = new Set<string>()
  return artifacts.filter(artifact => {
    const id = String(artifact.attachment.attachmentId)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Read native or compatibility image artifacts from one settled tool result. */
export function readRoleplayToolResultArtifacts(
  result: RoleplayToolResultArtifactSource,
): readonly RoleplayToolImageArtifact[] {
  if (result.isError) return []
  const durable = readToolArtifactPresentationMeta(result.meta)?.artifacts
  const legacy = imagesFromContent(result.content)
  return uniqueArtifacts(durable === undefined ? legacy : [...durable, ...legacy])
}

/**
 * Detect the only safe prompt-narrowing boundary: this exact model step has
 * already emitted visible prose and its non-publisher tool returned an image.
 */
export function detectRoleplayArtifactFollowup(
  events: readonly SessionEvent[],
  callId: string,
  result: RoleplayToolResultArtifactSource,
): RoleplayArtifactFollowup | undefined {
  const artifacts = readRoleplayToolResultArtifacts(result)
  if (artifacts.length === 0) return undefined
  const call = events.findLast(event => event.type === 'tool/call'
    && String(event.data.callId) === callId)
  if (call?.type !== 'tool/call'
    || call.data.name === ROLEPLAY_ARTIFACT_STAGE_TOOL
    || call.data.name === ROLEPLAY_ARTIFACT_PUBLISH_TOOL) return undefined
  return roleplayToolCallFollowsVisibleReply(events, callId)
    ? { turn: call.data.turn, step: call.data.step, artifacts }
    : undefined
}

function legacyPublishedCaption(value: JsonValue | undefined): string | undefined {
  const record = plainRecord(value)
  if (record?.format !== 0 || record.version !== 0 || record.caption === undefined) return undefined
  if (typeof record.caption !== 'string' || record.caption === '' || record.caption.length > 500) return undefined
  return record.caption
}

function stagedSourceSeqs(events: readonly SessionEvent[], turn: number): ReadonlySet<number> {
  const staged = new Set<number>()
  for (const event of events) {
    if (event.type !== 'tool/result' || event.data.turn !== turn || resultFailed(event)) continue
    const explicit = readRoleplayArtifactStageRecord(event.data.meta)
    if (explicit !== undefined) staged.add(explicit.sourceResultSeq)
    const meta = readToolArtifactPresentationMeta(event.data.meta)
    const autoStage = readRoleplayArtifactAutoStageIntent(meta?.data)
    if (autoStage !== undefined) {
      staged.add(event.seq)
      staged.add(autoStage.sourceResultSeq ?? event.seq)
    }
  }
  return staged
}

function latestPublishableArtifacts(
  session: Session,
  call: Extract<SessionEvent, { readonly type: 'tool/call' }>,
): { readonly artifacts: readonly RoleplayToolImageArtifact[]; readonly sourceResultSeq: number } | undefined {
  const alreadyStaged = stagedSourceSeqs(sessionEvents(session), call.data.turn)
  for (let index = sessionEvents(session).length - 1; index >= 0; index -= 1) {
    const event = sessionEvents(session)[index]
    if (event === undefined || event.seq >= call.seq || event.type !== 'tool/result'
      || event.data.turn !== call.data.turn || resultFailed(event) || alreadyStaged.has(event.seq)) continue
    const artifacts = readRoleplayToolResultArtifacts({
      isError: false,
      content: event.data.message.content,
      ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
    })
    if (artifacts.length > 0) return { artifacts, sourceResultSeq: event.seq }
  }
  return undefined
}

function inferredImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6) {
    const signature = String.fromCharCode(...data.subarray(0, 6))
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (data.length >= 12
    && String.fromCharCode(...data.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...data.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

function insideWorkspace(workspace: string, candidate: string): boolean {
  const child = relative(workspace, candidate)
  return child !== '' && child !== '..'
    && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child)
}

async function saveWorkspaceArtifact(
  store: AttachmentStore,
  agent: Agent,
  requestedPath: string,
  signal: AbortSignal,
): Promise<RoleplayToolImageArtifact> {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) throw new Error('publish_roleplay_image(path) requires this Session to have a workspace cwd')
  const requested = requestedPath.trim()
  if (requested === '') throw new Error('path must contain non-whitespace text')
  if (requested.length > 4_000) throw new Error('path is too long')
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(requested)) {
    throw new Error('path must be a local image inside the Session workspace, not a URL or data URI')
  }
  signal.throwIfAborted()
  const workspace = await realpath(cwd)
  const candidate = await realpath(resolve(workspace, requested))
  if (!insideWorkspace(workspace, candidate)) {
    throw new Error('path must resolve to an image file inside the Session workspace')
  }
  const file = await stat(candidate)
  if (!file.isFile()) throw new Error('path must resolve to a regular image file')
  if (file.size > store.imageLimits.maxImageBytes) {
    throw new Error(`image exceeds the configured ${store.imageLimits.maxImageBytes}-byte limit`)
  }
  const data = await readFile(candidate, { signal })
  const mediaType = inferredImageMediaType(data)
  if (mediaType === undefined) throw new Error('path is not a supported PNG, JPEG, WebP, or GIF image')
  if (!store.imageLimits.mediaTypes.includes(mediaType)) {
    throw new Error(`${mediaType} images are disabled by the attachment policy`)
  }
  return {
    type: 'image',
    attachment: await store.saveImage({ data, mediaType, name: basename(candidate) }),
  }
}

const PUBLISH_NO_SOURCE_GUIDANCE = 'No image can be published yet. No same-turn tool returned a durable image artifact and no workspace path was provided. Do not retry the same call. First make the image tool return a native image artifact, or materialize its output as a real image file inside the Session workspace and pass that path. Otherwise continue the roleplay reply without an image.'

async function preparePublishedArtifacts(
  store: AttachmentStore,
  agent: Agent,
  callId: string,
  args: RoleplayArtifactPublishArgs,
  signal: AbortSignal,
): Promise<RoleplayArtifactPublishValue> {
  const call = currentToolCall(agent.session, callId, ROLEPLAY_ARTIFACT_PUBLISH_TOOL)
  const caption = boundedCaption(args.caption)
  const requestedPath = args.path?.trim() === '' ? undefined : args.path
  const selected = requestedPath === undefined
    ? latestPublishableArtifacts(agent.session, call)
    : { artifacts: [await saveWorkspaceArtifact(store, agent, requestedPath, signal)] }
  if (selected === undefined) throw new Error(PUBLISH_NO_SOURCE_GUIDANCE)
  const artifacts = selected.artifacts
  if (artifacts.length > store.imageLimits.maxImagesPerMessage) {
    throw new Error(`image tool returned ${artifacts.length} images; at most ${store.imageLimits.maxImagesPerMessage} may be published together`)
  }
  for (const artifact of artifacts) {
    const stored = await store.readImage(artifact.attachment, signal)
    if (String(stored.ref.attachmentId) !== String(artifact.attachment.attachmentId)) {
      throw new Error('stored artifact identity changed during verification')
    }
  }
  return {
    format: ROLEPLAY_ARTIFACT_PUBLISH_FORMAT,
    version: 0,
    artifacts: [...artifacts],
    ...('sourceResultSeq' in selected ? { sourceResultSeq: selected.sourceResultSeq } : {}),
    ...(caption === undefined ? {} : { caption }),
  }
}

export const ROLEPLAY_ARTIFACT_STAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', required: true, const: ROLEPLAY_ARTIFACT_STAGE_FORMAT },
    version: { type: 'integer', required: true, const: 0 },
    artifact: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        type: { type: 'string', required: true, const: 'image' },
        attachment: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            attachmentId: { type: 'string', required: true },
            mediaType: { type: 'string', required: true, enum: [...IMAGE_MEDIA_TYPES] },
            bytes: { type: 'integer', required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            name: { type: 'string' },
            originalDimensions: {
              type: 'object',
              additionalProperties: false,
              properties: {
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
              },
            },
          },
        },
      },
    },
    sourceResultSeq: { type: 'integer', required: true },
    sourceCallId: { type: 'string', required: true },
    sourceToolName: { type: 'string', required: true },
    caption: { type: 'string' },
  },
} as const

export const ROLEPLAY_ARTIFACT_PUBLISH_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', required: true, const: ROLEPLAY_ARTIFACT_PUBLISH_FORMAT },
    version: { type: 'integer', required: true, const: 0 },
    artifacts: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', required: true, const: 'image' },
          attachment: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true, enum: [...IMAGE_MEDIA_TYPES] },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
              originalDimensions: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            },
          },
        },
      },
    },
    sourceResultSeq: { type: 'integer' },
    caption: { type: 'string' },
  },
} as const

/** Compatibility renderer for callers that have not adopted prepared turn policies yet. */
export function renderRoleplayArtifactToolGuidance(
  config: ResolvedToolGuidanceConfig = DEFAULT_TOOL_GUIDANCE,
): string {
  return prepareRoleplayToolPolicy(config).guidance.contextText
}

export interface InstallRoleplayArtifactCapabilityOptions {
  /** Return the exact prepared policy for this Agent's active turn; undefined disables the capability. */
  readonly toolPolicy?: (agent: Agent) => RoleplayToolPolicyPlan | undefined
}

/** Synchronous gate used before SystemPrompt assembly for the next model step. */
export interface RoleplayArtifactCapabilityController {
  prepare(agent: Agent, policy: RoleplayToolPolicyPlan | undefined): void
}

/** Install the provider-neutral bridge from durable DSH artifacts to RP stage intent. */
export function installRoleplayArtifactCapability(
  ctx: Context,
  options: InstallRoleplayArtifactCapabilityOptions = {},
): RoleplayArtifactCapabilityController {
  const defaultPolicy = prepareRoleplayToolPolicy(DEFAULT_TOOL_GUIDANCE)
  const currentPolicy = (agent: Agent): RoleplayToolPolicyPlan | undefined => options.toolPolicy === undefined
    ? defaultPolicy
    : options.toolPolicy(agent)
  const publishFailures = new WeakMap<Agent, { readonly turn: number; readonly count: number }>()
  const failureRestrictions = new Map<Agent, { readonly turn: number; readonly dispose: () => void }>()
  const policyRestrictions = new Map<Agent, () => void>()
  const disposeRestriction = (agent: Agent, restrictions: Map<Agent, () => void>): void => {
    const dispose = restrictions.get(agent)
    restrictions.delete(agent)
    dispose?.()
  }
  const disposeFailureRestriction = (agent: Agent): void => {
    const restriction = failureRestrictions.get(agent)
    failureRestrictions.delete(agent)
    restriction?.dispose()
  }
  const prepare = (agent: Agent, policy: RoleplayToolPolicyPlan | undefined): void => {
    const disabled = policy?.capability.artifactPresentation !== true
    const restricted = policyRestrictions.has(agent)
    if (disabled && !restricted) {
      policyRestrictions.set(agent, agent.ctx.tools.restrict({
        deny: [ROLEPLAY_ARTIFACT_STAGE_TOOL, ROLEPLAY_ARTIFACT_PUBLISH_TOOL],
      }))
    } else if (!disabled && restricted) {
      disposeRestriction(agent, policyRestrictions)
    }
  }
  ctx.on('agent/created', ({ agent }) => {
    prepare(agent, currentPolicy(agent))
  })
  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const failed = failureRestrictions.get(agent)
    if (failed !== undefined && failed.turn !== turn) {
      disposeFailureRestriction(agent)
      publishFailures.delete(agent)
    }
    return await next()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    publishFailures.delete(agent)
    disposeFailureRestriction(agent)
    disposeRestriction(agent, policyRestrictions)
  })
  ctx.effect(() => () => {
    for (const { dispose } of failureRestrictions.values()) dispose()
    failureRestrictions.clear()
    for (const dispose of policyRestrictions.values()) dispose()
    policyRestrictions.clear()
  }, 'agent-rp: artifact publication restrictions')
  const recordPublishFailure = (agent: Agent, turn: number): void => {
    const previous = publishFailures.get(agent)
    const count = previous?.turn === turn ? previous.count + 1 : 1
    publishFailures.set(agent, { turn, count })
    if (count < 2 || failureRestrictions.has(agent)) return
    failureRestrictions.set(agent, {
      turn,
      dispose: agent.ctx.tools.restrict({ deny: [ROLEPLAY_ARTIFACT_PUBLISH_TOOL] }),
    })
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: ROLEPLAY_ARTIFACT_STAGE_TOOL,
    description: 'Place one durable artifact from an earlier tool result in this turn onto the roleplay stage. Pass the exact artifact id shown by the producing tool. This chooses presentation only: it does not generate, download, or modify the artifact.',
    parameters: {
      artifactId: {
        type: 'string',
        required: true,
        description: 'Exact stable artifact id from an earlier tool result in this turn; never a URL, path, or base64 payload.',
      },
      caption: {
        type: 'string',
        description: 'Optional short player-facing caption. Omit when the image should stand on its own.',
      },
    },
    output: {
      schema: ROLEPLAY_ARTIFACT_STAGE_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: value.caption === undefined
          ? `Staged artifact ${String(value.artifact.attachment.attachmentId)} for this roleplay turn.`
          : `Staged artifact ${String(value.artifact.attachment.attachmentId)} for this roleplay turn with caption: ${value.caption}`,
      }],
      presentationMeta: (_args, value) => value as unknown as JsonValue,
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('stage_roleplay_artifact requires an Agent Session')
      const policy = currentPolicy(exec.agent)
      if (policy?.capability.artifactPresentation !== true) {
        throw new Error('roleplay artifact presentation is disabled for this prepared turn')
      }
      if (exec.parent !== undefined) {
        throw new Error('stage_roleplay_artifact must be a top-level tool call so its stage decision is replayable')
      }
      const artifactId = boundedArtifactId(args.artifactId)
      const caption = boundedCaption(args.caption)
      const call = currentStageCall(exec.agent.session, String(exec.callId))
      if (readStagedRoleplayArtifacts(sessionEvents(exec.agent.session), call.data.turn, call.seq).length
        >= policy.behavior.image.maxPublicationsPerTurn) {
        throw new Error('this prepared turn already published its allowed roleplay image')
      }
      const staged = referencedArtifact(exec.agent.session, call, artifactId)
      const stored = await ctx.attachments.readImage(staged.artifact.attachment, exec.signal)
      if (String(stored.ref.attachmentId) !== artifactId) {
        throw new Error('stored artifact identity changed during verification')
      }
      exec.concludeTurn()
      return { ...staged, ...(caption === undefined ? {} : { caption }) }
    },
    presentCall: () => ({ card: 'generic', title: '加入 RP 舞台', kind: 'other' }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '舞台产物加入失败' : '已加入 RP 舞台',
    }),
    isConcurrencySafe: () => false,
  })), 'agent-rp: stage durable tool artifacts')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    description: 'Compatibility publisher for roleplay image tools. Omit path to publish the latest unused durable image returned earlier in this turn. Otherwise pass a real PNG, JPEG, WebP, or GIF path inside the Session workspace. This stores one canonical DSH artifact and places it after the final roleplay reply; never pass a URL, data URI, base64 payload, or guessed path.',
    parameters: {
      path: {
        type: 'string',
        description: 'Optional real image path inside the current Session workspace. Omit when an earlier same-turn tool returned a native image artifact.',
      },
      caption: {
        type: 'string',
        description: 'Optional short player-facing caption. Omit when the image should stand on its own.',
      },
    },
    output: {
      schema: ROLEPLAY_ARTIFACT_PUBLISH_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Published ${value.artifacts.length} durable roleplay image${value.artifacts.length === 1 ? '' : 's'} for this turn.`,
      }],
      presentationMeta: (_args, value) => roleplayToolArtifactPresentationMeta(
        value.artifacts as unknown as RoleplayToolImageArtifact[], {
        format: ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
        version: 0,
        ...(value.sourceResultSeq === undefined ? {} : { sourceResultSeq: value.sourceResultSeq }),
        ...(value.caption === undefined ? {} : { caption: value.caption }),
      }),
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('publish_roleplay_image requires an Agent Session')
      const policy = currentPolicy(exec.agent)
      if (policy?.capability.artifactPresentation !== true) {
        throw new Error('publish_roleplay_image is disabled for this prepared turn')
      }
      if (exec.parent !== undefined) {
        throw new Error('publish_roleplay_image must be a top-level tool call so its stage decision is replayable')
      }
      const call = currentToolCall(exec.agent.session, String(exec.callId), ROLEPLAY_ARTIFACT_PUBLISH_TOOL)
      if (readStagedRoleplayArtifacts(sessionEvents(exec.agent.session), call.data.turn, call.seq).length
        >= policy.behavior.image.maxPublicationsPerTurn) {
        throw new Error('this prepared turn already published its allowed roleplay image')
      }
      try {
        const published = await preparePublishedArtifacts(
          ctx.attachments,
          exec.agent,
          String(exec.callId),
          args,
          exec.signal,
        )
        exec.concludeTurn()
        return published
      } catch (error) {
        recordPublishFailure(exec.agent, call.data.turn)
        throw error
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: '发布角色插图',
      kind: 'other',
      ...(args.caption === undefined ? {} : { rawInput: args.caption }),
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '角色插图发布失败' : '角色插图已发布',
    }),
    isConcurrencySafe: () => false,
  })), 'agent-rp: publish image compatibility artifacts')
  return { prepare }
}

/** Read every validated stage decision in one turn before a durable boundary. */
export function readStagedRoleplayArtifacts(
  events: readonly SessionEvent[],
  turn: number,
  beforeSeq = Number.POSITIVE_INFINITY,
): readonly RoleplayArtifactStageRecord[] {
  const staged: RoleplayArtifactStageRecord[] = []
  const stagedIndex = new Map<string, number>()
  const accept = (record: RoleplayArtifactStageRecord): void => {
    const id = String(record.artifact.attachment.attachmentId)
    const previous = stagedIndex.get(id)
    if (previous === undefined) {
      stagedIndex.set(id, staged.length)
      staged.push(record)
    } else {
      staged[previous] = record
    }
  }
  const calls = new Map<string, Extract<SessionEvent, { readonly type: 'tool/call' }>>()
  const results = new Map<number, Extract<SessionEvent, { readonly type: 'tool/result' }>>()
  for (const event of events) {
    if (event.seq >= beforeSeq) continue
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), event)
      continue
    }
    if (event.type !== 'tool/result') continue
    if (event.data.turn !== turn || resultFailed(event)) {
      results.set(event.seq, event)
      continue
    }
    const artifactMeta = readToolArtifactPresentationMeta(event.data.meta)
    const autoStage = readRoleplayArtifactAutoStageIntent(artifactMeta?.data)
    const artifactCallId = resultCallId(event)
    const artifactCall = artifactCallId === undefined ? undefined : calls.get(artifactCallId)
    if (artifactMeta !== undefined && autoStage !== undefined && artifactCallId !== undefined
      && artifactCall !== undefined) {
      for (const artifact of artifactMeta.artifacts) {
        accept({
          format: ROLEPLAY_ARTIFACT_STAGE_FORMAT,
          version: 0,
          artifact,
          sourceResultSeq: event.seq,
          sourceCallId: artifactCallId,
          sourceToolName: artifactCall.data.name,
          ...(autoStage.caption === undefined ? {} : { caption: autoStage.caption }),
        })
      }
      results.set(event.seq, event)
      continue
    }
    if (artifactCall?.data.name === ROLEPLAY_ARTIFACT_PUBLISH_TOOL && artifactCallId !== undefined) {
      const legacyArtifacts = uniqueArtifacts(imagesFromContent(event.data.message.content))
      if (legacyArtifacts.length > 0) {
        const caption = legacyPublishedCaption(event.data.meta)
        for (const artifact of legacyArtifacts) {
          accept({
            format: ROLEPLAY_ARTIFACT_STAGE_FORMAT,
            version: 0,
            artifact,
            sourceResultSeq: event.seq,
            sourceCallId: artifactCallId,
            sourceToolName: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
            ...(caption === undefined ? {} : { caption }),
          })
        }
        results.set(event.seq, event)
        continue
      }
    }
    const stageCallId = resultCallId(event)
    const stageCall = stageCallId === undefined ? undefined : calls.get(stageCallId)
    if (stageCall?.data.name !== ROLEPLAY_ARTIFACT_STAGE_TOOL) {
      results.set(event.seq, event)
      continue
    }
    const record = readRoleplayArtifactStageRecord(event.data.meta)
    const source = record === undefined ? undefined : results.get(record.sourceResultSeq)
    const sourceMeta = source === undefined ? undefined : readToolArtifactPresentationMeta(source.data.meta)
    const sourceCall = record === undefined ? undefined : calls.get(record.sourceCallId)
    if (record === undefined || source === undefined || record.sourceResultSeq >= event.seq
      || source.data.turn !== turn || resultFailed(source)
      || resultCallId(source) !== record.sourceCallId
      || sourceCall?.data.name !== record.sourceToolName
      || !sourceMeta?.artifacts.some(candidate =>
        String(candidate.attachment.attachmentId) === String(record.artifact.attachment.attachmentId))) {
      results.set(event.seq, event)
      continue
    }
    accept(record)
    results.set(event.seq, event)
  }
  return staged
}

/** Project validated stage decisions into the immutable player-facing artifact shape. */
export function readPresentedRoleplayArtifacts(
  events: readonly SessionEvent[],
  turn: number,
  beforeSeq = Number.POSITIVE_INFINITY,
): readonly RoleplayPresentedArtifact[] {
  return readStagedRoleplayArtifacts(events, turn, beforeSeq).map(staged => ({
    type: staged.artifact.type,
    artifactId: String(staged.artifact.attachment.attachmentId),
    attachment: staged.artifact.attachment,
    sourceResultSeq: staged.sourceResultSeq,
    sourceCallId: staged.sourceCallId,
    sourceToolName: staged.sourceToolName,
    ...(staged.caption === undefined ? {} : { caption: staged.caption }),
  }))
}

/** Minimal Agent shape documented for capability tests and embedders. */
export type RoleplayArtifactAgent = Pick<Agent, 'session'>
