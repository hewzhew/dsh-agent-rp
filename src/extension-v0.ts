/** Versioned public contract for independent DSH plugins extending Agent RP. */

/** The API version encoded by the `@hewzhew/dsh-agent-rp/extension/v0` export. */
export const AGENT_RP_EXTENSION_API_VERSION = 0 as const

export {
  registerRoleplayResourceProvider,
  ROLEPLAY_RESOURCE_CATALOG_KEY,
} from './roleplay-resource-catalog.ts'
export type {
  LocatedPlayWorldResource,
  RoleplayActorProjection,
  RoleplayResourceMaterialization,
  RoleplayResourceMaterializationContext,
  RoleplayResourceMaterializationInput,
  RoleplayResourceProvider,
  RoleplayStorySourceProjection,
  RoleplayWorldProjection,
} from './roleplay-resource-catalog.ts'
export {
  ROLEPLAY_RESOURCE_KINDS,
} from './roleplay-resource-catalog-protocol.ts'
export type {
  RoleplayResourceDescriptor,
  RoleplayResourceDetail,
  RoleplayResourceKind,
  RoleplayResourceReference,
  RoleplayResourceSelection,
} from './roleplay-resource-catalog-protocol.ts'

export {
  registerRoleplayRuntimeExtension,
  ROLEPLAY_RUNTIME_EXTENSIONS_KEY,
} from './roleplay-runtime-extension.ts'
export type {
  RoleplayRuntimeExtensionDefinition,
  RoleplayRuntimeExtensionResolution,
  RoleplayRuntimeExtensionResolveInput,
} from './roleplay-runtime-extension.ts'

export {
  registerRoleplayTurnWorker,
  ROLEPLAY_TURN_WORKERS_KEY,
} from './roleplay-turn-worker.ts'
export type {
  RoleplayTurnWorker,
  RoleplayTurnWorkerInput,
  RoleplayTurnWorkerOutcome,
  RoleplayTurnWorkerPhase,
} from './roleplay-turn-worker.ts'

export {
  PLAY_WORLD_REGISTRY_KEY,
  registerPlayWorldModule,
} from './play-world.ts'
export type {
  PlayWorldCharacterAction,
  PlayWorldCharacterTurn,
  PlayWorldContext,
  PlayWorldModule,
  PlayWorldWorkspaceEdgeTemplate,
  PlayWorldWorkspaceNodeTemplate,
  PlayWorldWorkspaceOutputTemplate,
  PlayWorldWorkspaceScaffold,
} from './play-world.ts'
export type {
  PlayWorldBinding,
  PlayWorldEvent,
  PlayWorldModuleDescriptor,
  PlayWorldPromptProjection,
  PlayWorldResourceDescriptor,
  PlayWorldSnapshot,
} from './play-world-protocol.ts'

export {
  registerRoleplayActorRevisionProvider,
  ROLEPLAY_ACTOR_DEFINITION_FIELDS,
  ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY,
  RoleplayActorRevisionConflictError,
} from './roleplay-actor-revision.ts'
export type {
  RoleplayActorDefinition,
  RoleplayActorDefinitionField,
  RoleplayActorRevisionChanges,
  RoleplayActorRevisionInput,
  RoleplayActorRevisionProvider,
  RoleplayActorRevisionSnapshot,
} from './roleplay-actor-revision.ts'

export {
  registerTavernResourcePreflightContributor,
  TAVERN_RESOURCE_PREFLIGHT_KEY,
} from './tavern-resource-preflight.ts'
export type {
  TavernResourcePreflightContributor,
  TavernResourcePreflightResolveInput,
} from './tavern-resource-preflight.ts'

export {
  readRoleplayArtifactAutoStageIntent,
  readToolArtifactPresentationMeta,
  roleplayToolArtifactPresentationMeta,
  ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
  TOOL_ARTIFACT_PRESENTATION_FORMAT,
} from './roleplay-artifact.ts'
export type {
  RoleplayArtifactAutoStageIntent,
  RoleplayToolImageArtifact,
  ToolArtifactPresentationMeta,
} from './roleplay-artifact.ts'
