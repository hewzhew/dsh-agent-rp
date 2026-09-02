/** Model-invoked image generation through the provider configured by Agent RP. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GeneratedImageLibrary } from './generated-image-library.ts'
import { executeConfiguredImageGeneration } from './image-generation-command.ts'
import {
  IMAGE_GENERATION_MODES,
  type ImageGenerationMode,
} from './image-generation-protocol.ts'
import {
  roleplayToolArtifactPresentationMeta,
  type RoleplayToolImageArtifact,
} from './roleplay-artifact.ts'
import type { RoleplayToolPolicyPlan } from './roleplay-tool-guidance.ts'
import { WorkspaceSettingsStore } from './workspace-settings-store.ts'
import { sessionEvents } from './session-events.ts'

export const ROLEPLAY_IMAGE_GENERATION_TOOL = 'generate_roleplay_image'
export const ROLEPLAY_IMAGE_GENERATION_FORMAT = 'agent-rp.generated-image'

/** Durable result shared by the model handoff and the browser image library. */
export interface RoleplayImageGenerationValue {
  readonly format: typeof ROLEPLAY_IMAGE_GENERATION_FORMAT
  readonly version: 0
  readonly jobId: string
  readonly artifact: RoleplayToolImageArtifact
}

export const ROLEPLAY_IMAGE_GENERATION_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', required: true, const: ROLEPLAY_IMAGE_GENERATION_FORMAT },
    version: { type: 'integer', required: true, const: 0 },
    jobId: { type: 'string', required: true },
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
            mediaType: {
              type: 'string',
              required: true,
              enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
            },
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
} as const

export interface InstallRoleplayImageGenerationToolOptions {
  readonly attachments: AttachmentStore
  readonly credentials: CredentialProvider
  readonly library: GeneratedImageLibrary
  readonly settings: WorkspaceSettingsStore
  /** Return the immutable policy prepared for the current roleplay turn. */
  readonly toolPolicy: (agent: Agent) => RoleplayToolPolicyPlan | undefined
}

/** Synchronous visibility gate settled before each model request is assembled. */
export interface RoleplayImageGenerationToolController {
  /** Apply one turn's policy and restore the tool only after a newer turn begins. */
  prepare(agent: Agent, policy: RoleplayToolPolicyPlan | undefined, turn?: number): void
}

function currentToolTurn(agent: Agent, callId: string): number {
  const call = sessionEvents(agent.session).findLast(event => event.type === 'tool/call'
    && String(event.data.callId) === callId)
  if (call?.type !== 'tool/call' || call.data.name !== ROLEPLAY_IMAGE_GENERATION_TOOL) {
    throw new Error('generate_roleplay_image has no matching durable tool call')
  }
  return call.data.turn
}

function imageName(jobId: string, mediaType: 'image/png' | 'image/jpeg' | 'image/webp'): string {
  const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice('image/'.length)
  return `${jobId}.${extension}`
}

/** Install the provider-neutral producer that feeds Agent RP's artifact handoff. */
export function installRoleplayImageGenerationTool(
  ctx: Context,
  options: InstallRoleplayImageGenerationToolOptions,
): RoleplayImageGenerationToolController {
  const policyRestrictions = new Map<Agent, () => void>()
  const attemptRestrictions = new Map<Agent, { readonly turn: number; readonly dispose: () => void }>()
  const disposePolicyRestriction = (agent: Agent): void => {
    const dispose = policyRestrictions.get(agent)
    policyRestrictions.delete(agent)
    dispose?.()
  }
  const disposeAttemptRestriction = (agent: Agent): void => {
    const restriction = attemptRestrictions.get(agent)
    attemptRestrictions.delete(agent)
    restriction?.dispose()
  }
  const prepare = (agent: Agent, policy: RoleplayToolPolicyPlan | undefined, turn?: number): void => {
    const attempt = attemptRestrictions.get(agent)
    if (turn !== undefined && attempt !== undefined && attempt.turn !== turn) {
      disposeAttemptRestriction(agent)
    }
    const disabled = policy?.capability.artifactPresentation !== true
      || policy.behavior.image.mode === 'never'
    const restricted = policyRestrictions.has(agent)
    if (disabled && !restricted) {
      policyRestrictions.set(agent, agent.ctx.tools.restrict({ deny: [ROLEPLAY_IMAGE_GENERATION_TOOL] }))
    } else if (!disabled && restricted) {
      disposePolicyRestriction(agent)
    }
  }

  ctx.on('agent/created', ({ agent }) => { prepare(agent, options.toolPolicy(agent)) })
  ctx.on('agent/disposed', ({ agent }) => {
    disposeAttemptRestriction(agent)
    disposePolicyRestriction(agent)
  })
  ctx.effect(() => () => {
    for (const { dispose } of attemptRestrictions.values()) dispose()
    attemptRestrictions.clear()
    for (const dispose of policyRestrictions.values()) dispose()
    policyRestrictions.clear()
  }, 'agent-rp: configured image generation restrictions and per-turn attempt limit')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: ROLEPLAY_IMAGE_GENERATION_TOOL,
    description: 'Generate one durable roleplay illustration with the image provider configured in Agent RP settings. When used for the current scene, first finish the visible roleplay prose, then call this tool once at the end of the same assistant message. Its result supplies an exact artifact id to a separate lightweight presentation handoff; do not invent a path, URL, or id.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'A self-contained visual prompt describing the desired scene or portrait. Do not include hidden reasoning, tool instructions, URLs, or credentials.',
      },
      mode: {
        type: 'string',
        enum: [...IMAGE_GENERATION_MODES],
        description: 'Image intent. Omit for a scene illustration.',
      },
    },
    output: {
      schema: ROLEPLAY_IMAGE_GENERATION_VALUE_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Generated durable roleplay image artifact ${String(value.artifact.attachment.attachmentId)}. Complete the presentation handoff without writing more roleplay prose.`,
      }],
      presentationMeta: (_args, value) => roleplayToolArtifactPresentationMeta(
        [value.artifact as RoleplayToolImageArtifact],
      ),
    },
    async execute(args, exec): Promise<RoleplayImageGenerationValue> {
      if (exec.agent === undefined) throw new Error('generate_roleplay_image requires an Agent Session')
      if (exec.parent !== undefined) {
        throw new Error('generate_roleplay_image must be called directly by the roleplay Agent')
      }
      const policy = options.toolPolicy(exec.agent)
      if (policy?.capability.artifactPresentation !== true || policy.behavior.image.mode === 'never') {
        throw new Error('roleplay image generation is disabled for this prepared turn')
      }
      const turn = currentToolTurn(exec.agent, String(exec.callId))
      const previousAttempt = attemptRestrictions.get(exec.agent)
      if (previousAttempt?.turn === turn) {
        throw new Error('this roleplay turn already attempted its configured image generation')
      }
      disposeAttemptRestriction(exec.agent)
      attemptRestrictions.set(exec.agent, {
        turn,
        dispose: exec.agent.ctx.tools.restrict({ deny: [ROLEPLAY_IMAGE_GENERATION_TOOL] }),
      })
      const mode = (args.mode ?? 'scene') as ImageGenerationMode
      const job = await executeConfiguredImageGeneration(
        options.library,
        options.settings,
        options.credentials,
        {
          format: 0,
          jobId: `image-${randomUUID()}`,
          mode,
          prompt: args.prompt,
        },
        exec.signal,
      )
      const asset = options.library.asset(job.id)
      const artifact: RoleplayToolImageArtifact = {
        type: 'image',
        attachment: await options.attachments.saveImage({
          data: asset.data,
          mediaType: asset.mediaType,
          name: imageName(job.id, asset.mediaType),
        }),
      }
      return {
        format: ROLEPLAY_IMAGE_GENERATION_FORMAT,
        version: 0,
        jobId: job.id,
        artifact,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: '生成角色插图',
      kind: 'other',
      rawInput: args.prompt,
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '角色插图生成失败' : '角色插图已生成',
    }),
    isConcurrencySafe: () => false,
  })), 'agent-rp: configured image generation tool')

  return { prepare }
}
