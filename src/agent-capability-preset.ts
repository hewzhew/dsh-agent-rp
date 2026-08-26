/** Admission and discovery for DSH Agent presets that compose Agent RP plus tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  AGENT_RP_CAPABILITY_PRESETS_PATH,
  isAgentRpCapabilityPresetId,
  type AgentRpCapabilityPresetSummary,
} from './agent-capability-preset-protocol.ts'
import {
  jsonResponse as json,
  trustedBrowserRequest,
  type AgentRpHttpServer,
} from './host-http.ts'
import { AGENT_RP_PRESET_ID } from './preset.ts'

export interface AgentPresetDescriptor {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** Structural subset of DSH's AgentPresets service used by the RP Host. */
export interface AgentPresetGateway {
  list(): Promise<readonly AgentPresetDescriptor[]>
  read(id: string): Promise<string>
  resolve(id?: string): Promise<AgentPresetDescriptor>
  mount(agentCtx: Context, id?: string): Promise<unknown>
  serviceFor(agent: { readonly ctx: Context }, name: string): unknown
}

/**
 * Recognize derivatives of the managed composition before attempting a mount.
 * The runtime service check remains authoritative after mounting; this bounded
 * source check keeps unrelated coding presets out of the RP picker.
 */
export function isAgentRpCapabilityComposition(source: string): boolean {
  const normalized = source.replace(/\r\n?|\n/gu, '\n')
  const packageRow = /(?:^|\n)[ \t]*name:[ \t]*(?:['"])?@hewzhew\/dsh-agent-rp(?:['"])?[ \t]*(?:#.*)?(?:\n|$)/u.exec(normalized)
  if (packageRow === null) return false
  const runtimeTail = normalized.slice(packageRow.index, packageRow.index + 2_000)
  return /(?:^|\n)[ \t]*mode:[ \t]*character[ \t]*(?:#.*)?(?:\n|$)/u.test(runtimeTail)
    && /(?:^|\n)[ \t]*agentRp\.actorRevisions:[ \t]*true[ \t]*(?:#.*)?(?:\n|$)/u.test(normalized)
}

export function agentHasAgentRpRuntime(
  presets: AgentPresetGateway,
  agent: Agent | undefined,
): agent is Agent {
  return agent !== undefined
    && isAgentRpCapabilityPresetId(agent.session.header.agentPreset)
    && presets.serviceFor(agent, 'agentRp.actorRevisions') !== undefined
}

/** Resolve only a prefixed, loadable composition that retains Agent RP. */
export async function resolveAgentRpCapabilityPreset(
  presets: AgentPresetGateway,
  id: string = AGENT_RP_PRESET_ID,
): Promise<AgentPresetDescriptor> {
  if (!isAgentRpCapabilityPresetId(id)) {
    throw new Error('Agent 能力预设 id 必须使用 agent-rp 或 agent-rp-*')
  }
  const preset = await presets.resolve(id)
  if (preset.broken !== undefined) throw new Error(`Agent 能力预设无法加载：${preset.broken}`)
  if (!isAgentRpCapabilityComposition(await presets.read(preset.id))) {
    throw new Error('所选 Agent 能力预设没有保留 Agent RP 角色运行时')
  }
  return preset
}

export async function listAgentRpCapabilityPresets(
  presets: AgentPresetGateway,
): Promise<readonly AgentRpCapabilityPresetSummary[]> {
  const compatible: AgentRpCapabilityPresetSummary[] = []
  for (const preset of await presets.list()) {
    if (preset.broken !== undefined || !isAgentRpCapabilityPresetId(preset.id)) continue
    let composition: string
    try {
      composition = await presets.read(preset.id)
    } catch {
      continue
    }
    if (!isAgentRpCapabilityComposition(composition)) continue
    compatible.push({
      id: preset.id,
      name: preset.name?.trim() || preset.id,
      ...(preset.description === undefined ? {} : { description: preset.description }),
      trust: preset.trust,
      managed: preset.id === AGENT_RP_PRESET_ID,
    })
  }
  return compatible.sort((left, right) => Number(right.managed) - Number(left.managed)
    || left.name.localeCompare(right.name, 'zh-CN'))
}

/** Publish a content-free picker; raw composition text never reaches this route. */
export function installAgentRpCapabilityPresetHttp(
  routeCtx: Context,
  hostCtx: Context,
  server: AgentRpHttpServer,
): void {
  routeCtx.effect(() => server.register({
    kind: 'exact',
    path: AGENT_RP_CAPABILITY_PRESETS_PATH,
    async handler(request, response) {
      if (!trustedBrowserRequest(request)) {
        json(response, 403, { error: 'forbidden' })
        return
      }
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET')
        json(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        const presets = hostCtx.get('agentPresets') as AgentPresetGateway | undefined
        if (presets === undefined) throw new Error('当前 Host 没有 Agent 预设服务')
        json(response, 200, { format: 0, entries: await listAgentRpCapabilityPresets(presets) })
      } catch (error: unknown) {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'agent-rp: capability preset HTTP')
}
