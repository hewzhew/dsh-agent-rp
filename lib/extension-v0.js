import "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-util-values";
import "@deepseek-ai/dsh-tools";
/** Reusable resource categories that can be selected independently for an experience. */
const ROLEPLAY_RESOURCE_KINDS = [
	"actor",
	"persona",
	"world",
	"prompt-policy",
	"regex"
];
/** Host service used by trusted plugins to publish discoverable Roleplay resources. */
const ROLEPLAY_RESOURCE_CATALOG_KEY = "agentRp.resources";
new Map(ROLEPLAY_RESOURCE_KINDS.map((kind, index) => [kind, index]));
/** Register through the caller's Cordis scope so unload always removes the provider. */
function registerRoleplayResourceProvider(ctx, provider) {
	const catalog = ctx.get(ROLEPLAY_RESOURCE_CATALOG_KEY);
	if (catalog === void 0 || typeof catalog.register !== "function") throw new Error("Agent RP resource catalog service is unavailable");
	ctx.effect(() => catalog.register(provider), `agent-rp: resource provider ${provider.id}`);
}
/** Host service shared by Agent RP profiles and trusted runtime plugins. */
const ROLEPLAY_RUNTIME_EXTENSIONS_KEY = "agentRp.runtimeExtensions";
/** Register through the caller's Cordis scope so plugin unload always revokes the module. */
function registerRoleplayRuntimeExtension(ctx, definition) {
	const registry = ctx.get(ROLEPLAY_RUNTIME_EXTENSIONS_KEY);
	if (registry === void 0 || typeof registry.register !== "function") throw new Error("Agent RP runtime extension service is unavailable");
	ctx.effect(() => registry.register(definition), `agent-rp: runtime extension ${definition.module.id}`);
}
/** Host service shared by Agent RP profiles and trusted Worker plugins. */
const ROLEPLAY_TURN_WORKERS_KEY = "agentRp.turnWorkers";
/** Register one trusted Host Worker through the versioned Agent RP extension service. */
function registerRoleplayTurnWorker(ctx, worker) {
	const registry = ctx.get(ROLEPLAY_TURN_WORKERS_KEY);
	if (registry === void 0 || typeof registry.register !== "function") throw new Error("Agent RP turn Worker registry is unavailable");
	ctx.effect(() => registry.register(worker), `agent-rp: turn Worker ${worker.id}`);
}
Object.freeze([Object.freeze({
	id: "single-board",
	text: "场景中只有一张棋盘。"
}), Object.freeze({
	id: "shared-die",
	text: "场景中只有一枚由各回合共用的骰子；投掷次数不能改写成骰子数量。"
})]);
/** Host service used by trusted plugins to install executable play worlds. */
const PLAY_WORLD_REGISTRY_KEY = "agentRp.playWorlds";
/** Register one trusted module for the lifetime of its Cordis plugin context. */
function registerPlayWorldModule(ctx, module) {
	const registry = ctx.get(PLAY_WORLD_REGISTRY_KEY);
	if (registry === void 0 || typeof registry.register !== "function") throw new Error("Agent RP 游玩世界注册表不可用");
	ctx.effect(() => registry.register(module), `agent-rp: play world ${module.descriptor.id}`);
}
const ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY = "agentRp.actorRevisions";
const ROLEPLAY_ACTOR_DEFINITION_FIELDS = [
	"name",
	"description",
	"personality",
	"scenario",
	"exampleDialogue",
	"openings"
];
var RoleplayActorRevisionConflictError = class extends Error {
	current;
	constructor(current) {
		super("角色设定已在别处改变，未覆盖新的修订");
		this.current = current;
		this.name = "RoleplayActorRevisionConflictError";
	}
};
/** Register one writable actor provider through the caller's owned Cordis lifetime. */
function registerRoleplayActorRevisionProvider(ctx, provider) {
	const registry = ctx.get(ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY);
	if (registry === void 0 || typeof registry.register !== "function") throw new Error("Agent RP actor revision service is unavailable");
	ctx.effect(() => registry.register(provider), `agent-rp: actor revision provider ${provider.id}`);
}
/** Host service used by trusted input adapters without coupling the resource catalog to Tavern. */
const TAVERN_RESOURCE_PREFLIGHT_KEY = "agentRp.tavernResourcePreflight";
/** Register through the caller's Cordis scope so plugin unload revokes its adapter. */
function registerTavernResourcePreflightContributor(ctx, contributor) {
	const registry = ctx.get(TAVERN_RESOURCE_PREFLIGHT_KEY);
	if (registry === void 0 || typeof registry.register !== "function") throw new Error("Agent RP Tavern resource preflight service is unavailable");
	ctx.effect(() => registry.register(contributor), `agent-rp: Tavern resource preflight provider ${contributor.providerId}`);
}
const TOOL_ARTIFACT_PRESENTATION_FORMAT = "dsh.tool-artifacts";
const ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT = "agent-rp.artifact-stage-intent";
const IMAGE_MEDIA_TYPES = /* @__PURE__ */ new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
]);
function plainRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function imageAttachment(value) {
	const record = plainRecord(value);
	if (record === void 0 || typeof record.attachmentId !== "string" || record.attachmentId === "" || typeof record.mediaType !== "string" || !IMAGE_MEDIA_TYPES.has(record.mediaType) || typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || typeof record.width !== "number" || !Number.isSafeInteger(record.width) || record.width <= 0 || typeof record.height !== "number" || !Number.isSafeInteger(record.height) || record.height <= 0 || record.name !== void 0 && typeof record.name !== "string") return void 0;
	return value;
}
function imageArtifact(value) {
	const record = plainRecord(value);
	const attachment = record?.type === "image" ? imageAttachment(record.attachment) : void 0;
	return attachment === void 0 ? void 0 : {
		type: "image",
		attachment
	};
}
/** Read the DSH artifact envelope without depending on a not-yet-published package export. */
function readToolArtifactPresentationMeta(value) {
	const record = plainRecord(value);
	if (record?.format !== "dsh.tool-artifacts" || record.version !== 0 || !Array.isArray(record.artifacts) || record.artifacts.length === 0) return void 0;
	const artifacts = record.artifacts.map(imageArtifact);
	if (artifacts.some((artifact) => artifact === void 0)) return void 0;
	return {
		format: TOOL_ARTIFACT_PRESENTATION_FORMAT,
		version: 0,
		artifacts,
		...record.data === void 0 ? {} : { data: record.data }
	};
}
/** Create the canonical DSH artifact envelope consumed by Agent RP and other capable clients. */
function roleplayToolArtifactPresentationMeta(artifacts, data) {
	return {
		format: TOOL_ARTIFACT_PRESENTATION_FORMAT,
		version: 0,
		artifacts: [...artifacts],
		...data === void 0 ? {} : { data }
	};
}
/** Parse producer-owned automatic stage intent without trusting arbitrary tool metadata. */
function readRoleplayArtifactAutoStageIntent(value) {
	const record = plainRecord(value);
	if (record?.format !== "agent-rp.artifact-stage-intent" || record.version !== 0 || record.sourceResultSeq !== void 0 && (typeof record.sourceResultSeq !== "number" || !Number.isSafeInteger(record.sourceResultSeq) || record.sourceResultSeq < 0) || record.caption !== void 0 && (typeof record.caption !== "string" || record.caption === "" || record.caption.length > 500)) return void 0;
	return {
		format: ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
		version: 0,
		...record.sourceResultSeq === void 0 ? {} : { sourceResultSeq: record.sourceResultSeq },
		...record.caption === void 0 ? {} : { caption: record.caption }
	};
}
[...IMAGE_MEDIA_TYPES];
[...IMAGE_MEDIA_TYPES];
/** Versioned public contract for independent DSH plugins extending Agent RP. */
/** The API version encoded by the `@hewzhew/dsh-agent-rp/extension/v0` export. */
const AGENT_RP_EXTENSION_API_VERSION = 0;
export { AGENT_RP_EXTENSION_API_VERSION, PLAY_WORLD_REGISTRY_KEY, ROLEPLAY_ACTOR_DEFINITION_FIELDS, ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY, ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT, ROLEPLAY_RESOURCE_CATALOG_KEY, ROLEPLAY_RESOURCE_KINDS, ROLEPLAY_RUNTIME_EXTENSIONS_KEY, ROLEPLAY_TURN_WORKERS_KEY, RoleplayActorRevisionConflictError, TAVERN_RESOURCE_PREFLIGHT_KEY, TOOL_ARTIFACT_PRESENTATION_FORMAT, readRoleplayArtifactAutoStageIntent, readToolArtifactPresentationMeta, registerPlayWorldModule, registerRoleplayActorRevisionProvider, registerRoleplayResourceProvider, registerRoleplayRuntimeExtension, registerRoleplayTurnWorker, registerTavernResourcePreflightContributor, roleplayToolArtifactPresentationMeta };
