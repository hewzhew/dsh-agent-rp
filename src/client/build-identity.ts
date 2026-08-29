/** Source and Host build identity included in content-free compatibility reports. */
export interface AgentRpBuildIdentity {
  readonly audit: 'agent-rp-build-v0'
  readonly channel: 'alpha-dev' | 'prerelease'
  readonly agentRp: {
    readonly version: string
    readonly revision?: string
    readonly dirty: boolean
  }
  readonly dsh: {
    readonly version: string
    readonly revision?: string
    readonly dirty: boolean
    readonly hostPatch?: string
  }
}

declare global {
  /** Build-time replacement emitted by the Agent RP browser bundler. */
  var __DSH_AGENT_RP_BUILD_IDENTITY__: AgentRpBuildIdentity | undefined
}

const sourceFallback: AgentRpBuildIdentity = {
  audit: 'agent-rp-build-v0',
  channel: 'alpha-dev',
  agentRp: { version: 'source', dirty: true },
  dsh: { version: 'source', dirty: true },
}

/** Exact bundled identity, or an explicit source marker in unbundled tests. */
export const AGENT_RP_BUILD_IDENTITY = globalThis.__DSH_AGENT_RP_BUILD_IDENTITY__ ?? sourceFallback
