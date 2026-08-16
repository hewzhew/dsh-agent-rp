import { createRequire } from "node:module";
import { BlockAssembler, ReasoningEffortId, createAssistantMessage, createMessage, createUserMessage, isAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import z from "@deepseek-ai/schemastery";
import { Session, SessionId, isSurfaceEvent, snapshotJsonValue } from "@deepseek-ai/dsh-session";
import { Buffer as Buffer$1 } from "node:buffer";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { fileURLToPath } from "node:url";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { renderContextSnapshot, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
/** Same-origin Host route for Agent RP workspace preferences. */
const AGENT_RP_WORKSPACE_SETTINGS_PATH = "/api/agent-rp/settings";
/** Image providers available for explicit roleplay illustrations. */
const AGENT_RP_IMAGE_PROVIDERS = [
	"openai",
	"novelai",
	"a1111",
	"comfyui"
];
const DEFAULT_IMAGE_PROFILE_ID = "default";
const DEFAULT_IMAGE_GENERATION_SETTINGS = {
	provider: "openai",
	openai: {
		endpoint: "https://api.openai.com/v1/images/generations",
		model: "gpt-image-1",
		size: "1024x1024"
	},
	novelai: {
		endpoint: "https://image.novelai.net/ai/generate-image",
		model: "nai-diffusion-4-5-full",
		width: 832,
		height: 1216,
		steps: 28,
		scale: 5,
		sampler: "k_euler",
		noiseSchedule: "karras",
		cfgRescale: .18,
		negativePrompt: "",
		quality: true,
		smea: true,
		smeaDyn: true
	},
	a1111: {
		endpoint: "http://127.0.0.1:7860",
		model: "",
		width: 768,
		height: 1024,
		steps: 28,
		cfgScale: 7,
		sampler: "DPM++ 2M Karras",
		negativePrompt: ""
	},
	comfyui: {
		endpoint: "http://127.0.0.1:8188",
		workflow: "",
		width: 768,
		height: 1024,
		negativePrompt: ""
	}
};
/** Default settings preserve the existing all-workspace behavior. */
const DEFAULT_AGENT_RP_SETTINGS = {
	workspaceMode: "all",
	workspaceIds: [],
	imageGeneration: DEFAULT_IMAGE_GENERATION_SETTINGS,
	activeImageProfileId: DEFAULT_IMAGE_PROFILE_ID,
	imageProfiles: [{
		id: DEFAULT_IMAGE_PROFILE_ID,
		name: "默认配置",
		settings: DEFAULT_IMAGE_GENERATION_SETTINGS
	}]
};
function text$4(value, fallback, max, label) {
	if (value === void 0) return fallback;
	if (typeof value !== "string" || value.length > max) throw new Error(`${label}无效`);
	return value.trim();
}
function endpoint$1(value, fallback, label) {
	const candidate = text$4(value, fallback, 2e3, label);
	let parsed;
	try {
		parsed = new URL(candidate);
	} catch {
		throw new Error(`${label}无效`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") throw new Error(`${label}无效`);
	return candidate;
}
function integer$1(value, fallback, min, max, label) {
	const candidate = value === void 0 ? fallback : value;
	if (!Number.isSafeInteger(candidate) || Number(candidate) < min || Number(candidate) > max) throw new Error(`${label}无效`);
	return Number(candidate);
}
function finite$2(value, fallback, min, max, label) {
	const candidate = value === void 0 ? fallback : value;
	if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < min || candidate > max) throw new Error(`${label}无效`);
	return candidate;
}
function bool(value, fallback, label) {
	if (value === void 0) return fallback;
	if (typeof value !== "boolean") throw new Error(`${label}无效`);
	return value;
}
function novelAiDimension(value, fallback, label) {
	const candidate = integer$1(value, fallback, 64, 2048, label);
	if (candidate % 64 !== 0) throw new Error(`${label}必须是 64 的倍数`);
	return candidate;
}
/** Normalize image settings while accepting pre-image-generation settings files. */
function normalizeImageGenerationSettings(value) {
	if (value === void 0) return structuredClone(DEFAULT_AGENT_RP_SETTINGS.imageGeneration);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Agent RP 图片设置不是对象");
	const record = value;
	if (!AGENT_RP_IMAGE_PROVIDERS.includes(record.provider)) throw new Error("Agent RP 图片提供方无效");
	const openai = typeof record.openai === "object" && record.openai !== null && !Array.isArray(record.openai) ? record.openai : {};
	const novelai = typeof record.novelai === "object" && record.novelai !== null && !Array.isArray(record.novelai) ? record.novelai : {};
	const a1111 = typeof record.a1111 === "object" && record.a1111 !== null && !Array.isArray(record.a1111) ? record.a1111 : {};
	const comfyui = typeof record.comfyui === "object" && record.comfyui !== null && !Array.isArray(record.comfyui) ? record.comfyui : {};
	const size = openai.size ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.openai.size;
	if (size !== "1024x1024" && size !== "1024x1536" && size !== "1536x1024") throw new Error("OpenAI 图片尺寸无效");
	const novelAiModel = novelai.model ?? DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.model;
	if (novelAiModel !== "nai-diffusion-4-5-full" && novelAiModel !== "nai-diffusion-4-5-curated") throw new Error("NovelAI 图片模型无效");
	return {
		provider: record.provider,
		openai: {
			endpoint: endpoint$1(openai.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.openai.endpoint, "OpenAI 图片服务地址"),
			model: text$4(openai.model, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.openai.model, 200, "OpenAI 图片模型"),
			size
		},
		novelai: {
			endpoint: endpoint$1(novelai.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.endpoint, "NovelAI 图片服务地址"),
			model: novelAiModel,
			width: novelAiDimension(novelai.width, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.width, "NovelAI 宽度"),
			height: novelAiDimension(novelai.height, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.height, "NovelAI 高度"),
			steps: integer$1(novelai.steps, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.steps, 1, 50, "NovelAI 步数"),
			scale: finite$2(novelai.scale, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.scale, 0, 20, "NovelAI 引导强度"),
			sampler: text$4(novelai.sampler, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.sampler, 100, "NovelAI 采样器"),
			noiseSchedule: text$4(novelai.noiseSchedule, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.noiseSchedule, 100, "NovelAI 噪声调度"),
			cfgRescale: finite$2(novelai.cfgRescale, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.cfgRescale, 0, 1, "NovelAI CFG Rescale"),
			negativePrompt: text$4(novelai.negativePrompt, "", 8e3, "NovelAI 负面提示词"),
			quality: bool(novelai.quality, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.quality, "NovelAI 质量增强"),
			smea: bool(novelai.smea, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.smea, "NovelAI SMEA"),
			smeaDyn: bool(novelai.smeaDyn, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.novelai.smeaDyn, "NovelAI SMEA DYN")
		},
		a1111: {
			endpoint: endpoint$1(a1111.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.endpoint, "A1111 图片服务地址"),
			model: text$4(a1111.model, "", 500, "A1111 模型"),
			width: integer$1(a1111.width, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.width, 256, 2048, "A1111 宽度"),
			height: integer$1(a1111.height, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.height, 256, 2048, "A1111 高度"),
			steps: integer$1(a1111.steps, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.steps, 1, 150, "A1111 步数"),
			cfgScale: finite$2(a1111.cfgScale, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.cfgScale, 0, 30, "A1111 CFG"),
			sampler: text$4(a1111.sampler, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.a1111.sampler, 300, "A1111 采样器"),
			negativePrompt: text$4(a1111.negativePrompt, "", 8e3, "A1111 负面提示词")
		},
		comfyui: {
			endpoint: endpoint$1(comfyui.endpoint, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.comfyui.endpoint, "ComfyUI 服务地址"),
			workflow: text$4(comfyui.workflow, "", 256 * 1024, "ComfyUI API 工作流"),
			width: integer$1(comfyui.width, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.comfyui.width, 64, 4096, "ComfyUI 宽度"),
			height: integer$1(comfyui.height, DEFAULT_AGENT_RP_SETTINGS.imageGeneration.comfyui.height, 64, 4096, "ComfyUI 高度"),
			negativePrompt: text$4(comfyui.negativePrompt, "", 8e3, "ComfyUI 负面提示词")
		}
	};
}
/**
* Validate one persisted or wire settings value.
* @param value - untrusted JSON value.
* @returns normalized settings with duplicate ids removed.
*/
function normalizeAgentRpSettings(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Agent RP 设置不是对象");
	const record = value;
	const workspaceMode = record.workspaceMode;
	const workspaceIds = record.workspaceIds;
	if (workspaceMode !== "all" && workspaceMode !== "selected" || !Array.isArray(workspaceIds) || workspaceIds.length > 1e3 || workspaceIds.some((id) => typeof id !== "string" || id.trim() !== id || id === "" || id.length > 256)) throw new Error("Agent RP 工作区设置字段无效");
	const imageGeneration = normalizeImageGenerationSettings(record.imageGeneration);
	let imageProfiles;
	let activeImageProfileId;
	if (record.imageProfiles === void 0) {
		activeImageProfileId = DEFAULT_IMAGE_PROFILE_ID;
		imageProfiles = [{
			id: activeImageProfileId,
			name: "默认配置",
			settings: imageGeneration
		}];
	} else {
		if (!Array.isArray(record.imageProfiles) || record.imageProfiles.length === 0 || record.imageProfiles.length > 50) throw new Error("图片服务配置档案无效");
		imageProfiles = record.imageProfiles.map((value) => {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("图片服务配置档案无效");
			const profile = value;
			if (typeof profile.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(profile.id)) throw new Error("图片服务配置档案 id 无效");
			if (typeof profile.name !== "string" || profile.name.trim() === "" || profile.name.trim().length > 80) throw new Error("图片服务配置档案名称无效");
			return {
				id: profile.id,
				name: profile.name.trim(),
				settings: normalizeImageGenerationSettings(profile.settings)
			};
		});
		if (new Set(imageProfiles.map((profile) => profile.id)).size !== imageProfiles.length) throw new Error("图片服务配置档案 id 重复");
		if (new Set(imageProfiles.map((profile) => profile.name.toLowerCase())).size !== imageProfiles.length) throw new Error("图片服务配置档案名称重复");
		activeImageProfileId = typeof record.activeImageProfileId === "string" ? record.activeImageProfileId : imageProfiles[0].id;
		if (!imageProfiles.some((profile) => profile.id === activeImageProfileId)) throw new Error("当前图片服务配置档案不存在");
	}
	const activeImageGeneration = imageProfiles.find((profile) => profile.id === activeImageProfileId).settings;
	return {
		workspaceMode,
		workspaceIds: [...new Set(workspaceIds)],
		imageGeneration: activeImageGeneration,
		activeImageProfileId,
		imageProfiles
	};
}
/** File-backed preferences for Agent RP entry points. */
/** Small atomic settings file owned by the plugin. */
var WorkspaceSettingsStore = class {
	path;
	constructor(options = {}) {
		this.path = resolve(options.path ?? dshHomePath("agent-rp", "settings.json"));
	}
	/** Read current settings, using the all-workspace default before the first write. */
	get() {
		if (!existsSync(this.path)) return {
			...DEFAULT_AGENT_RP_SETTINGS,
			workspaceIds: []
		};
		try {
			return normalizeAgentRpSettings(JSON.parse(readFileSync(this.path, "utf8")));
		} catch (error) {
			throw new Error(`无法读取 Agent RP 设置 ${JSON.stringify(this.path)}`, { cause: error });
		}
	}
	/** Validate and atomically replace current settings. */
	set(input) {
		const settings = normalizeAgentRpSettings(input);
		mkdirSync(dirname(this.path), {
			recursive: true,
			mode: 448
		});
		const staging = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
		try {
			writeFileSync(staging, `${JSON.stringify({
				format: 0,
				...settings
			}, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			renameSync(staging, this.path);
		} finally {
			rmSync(staging, { force: true });
		}
		return settings;
	}
};
const MAX_SETTINGS_BYTES = 512 * 1024;
function trustedBrowserRequest$12(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$12(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJson$5(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > MAX_SETTINGS_BYTES) throw new Error("Agent RP 设置内容过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > MAX_SETTINGS_BYTES) throw new Error("Agent RP 设置内容过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("Agent RP 设置内容为空");
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
/** Register durable reads and whole-document writes for plugin preferences. */
function installWorkspaceSettingsHttp(ctx, store, server) {
	ctx.effect(() => server.register({
		kind: "exact",
		path: AGENT_RP_WORKSPACE_SETTINGS_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$12(request)) {
				json$12(response, 403, { error: "forbidden" });
				return;
			}
			try {
				if (request.method === "GET") {
					json$12(response, 200, {
						format: 0,
						settings: store.get()
					});
					return;
				}
				if (request.method === "PUT") {
					json$12(response, 200, {
						format: 0,
						settings: store.set(await readJson$5(request))
					});
					return;
				}
				response.setHeader("allow", "GET, PUT");
				json$12(response, 405, { error: "method not allowed" });
			} catch (error) {
				json$12(response, /过大/u.test(String(error)) ? 413 : 400, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "agent-rp: workspace settings HTTP");
}
/** Default character traits; deployments may replace this text without changing the runtime. */
const DEFAULT_PERSONA = "二十七岁，经营一家傍晚开门的旧书修复铺。观察敏锐，话不多，熟悉之后会显出一点促狭；不卖弄知识，也不急着把每句话说成结论。";
/** Default opening situation for a fresh conversation. */
const DEFAULT_SCENARIO = "一个下雨的傍晚，用户在修复铺打烊前走了进来。你们见过几次，还没有熟到无话不谈。";
/** Default relationship state before durable conversation memories accumulate. */
const DEFAULT_RELATIONSHIP = "你对用户有克制的熟悉感，愿意认真听对方说话；关系怎样变化，由后续对话决定。";
/** Loader schema for the Agent RP character configuration. */
const Config = z.object({
	mode: z.union(["host", "character"]).default("character"),
	characterName: z.string().min(1).max(80).default("岚"),
	persona: z.string().min(1).max(4e3).default(DEFAULT_PERSONA),
	scenario: z.string().min(1).max(4e3).default(DEFAULT_SCENARIO),
	relationship: z.string().min(1).max(2e3).default(DEFAULT_RELATIONSHIP)
});
function requiredText(value, fallback, field) {
	const normalized = (value ?? fallback).trim();
	if (normalized.length === 0) throw new TypeError(`${field} must contain non-whitespace text`);
	return normalized;
}
/**
* Normalize configuration even when the plugin is mounted without Loader validation.
* @param config - loader-provided or direct plugin configuration.
* @returns complete character configuration.
*/
function resolveConfig(config) {
	return {
		mode: config.mode ?? "character",
		characterName: requiredText(config.characterName, "岚", "characterName"),
		persona: requiredText(config.persona, DEFAULT_PERSONA, "persona"),
		scenario: requiredText(config.scenario, DEFAULT_SCENARIO, "scenario"),
		relationship: requiredText(config.relationship, DEFAULT_RELATIONSHIP, "relationship")
	};
}
/** Supported reasons for retaining information across turns. */
const AGENT_RP_MEMORY_KINDS = [
	"fact",
	"promise",
	"relationship",
	"preference",
	"event"
];
const SUBJECT_MAX_LENGTH = 120;
const TEXT_MAX_LENGTH = 1e3;
const MEMORY_ID_PATTERN = /^memory-(?:(?:0|[1-9]\d*)|seed-(?:0|[1-9]\d*)-(?:0|[1-9]\d*))$/u;
const COMMAND_RESULT_PREFIX = "agent-rp-memory-v0:";
/** Brand a validated memory id at the Session boundary. */
function AgentRpMemoryId(value) {
	if (!MEMORY_ID_PATTERN.test(value)) throw new Error(`invalid Agent RP memory id ${JSON.stringify(value)}`);
	return value;
}
function normalizeText(value, field, maximum) {
	const normalized = value.trim();
	if (normalized.length === 0) throw new Error(`Agent RP memory ${field} must contain non-whitespace text`);
	if (normalized.length > maximum) throw new Error(`Agent RP memory ${field} exceeds ${maximum} characters`);
	return normalized;
}
function memorySubjectKey(value) {
	return value.trim().toLocaleLowerCase();
}
/** Find another active record that already owns one stable topic. */
function findAgentRpMemorySubjectConflict(active, subject, replacing) {
	const key = memorySubjectKey(subject);
	return active.find((record) => record.id !== replacing && memorySubjectKey(record.subject) === key);
}
function object$15(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}不是对象`);
	return value;
}
function memoryCommandRequest(value) {
	const record = object$15(value, "记忆操作请求");
	if (record.format !== 0) throw new Error("记忆操作请求字段无效");
	if (record.operation === "add") {
		if (typeof record.kind !== "string" || !AGENT_RP_MEMORY_KINDS.includes(record.kind) || typeof record.subject !== "string" || typeof record.text !== "string" || Object.keys(record).some((key) => ![
			"format",
			"operation",
			"kind",
			"subject",
			"text"
		].includes(key))) throw new Error("记忆操作请求字段无效");
		return {
			format: 0,
			operation: "add",
			kind: record.kind,
			subject: normalizeText(record.subject, "subject", SUBJECT_MAX_LENGTH),
			text: normalizeText(record.text, "text", TEXT_MAX_LENGTH)
		};
	}
	if (typeof record.id !== "string") throw new Error("记忆操作请求字段无效");
	const id = AgentRpMemoryId(record.id);
	if (record.operation === "forget") {
		if (Object.keys(record).some((key) => ![
			"format",
			"operation",
			"id"
		].includes(key))) throw new Error("记忆操作请求字段无效");
		return {
			format: 0,
			operation: "forget",
			id
		};
	}
	if (record.operation !== "correct" || typeof record.kind !== "string" || !AGENT_RP_MEMORY_KINDS.includes(record.kind) || typeof record.subject !== "string" || typeof record.text !== "string" || Object.keys(record).some((key) => ![
		"format",
		"operation",
		"id",
		"kind",
		"subject",
		"text"
	].includes(key))) throw new Error("记忆操作请求字段无效");
	return {
		format: 0,
		operation: "correct",
		id,
		kind: record.kind,
		subject: normalizeText(record.subject, "subject", SUBJECT_MAX_LENGTH),
		text: normalizeText(record.text, "text", TEXT_MAX_LENGTH)
	};
}
function memoryCommandMatches(request, command) {
	if (request.operation !== command.operation) return false;
	switch (request.operation) {
		case "add": return command.operation === "add" && request.kind === command.kind && request.subject === command.subject && request.text === command.text;
		case "correct": return command.operation === "correct" && request.id === command.id && request.kind === command.kind && request.subject === command.subject && request.text === command.text;
		case "forget": return command.operation === "forget" && request.id === command.id;
	}
}
/** Validate one private user memory request. */
function parseAgentRpMemoryCommandRequest(source) {
	try {
		return memoryCommandRequest(JSON.parse(source));
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("记忆操作请求不是有效 JSON", { cause: error });
		throw error;
	}
}
/** Serialize one user memory operation into the Session command log. */
function encodeAgentRpMemoryCommandRecord(record) {
	return `${COMMAND_RESULT_PREFIX}${JSON.stringify(record)}`;
}
/** Decode one user memory operation while declining unrelated command output. */
function decodeAgentRpMemoryCommandRecord(source) {
	if (source?.startsWith(COMMAND_RESULT_PREFIX) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(19));
	} catch (error) {
		throw new Error("记忆操作结果不是有效 JSON", { cause: error });
	}
	const record = object$15(value, "记忆操作结果");
	if (typeof record.sourceEventSeq !== "number" || !Number.isSafeInteger(record.sourceEventSeq) || record.sourceEventSeq < 0) throw new Error("记忆操作结果来源无效");
	return {
		...memoryCommandRequest(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "sourceEventSeq"))),
		sourceEventSeq: record.sourceEventSeq
	};
}
function sourceCall(events, record) {
	if (!Number.isSafeInteger(record.sourceEventSeq) || record.sourceEventSeq < 0) throw new Error("Agent RP memory sourceEventSeq must be a non-negative safe integer");
	const source = events[record.sourceEventSeq];
	if (source?.type !== "tool/call" || source.seq !== record.sourceEventSeq || source.data.name !== "remember") throw new Error(`Agent RP memory ${record.id} does not reference its direct remember tool call`);
	return source;
}
function sourceArguments(call) {
	let parsed;
	try {
		parsed = JSON.parse(call.data.arguments);
	} catch {
		throw new Error(`Agent RP memory source call at seq ${call.seq} has invalid JSON arguments`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`Agent RP memory source call at seq ${call.seq} has invalid arguments`);
	const input = parsed;
	if (typeof input.kind !== "string" || !AGENT_RP_MEMORY_KINDS.includes(input.kind) || typeof input.subject !== "string" || typeof input.text !== "string" || input.supersedes !== void 0 && typeof input.supersedes !== "string") throw new Error(`Agent RP memory source call at seq ${call.seq} has invalid arguments`);
	return {
		kind: input.kind,
		subject: input.subject,
		text: input.text,
		...input.supersedes === void 0 ? {} : { supersedes: input.supersedes }
	};
}
function canonicalRecord(value, call) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`remember result for call ${call.data.callId} has invalid canonical value`);
	const record = value;
	if (record.version !== 0 || typeof record.id !== "string" || typeof record.kind !== "string" || !AGENT_RP_MEMORY_KINDS.includes(record.kind) || typeof record.subject !== "string" || typeof record.text !== "string" || !Number.isSafeInteger(record.sourceEventSeq) || record.supersedes !== void 0 && typeof record.supersedes !== "string") throw new Error(`remember result for call ${call.data.callId} has invalid canonical value`);
	return {
		version: 0,
		id: AgentRpMemoryId(record.id),
		kind: record.kind,
		subject: record.subject,
		text: record.text,
		sourceEventSeq: record.sourceEventSeq,
		...record.supersedes === void 0 ? {} : { supersedes: AgentRpMemoryId(record.supersedes) }
	};
}
function parseCanonicalResult(result, call) {
	const block = result.data.message.content[0];
	if (String(block.toolCallId) !== String(call.data.callId) || String(result.data.message.source.callId) !== String(call.data.callId)) throw new Error(`remember result for call ${call.data.callId} has inconsistent call identity`);
	if (result.sourceEventSeqs?.length !== 1 || result.sourceEventSeqs[0] !== call.seq) throw new Error(`remember result for call ${call.data.callId} does not cite its direct tool call`);
	if (block.content.length !== 1 || block.content[0]?.type !== "text") throw new Error(`remember result for call ${call.data.callId} has invalid canonical content`);
	try {
		return JSON.parse(block.content[0].text);
	} catch {
		throw new Error(`remember result for call ${call.data.callId} has invalid canonical JSON`);
	}
}
function successfulRememberResults(events) {
	const rememberCallIds = new Set(events.flatMap((event) => event.type === "tool/call" && event.data.name === "remember" ? [String(event.data.callId)] : []));
	const results = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (event.type !== "tool/result") continue;
		const block = event.data.message.content[0];
		if (block.isError === true || event.data.error !== void 0) continue;
		const callId = String(block.toolCallId);
		if (!rememberCallIds.has(callId)) continue;
		if (results.has(callId)) throw new Error(`tool call ${callId} has multiple successful results`);
		results.set(callId, event);
	}
	return results;
}
function validateRecord(events, call, result, active) {
	const record = canonicalRecord(parseCanonicalResult(result, call), call);
	const id = record.id;
	sourceCall(events, record);
	const input = sourceArguments(call);
	if (record.sourceEventSeq !== call.seq || call.seq >= result.seq || id !== `memory-${call.seq}`) throw new Error(`Agent RP memory ${record.id} has invalid source ordering or identity`);
	normalizeText(record.subject, "subject", SUBJECT_MAX_LENGTH);
	normalizeText(record.text, "text", TEXT_MAX_LENGTH);
	if (record.subject !== record.subject.trim() || record.text !== record.text.trim()) throw new Error(`Agent RP memory ${record.id} text is not normalized`);
	if (record.kind !== input.kind || record.subject !== input.subject.trim() || record.text !== input.text.trim() || record.supersedes !== input.supersedes) throw new Error(`Agent RP memory ${record.id} does not match its source call arguments`);
	if (record.supersedes !== void 0) {
		const superseded = AgentRpMemoryId(record.supersedes);
		if (!active.delete(superseded)) throw new Error(`Agent RP memory ${record.id} supersedes a missing or inactive record`);
	}
	active.set(id, record);
	return record;
}
function applyCommandRecord(events, done, command, active) {
	const source = events[command.sourceEventSeq];
	if (source?.type !== "command/run" || source.seq !== command.sourceEventSeq || source.data.name !== "rp-memory" || String(source.data.commandId) !== String(done.data.commandId)) throw new Error("记忆操作结果没有对应的命令来源");
	if (!memoryCommandMatches(parseAgentRpMemoryCommandRequest(source.data.args ?? ""), command)) throw new Error("记忆操作结果与请求不一致");
	if (command.operation === "add") {
		if (findAgentRpMemorySubjectConflict([...active.values()], command.subject) !== void 0) throw new Error(`记忆操作新增了重复主题 ${JSON.stringify(command.subject)}`);
		const added = {
			version: 0,
			id: AgentRpMemoryId(`memory-${command.sourceEventSeq}`),
			kind: command.kind,
			subject: command.subject,
			text: command.text,
			sourceEventSeq: command.sourceEventSeq
		};
		if (active.has(added.id)) throw new Error(`重复的 Agent RP 记忆编号 ${added.id}`);
		active.set(added.id, added);
		return added;
	}
	if (!active.has(command.id)) throw new Error(`记忆操作引用了不存在或已失效的记录 ${JSON.stringify(command.id)}`);
	active.delete(command.id);
	if (command.operation === "forget") return void 0;
	const replacement = {
		version: 0,
		id: AgentRpMemoryId(`memory-${command.sourceEventSeq}`),
		kind: command.kind,
		subject: command.subject,
		text: command.text,
		sourceEventSeq: command.sourceEventSeq,
		supersedes: command.id
	};
	if (active.has(replacement.id)) throw new Error(`重复的 Agent RP 记忆编号 ${replacement.id}`);
	active.set(replacement.id, replacement);
	return replacement;
}
function applySeedRecord(event, active) {
	if (event.data.format !== 0 || event.data.sourceSessionId.trim() === "" || event.data.sourceSessionId.length > 512 || !Array.isArray(event.data.memories) || event.data.memories.length > 1e3) throw new Error("Agent RP 继承记忆事件无效");
	return event.data.memories.map((entry, index) => {
		if (typeof entry !== "object" || entry === null || !AGENT_RP_MEMORY_KINDS.includes(entry.kind) || typeof entry.subject !== "string" || typeof entry.text !== "string") throw new Error("Agent RP 继承记忆内容无效");
		const subject = normalizeText(entry.subject, "subject", SUBJECT_MAX_LENGTH);
		const text = normalizeText(entry.text, "text", TEXT_MAX_LENGTH);
		if (subject !== entry.subject || text !== entry.text) throw new Error("Agent RP 继承记忆内容未规范化");
		const record = {
			version: 0,
			id: AgentRpMemoryId(`memory-seed-${event.seq}-${index}`),
			kind: entry.kind,
			subject,
			text,
			sourceEventSeq: event.seq
		};
		if (active.has(record.id)) throw new Error(`重复的 Agent RP 记忆编号 ${record.id}`);
		active.set(record.id, record);
		return record;
	});
}
/**
* Replay and validate all Agent RP memory records in one Session log.
* @param events - complete chronological Session history.
* @returns immutable chronological and currently active record lists.
*/
function readAgentRpMemoryHistory(events) {
	const all = [];
	const active = /* @__PURE__ */ new Map();
	const results = successfulRememberResults(events);
	for (const event of events) {
		if (event.type === "agent-rp/memory-seed") {
			all.push(...applySeedRecord(event, active));
			continue;
		}
		if (event.type === "tool/call" && event.data.name === "remember") {
			const result = results.get(String(event.data.callId));
			if (result !== void 0) all.push(validateRecord(events, event, result, active));
			continue;
		}
		if (event.type !== "command/done" || event.data.kind !== "success") continue;
		const command = decodeAgentRpMemoryCommandRecord(event.data.text);
		if (command === void 0) continue;
		const replacement = applyCommandRecord(events, event, command, active);
		if (replacement !== void 0) all.push(replacement);
	}
	return {
		all: Object.freeze(all),
		active: Object.freeze([...active.values()])
	};
}
/** Append an opt-in active-memory snapshot to an otherwise complete new-Session seed. */
function appendAgentRpMemorySeed(seed, memories, sourceSessionId) {
	if (memories.length === 0) return seed;
	if (sourceSessionId.trim() === "" || sourceSessionId.length > 512) throw new Error("来源角色会话编号无效");
	const time = Math.max(Date.now(), (seed.at(-1)?.time ?? 0) + 1);
	const events = [...seed, {
		type: "agent-rp/memory-seed",
		seq: seed.length,
		time,
		data: {
			format: 0,
			sourceSessionId,
			memories: memories.map((memory) => ({
				kind: memory.kind,
				subject: memory.subject,
				text: memory.text
			}))
		},
		ignorable: true
	}];
	return Object.freeze(Session.create(SessionId("agent-rp-memory-seed-validation"), events).events.slice(0, events.length));
}
function findRememberCall(session, callId) {
	const call = session.events.findLast((event) => event.type === "tool/call" && event.data.callId === callId);
	if (call?.type !== "tool/call" || call.data.name !== "remember") throw new Error("remember execution has no matching direct Session tool call");
	return call;
}
/**
* Prepare one normalized result for the current direct `remember` tool call.
* @param session - Session that owns both source call and durable memory.
* @param callId - execution call id recorded by the Agent loop.
* @param input - model-selected memory content and optional correction target.
* @returns the canonical record that the Agent loop persists as the tool result.
*/
function prepareAgentRpMemory(session, callId, input) {
	const history = readAgentRpMemoryHistory(session.events);
	const call = findRememberCall(session, callId);
	const sourceInput = sourceArguments(call);
	if (sourceInput.kind !== input.kind || sourceInput.subject !== input.subject || sourceInput.text !== input.text || sourceInput.supersedes !== input.supersedes) throw new Error("remember execution arguments do not match its Session tool call");
	const supersedes = input.supersedes === void 0 ? void 0 : AgentRpMemoryId(input.supersedes);
	if (supersedes !== void 0 && !history.active.some((record) => record.id === supersedes)) throw new Error(`cannot supersede missing or inactive Agent RP memory ${JSON.stringify(supersedes)}`);
	const subject = normalizeText(input.subject, "subject", SUBJECT_MAX_LENGTH);
	const text = normalizeText(input.text, "text", TEXT_MAX_LENGTH);
	const conflict = findAgentRpMemorySubjectConflict(history.active, subject, supersedes);
	if (conflict !== void 0) throw new Error(`memory subject ${JSON.stringify(subject)} is already active as ${conflict.id}; use supersedes to update it`);
	return {
		version: 0,
		id: AgentRpMemoryId(`memory-${call.seq}`),
		kind: input.kind,
		subject,
		text,
		sourceEventSeq: call.seq,
		...supersedes === void 0 ? {} : { supersedes }
	};
}
/** Apply one private memory-manager request without invoking the character model. */
function executeAgentRpMemoryCommand(invocation) {
	const request = parseAgentRpMemoryCommandRequest(invocation.rawInput);
	const source = invocation.agent.session.events.at(-1);
	if (source?.type !== "command/run" || source.data.name !== "rp-memory" || String(source.data.commandId) !== String(invocation.commandId)) throw new Error("记忆操作命令不是当前 Session 事件");
	const history = readAgentRpMemoryHistory(invocation.agent.session.events);
	if (request.operation === "add") {
		if (findAgentRpMemorySubjectConflict(history.active, request.subject) !== void 0) throw new Error(`“${request.subject}”已经有一条有效记忆，请直接纠正原记录`);
	} else {
		if (!history.active.some((record) => record.id === request.id)) throw new Error("这条记忆已经被纠正或忘记，请刷新后再试");
		if (request.operation === "correct") {
			if (findAgentRpMemorySubjectConflict(history.active, request.subject, request.id) !== void 0) throw new Error(`“${request.subject}”已经是另一条有效记忆的主题，请先整理其中一条`);
		}
	}
	return {
		kind: "success",
		text: encodeAgentRpMemoryCommandRecord({
			...request,
			sourceEventSeq: source.seq
		})
	};
}
/** Same-origin endpoint exposing only the currently active memory snapshot. */
const AGENT_RP_MEMORY_PATH = "/api/agent-rp/memory";
function trustedBrowserRequest$11(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$11(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
/** Register a local-only active-memory inspector for Agent RP Sessions. */
function installAgentRpMemoryHttp(routeCtx, hostCtx, server) {
	routeCtx.effect(() => server.register({
		kind: "exact",
		path: AGENT_RP_MEMORY_PATH,
		handler(request, response) {
			if (!trustedBrowserRequest$11(request)) {
				json$11(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method !== "GET") {
				response.setHeader("allow", "GET");
				json$11(response, 405, { error: "method not allowed" });
				return;
			}
			try {
				const sourceSessionId = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("sessionId")?.trim();
				if (sourceSessionId === void 0 || sourceSessionId === "" || sourceSessionId.length > 512) throw new Error("角色会话编号无效");
				const agent = hostCtx.get("agents")?.get(SessionId(sourceSessionId));
				if (agent === void 0 || agent.session.header.agentPreset !== "agent-rp") throw new Error("角色会话当前不可用");
				json$11(response, 200, {
					format: 0,
					memories: readAgentRpMemoryHistory(agent.session.events).active.map((memory) => ({
						id: memory.id,
						kind: memory.kind,
						subject: memory.subject,
						text: memory.text,
						source: agent.session.events[memory.sourceEventSeq]?.type === "command/run" ? "user" : agent.session.events[memory.sourceEventSeq]?.type === "agent-rp/memory-seed" ? "inherited" : "character"
					}))
				});
			} catch (error) {
				json$11(response, 400, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "agent-rp: memory HTTP");
}
function object$14(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}
function requiredString$1(value, path) {
	if (typeof value !== "string") throw new Error(`${path} must be a string`);
	return value;
}
function optionalBoolean$2(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
	return value;
}
function optionalFiniteNumber$2(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
	return value;
}
function optionalSubstituteRegex(value, path) {
	if (value === void 0) return void 0;
	const normalized = typeof value === "number" ? value : typeof value === "string" || typeof value === "boolean" || value === null ? Number(value) : NaN;
	if (!Number.isFinite(normalized)) throw new Error(`${path} must be a finite numeric value`);
	return normalized;
}
function stringArray$4(value, path) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} must be an array of strings`);
	return [...value];
}
function numberArray(value, path) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error(`${path} must be an array of finite numbers`);
	return [...value];
}
function nullableFiniteNumber(value, path) {
	if (value === void 0 || value === null) return null;
	return optionalFiniteNumber$2(value, path) ?? null;
}
/** Parse one imported extension regex without executing it. */
function parseRegexScript(value, path) {
	const script = object$14(value, path);
	return {
		...typeof script.id === "string" && script.id.trim() !== "" ? { id: script.id } : {},
		scriptName: requiredString$1(script.scriptName, `${path}.scriptName`),
		findRegex: requiredString$1(script.findRegex, `${path}.findRegex`),
		replaceString: requiredString$1(script.replaceString, `${path}.replaceString`),
		trimStrings: stringArray$4(script.trimStrings, `${path}.trimStrings`),
		placement: numberArray(script.placement, `${path}.placement`),
		disabled: optionalBoolean$2(script.disabled, `${path}.disabled`) ?? false,
		markdownOnly: optionalBoolean$2(script.markdownOnly, `${path}.markdownOnly`) ?? false,
		promptOnly: optionalBoolean$2(script.promptOnly, `${path}.promptOnly`) ?? false,
		runOnEdit: optionalBoolean$2(script.runOnEdit, `${path}.runOnEdit`) ?? false,
		substituteRegex: optionalSubstituteRegex(script.substituteRegex, `${path}.substituteRegex`) ?? 0,
		minDepth: nullableFiniteNumber(script.minDepth, `${path}.minDepth`),
		maxDepth: nullableFiniteNumber(script.maxDepth, `${path}.maxDepth`)
	};
}
function object$13(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}
/** Normalize Tavern Helper's object and JSON-serialized entry-list formats. */
function tavernHelperExtension(value, path) {
	if (!Array.isArray(value)) {
		const normalized = object$13(value, path);
		return {
			value: normalized,
			format: "object",
			ignoredFieldCount: Object.keys(normalized).filter((key) => key !== "scripts" && key !== "variables").length
		};
	}
	const result = {};
	let ignoredFieldCount = 0;
	for (const [index, entry] of value.entries()) {
		if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new Error(`${path}[${index}] must be a [key, value] entry`);
		if (entry[0] === "scripts" || entry[0] === "variables") result[entry[0]] = entry[1];
		else ignoredFieldCount += 1;
	}
	return {
		value: result,
		format: "entries",
		ignoredFieldCount
	};
}
/** Preserve one JSON object used as a Tavern Helper variable namespace. */
function tavernHelperVariables(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
/** Flatten one Tavern Helper script tree while applying folder enablement. */
function parseTavernHelperScripts(values, path, parentEnabled = true) {
	return values.flatMap((value, index) => {
		const itemPath = `${path}[${index}]`;
		const item = object$13(value, itemPath);
		const enabled = parentEnabled && item.enabled !== false;
		if (item.type === "folder" || Array.isArray(item.scripts)) {
			if (!Array.isArray(item.scripts)) return [];
			return parseTavernHelperScripts(item.scripts, `${itemPath}.scripts`, enabled);
		}
		const content = typeof item.content === "string" ? item.content : "";
		const name = typeof item.name === "string" ? item.name : "";
		const id = typeof item.id === "string" && item.id !== "" ? item.id : `${itemPath}:${name}`;
		const button = tavernHelperVariables(item.button);
		const buttons = Array.isArray(button.buttons) ? button.buttons.flatMap((entry) => {
			const parsed = tavernHelperVariables(entry);
			return typeof parsed.name === "string" ? [{
				name: parsed.name,
				visible: parsed.visible !== false
			}] : [];
		}) : [];
		return [{
			id,
			name,
			content,
			info: typeof item.info === "string" ? item.info : "",
			enabled,
			buttonEnabled: button.enabled !== false,
			buttons,
			data: tavernHelperVariables(item.data)
		}];
	});
}
/** Character Card V1/V2/V3 JSON parser with lossless raw preservation. */
/** Maximum decoded card definition accepted independently from transport media. */
const MAX_CHARACTER_CARD_JSON_BYTES = 8 * 1024 * 1024;
/** Maximum complete PNG, JSON, or CHARX transport accepted by the local library. */
const MAX_CHARACTER_CARD_FILE_BYTES = 64 * 1024 * 1024;
function characterCardSizeError() {
	return /* @__PURE__ */ new Error(`角色卡定义内容过大（最多 ${MAX_CHARACTER_CARD_JSON_BYTES / (1024 * 1024)} MiB；PNG/CHARX 图片不计入）`);
}
/** Reject an oversized decoded card definition before UTF-8 or JSON allocation. */
function assertCharacterCardJsonSize(bytes) {
	if (bytes > 8388608) throw characterCardSizeError();
}
function jsonStringBytes(value) {
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
		else if (code < 32) bytes += 6;
		else if (code < 128) bytes += 1;
		else if (code < 2048) bytes += 2;
		else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) {
			bytes += 4;
			index += 1;
		} else if (code >= 55296 && code <= 57343) bytes += 6;
		else bytes += 3;
		if (bytes > 8388608) throw characterCardSizeError();
	}
	return bytes;
}
function assertCharacterCardValueSize(value) {
	let bytes = 0;
	const add = (amount) => {
		bytes += amount;
		if (bytes > 8388608) throw characterCardSizeError();
	};
	const visit = (item) => {
		if (item === null) return add(4);
		if (typeof item === "string") return add(jsonStringBytes(item));
		if (typeof item === "number") return add(Buffer.byteLength(JSON.stringify(item) ?? "null", "utf8"));
		if (typeof item === "boolean") return add(item ? 4 : 5);
		if (Array.isArray(item)) {
			add(2 + Math.max(0, item.length - 1));
			for (const child of item) visit(child);
			return;
		}
		const entries = Object.entries(item);
		add(2 + Math.max(0, entries.length - 1));
		for (const [key, child] of entries) {
			add(jsonStringBytes(key) + 1);
			visit(child);
		}
	};
	visit(value);
}
/** Decode one standalone Character Card JSON file without replacement characters. */
function parseCharacterCardJsonBytes(data) {
	assertCharacterCardJsonSize(data.byteLength);
	let json;
	try {
		json = new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/u, "");
	} catch (error) {
		throw new Error("Character Card JSON must be valid UTF-8", { cause: error });
	}
	return parseCharacterCardJson(json);
}
function object$12(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}
function optionalObject$2(value, path) {
	if (value === void 0) return void 0;
	return object$12(value, path);
}
function requiredString(value, path) {
	if (typeof value !== "string") throw new Error(`${path} must be a string`);
	return value;
}
function optionalString$2(value, path) {
	if (value === void 0) return void 0;
	return requiredString(value, path);
}
function optionalBoolean$1(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
	return value;
}
function optionalFiniteNumber$1(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
	return value;
}
function stringArray$3(value, path, fallback = []) {
	if (value === void 0) return [...fallback];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} must be an array of strings`);
	return [...value];
}
function parseFrontend(data) {
	const extensions = optionalObject$2(data.extensions, "data.extensions");
	const rawRegex = extensions?.regex_scripts;
	const regexScripts = rawRegex === void 0 ? [] : (() => {
		if (!Array.isArray(rawRegex)) throw new Error("data.extensions.regex_scripts must be an array");
		return rawRegex.map((value, index) => parseRegexScript(value, `data.extensions.regex_scripts[${index}]`));
	})();
	const helper = extensions?.tavern_helper;
	const parsedHelper = helper === void 0 ? void 0 : tavernHelperExtension(helper, "data.extensions.tavern_helper");
	const helperScripts = parsedHelper === void 0 ? [] : (() => {
		if (parsedHelper.value.scripts === void 0) return [];
		if (!Array.isArray(parsedHelper.value.scripts)) throw new Error("data.extensions.tavern_helper.scripts must be an array");
		return parseTavernHelperScripts(parsedHelper.value.scripts, "data.extensions.tavern_helper.scripts");
	})();
	const helperVariables = tavernHelperVariables(parsedHelper?.value.variables);
	return {
		regexScripts,
		tavernHelperScriptNames: helperScripts.filter((script) => script.enabled).map((script) => script.name),
		tavernHelperScripts: helperScripts,
		tavernHelperVariables: helperVariables,
		...parsedHelper === void 0 ? {} : { tavernHelper: {
			format: parsedHelper.format,
			scriptCount: helperScripts.length,
			enabledScriptCount: helperScripts.filter((script) => script.enabled).length,
			variableCount: Object.keys(helperVariables).length,
			ignoredFieldCount: parsedHelper.ignoredFieldCount
		} }
	};
}
function parseAssets(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) throw new Error("data.assets must be an array");
	return value.map((item, index) => {
		const asset = object$12(item, `data.assets[${index}]`);
		return {
			type: requiredString(asset.type, `data.assets[${index}].type`),
			uri: requiredString(asset.uri, `data.assets[${index}].uri`),
			name: requiredString(asset.name, `data.assets[${index}].name`),
			ext: requiredString(asset.ext, `data.assets[${index}].ext`)
		};
	});
}
function hasDecorator$1(content) {
	return /(?:^|\n)@@@?[a-z_]+(?:\s|$)/imu.test(content);
}
function parseLorebookEntry(value, index, version) {
	const path = `data.character_book.entries[${index}]`;
	const entry = object$12(value, path);
	const extensions = object$12(entry.extensions, `${path}.extensions`);
	const insertionOrder = optionalFiniteNumber$1(entry.insertion_order, `${path}.insertion_order`);
	if (insertionOrder === void 0) throw new Error(`${path}.insertion_order must be a finite number`);
	const enabled = optionalBoolean$1(entry.enabled, `${path}.enabled`);
	if (enabled === void 0) throw new Error(`${path}.enabled must be a boolean`);
	const priority = optionalFiniteNumber$1(entry.priority, `${path}.priority`);
	const useRegex = optionalBoolean$1(entry.use_regex, `${path}.use_regex`) ?? false;
	if (version === 3 && entry.use_regex === void 0) throw new Error(`${path}.use_regex must be a boolean`);
	const position = optionalString$2(entry.position, `${path}.position`) ?? "after_char";
	if (position !== "before_char" && position !== "after_char") throw new Error(`${path}.position must be before_char or after_char`);
	const content = requiredString(entry.content, `${path}.content`);
	const sourceIdValue = entry.id;
	if (sourceIdValue !== void 0 && sourceIdValue !== null && typeof sourceIdValue !== "string" && typeof sourceIdValue !== "number") throw new Error(`${path}.id must be a string or number`);
	const name = optionalString$2(entry.name, `${path}.name`);
	const comment = optionalString$2(entry.comment, `${path}.comment`);
	return {
		sourceId: sourceIdValue === void 0 || sourceIdValue === null ? String(index) : String(sourceIdValue),
		...name === void 0 ? {} : { name },
		...comment === void 0 ? {} : { comment },
		keys: stringArray$3(entry.keys, `${path}.keys`),
		secondaryKeys: stringArray$3(entry.secondary_keys, `${path}.secondary_keys`),
		content,
		enabled,
		insertionOrder,
		selective: optionalBoolean$1(entry.selective, `${path}.selective`) ?? false,
		constant: optionalBoolean$1(entry.constant, `${path}.constant`) ?? false,
		caseSensitive: optionalBoolean$1(entry.case_sensitive, `${path}.case_sensitive`) ?? false,
		matchWholeWords: optionalBoolean$1(entry.match_whole_words, `${path}.match_whole_words`) ?? false,
		secondaryLogic: "and-any",
		position,
		...priority === void 0 ? {} : { priority },
		useRegex,
		hasDecorators: hasDecorator$1(content),
		ignoreBudget: optionalBoolean$1(extensions.ignore_budget, `${path}.extensions.ignore_budget`) ?? false
	};
}
function parseLorebook(value, version) {
	if (value === void 0) return void 0;
	const book = object$12(value, "data.character_book");
	optionalObject$2(book.extensions, "data.character_book.extensions");
	if (!Array.isArray(book.entries)) throw new Error("data.character_book.entries must be an array");
	const scanDepth = optionalFiniteNumber$1(book.scan_depth, "data.character_book.scan_depth");
	const extensionTokenBudget = optionalFiniteNumber$1(optionalObject$2(book.extensions, "data.character_book.extensions")?.token_budget, "data.character_book.extensions.token_budget");
	const tokenBudget = optionalFiniteNumber$1(book.token_budget, "data.character_book.token_budget") ?? extensionTokenBudget;
	if (scanDepth !== void 0 && scanDepth < 0) throw new Error("data.character_book.scan_depth must not be negative");
	if (tokenBudget !== void 0 && tokenBudget < 0) throw new Error("data.character_book.token_budget must not be negative");
	const name = optionalString$2(book.name, "data.character_book.name");
	return {
		...name === void 0 ? {} : { name },
		...scanDepth === void 0 ? {} : { scanDepth },
		...tokenBudget === void 0 ? {} : { tokenBudget },
		recursiveScanning: optionalBoolean$1(book.recursive_scanning, "data.character_book.recursive_scanning") ?? false,
		entries: book.entries.map((entry, index) => parseLorebookEntry(entry, index, version))
	};
}
function cardVersion(root) {
	if (root.spec === "chara_card_v3") {
		const specVersion = requiredString(root.spec_version, "spec_version");
		const numeric = Number.parseFloat(specVersion);
		if (!Number.isFinite(numeric) || numeric < 3) throw new Error("spec_version must identify Character Card V3");
		return {
			version: 3,
			specVersion,
			data: object$12(root.data, "data")
		};
	}
	if (root.spec === "chara_card_v2") {
		const specVersion = requiredString(root.spec_version, "spec_version");
		if (specVersion !== "2.0") throw new Error("spec_version must be 2.0 for Character Card V2");
		return {
			version: 2,
			specVersion,
			data: object$12(root.data, "data")
		};
	}
	if (root.spec !== void 0) throw new Error(`unsupported character card spec ${JSON.stringify(root.spec)}`);
	return {
		version: 1,
		specVersion: "1.0",
		data: root
	};
}
function validateVersionFields(data, version) {
	if (version === 1) return;
	for (const field of [
		"creator_notes",
		"system_prompt",
		"post_history_instructions",
		"creator",
		"character_version"
	]) requiredString(data[field], `data.${field}`);
	stringArray$3(data.alternate_greetings, "data.alternate_greetings");
	stringArray$3(data.tags, "data.tags");
	object$12(data.extensions, "data.extensions");
	if (version === 3) stringArray$3(data.group_only_greetings, "data.group_only_greetings");
}
function degradationSet(data, version, specVersion, lorebook) {
	const result = /* @__PURE__ */ new Set();
	if (version === 3 && Number.parseFloat(specVersion) > 3) result.add("future-card-version");
	const assets = data.assets;
	if (Array.isArray(assets) && assets.length > 0) {
		result.add("character-assets");
		if (assets.some((asset) => typeof asset === "object" && asset !== null && !Array.isArray(asset) && typeof asset.uri === "string" && /^(?:https?:|data:)/iu.test(asset.uri))) result.add("remote-assets");
	}
	if (stringArray$3(data.group_only_greetings, "data.group_only_greetings").length > 0) result.add("group-greetings");
	if (lorebook?.recursiveScanning === true) result.add("lorebook-recursion");
	if (lorebook?.entries.some((entry) => entry.hasDecorators) === true) result.add("lorebook-decorators");
	return [...result].sort();
}
/**
* Parse one decoded Character Card JSON document.
* @param json - UTF-8 JSON text from a JSON file or PNG metadata.
* @returns a normalized runtime card plus its exact parsed JSON value.
*/
function parseCharacterCardJson(json) {
	assertCharacterCardJsonSize(Buffer.byteLength(json, "utf8"));
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch (error) {
		throw new Error("character card is not valid JSON", { cause: error });
	}
	const raw = snapshotJsonValue(parsed);
	if (raw === void 0) throw new Error("character card must contain lossless JSON");
	return normalizeCharacterCardValue(raw);
}
/**
* Validate one already-decoded JSON value without serializing and parsing it again.
* @param raw - Lossless JSON value from a trusted JSON or durable Session decoder.
* @returns a normalized runtime card retaining the supplied JSON value.
*/
function parseCharacterCardValue(raw) {
	assertCharacterCardValueSize(raw);
	return normalizeCharacterCardValue(raw);
}
function normalizeCharacterCardValue(raw) {
	const { version, specVersion, data } = cardVersion(object$12(raw, "character card"));
	validateVersionFields(data, version);
	const lorebook = parseLorebook(data.character_book, version);
	const nickname = optionalString$2(data.nickname, "data.nickname");
	const alternateGreetings = stringArray$3(data.alternate_greetings, "data.alternate_greetings");
	const systemPrompt = optionalString$2(data.system_prompt, "data.system_prompt") ?? "";
	const postHistoryInstructions = optionalString$2(data.post_history_instructions, "data.post_history_instructions") ?? "";
	const frontend = parseFrontend(data);
	const assets = parseAssets(data.assets);
	return {
		format: 0,
		version,
		specVersion,
		name: requiredString(data.name, "data.name"),
		...nickname === void 0 ? {} : { nickname },
		description: requiredString(data.description, "data.description"),
		personality: requiredString(data.personality, "data.personality"),
		scenario: requiredString(data.scenario, "data.scenario"),
		firstMessage: requiredString(data.first_mes, "data.first_mes"),
		messageExample: requiredString(data.mes_example, "data.mes_example"),
		alternateGreetings,
		systemPrompt,
		postHistoryInstructions,
		assets,
		...lorebook === void 0 ? {} : { lorebook },
		frontend,
		degradations: degradationSet(data, version, specVersion, lorebook),
		raw
	};
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	1,
	1,
	1,
	1,
	2,
	2,
	2,
	2,
	3,
	3,
	3,
	3,
	4,
	4,
	4,
	4,
	5,
	5,
	5,
	5,
	0,
	0,
	0,
	0
]);
var fdeb = new u8([
	0,
	0,
	0,
	0,
	1,
	1,
	2,
	2,
	3,
	3,
	4,
	4,
	5,
	5,
	6,
	6,
	7,
	7,
	8,
	8,
	9,
	9,
	10,
	10,
	11,
	11,
	12,
	12,
	13,
	13,
	0,
	0
]);
var clim = new u8([
	16,
	17,
	18,
	0,
	8,
	7,
	9,
	6,
	10,
	5,
	11,
	4,
	12,
	3,
	13,
	2,
	14,
	1,
	15
]);
var freb = function(eb, start) {
	var b = new u16(31);
	for (var i = 0; i < 31; ++i) b[i] = start += 1 << eb[i - 1];
	var r = new i32(b[30]);
	for (var i = 1; i < 30; ++i) for (var j = b[i]; j < b[i + 1]; ++j) r[j] = j - b[i] << 5 | i;
	return {
		b,
		r
	};
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
_b.r;
var rev = new u16(32768);
for (var i = 0; i < 32768; ++i) {
	var x = (i & 43690) >> 1 | (i & 21845) << 1;
	x = (x & 52428) >> 2 | (x & 13107) << 2;
	x = (x & 61680) >> 4 | (x & 3855) << 4;
	rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var hMap = (function(cd, mb, r) {
	var s = cd.length;
	var i = 0;
	var l = new u16(mb);
	for (; i < s; ++i) if (cd[i]) ++l[cd[i] - 1];
	var le = new u16(mb);
	for (i = 1; i < mb; ++i) le[i] = le[i - 1] + l[i - 1] << 1;
	var co;
	if (r) {
		co = new u16(1 << mb);
		var rvb = 15 - mb;
		for (i = 0; i < s; ++i) if (cd[i]) {
			var sv = i << 4 | cd[i];
			var r_1 = mb - cd[i];
			var v = le[cd[i] - 1]++ << r_1;
			for (var m = v | (1 << r_1) - 1; v <= m; ++v) co[rev[v] >> rvb] = sv;
		}
	} else {
		co = new u16(s);
		for (i = 0; i < s; ++i) if (cd[i]) co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
	}
	return co;
});
var flt = new u8(288);
for (var i = 0; i < 144; ++i) flt[i] = 8;
for (var i = 144; i < 256; ++i) flt[i] = 9;
for (var i = 256; i < 280; ++i) flt[i] = 7;
for (var i = 280; i < 288; ++i) flt[i] = 8;
var fdt = new u8(32);
for (var i = 0; i < 32; ++i) fdt[i] = 5;
var flrm = /*#__PURE__*/ hMap(flt, 9, 1);
var fdrm = /*#__PURE__*/ hMap(fdt, 5, 1);
var max = function(a) {
	var m = a[0];
	for (var i = 1; i < a.length; ++i) if (a[i] > m) m = a[i];
	return m;
};
var bits = function(d, p, m) {
	var o = p / 8 | 0;
	return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
	var o = p / 8 | 0;
	return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
	return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
	if (s == null || s < 0) s = 0;
	if (e == null || e > v.length) e = v.length;
	return new u8(v.subarray(s, e));
};
var ec = [
	"unexpected EOF",
	"invalid block type",
	"invalid length/literal",
	"invalid distance",
	"stream finished",
	"no stream handler",
	,
	"no callback",
	"invalid UTF-8 data",
	"extra field too long",
	"date not in range 1980-2099",
	"filename too long",
	"stream finishing",
	"invalid zip data"
];
var err = function(ind, msg, nt) {
	var e = new Error(msg || ec[ind]);
	e.code = ind;
	if (Error.captureStackTrace) Error.captureStackTrace(e, err);
	if (!nt) throw e;
	return e;
};
var inflt = function(dat, st, buf, dict) {
	var sl = dat.length, dl = dict ? dict.length : 0;
	if (!sl || st.f && !st.l) return buf || new u8(0);
	var noBuf = !buf;
	var resize = noBuf || st.i != 2;
	var noSt = st.i;
	if (noBuf) buf = new u8(sl * 3);
	var cbuf = function(l) {
		var bl = buf.length;
		if (l > bl) {
			var nbuf = new u8(Math.max(bl * 2, l));
			nbuf.set(buf);
			buf = nbuf;
		}
	};
	var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
	var tbts = sl * 8;
	do {
		if (!lm) {
			final = bits(dat, pos, 1);
			var type = bits(dat, pos + 1, 3);
			pos += 3;
			if (!type) {
				var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
				if (t > sl) {
					if (noSt) err(0);
					break;
				}
				if (resize) cbuf(bt + l);
				buf.set(dat.subarray(s, t), bt);
				st.b = bt += l, st.p = pos = t * 8, st.f = final;
				continue;
			} else if (type == 1) lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
			else if (type == 2) {
				var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
				var tl = hLit + bits(dat, pos + 5, 31) + 1;
				pos += 14;
				var ldt = new u8(tl);
				var clt = new u8(19);
				for (var i = 0; i < hcLen; ++i) clt[clim[i]] = bits(dat, pos + i * 3, 7);
				pos += hcLen * 3;
				var clb = max(clt), clbmsk = (1 << clb) - 1;
				var clm = hMap(clt, clb, 1);
				for (var i = 0; i < tl;) {
					var r = clm[bits(dat, pos, clbmsk)];
					pos += r & 15;
					var s = r >> 4;
					if (s < 16) ldt[i++] = s;
					else {
						var c = 0, n = 0;
						if (s == 16) n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
						else if (s == 17) n = 3 + bits(dat, pos, 7), pos += 3;
						else if (s == 18) n = 11 + bits(dat, pos, 127), pos += 7;
						while (n--) ldt[i++] = c;
					}
				}
				var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
				lbt = max(lt);
				dbt = max(dt);
				lm = hMap(lt, lbt, 1);
				dm = hMap(dt, dbt, 1);
			} else err(1);
			if (pos > tbts) {
				if (noSt) err(0);
				break;
			}
		}
		if (resize) cbuf(bt + 131072);
		var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
		var lpos = pos;
		for (;; lpos = pos) {
			var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
			pos += c & 15;
			if (pos > tbts) {
				if (noSt) err(0);
				break;
			}
			if (!c) err(2);
			if (sym < 256) buf[bt++] = sym;
			else if (sym == 256) {
				lpos = pos, lm = null;
				break;
			} else {
				var add = sym - 254;
				if (sym > 264) {
					var i = sym - 257, b = fleb[i];
					add = bits(dat, pos, (1 << b) - 1) + fl[i];
					pos += b;
				}
				var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
				if (!d) err(3);
				pos += d & 15;
				var dt = fd[dsym];
				if (dsym > 3) {
					var b = fdeb[dsym];
					dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
				}
				if (pos > tbts) {
					if (noSt) err(0);
					break;
				}
				if (resize) cbuf(bt + 131072);
				var end = bt + add;
				if (bt < dt) {
					var shift = dl - dt, dend = Math.min(dt, end);
					if (shift + bt < 0) err(3);
					for (; bt < dend; ++bt) buf[bt] = dict[shift + bt];
				}
				for (; bt < end; ++bt) buf[bt] = buf[bt - dt];
			}
		}
		st.l = lm, st.p = lpos, st.b = bt, st.f = final;
		if (lm) final = 1, st.m = lbt, st.d = dm, st.n = dbt;
	} while (!final);
	return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /*#__PURE__*/ new u8(0);
var b2 = function(d, b) {
	return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
	return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
	return b4(d, b) + b4(d, b + 4) * 4294967296;
};
function inflateSync(data, opts) {
	return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /*#__PURE__*/ new TextDecoder();
try {
	td.decode(et, { stream: true });
} catch (e) {}
var dutf8 = function(d) {
	for (var r = "", i = 0;;) {
		var c = d[i++];
		var eb = (c > 127) + (c > 223) + (c > 239);
		if (i + eb > d.length) return {
			s: r,
			r: slc(d, i - 1)
		};
		if (!eb) r += String.fromCharCode(c);
		else if (eb == 3) c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
		else if (eb & 1) r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
		else r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
	}
};
/**
* Converts a Uint8Array to a string
* @param dat The data to decode to string
* @param latin1 Whether or not to interpret the data as Latin-1. This should
*               not need to be true unless encoding to binary string.
* @returns The original UTF-8/Latin-1 string
*/
function strFromU8(dat, latin1) {
	if (latin1) {
		var r = "";
		for (var i = 0; i < dat.length; i += 16384) r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
		return r;
	} else if (td) return td.decode(dat);
	else {
		var _a = dutf8(dat), s = _a.s, r = _a.r;
		if (r.length) err(8);
		return s;
	}
}
var slzh = function(d, b) {
	return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
	var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
	var _a = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a[0], su = _a[1], off = _a[2];
	return [
		b2(d, b + 10),
		sc,
		su,
		fn,
		es + efl + b2(d, b + 32),
		off
	];
};
var z64hs = function(d, b, l, z, sc, su, off) {
	var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
	var nf = nsc + nsu + noff;
	if (z && nf) {
		for (; b + 4 < e; b += 4 + b2(d, b + 2)) if (b2(d, b) == 1) return [
			nsc ? b8(d, b + 4 + 8 * nsu) : sc,
			nsu ? b8(d, b + 4) : su,
			noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
			1
		];
		if (z < 2) err(13);
	}
	return [
		sc,
		su,
		off,
		0
	];
};
/**
* Synchronously decompresses a ZIP archive. Prefer using `unzip` for better
* performance with more than one file.
* @param data The raw compressed ZIP file
* @param opts The ZIP extraction options
* @returns The decompressed files
*/
function unzipSync(data, opts) {
	var files = {};
	var e = data.length - 22;
	for (; b4(data, e) != 101010256; --e) if (!e || data.length - e > 65558) err(13);
	var c = b2(data, e + 8);
	if (!c) return {};
	var o = b4(data, e + 16);
	var z = b4(data, e - 20) == 117853008;
	if (z) {
		var ze = b4(data, e - 12);
		z = b4(data, ze) == 101075792;
		if (z) {
			c = b4(data, ze + 32);
			o = b4(data, ze + 48);
		}
	}
	var fltr = opts && opts.filter;
	for (var i = 0; i < c; ++i) {
		var _a = zh(data, o, z), c_2 = _a[0], sc = _a[1], su = _a[2], fn = _a[3], no = _a[4], off = _a[5], b = slzh(data, off);
		o = no;
		if (!fltr || fltr({
			name: fn,
			size: sc,
			originalSize: su,
			compression: c_2
		})) if (!c_2) files[fn] = slc(data, b, b + sc);
		else if (c_2 == 8) files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
		else err(14, "unknown compression type " + c_2);
	}
	return files;
}
/** Bounded Character Card V3 CHARX archive parsing. */
/** Largest compressed CHARX file accepted by the importer. */
const MAX_CHARX_BYTES = MAX_CHARACTER_CARD_FILE_BYTES;
/** Largest total uncompressed payload accepted from one CHARX archive. */
const MAX_CHARX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
/** Largest entry count accepted from one CHARX archive. */
const MAX_CHARX_ENTRIES = 4096;
const IMAGE_MEDIA_TYPES = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	avif: "image/avif"
};
/** Normalize a case-sensitive CHARX entry path without allowing an archive escape. */
function normalizeCharxPath(value) {
	const normalized = value.replace(/\\/gu, "/");
	if (normalized.startsWith("/") || /^[a-z]:/iu.test(normalized)) throw new Error("CHARX contains an invalid archive path");
	const path = normalized.replace(/\/+$/gu, "");
	if (path === "" || path.includes("\0")) throw new Error("CHARX contains an invalid archive path");
	const segments = path.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error("CHARX contains an unsafe archive path");
	return segments.join("/");
}
function scanArchive(data, requested) {
	const seen = /* @__PURE__ */ new Set();
	const entries = /* @__PURE__ */ new Map();
	const totals = {
		entries: 0,
		bytes: 0
	};
	let extracted;
	try {
		extracted = unzipSync(data, { filter: archiveFilter(seen, entries, totals, requested) });
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("CHARX ")) throw error;
		throw new Error("CHARX is not a supported ZIP archive", { cause: error });
	}
	const selected = /* @__PURE__ */ new Map();
	for (const [sourcePath, bytes] of Object.entries(extracted)) selected.set(normalizeCharxPath(sourcePath), bytes);
	return {
		entries,
		extracted: selected
	};
}
function archiveFilter(seen, entries, totals, requested) {
	return (file) => {
		const path = normalizeCharxPath(file.name);
		totals.entries += 1;
		totals.bytes += file.originalSize;
		if (totals.entries > 4096) throw new Error(`CHARX contains more than ${MAX_CHARX_ENTRIES} entries`);
		if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || totals.bytes > 134217728) throw new Error(`CHARX expands beyond ${MAX_CHARX_UNCOMPRESSED_BYTES} bytes`);
		if (seen.has(path)) throw new Error(`CHARX contains duplicate path ${JSON.stringify(path)}`);
		seen.add(path);
		entries.set(path, {
			path,
			bytes: file.originalSize
		});
		return requested.has(path);
	};
}
/** Parse one non-encrypted CHARX ZIP without inflating unrequested media. */
function parseCharx(data) {
	if (data.byteLength > MAX_CHARX_BYTES) throw new Error(`CHARX exceeds ${MAX_CHARX_BYTES} bytes`);
	const scan = scanArchive(data, /* @__PURE__ */ new Set(["card.json"]));
	const cardBytes = scan.extracted.get("card.json");
	if (cardBytes === void 0) throw new Error("CHARX must contain card.json at the archive root");
	const card = parseCharacterCardJsonBytes(cardBytes);
	if (card.version !== 3) throw new Error("CHARX card.json must contain Character Card V3");
	return {
		card,
		archive: data,
		entries: scan.entries
	};
}
/** Inflate one validated entry while leaving every other archive payload compressed. */
function readCharxEntry(charx, sourcePath) {
	const path = normalizeCharxPath(sourcePath);
	if (!charx.entries.has(path)) return void 0;
	return scanArchive(charx.archive, /* @__PURE__ */ new Set([path])).extracted.get(path);
}
function embeddedPath(uri) {
	const value = uri.trim();
	const prefix = [
		"embeded://",
		"embedded://",
		"__asset:"
	].find((candidate) => value.toLocaleLowerCase().startsWith(candidate));
	return prefix === void 0 ? void 0 : normalizeCharxPath(value.slice(prefix.length));
}
/** Resolve card-declared embedded image assets, declining code and unknown media. */
function charxImageAssets(charx) {
	return (charx.card.assets ?? []).flatMap((asset, index) => {
		const path = embeddedPath(asset.uri);
		const ext = asset.ext.trim().toLocaleLowerCase().replace(/^\./u, "");
		const mediaType = IMAGE_MEDIA_TYPES[ext];
		if (path === void 0 || mediaType === void 0 || !charx.entries.has(path)) return [];
		return [{
			index,
			type: asset.type.trim().toLocaleLowerCase(),
			name: asset.name,
			path,
			mediaType
		}];
	});
}
/** Inflate one card-declared inert image selected from a parsed CHARX manifest. */
function readCharxImageAsset(charx, asset) {
	const data = readCharxEntry(charx, asset.path);
	if (data === void 0) throw new Error(`CHARX image entry ${JSON.stringify(asset.path)} is missing`);
	return data;
}
/** Select the card's primary embedded icon according to Character Card V3 rules. */
function charxAvatar(charx) {
	const icons = charxImageAssets(charx).filter((asset) => asset.type === "icon");
	return icons.find((asset) => asset.name.trim().toLocaleLowerCase() === "main") ?? icons[0];
}
/** One feature preserved from a card but deliberately not executed. */
const CHARACTER_IMPORT_DEGRADATIONS = [
	"character-assets",
	"future-card-version",
	"group-greetings",
	"lorebook-decorators",
	"lorebook-regex",
	"lorebook-recursion",
	"remote-assets"
];
/** One SillyTavern World Info feature retained in raw JSON but not executed. */
const WORLD_INFO_IMPORT_DEGRADATIONS = [
	"entry-advanced-matching",
	"entry-decorators",
	"entry-probability",
	"entry-regex",
	"entry-unsupported-position",
	"lorebook-recursion",
	"timed-effects",
	"vector-matching"
];
/** Browser-safe values for model-free SillyTavern chat migration. */
/** Same-origin upload endpoint served by the Agent RP Host plugin. */
const SILLYTAVERN_CHAT_PATH = "/api/agent-rp/sillytavern-chats";
const SILLYTAVERN_CHAT_RESULT_PREFIX = "agent-rp-sillytavern-chat-v0:";
/** Validate one chat summary recovered from a command result. */
function parseSillyTavernChatCommandRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("聊天迁移结果不是对象");
	const record = value;
	if (record.format !== 0 || typeof record.importId !== "string" || !/^chat-[a-f0-9]{32}$/u.test(record.importId) || typeof record.name !== "string" || record.name.trim() === "" || !/\.jsonl$/iu.test(record.name) || typeof record.messageCount !== "number" || !Number.isSafeInteger(record.messageCount) || record.messageCount < 0 || record.characterName !== void 0 && (typeof record.characterName !== "string" || record.characterName.trim() === "") || record.userName !== void 0 && (typeof record.userName !== "string" || record.userName.trim() === "") || Object.keys(record).some((key) => ![
		"format",
		"importId",
		"name",
		"messageCount",
		"characterName",
		"userName"
	].includes(key))) throw new Error("聊天迁移结果字段无效");
	return {
		format: 0,
		importId: record.importId,
		name: record.name,
		messageCount: record.messageCount,
		...typeof record.characterName === "string" ? { characterName: record.characterName } : {},
		...typeof record.userName === "string" ? { userName: record.userName } : {}
	};
}
/** Decode a chat-only migration result, declining unrelated command output. */
function decodeSillyTavernChatCommandRecord(source) {
	if (source?.startsWith(SILLYTAVERN_CHAT_RESULT_PREFIX) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(29));
	} catch (error) {
		throw new Error("聊天迁移结果不是有效 JSON", { cause: error });
	}
	return parseSillyTavernChatCommandRecord(value);
}
const CHARACTER_LIBRARY_RESULT_PREFIX = "agent-rp-character-library-v0:";
/** Reconstruct the normalized active card from its preserved JSON. */
function cardFromImportMeta(meta) {
	return parseCharacterCardValue(meta.raw);
}
function jsonObject$2(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function parseResult$1(value) {
	const record = jsonObject$2(value, "import_character_card result");
	const validTransport = record.transport === "png" ? record.metadataKeyword === "ccv3" || record.metadataKeyword === "chara" : (record.transport === "json" || record.transport === "charx") && record.metadataKeyword === void 0;
	if (record.version !== 0 || typeof record.name !== "string" || record.cardVersion !== 1 && record.cardVersion !== 2 && record.cardVersion !== 3 || typeof record.sourceEventSeq !== "number" || !Number.isSafeInteger(record.sourceEventSeq) || typeof record.sourceAttachmentId !== "string" || !validTransport || typeof record.greetingIndex !== "number" || !Number.isSafeInteger(record.greetingIndex) || record.greetingIndex < 0 || typeof record.selectedGreeting !== "string" || record.libraryId !== void 0 && (typeof record.libraryId !== "string" || !/^card-[a-f0-9]{32}$/u.test(record.libraryId)) || record.userName !== void 0 && (typeof record.userName !== "string" || record.userName.trim() === "") || !Array.isArray(record.degradations) || record.degradations.some((value) => typeof value !== "string" || !CHARACTER_IMPORT_DEGRADATIONS.includes(value))) throw new Error("import_character_card result has invalid fields");
	return record;
}
function parseCharacterImportMeta(value) {
	const meta = jsonObject$2(value, "import_character_card metadata");
	if (meta.format !== 0) throw new Error("import_character_card metadata has an unsupported format");
	const result = parseResult$1(meta.result);
	if (meta.raw === void 0) throw new Error("import_character_card metadata is missing raw card data");
	return {
		format: 0,
		result,
		raw: meta.raw
	};
}
/** Parse a character-library command result, declining unrelated command output. */
function decodeCharacterLibraryLaunch(source) {
	if (source?.startsWith(CHARACTER_LIBRARY_RESULT_PREFIX) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(30));
	} catch (error) {
		throw new Error("角色库启动结果不是有效 JSON", { cause: error });
	}
	const record = value;
	if (record === null || typeof record !== "object" || Array.isArray(record) || record.format !== 0 || typeof record.libraryId !== "string" || !/^card-[a-f0-9]{32}$/u.test(record.libraryId) || Object.keys(record).some((key) => key !== "format" && key !== "libraryId" && key !== "meta" && key !== "persona" && key !== "chat")) throw new Error("角色库启动结果字段无效");
	const meta = parseCharacterImportMeta(record.meta);
	const persona = record.persona === void 0 ? void 0 : parsePersonaSnapshot(record.persona);
	const chat = record.chat === void 0 ? void 0 : parseSillyTavernChatCommandRecord(record.chat);
	if (meta.result.libraryId !== record.libraryId || meta.result.sourceAttachmentId !== `library:${record.libraryId}` || persona !== void 0 && meta.result.userName !== persona.name) throw new Error("角色库启动结果来源无效");
	return {
		format: 0,
		libraryId: record.libraryId,
		meta,
		...persona === void 0 ? {} : { persona },
		...chat === void 0 ? {} : { chat }
	};
}
function parsePersonaSnapshot(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("角色库 Persona 快照无效");
	const record = value;
	if (typeof record.id !== "string" || !/^persona-[0-9a-f-]+$/u.test(record.id) || typeof record.name !== "string" || record.name.trim() === "" || record.name.trim().length > 120 || typeof record.description !== "string" || record.description.trim().length > 12e3 || Object.keys(record).some((key) => key !== "id" && key !== "name" && key !== "description")) throw new Error("角色库 Persona 快照字段无效");
	return {
		id: record.id,
		name: record.name.trim(),
		description: record.description.trim()
	};
}
/** Recognize one durable PNG reference usable as a Character Card transport. */
function isPngCharacterCardAttachment(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return record.kind === void 0 && record.mediaType === "image/png" && typeof record.attachmentId === "string" && typeof record.bytes === "number" && typeof record.width === "number" && typeof record.height === "number";
}
/** Recognize one durable standalone JSON reference usable as a Character Card transport. */
function isJsonCharacterCardAttachment(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return record.kind === "file" && typeof record.attachmentId === "string" && typeof record.bytes === "number" && typeof record.name === "string" && /\.json$/iu.test(record.name) && (record.mediaType === void 0 || typeof record.mediaType === "string");
}
/** Recognize one durable CHARX reference usable as a Character Card transport. */
function isCharxCharacterCardAttachment(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return record.kind === "file" && typeof record.attachmentId === "string" && typeof record.bytes === "number" && typeof record.name === "string" && /\.charx$/iu.test(record.name) && (record.mediaType === void 0 || typeof record.mediaType === "string");
}
function sourceAttachments$1(events, sourceEventSeq) {
	const source = events[sourceEventSeq];
	if (source?.type !== "user/message" || source.seq !== sourceEventSeq) throw new Error("import_character_card sourceEventSeq does not reference a user message");
	const direct = source.data.content.flatMap((block) => block.type === "image" && isPngCharacterCardAttachment(block.attachment) ? [block.attachment] : []);
	const sourceMeta = source.data.source.kind === "user" ? source.data.source : void 0;
	if (sourceMeta === void 0) throw new Error("import_character_card source attachment metadata is invalid");
	const consumed = (sourceMeta.attachmentConsumer === "dsh-agent-rp" && Array.isArray(sourceMeta.attachments) ? sourceMeta.attachments : []).filter((value) => isPngCharacterCardAttachment(value) || isJsonCharacterCardAttachment(value) || isCharxCharacterCardAttachment(value));
	return [...direct, ...consumed];
}
function validateImport$1(events, resultEvent) {
	const meta = parseCharacterImportMeta(resultEvent.data.meta);
	const result = meta.result;
	const card = parseCharacterCardValue(meta.raw);
	const call = resultEvent.sourceEventSeqs?.length === 1 ? events[resultEvent.sourceEventSeqs[0]] : void 0;
	if (call?.type !== "tool/call" || call.data.name !== "import_character_card" || call.seq >= resultEvent.seq || String(call.data.callId) !== String(resultEvent.data.message.content[0].toolCallId)) throw new Error("import_character_card result does not cite its direct tool call");
	let callArguments;
	try {
		callArguments = JSON.parse(call.data.arguments);
	} catch {
		throw new Error("import_character_card source call has invalid JSON arguments");
	}
	if (typeof callArguments !== "object" || callArguments === null || Array.isArray(callArguments)) throw new Error("import_character_card source call has invalid arguments");
	const args = callArguments;
	if ((args.greetingIndex ?? 0) !== result.greetingIndex) throw new Error("import_character_card greeting does not match its source call");
	if (result.sourceEventSeq >= call.seq) throw new Error("import_character_card source attachment does not precede its tool call");
	const attachmentIndex = args.attachmentIndex ?? 0;
	if (typeof attachmentIndex !== "number" || !Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) throw new Error("import_character_card source call has an invalid attachmentIndex");
	const attachment = sourceAttachments$1(events, result.sourceEventSeq)[attachmentIndex];
	if (attachment === void 0 || String(attachment.attachmentId) !== result.sourceAttachmentId) throw new Error("import_character_card source attachment is absent from its user message");
	if (result.transport === "png" && !isPngCharacterCardAttachment(attachment)) throw new Error("import_character_card PNG transport does not match its source attachment");
	if (result.transport === "json" && !isJsonCharacterCardAttachment(attachment)) throw new Error("import_character_card JSON transport does not match its source attachment");
	if (result.transport === "charx" && !isCharxCharacterCardAttachment(attachment)) throw new Error("import_character_card CHARX transport does not match its source attachment");
	const expectedGreeting = [card.firstMessage, ...card.alternateGreetings][result.greetingIndex];
	if (result.name !== card.name || result.cardVersion !== card.version || result.selectedGreeting !== expectedGreeting || JSON.stringify(result.degradations) !== JSON.stringify(card.degradations)) throw new Error("import_character_card result summary does not match durable card metadata");
	return {
		result,
		meta: {
			...meta,
			raw: card.raw
		}
	};
}
/**
* Find and validate the last successful character import in one Session.
* @param events - complete chronological Session history.
* @returns the active imported character, or undefined before the first import.
*/
function readActiveSessionCharacter(events) {
	let active;
	for (const event of events) {
		if (event.type === "agent-rp/character-card-seed") {
			const meta = parseCharacterImportMeta(event.data.meta);
			const result = meta.result;
			const card = parseCharacterCardValue(meta.raw);
			const expectedGreeting = [card.firstMessage, ...card.alternateGreetings][result.greetingIndex];
			const libraryId = "characterLibraryId" in event.data.source ? event.data.source.characterLibraryId : void 0;
			const attachment = "attachments" in event.data.source ? event.data.source.attachments[0] : void 0;
			const validSource = libraryId === void 0 ? "attachmentConsumer" in event.data.source && attachment !== void 0 && event.data.source.attachmentConsumer === "dsh-agent-rp" && (result.transport === "json" ? isJsonCharacterCardAttachment(attachment) : result.transport === "charx" ? isCharxCharacterCardAttachment(attachment) : isPngCharacterCardAttachment(attachment)) && result.sourceAttachmentId === String(attachment.attachmentId) : /^card-[a-f0-9]{32}$/u.test(libraryId) && result.libraryId === libraryId && result.sourceAttachmentId === `library:${libraryId}`;
			if (event.data.format !== 0 || !validSource || result.sourceEventSeq !== event.seq || result.name !== card.name || result.cardVersion !== card.version || result.selectedGreeting !== expectedGreeting || JSON.stringify(result.degradations) !== JSON.stringify(card.degradations)) throw new Error("agent-rp/character-card-seed has invalid provenance");
			active = {
				result,
				meta: {
					...meta,
					raw: card.raw
				}
			};
			continue;
		}
		if (event.type === "command/done" && event.data.kind === "success") {
			const launch = decodeCharacterLibraryLaunch(event.data.text);
			if (launch !== void 0) {
				const source = events[launch.meta.result.sourceEventSeq];
				if (source?.type !== "command/run" || source.data.name !== "rp-character-library" && source.data.name !== "rp-chat-import" || source.seq >= event.seq || String(source.data.commandId) !== String(event.data.commandId)) throw new Error("角色库启动结果没有对应的命令来源");
				const card = parseCharacterCardValue(launch.meta.raw);
				const expectedGreeting = [card.firstMessage, ...card.alternateGreetings][launch.meta.result.greetingIndex];
				if (launch.meta.result.name !== card.name || launch.meta.result.cardVersion !== card.version || launch.meta.result.selectedGreeting !== expectedGreeting || JSON.stringify(launch.meta.result.degradations) !== JSON.stringify(card.degradations)) throw new Error("角色库启动结果与角色卡不一致");
				active = {
					result: launch.meta.result,
					meta: {
						...launch.meta,
						raw: card.raw
					}
				};
			}
			continue;
		}
		if (event.type !== "tool/result" || event.data.message.content[0].isError === true) continue;
		const callId = String(event.data.message.content[0].toolCallId);
		const call = events.find((candidate) => candidate.type === "tool/call" && String(candidate.data.callId) === callId);
		if (call?.type !== "tool/call" || call.data.name !== "import_character_card") continue;
		active = validateImport$1(events, event);
	}
	return active;
}
/**
* Build the canonical import summary associated with its source attachment.
* @param card - parsed Character Card.
* @param transport - transport and PNG metadata provenance for the selected card.
* @param sourceEventSeq - exact user message carrying the attachment.
* @param attachment - matching durable attachment reference.
* @param greetingIndex - zero-based selected greeting, with zero naming `first_mes`.
* @returns a compact canonical tool result.
*/
function prepareCharacterImportResult(card, transport, sourceEventSeq, attachment, greetingIndex, userName, libraryId) {
	if (!Number.isSafeInteger(greetingIndex) || greetingIndex < 0) throw new Error("greetingIndex must be a non-negative integer");
	const selectedGreeting = [card.firstMessage, ...card.alternateGreetings][greetingIndex];
	if (selectedGreeting === void 0) throw new Error(`greetingIndex ${greetingIndex} is unavailable for this character card`);
	return {
		version: 0,
		name: card.name,
		cardVersion: card.version,
		sourceEventSeq,
		sourceAttachmentId: String(attachment.attachmentId),
		transport: transport.transport,
		...transport.transport === "png" ? { metadataKeyword: transport.metadataKeyword } : {},
		greetingIndex,
		selectedGreeting,
		...userName === void 0 || userName.trim() === "" ? {} : { userName: userName.trim() },
		...libraryId === void 0 ? {} : { libraryId },
		degradations: [...card.degradations],
		raw: card.raw
	};
}
/** Model-free Character Card import into a native roleplay Session. */
/**
* Build a native Session that activates one Character Card and opens with its selected greeting.
* @param card - parsed lossless Character Card.
* @param attachment - Host-stored original card attachment.
* @param greetingIndex - selected first or alternate greeting.
* @param renderedGreeting - selected greeting after stable identity macro substitution.
* @param transport - JSON, PNG, or CHARX provenance.
* @param userName - optional imported user identity for card macros.
* @param persona - optional reusable player Persona snapshotted for this Session.
* @param libraryId - reusable card id used to resolve CHARX media.
* @returns validated immutable Session seed.
*/
function createCharacterCardSessionSeed(card, attachment, greetingIndex, renderedGreeting, transport = { transport: "json" }, userName, persona, libraryId) {
	const { raw, ...result } = prepareCharacterImportResult(card, transport, 0, attachment, greetingIndex, userName, libraryId);
	const meta = {
		format: 0,
		result,
		raw
	};
	const time = Date.now();
	const events = [{
		type: "agent-rp/character-card-seed",
		seq: 0,
		time,
		data: {
			format: 0,
			source: libraryId !== void 0 && String(attachment.attachmentId) === `library:${libraryId}` ? { characterLibraryId: libraryId } : {
				attachmentConsumer: "dsh-agent-rp",
				attachments: [attachment]
			},
			meta
		},
		ignorable: true
	}];
	if (persona !== void 0) events.push({
		type: "agent-rp/persona-seed",
		seq: events.length,
		time,
		data: {
			format: 0,
			persona
		},
		ignorable: true
	});
	if (renderedGreeting.trim() !== "") {
		const push = (event) => {
			events.push({
				...event,
				seq: events.length
			});
		};
		push({
			type: "turn/start",
			time: time + 1,
			data: { turn: 1 }
		});
		push({
			type: "step/start",
			time: time + 1,
			data: {
				turn: 1,
				step: 1
			}
		});
		push({
			type: "assistant/message",
			time: time + 1,
			data: {
				turn: 1,
				step: 1,
				message: createAssistantMessage({
					content: [{
						type: "text",
						text: renderedGreeting
					}],
					source: {
						provider: "agent-rp-import",
						model: "character-card"
					}
				})
			},
			surfaceOp: "append"
		});
		push({
			type: "step/end",
			time: time + 1,
			data: {
				turn: 1,
				step: 1
			}
		});
		push({
			type: "turn/end",
			time: time + 1,
			data: {
				turn: 1,
				reason: { kind: "completed" }
			}
		});
	}
	return Object.freeze(Session.create(SessionId("agent-rp-character-card-import-validation"), events).events.slice(0, events.length));
}
var require_crc32 = /* @__PURE__ */ __commonJSMin(((exports) => {
	(function(factory) {
		if (typeof DO_NOT_EXPORT_CRC === "undefined") if ("object" === typeof exports) factory(exports);
		else if ("function" === typeof define && define.amd) define(function() {
			var module$1 = {};
			factory(module$1);
			return module$1;
		});
		else factory({});
		else factory({});
	})(function(CRC32) {
		CRC32.version = "0.3.0";
		function signed_crc_table() {
			var c = 0, table = new Array(256);
			for (var n = 0; n != 256; ++n) {
				c = n;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				c = c & 1 ? -306674912 ^ c >>> 1 : c >>> 1;
				table[n] = c;
			}
			return typeof Int32Array !== "undefined" ? new Int32Array(table) : table;
		}
		var table = signed_crc_table();
		var use_buffer = typeof Buffer !== "undefined";
		function crc32_bstr(bstr) {
			if (bstr.length > 32768) {
				if (use_buffer) return crc32_buf_8(new Buffer(bstr));
			}
			var crc = -1, L = bstr.length - 1;
			for (var i = 0; i < L;) {
				crc = table[(crc ^ bstr.charCodeAt(i++)) & 255] ^ crc >>> 8;
				crc = table[(crc ^ bstr.charCodeAt(i++)) & 255] ^ crc >>> 8;
			}
			if (i === L) crc = crc >>> 8 ^ table[(crc ^ bstr.charCodeAt(i)) & 255];
			return crc ^ -1;
		}
		function crc32_buf(buf) {
			if (buf.length > 1e4) return crc32_buf_8(buf);
			for (var crc = -1, i = 0, L = buf.length - 3; i < L;) {
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
			}
			while (i < L + 3) crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
			return crc ^ -1;
		}
		function crc32_buf_8(buf) {
			for (var crc = -1, i = 0, L = buf.length - 7; i < L;) {
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
				crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
			}
			while (i < L + 7) crc = crc >>> 8 ^ table[(crc ^ buf[i++]) & 255];
			return crc ^ -1;
		}
		function crc32_str(str) {
			for (var crc = -1, i = 0, L = str.length, c, d; i < L;) {
				c = str.charCodeAt(i++);
				if (c < 128) crc = crc >>> 8 ^ table[(crc ^ c) & 255];
				else if (c < 2048) {
					crc = crc >>> 8 ^ table[(crc ^ (192 | c >> 6 & 31)) & 255];
					crc = crc >>> 8 ^ table[(crc ^ (128 | c & 63)) & 255];
				} else if (c >= 55296 && c < 57344) {
					c = (c & 1023) + 64;
					d = str.charCodeAt(i++) & 1023;
					crc = crc >>> 8 ^ table[(crc ^ (240 | c >> 8 & 7)) & 255];
					crc = crc >>> 8 ^ table[(crc ^ (128 | c >> 2 & 63)) & 255];
					crc = crc >>> 8 ^ table[(crc ^ (128 | d >> 6 & 15 | c & 3)) & 255];
					crc = crc >>> 8 ^ table[(crc ^ (128 | d & 63)) & 255];
				} else {
					crc = crc >>> 8 ^ table[(crc ^ (224 | c >> 12 & 15)) & 255];
					crc = crc >>> 8 ^ table[(crc ^ (128 | c >> 6 & 63)) & 255];
					crc = crc >>> 8 ^ table[(crc ^ (128 | c & 63)) & 255];
				}
			}
			return crc ^ -1;
		}
		CRC32.table = table;
		CRC32.bstr = crc32_bstr;
		CRC32.buf = crc32_buf;
		CRC32.str = crc32_str;
	});
}));
/** Character Card PNG tEXt transport decoder. */
var import_png_chunks_extract = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var crc32 = require_crc32();
	module.exports = extractChunks;
	var uint8 = /* @__PURE__ */ new Uint8Array(4);
	var int32 = new Int32Array(uint8.buffer);
	var uint32 = new Uint32Array(uint8.buffer);
	function extractChunks(data) {
		if (data[0] !== 137) throw new Error("Invalid .png file header");
		if (data[1] !== 80) throw new Error("Invalid .png file header");
		if (data[2] !== 78) throw new Error("Invalid .png file header");
		if (data[3] !== 71) throw new Error("Invalid .png file header");
		if (data[4] !== 13) throw new Error("Invalid .png file header: possibly caused by DOS-Unix line ending conversion?");
		if (data[5] !== 10) throw new Error("Invalid .png file header: possibly caused by DOS-Unix line ending conversion?");
		if (data[6] !== 26) throw new Error("Invalid .png file header");
		if (data[7] !== 10) throw new Error("Invalid .png file header: possibly caused by DOS-Unix line ending conversion?");
		var ended = false;
		var chunks = [];
		var idx = 8;
		while (idx < data.length) {
			uint8[3] = data[idx++];
			uint8[2] = data[idx++];
			uint8[1] = data[idx++];
			uint8[0] = data[idx++];
			var length = uint32[0] + 4;
			var chunk = new Uint8Array(length);
			chunk[0] = data[idx++];
			chunk[1] = data[idx++];
			chunk[2] = data[idx++];
			chunk[3] = data[idx++];
			var name = String.fromCharCode(chunk[0]) + String.fromCharCode(chunk[1]) + String.fromCharCode(chunk[2]) + String.fromCharCode(chunk[3]);
			if (!chunks.length && name !== "IHDR") throw new Error("IHDR header missing");
			if (name === "IEND") {
				ended = true;
				chunks.push({
					name,
					data: /* @__PURE__ */ new Uint8Array(0)
				});
				break;
			}
			for (var i = 4; i < length; i++) chunk[i] = data[idx++];
			uint8[3] = data[idx++];
			uint8[2] = data[idx++];
			uint8[1] = data[idx++];
			uint8[0] = data[idx++];
			var crcActual = int32[0];
			if (crc32.buf(chunk) !== crcActual) throw new Error("CRC values for " + name + " header do not match, PNG file is likely corrupted");
			var chunkData = new Uint8Array(chunk.buffer.slice(4));
			chunks.push({
				name,
				data: chunkData
			});
		}
		if (!ended) throw new Error(".png file ended prematurely: no IEND header was found");
		return chunks;
	}
})))(), 1);
const PNG_SIGNATURE = Buffer$1.from([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
]);
function preflightChunks(data) {
	let offset = PNG_SIGNATURE.byteLength;
	let ended = false;
	while (offset < data.byteLength) {
		if (data.byteLength - offset < 12) throw new Error("character card PNG has a truncated chunk");
		const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
		const end = offset + 12 + length;
		if (!Number.isSafeInteger(end) || end > data.byteLength) throw new Error("character card PNG has an invalid chunk length");
		const name = Buffer$1.from(data.subarray(offset + 4, offset + 8)).toString("ascii");
		offset = end;
		if (name === "IEND") {
			ended = true;
			break;
		}
	}
	if (!ended) throw new Error("character card PNG has no IEND chunk");
}
function decodeBase64(value, keyword) {
	if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new Error(`${keyword} PNG metadata is not canonical base64`);
	const bytes = Buffer$1.from(value, "base64");
	assertCharacterCardJsonSize(bytes.byteLength);
	if (bytes.toString("base64") !== value) throw new Error(`${keyword} PNG metadata is not canonical base64`);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`${keyword} PNG metadata is not valid UTF-8`, { cause: error });
	}
}
function decodeTextChunk(data) {
	const bytes = Buffer$1.from(data.buffer, data.byteOffset, data.byteLength);
	const separator = bytes.indexOf(0);
	if (separator < 0) return {
		keyword: bytes.toString("latin1"),
		text: ""
	};
	if (bytes.indexOf(0, separator + 1) >= 0) throw new Error("Invalid NULL character found. 0x00 character is not permitted in tEXt content");
	return {
		keyword: bytes.subarray(0, separator).toString("latin1"),
		text: bytes.subarray(separator + 1).toString("latin1")
	};
}
/**
* Extract the preferred card payload from one verified PNG attachment.
* @param data - complete PNG bytes read from the attachment store.
* @returns decoded JSON text, preferring `ccv3` over `chara`.
*/
function readCharacterCardPng(data) {
	const bytes = Buffer$1.from(data);
	if (bytes.byteLength < PNG_SIGNATURE.byteLength || !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) throw new Error("character card attachment is not a PNG");
	let chunks;
	try {
		preflightChunks(bytes);
		chunks = (0, import_png_chunks_extract.default)(bytes);
	} catch (error) {
		throw new Error("character card PNG is malformed", { cause: error });
	}
	const payloads = /* @__PURE__ */ new Map();
	for (const chunk of chunks) {
		if (chunk.name !== "tEXt") continue;
		let decoded;
		try {
			decoded = decodeTextChunk(chunk.data);
		} catch (error) {
			throw new Error("character card PNG contains malformed text metadata", { cause: error });
		}
		const keyword = decoded.keyword.toLowerCase();
		if ((keyword === "ccv3" || keyword === "chara") && !payloads.has(keyword)) payloads.set(keyword, decoded.text);
	}
	for (const keyword of ["ccv3", "chara"]) {
		const payload = payloads.get(keyword);
		if (payload !== void 0) return {
			keyword,
			json: decodeBase64(payload, keyword)
		};
	}
	throw new Error("PNG does not contain ccv3 or chara character metadata");
}
/** Standalone SillyTavern World Info JSON parser with inert advanced behavior. */
/** Maximum decoded JSON accepted from one standalone World Info file. */
const MAX_WORLD_INFO_JSON_BYTES = 2 * 1024 * 1024;
function object$11(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}
function optionalString$1(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "string") throw new Error(`${path} must be a string`);
	return value;
}
function boolean(value, path, fallback) {
	if (value === void 0 || value === null) return fallback;
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean or null`);
	return value;
}
function finiteNumber(value, path, fallback) {
	if (value === void 0 || value === null) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number or null`);
	return value;
}
function optionalFiniteNumber(value, path) {
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number or null`);
	return value;
}
function stringArray$2(value, path) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} must be an array of strings`);
	return [...value];
}
function hasDecorator(content) {
	return /(?:^|\n)@@@?[a-z_]+(?:\s|$)/imu.test(content);
}
function isDelimitedRegex(key) {
	return /^\/[\s\S]+\/[gimsuy]*$/u.test(key);
}
function hasAdvancedMatching(entry) {
	const filter = entry.characterFilter;
	return entry.matchPersonaDescription === true || entry.matchCharacterDescription === true || entry.matchCharacterPersonality === true || entry.matchCharacterDepthPrompt === true || entry.matchScenario === true || entry.matchCreatorNotes === true || typeof filter === "object" && filter !== null && Object.keys(filter).length > 0;
}
function secondaryLogic(value, path) {
	if (value === 0) return "and-any";
	if (value === 1) return "not-all";
	if (value === 2) return "not-any";
	if (value === 3) return "and-all";
	throw new Error(`${path} must be 0, 1, 2, or 3`);
}
function parseEntry(value, id, degradations) {
	const path = `entries.${id}`;
	const entry = object$11(value, path);
	const keys = stringArray$2(entry.key, `${path}.key`);
	const secondaryKeys = stringArray$2(entry.keysecondary, `${path}.keysecondary`);
	const content = optionalString$1(entry.content, `${path}.content`) ?? "";
	const position = finiteNumber(entry.position, `${path}.position`, 0);
	const probability = finiteNumber(entry.probability, `${path}.probability`, 100);
	const usesProbability = boolean(entry.useProbability, `${path}.useProbability`, true) && probability < 100;
	const advancedMatching = hasAdvancedMatching(entry);
	const vectorized = entry.vectorized === true;
	const timed = entry.sticky !== void 0 && entry.sticky !== null || entry.cooldown !== void 0 && entry.cooldown !== null || entry.delay !== void 0 && entry.delay !== null;
	const recursive = entry.excludeRecursion === true || entry.preventRecursion === true || entry.delayUntilRecursion === true;
	const useRegex = [...keys, ...secondaryKeys].some(isDelimitedRegex);
	const decorated = hasDecorator(content);
	const uid = entry.uid;
	if (uid !== void 0 && uid !== null && typeof uid !== "string" && typeof uid !== "number") throw new Error(`${path}.uid must be a string or number`);
	const displayName = optionalString$1(entry.comment, `${path}.comment`);
	const supportedPosition = position === 0 || position === 1;
	if (decorated) degradations.add("entry-decorators");
	if (!supportedPosition) degradations.add("entry-unsupported-position");
	if (usesProbability) degradations.add("entry-probability");
	if (advancedMatching) degradations.add("entry-advanced-matching");
	if (vectorized) degradations.add("vector-matching");
	if (timed) degradations.add("timed-effects");
	if (recursive) degradations.add("lorebook-recursion");
	const scanDepth = optionalFiniteNumber(entry.scanDepth, `${path}.scanDepth`);
	if (scanDepth !== void 0 && scanDepth < 0) throw new Error(`${path}.scanDepth must not be negative`);
	return {
		sourceId: uid === void 0 || uid === null ? id : String(uid),
		...displayName === void 0 ? {} : { name: displayName },
		keys,
		secondaryKeys,
		content,
		enabled: !boolean(entry.disable, `${path}.disable`, false) && supportedPosition && !usesProbability && !advancedMatching && !vectorized && !timed && !recursive,
		insertionOrder: finiteNumber(entry.order, `${path}.order`, 100),
		selective: boolean(entry.selective, `${path}.selective`, secondaryKeys.length > 0),
		constant: boolean(entry.constant, `${path}.constant`, false),
		caseSensitive: boolean(entry.caseSensitive, `${path}.caseSensitive`, false),
		matchWholeWords: boolean(entry.matchWholeWords, `${path}.matchWholeWords`, false),
		secondaryLogic: secondaryLogic(finiteNumber(entry.selectiveLogic, `${path}.selectiveLogic`, 0), `${path}.selectiveLogic`),
		...scanDepth === void 0 ? {} : { scanDepth },
		position: position === 0 ? "before_char" : "after_char",
		ignoreBudget: false,
		useRegex,
		hasDecorators: decorated
	};
}
/** Decode one standalone World Info JSON file without replacement characters. */
function parseWorldInfoJsonBytes(data) {
	let json;
	try {
		json = new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/u, "");
	} catch (error) {
		throw new Error("World Info JSON must be valid UTF-8", { cause: error });
	}
	return parseWorldInfoJson(json);
}
/**
* Parse one SillyTavern World Info JSON document.
* @param json - UTF-8 JSON text from a standalone file.
* @returns normalized literal-key lore plus exact parsed JSON.
*/
function parseWorldInfoJson(json) {
	if (Buffer.byteLength(json, "utf8") > 2097152) throw new Error(`World Info JSON exceeds ${MAX_WORLD_INFO_JSON_BYTES} bytes`);
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch (error) {
		throw new Error("World Info is not valid JSON", { cause: error });
	}
	const raw = snapshotJsonValue(parsed);
	if (raw === void 0) throw new Error("World Info must contain lossless JSON");
	const root = object$11(raw, "World Info");
	const entries = root.entries;
	if (typeof entries !== "object" || entries === null) throw new Error("World Info entries must be an object or array");
	const values = Array.isArray(entries) ? entries.map((entry, index) => [String(index), entry]) : Object.entries(entries);
	const degradations = /* @__PURE__ */ new Set();
	const lorebookEntries = values.map(([id, entry]) => parseEntry(entry, id, degradations));
	const name = optionalString$1(root.name, "World Info name");
	return {
		format: 0,
		...name === void 0 ? {} : { name },
		lorebook: {
			recursiveScanning: false,
			entries: lorebookEntries
		},
		degradations: [...degradations].sort(),
		raw
	};
}
/** Strict, lossless parser for exported SillyTavern JSONL chats. */
/** Maximum UTF-8 input accepted as one SillyTavern chat export. */
const MAX_SILLYTAVERN_CHAT_BYTES$1 = 32 * 1024 * 1024;
function object$10(value, path) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}
function optionalString(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "string") throw new Error(`${path} must be a string`);
	return value;
}
function optionalBoolean(value, path) {
	if (value === void 0) return false;
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
	return value;
}
function optionalObject$1(value, path) {
	if (value === void 0) return void 0;
	return object$10(value, path);
}
function stringArray$1(value, path) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} must be an array of strings`);
	return [...value];
}
function optionalNonNegativeInteger(value, path) {
	if (value === void 0) return void 0;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a non-negative safe integer`);
	return value;
}
function parseLine(line, lineNumber) {
	let parsed;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		throw new Error(`SillyTavern chat line ${lineNumber} is not valid JSON`, { cause: error });
	}
	const raw = snapshotJsonValue(parsed);
	if (raw === void 0) throw new Error(`SillyTavern chat line ${lineNumber} must contain lossless JSON`);
	return raw;
}
function parseHeader(raw, line) {
	const header = object$10(raw, `SillyTavern chat line ${line}`);
	const metadata = header.chat_metadata;
	if (metadata === void 0) throw new Error(`SillyTavern chat line ${line} must be the chat header with chat_metadata`);
	object$10(metadata, `SillyTavern chat line ${line}.chat_metadata`);
	const userName = optionalString(header.user_name, `SillyTavern chat line ${line}.user_name`);
	const characterName = optionalString(header.character_name, `SillyTavern chat line ${line}.character_name`);
	return {
		...userName === void 0 ? {} : { userName },
		...characterName === void 0 ? {} : { characterName },
		...header.create_date === void 0 ? {} : { createDate: header.create_date },
		chatMetadata: metadata,
		raw
	};
}
function parseMessage(raw, line) {
	const path = `SillyTavern chat line ${line}`;
	const message = object$10(raw, path);
	const text = optionalString(message.mes, `${path}.mes`);
	if (text === void 0) throw new Error(`${path}.mes must be a string`);
	const name = optionalString(message.name, `${path}.name`);
	const isUser = optionalBoolean(message.is_user, `${path}.is_user`);
	const isSystem = optionalBoolean(message.is_system, `${path}.is_system`);
	if (isUser && isSystem) throw new Error(`${path} cannot be both a user and system message`);
	const extra = optionalObject$1(message.extra, `${path}.extra`);
	const narrator = extra?.type === "narrator";
	const swipes = stringArray$1(message.swipes, `${path}.swipes`);
	const swipeId = optionalNonNegativeInteger(message.swipe_id, `${path}.swipe_id`);
	if (swipeId !== void 0 && swipeId >= swipes.length) throw new Error(`${path}.swipe_id ${swipeId} is outside ${swipes.length} swipe(s)`);
	const kind = narrator ? "narrator" : isUser ? "user" : isSystem ? "system" : "assistant";
	return {
		line,
		...name === void 0 ? {} : { name },
		text,
		kind,
		swipes,
		...swipeId === void 0 ? {} : { swipeId },
		...extra === void 0 ? {} : { extra },
		raw
	};
}
/** Decode one SillyTavern JSONL chat without replacement characters. */
function parseSillyTavernChatBytes(data) {
	if (data.byteLength > 33554432) throw new Error(`SillyTavern chat exceeds ${MAX_SILLYTAVERN_CHAT_BYTES$1} bytes`);
	let jsonl;
	try {
		jsonl = new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/u, "");
	} catch (error) {
		throw new Error("SillyTavern chat must be valid UTF-8", { cause: error });
	}
	return parseSillyTavernChat(jsonl);
}
/**
* Parse one SillyTavern JSONL chat while retaining every source row.
* @param jsonl - decoded JSONL text from a SillyTavern export.
* @returns the header and ordered chat messages; ordinary system rows remain inert.
*/
function parseSillyTavernChat(jsonl) {
	if (Buffer.byteLength(jsonl, "utf8") > 33554432) throw new Error(`SillyTavern chat exceeds ${MAX_SILLYTAVERN_CHAT_BYTES$1} bytes`);
	const rows = jsonl.split(/\r?\n/u).map((text, index) => ({
		text,
		line: index + 1
	})).filter((row) => row.text.trim().length > 0);
	const first = rows[0];
	if (first === void 0) throw new Error("SillyTavern chat is empty");
	return {
		format: 0,
		header: parseHeader(parseLine(first.text, first.line), first.line),
		messages: rows.slice(1).map((row) => parseMessage(parseLine(row.text, row.line), row.line))
	};
}
/** Read preset scripts from the current normalized shape or a pre-regex session snapshot. */
function presetRegexScripts(preset) {
	return preset.regexScripts ?? [];
}
/** Read executable Tavern Helper scripts from current or older preset snapshots. */
function presetTavernHelperScripts(preset) {
	return preset.tavernHelperScripts ?? [];
}
function object$9(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function text$3(value, fallback = "") {
	return typeof value === "string" ? value : fallback;
}
function optionalFinite$1(value, label) {
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
	return value;
}
function optionalObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function extensionCompatibility(extensions, rawRegex, helper, helperScripts, helperVariables) {
	const spreset = optionalObject(extensions.SPreset);
	const chatSquash = optionalObject(spreset?.ChatSquash);
	const regexBinding = optionalObject(spreset?.RegexBinding);
	const compatibility = {
		...typeof spreset?.MacroNest === "boolean" ? { macroNestEnabled: spreset.MacroNest } : {},
		...typeof chatSquash?.enabled === "boolean" ? { chatSquashEnabled: chatSquash.enabled } : {},
		...typeof regexBinding?.enabled === "boolean" ? { regexBindingEnabled: regexBinding.enabled } : {},
		...Array.isArray(regexBinding?.regexes) && Array.isArray(rawRegex) ? { regexBindingMatchesPresetScripts: JSON.stringify(regexBinding.regexes) === JSON.stringify(rawRegex) } : {},
		...helper === void 0 ? {} : {
			tavernHelperScriptCount: helperScripts.length,
			enabledTavernHelperScriptCount: helperScripts.filter((script) => script.enabled).length,
			tavernHelperFormat: helper.format,
			tavernHelperVariableCount: Object.keys(helperVariables).length,
			tavernHelperIgnoredFieldCount: helper.ignoredFieldCount
		}
	};
	return Object.keys(compatibility).length === 0 ? void 0 : compatibility;
}
function prompt$2(value, index) {
	const record = object$9(value, `prompts[${index}]`);
	const identifier = text$3(record.identifier).trim();
	if (identifier === "") throw new Error(`prompts[${index}].identifier must be non-empty`);
	const role = record.role === "model" ? "assistant" : record.role ?? "system";
	if (role !== "system" && role !== "user" && role !== "assistant") throw new Error(`prompts[${index}].role is unsupported`);
	return {
		identifier,
		name: text$3(record.name, identifier),
		role,
		content: text$3(record.content),
		marker: record.marker === true,
		systemPrompt: record.system_prompt === true,
		forbidOverrides: record.forbid_overrides === true,
		...optionalFinite$1(record.injection_position, `prompts[${index}].injection_position`) === void 0 ? {} : { injectionPosition: record.injection_position },
		...optionalFinite$1(record.injection_depth, `prompts[${index}].injection_depth`) === void 0 ? {} : { injectionDepth: record.injection_depth },
		...optionalFinite$1(record.injection_order, `prompts[${index}].injection_order`) === void 0 ? {} : { injectionOrder: record.injection_order }
	};
}
function selectedOrder(value) {
	if (!Array.isArray(value) || value.length === 0) throw new Error("prompt_order must contain at least one order");
	const rows = value.map((entry, index) => object$9(entry, `prompt_order[${index}]`));
	const selected = rows.find((row) => String(row.character_id) === "100001") ?? rows[0];
	if (!Array.isArray(selected.order)) throw new Error("selected prompt_order row must contain an order array");
	return selected.order.map((entry, index) => {
		const record = object$9(entry, `prompt_order.order[${index}]`);
		const identifier = text$3(record.identifier).trim();
		if (identifier === "") throw new Error(`prompt_order.order[${index}].identifier must be non-empty`);
		return {
			identifier,
			enabled: record.enabled === true
		};
	});
}
/** Whether parsed JSON has the structural signature of a Chat Completion preset. */
function isSillyTavernPresetJson(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return Array.isArray(record.prompts) && Array.isArray(record.prompt_order);
}
/** Parse all Prompt Manager modules while retaining extension capability counts. */
function parseSillyTavernPresetJson(source, fileName = "SillyTavern preset") {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("SillyTavern preset is not valid JSON", { cause: error });
	}
	if (!isSillyTavernPresetJson(value)) throw new Error("JSON is not a SillyTavern Chat Completion preset");
	const record = object$9(value, "preset");
	const prompts = record.prompts.map(prompt$2);
	const seen = /* @__PURE__ */ new Set();
	for (const item of prompts) {
		if (seen.has(item.identifier)) throw new Error(`preset repeats prompt identifier ${JSON.stringify(item.identifier)}`);
		seen.add(item.identifier);
	}
	const order = selectedOrder(record.prompt_order);
	for (const item of order) if (!seen.has(item.identifier)) throw new Error(`prompt_order references missing prompt ${JSON.stringify(item.identifier)}`);
	const extensions = record.extensions === void 0 ? {} : object$9(record.extensions, "extensions");
	const rawRegex = extensions.regex_scripts;
	const regexScripts = rawRegex === void 0 ? [] : (() => {
		if (!Array.isArray(rawRegex)) throw new Error("extensions.regex_scripts must be an array");
		return rawRegex.map((value, index) => parseRegexScript(value, `extensions.regex_scripts[${index}]`));
	})();
	const rawHelper = extensions.tavern_helper;
	const helper = rawHelper === void 0 || rawHelper === null ? void 0 : tavernHelperExtension(rawHelper, "extensions.tavern_helper");
	const helperScripts = helper?.value.scripts === void 0 ? [] : (() => {
		if (!Array.isArray(helper.value.scripts)) throw new Error("extensions.tavern_helper.scripts must be an array");
		return parseTavernHelperScripts(helper.value.scripts, "extensions.tavern_helper.scripts");
	})();
	const helperVariables = tavernHelperVariables(helper?.value.variables);
	const compatibility = extensionCompatibility(extensions, rawRegex, helper, helperScripts, helperVariables);
	return {
		format: 0,
		name: fileName.replace(/\.json$/iu, "").trim() || "SillyTavern preset",
		prompts,
		order,
		generation: {
			...optionalFinite$1(record.temperature, "temperature") === void 0 ? {} : { temperature: record.temperature },
			...optionalFinite$1(record.openai_max_tokens, "openai_max_tokens") === void 0 ? {} : { maxTokens: record.openai_max_tokens },
			...typeof record.reasoning_effort === "string" ? { reasoningEffort: record.reasoning_effort } : {},
			...optionalFinite$1(record.top_p, "top_p") === void 0 ? {} : { topP: record.top_p },
			...optionalFinite$1(record.top_k, "top_k") === void 0 ? {} : { topK: record.top_k },
			...optionalFinite$1(record.top_a, "top_a") === void 0 ? {} : { topA: record.top_a },
			...optionalFinite$1(record.min_p, "min_p") === void 0 ? {} : { minP: record.min_p },
			...optionalFinite$1(record.frequency_penalty, "frequency_penalty") === void 0 ? {} : { frequencyPenalty: record.frequency_penalty },
			...optionalFinite$1(record.presence_penalty, "presence_penalty") === void 0 ? {} : { presencePenalty: record.presence_penalty },
			...optionalFinite$1(record.repetition_penalty, "repetition_penalty") === void 0 ? {} : { repetitionPenalty: record.repetition_penalty }
		},
		formats: {
			worldInfo: text$3(record.wi_format, "{0}"),
			scenario: text$3(record.scenario_format, "{{scenario}}"),
			personality: text$3(record.personality_format, "{{personality}}")
		},
		regexScripts,
		tavernHelperScripts: helperScripts,
		tavernHelperVariables: helperVariables,
		extensionSummary: {
			regexScriptCount: regexScripts.length,
			hasSPreset: extensions.SPreset !== void 0 && extensions.SPreset !== null,
			hasTavernHelper: extensions.tavern_helper !== void 0 && extensions.tavern_helper !== null
		},
		...compatibility === void 0 ? {} : { extensionCompatibility: compatibility }
	};
}
/** Parse UTF-8 preset bytes with strict decoding. */
function parseSillyTavernPresetBytes(bytes, fileName) {
	let source;
	try {
		source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error("SillyTavern preset must be UTF-8 JSON", { cause: error });
	}
	return parseSillyTavernPresetJson(source, fileName);
}
/** Convert a normalized preset to durable JSON without retaining executable extension payloads. */
function presetJson(preset) {
	return structuredClone(preset);
}
/** Convert a parsed SillyTavern chat into validated DSH Session history. */
function usableIdentityName(value) {
	const name = value?.trim();
	return name === void 0 || name === "" || name.toLowerCase() === "unused" ? void 0 : name;
}
/** Recover names from current SillyTavern exports whose legacy header names are `unused`. */
function resolveSillyTavernChatIdentity(chat) {
	const characterName = usableIdentityName(chat.header.characterName) ?? chat.messages.find((message) => message.kind === "assistant" && usableIdentityName(message.name) !== void 0)?.name?.trim();
	const userName = usableIdentityName(chat.header.userName) ?? chat.messages.find((message) => message.kind === "user" && usableIdentityName(message.name) !== void 0)?.name?.trim();
	return {
		...characterName === void 0 ? {} : { characterName },
		...userName === void 0 ? {} : { userName }
	};
}
function eventTime(message, fallback) {
	if (typeof message.raw !== "object" || message.raw === null || Array.isArray(message.raw)) return fallback;
	const date = message.raw.send_date;
	if (typeof date === "number" && Number.isSafeInteger(date) && date >= 0) return date;
	if (typeof date !== "string") return fallback;
	const parsed = Date.parse(date);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
function metadata$1(chat, attachment) {
	return {
		format: 0,
		source: {
			attachmentConsumer: "dsh-agent-rp",
			attachments: [attachment]
		},
		header: chat.header.raw,
		messages: chat.messages.map((message) => ({
			line: message.line,
			kind: message.kind,
			...message.name === void 0 ? {} : { name: message.name },
			swipes: message.swipes,
			...message.swipeId === void 0 ? {} : { swipeId: message.swipeId },
			...message.extra === void 0 ? {} : { extra: message.extra }
		}))
	};
}
/**
* Read the latest usable character identity attached to an imported chat Session.
* @param events - current Session history.
* @returns imported character and optional user names, when the chat header names a character.
*/
function readSillyTavernChatIdentity(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "command/done" && event.data.kind === "success") {
			let command;
			try {
				command = decodeSillyTavernChatCommandRecord(event.data.text) ?? decodeCharacterLibraryLaunch(event.data.text)?.chat;
			} catch {
				continue;
			}
			if (command !== void 0 && command.characterName !== void 0) return {
				characterName: command.characterName,
				...command.userName === void 0 ? {} : { userName: command.userName }
			};
			continue;
		}
		if (event?.type !== "agent-rp/sillytavern-chat-import") continue;
		const header = event.data.header;
		if (typeof header !== "object" || header === null || Array.isArray(header)) return void 0;
		const headerCharacterName = typeof header.character_name === "string" ? header.character_name : void 0;
		const headerUserName = typeof header.user_name === "string" ? header.user_name : void 0;
		const characterName = usableIdentityName(headerCharacterName) ?? event.data.messages.find((message) => message.kind === "assistant" && usableIdentityName(message.name) !== void 0)?.name?.trim();
		if (characterName === void 0) return void 0;
		const userName = usableIdentityName(headerUserName) ?? event.data.messages.find((message) => message.kind === "user" && usableIdentityName(message.name) !== void 0)?.name?.trim();
		return {
			characterName,
			...userName === void 0 ? {} : { userName }
		};
	}
}
function appendMessageEvents(events, message, turn, time) {
	const push = (event) => {
		events.push({
			...event,
			seq: events.length
		});
	};
	push({
		type: "turn/start",
		time,
		data: { turn }
	});
	push({
		type: "step/start",
		time,
		data: {
			turn,
			step: 1
		}
	});
	if (message.kind === "assistant") push({
		type: "assistant/message",
		time,
		data: {
			turn,
			step: 1,
			message: createAssistantMessage({
				content: [{
					type: "text",
					text: message.text
				}],
				source: {
					provider: "sillytavern-import",
					model: "history"
				}
			})
		},
		surfaceOp: "append"
	});
	else push({
		type: "user/message",
		time,
		data: createUserMessage({
			content: [{
				type: "text",
				text: message.text
			}],
			source: message.kind === "user" ? { kind: "user" } : {
				kind: "plugin",
				plugin: "dsh-agent-rp",
				form: "recall"
			}
		}),
		surfaceOp: "append"
	});
	push({
		type: "step/end",
		time,
		data: {
			turn,
			step: 1
		}
	});
	push({
		type: "turn/end",
		time,
		data: {
			turn,
			reason: { kind: "completed" }
		}
	});
}
/**
* Build a balanced Session seed from one parsed SillyTavern chat.
* @param chat - validated lossless JSONL projection.
* @param attachment - Host-stored original JSONL file owned by the imported Session.
* @returns a frozen seed accepted by the native Session constructor.
*/
function createSillyTavernChatSeed(chat, attachment) {
	if (!/\.jsonl$/iu.test(attachment.name)) throw new Error("SillyTavern chat source must be a .jsonl file");
	const events = [{
		type: "agent-rp/sillytavern-chat-import",
		seq: 0,
		time: Date.now(),
		data: metadata$1(chat, attachment),
		ignorable: true
	}];
	let turn = 0;
	let fallbackTime = events[0].time;
	for (const message of chat.messages) {
		if (message.kind === "system" || message.text.length === 0) continue;
		turn += 1;
		fallbackTime += 1;
		appendMessageEvents(events, message, turn, eventTime(message, fallbackTime));
	}
	const validated = Session.create(SessionId("agent-rp-sillytavern-import-validation"), events);
	return Object.freeze(validated.events.slice(0, events.length));
}
/** One-shot SillyTavern character and chat migration. */
/**
* Build one Session from a Character Card JSON and its SillyTavern chat export.
* @param card - parsed Character Card identity.
* @param cardAttachment - stored card JSON, PNG, or CHARX.
* @param cardTransport - decoded card transport metadata.
* @param chat - parsed SillyTavern chat history.
* @param chatAttachment - stored chat JSONL.
* @param libraryId - reusable card id used to resolve CHARX media.
* @returns one validated seed with imported history and active card identity.
*/
function createSillyTavernMigrationSeed(card, cardAttachment, cardTransport, chat, chatAttachment, libraryId) {
	const events = [...createSillyTavernChatSeed(chat, chatAttachment)];
	const cardEvent = createCharacterCardSessionSeed(card, cardAttachment, 0, "", cardTransport, resolveSillyTavernChatIdentity(chat).userName, void 0, libraryId)[0];
	if (cardEvent?.type !== "agent-rp/character-card-seed") throw new Error("Character Card seed is missing");
	const seq = events.length;
	events.push({
		...cardEvent,
		seq,
		time: Math.max(Date.now(), events.at(-1)?.time ?? 0),
		data: {
			...cardEvent.data,
			meta: {
				...cardEvent.data.meta,
				result: {
					...cardEvent.data.meta.result,
					sourceEventSeq: seq
				}
			}
		}
	});
	const validated = Session.create(SessionId("agent-rp-sillytavern-migration-validation"), events);
	return Object.freeze(validated.events.slice(0, events.length));
}
/** Same-origin upload endpoint served by the Agent RP Host plugin. */
const WORLD_INFO_LIBRARY_PATH = "/api/agent-rp/world-info";
const RESULT_PREFIX$3 = "agent-rp-world-info-library-v0:";
/** Serialize one direct World Info import into the Session command log. */
function encodeWorldInfoLibraryImport(record) {
	return `${RESULT_PREFIX$3}${JSON.stringify(record)}`;
}
/** Decode a direct World Info import while declining unrelated command output. */
function decodeWorldInfoLibraryImport(source) {
	if (source?.startsWith(RESULT_PREFIX$3) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(31));
	} catch (error) {
		throw new Error("世界书导入结果不是有效 JSON", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("世界书导入结果不是对象");
	const record = value;
	if (record.format !== 0 || typeof record.importId !== "string" || !/^world-info-[a-f0-9]{32}$/u.test(record.importId) || typeof record.meta !== "object" || record.meta === null || Array.isArray(record.meta) || Object.keys(record).some((key) => key !== "format" && key !== "importId" && key !== "meta")) throw new Error("世界书导入结果字段无效");
	return record;
}
function jsonObject$1(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function parseResult(value) {
	const record = jsonObject$1(value, "import_world_info result");
	if (record.version !== 0 || typeof record.name !== "string" || record.name.trim().length === 0 || typeof record.sourceEventSeq !== "number" || !Number.isSafeInteger(record.sourceEventSeq) || typeof record.sourceAttachmentId !== "string" || typeof record.entryCount !== "number" || !Number.isSafeInteger(record.entryCount) || record.entryCount < 0 || !Array.isArray(record.degradations) || record.degradations.some((value) => typeof value !== "string" || !WORLD_INFO_IMPORT_DEGRADATIONS.includes(value))) throw new Error("import_world_info result has invalid fields");
	return record;
}
/** Parse replayable World Info metadata from a tool or private command result. */
function parseWorldInfoImportMeta(value) {
	const meta = jsonObject$1(value, "import_world_info metadata");
	if (meta.format !== 0) throw new Error("import_world_info metadata has an unsupported format");
	const result = parseResult(meta.result);
	if (meta.raw === void 0) throw new Error("import_world_info metadata is missing raw data");
	return {
		format: 0,
		result,
		raw: meta.raw
	};
}
/** Recognize one standalone JSON file usable as a World Info transport. */
function isJsonWorldInfoAttachment(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return record.kind === "file" && typeof record.attachmentId === "string" && typeof record.bytes === "number" && typeof record.name === "string" && /\.json$/iu.test(record.name) && (record.mediaType === void 0 || typeof record.mediaType === "string");
}
function sourceAttachments(events, sourceEventSeq) {
	const source = events[sourceEventSeq];
	if (source?.type !== "user/message" || source.seq !== sourceEventSeq || source.data.source.kind !== "user") throw new Error("import_world_info sourceEventSeq does not reference a user message");
	const sourceMeta = source.data.source;
	return (sourceMeta.attachmentConsumer === "dsh-agent-rp" && Array.isArray(sourceMeta.attachments) ? sourceMeta.attachments : []).filter(isJsonWorldInfoAttachment);
}
function validateImport(events, resultEvent) {
	const meta = parseWorldInfoImportMeta(resultEvent.data.meta);
	const result = meta.result;
	const worldInfo = parseWorldInfoJson(JSON.stringify(meta.raw));
	const call = resultEvent.sourceEventSeqs?.length === 1 ? events[resultEvent.sourceEventSeqs[0]] : void 0;
	if (call?.type !== "tool/call" || call.data.name !== "import_world_info" || call.seq >= resultEvent.seq || String(call.data.callId) !== String(resultEvent.data.message.content[0].toolCallId)) throw new Error("import_world_info result does not cite its direct tool call");
	let callArguments;
	try {
		callArguments = JSON.parse(call.data.arguments);
	} catch {
		throw new Error("import_world_info source call has invalid JSON arguments");
	}
	if (typeof callArguments !== "object" || callArguments === null || Array.isArray(callArguments)) throw new Error("import_world_info source call has invalid arguments");
	const attachmentIndex = callArguments.attachmentIndex ?? 0;
	if (typeof attachmentIndex !== "number" || !Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) throw new Error("import_world_info source call has an invalid attachmentIndex");
	if (result.sourceEventSeq >= call.seq) throw new Error("import_world_info source attachment does not precede its tool call");
	const attachment = sourceAttachments(events, result.sourceEventSeq)[attachmentIndex];
	if (attachment === void 0 || String(attachment.attachmentId) !== result.sourceAttachmentId) throw new Error("import_world_info source attachment is absent from its user message");
	const name = worldInfo.name?.trim() || attachment.name.replace(/\.json$/iu, "");
	if (result.name !== name || result.entryCount !== worldInfo.lorebook.entries.length || JSON.stringify(result.degradations) !== JSON.stringify(worldInfo.degradations)) throw new Error("import_world_info result summary does not match durable metadata");
	return {
		result,
		meta: {
			...meta,
			raw: worldInfo.raw
		},
		worldInfo
	};
}
/**
* Find and validate active standalone World Info books in one Session.
* @param events - complete chronological Session history.
* @returns successful imports in log order, with a repeated attachment replacing its prior import.
*/
function readActiveSessionWorldInfos(events) {
	const active = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (event.type === "command/done" && event.data.kind === "success") {
			const direct = decodeWorldInfoLibraryImport(event.data.text);
			if (direct === void 0) continue;
			const meta = parseWorldInfoImportMeta(direct.meta);
			const source = events[meta.result.sourceEventSeq];
			const expectedAttachment = `library:${direct.importId}`;
			if (source?.type !== "command/run" || source.data.name !== "rp-world-info-import" || source.seq >= event.seq || String(source.data.commandId) !== String(event.data.commandId) || meta.result.sourceAttachmentId !== expectedAttachment) throw new Error("世界书导入结果没有对应的命令来源");
			const worldInfo = parseWorldInfoJson(JSON.stringify(meta.raw));
			if (meta.result.name !== (worldInfo.name?.trim() || meta.result.name) || meta.result.entryCount !== worldInfo.lorebook.entries.length || JSON.stringify(meta.result.degradations) !== JSON.stringify(worldInfo.degradations)) throw new Error("世界书导入结果与来源不一致");
			active.set(expectedAttachment, {
				result: meta.result,
				meta,
				worldInfo
			});
			continue;
		}
		if (event.type !== "tool/result" || event.data.message.content[0].isError === true) continue;
		const callId = String(event.data.message.content[0].toolCallId);
		const call = events.find((candidate) => candidate.type === "tool/call" && String(candidate.data.callId) === callId);
		if (call?.type !== "tool/call" || call.data.name !== "import_world_info") continue;
		const imported = validateImport(events, event);
		active.set(imported.result.sourceAttachmentId, imported);
	}
	return [...active.values()];
}
/**
* Build the canonical World Info summary associated with its source file.
* @param worldInfo - parsed standalone World Info.
* @param sourceEventSeq - exact user message carrying the attachment.
* @param attachment - matching durable JSON attachment.
* @returns compact canonical tool result plus lossless raw JSON.
*/
function prepareWorldInfoImportResult(worldInfo, sourceEventSeq, attachment) {
	const name = worldInfo.name?.trim() || attachment.name.replace(/\.json$/iu, "");
	if (name.trim().length === 0) throw new Error("World Info attachment must have a non-empty filename or name");
	return {
		version: 0,
		name,
		sourceEventSeq,
		sourceAttachmentId: String(attachment.attachmentId),
		entryCount: worldInfo.lorebook.entries.length,
		degradations: [...worldInfo.degradations],
		raw: worldInfo.raw
	};
}
const FORCE_TOGGLE_MARKERS = /* @__PURE__ */ new Set([
	"charDescription",
	"charPersonality",
	"scenario",
	"personaDescription",
	"worldInfoBefore",
	"worldInfoAfter",
	"main",
	"chatHistory",
	"dialogueExamples"
]);
/** Whether SillyTavern exposes the module's enable switch. */
function canTogglePresetPrompt(preset, identifier) {
	const prompt = preset.prompts.find((item) => item.identifier === identifier);
	return prompt !== void 0 && (!prompt.marker || FORCE_TOGGLE_MARKERS.has(identifier));
}
/** Whether one module owns literal text that can be edited by the Prompt Manager. */
function canEditPresetPrompt(preset, identifier) {
	const prompt = preset.prompts.find((item) => item.identifier === identifier);
	return prompt !== void 0 && !prompt.marker;
}
function object$8(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function revision(value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("revision must be a non-negative safe integer");
	return value;
}
function index(value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("index must be a non-negative safe integer");
	return value;
}
function identifier(value, label = "identifier") {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
	return value;
}
function order(value) {
	if (!Array.isArray(value)) throw new Error("order must be an array");
	const seen = /* @__PURE__ */ new Set();
	return value.map((item, index) => {
		const record = object$8(item, `order[${index}]`);
		const id = identifier(record.identifier, `order[${index}].identifier`);
		if (seen.has(id)) throw new Error(`order repeats module ${JSON.stringify(id)}`);
		seen.add(id);
		if (typeof record.enabled !== "boolean") throw new Error(`order[${index}].enabled must be a boolean`);
		return {
			identifier: id,
			enabled: record.enabled
		};
	});
}
function nullableFiniteDepth(value, label) {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number or null`);
	return value;
}
function regex$1(value) {
	if (!Array.isArray(value)) throw new Error("regex must be an array");
	const seen = /* @__PURE__ */ new Set();
	return value.map((item, itemIndex) => {
		const record = object$8(item, `regex[${itemIndex}]`);
		const scriptIndex = index(record.index);
		if (seen.has(scriptIndex)) throw new Error(`regex repeats script index ${scriptIndex}`);
		seen.add(scriptIndex);
		if (typeof record.disabled !== "boolean") throw new Error(`regex[${itemIndex}].disabled must be a boolean`);
		return {
			index: scriptIndex,
			disabled: record.disabled,
			...record.minDepth === void 0 ? {} : { minDepth: nullableFiniteDepth(record.minDepth, `regex[${itemIndex}].minDepth`) },
			...record.maxDepth === void 0 ? {} : { maxDepth: nullableFiniteDepth(record.maxDepth, `regex[${itemIndex}].maxDepth`) }
		};
	});
}
function regexScripts(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value)) throw new Error("regexScripts must be an array");
	return value.map((item, itemIndex) => parseRegexScript(item, `regexScripts[${itemIndex}]`));
}
function content(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) throw new Error("content must be an array");
	const seen = /* @__PURE__ */ new Set();
	return value.map((item, itemIndex) => {
		const record = object$8(item, `content[${itemIndex}]`);
		const id = identifier(record.identifier, `content[${itemIndex}].identifier`);
		if (seen.has(id)) throw new Error(`content repeats module ${JSON.stringify(id)}`);
		seen.add(id);
		if (typeof record.content !== "string") throw new Error(`content[${itemIndex}].content must be a string`);
		return {
			identifier: id,
			content: record.content
		};
	});
}
function optionalPromptInteger(value, label, maximum) {
	if (value === void 0) return void 0;
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be an integer from 0 to ${maximum}`);
	return value;
}
function promptDefinitions(value) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value)) throw new Error("prompts must be an array");
	const seen = /* @__PURE__ */ new Set();
	return value.map((item, itemIndex) => {
		const record = object$8(item, `prompts[${itemIndex}]`);
		const id = identifier(record.identifier, `prompts[${itemIndex}].identifier`);
		if (seen.has(id)) throw new Error(`prompts repeats module ${JSON.stringify(id)}`);
		seen.add(id);
		if (typeof record.name !== "string" || record.name.trim() === "") throw new Error(`prompts[${itemIndex}].name must be a non-empty string`);
		if (record.role !== "system" && record.role !== "user" && record.role !== "assistant") throw new Error(`prompts[${itemIndex}].role is unsupported`);
		if (typeof record.content !== "string") throw new Error(`prompts[${itemIndex}].content must be a string`);
		const injectionPosition = optionalPromptInteger(record.injectionPosition, `prompts[${itemIndex}].injectionPosition`, 1);
		const injectionDepth = optionalPromptInteger(record.injectionDepth, `prompts[${itemIndex}].injectionDepth`, 9999);
		const injectionOrder = optionalPromptInteger(record.injectionOrder, `prompts[${itemIndex}].injectionOrder`, 9999);
		return {
			identifier: id,
			name: record.name.trim(),
			role: record.role,
			content: record.content,
			...injectionPosition === void 0 ? {} : { injectionPosition },
			...injectionDepth === void 0 ? {} : { injectionDepth },
			...injectionOrder === void 0 ? {} : { injectionOrder }
		};
	});
}
function finiteOrNull(value, label) {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number or null`);
	if (label === "temperature" && (value < 0 || value > 2)) throw new Error("temperature must be between 0 and 2");
	return value;
}
function integerOrNull(value, label) {
	if (value === null) return null;
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer or null`);
	return value;
}
function effortOrNull(value) {
	if (value === null) return null;
	if (typeof value !== "string" || value.trim() === "") throw new Error("reasoningEffort must be a non-empty string or null");
	return value.trim();
}
function generation(value) {
	const record = object$8(value, "generation");
	return {
		...record.temperature === void 0 ? {} : { temperature: finiteOrNull(record.temperature, "temperature") },
		...record.maxTokens === void 0 ? {} : { maxTokens: integerOrNull(record.maxTokens, "maxTokens") },
		...record.reasoningEffort === void 0 ? {} : { reasoningEffort: effortOrNull(record.reasoningEffort) }
	};
}
/** Decode the private command payload at the Host boundary. */
function parsePresetConfigurationRequest(source) {
	let parsed;
	try {
		parsed = JSON.parse(source.trim());
	} catch (error) {
		throw new Error("preset configuration must be valid JSON", { cause: error });
	}
	const value = object$8(parsed, "preset configuration");
	const common = { revision: revision(value.revision) };
	switch (value.operation) {
		case "replace": return {
			operation: "replace",
			...common,
			order: order(value.order),
			...value.prompts === void 0 ? {} : { prompts: promptDefinitions(value.prompts) },
			content: content(value.content),
			generation: generation(value.generation),
			regex: regex$1(value.regex),
			...value.regexScripts === void 0 ? {} : { regexScripts: regexScripts(value.regexScripts) }
		};
		case "toggle":
			if (typeof value.enabled !== "boolean") throw new Error("enabled must be a boolean");
			return {
				operation: "toggle",
				...common,
				identifier: identifier(value.identifier),
				enabled: value.enabled
			};
		case "move": return {
			operation: "move",
			...common,
			identifier: identifier(value.identifier),
			...value.before === void 0 ? {} : { before: identifier(value.before, "before") }
		};
		case "generation": {
			const result = {
				operation: "generation",
				...common,
				...value.temperature === void 0 ? {} : { temperature: finiteOrNull(value.temperature, "temperature") },
				...value.maxTokens === void 0 ? {} : { maxTokens: integerOrNull(value.maxTokens, "maxTokens") },
				...value.reasoningEffort === void 0 ? {} : { reasoningEffort: effortOrNull(value.reasoningEffort) }
			};
			if (result.temperature === void 0 && result.maxTokens === void 0 && result.reasoningEffort === void 0) throw new Error("generation requires at least one setting");
			return result;
		}
		case "reset": return {
			operation: "reset",
			...common
		};
		default: throw new Error(`unknown preset configuration operation ${JSON.stringify(value.operation)}`);
	}
}
function withGeneration(current, request) {
	const next = { ...current };
	for (const [key, value] of [
		["temperature", request.temperature],
		["maxTokens", request.maxTokens],
		["reasoningEffort", request.reasoningEffort]
	]) {
		if (value === void 0) continue;
		if (value === null) delete next[key];
		else next[key] = value;
	}
	return next;
}
/** Apply one validated manager mutation to an imported preset snapshot. */
function configurePreset(active, request) {
	if (request.revision !== active.revision) throw new Error(`preset configuration changed; expected revision ${active.revision}, received ${request.revision}`);
	if (request.operation === "reset") return structuredClone(active.importedPreset);
	if (request.operation === "replace") {
		const currentById = new Map(active.preset.prompts.map((item) => [item.identifier, item]));
		const nextPrompts = request.prompts === void 0 ? active.preset.prompts.map((prompt) => ({ ...prompt })) : request.prompts.map((definition) => {
			const current = currentById.get(definition.identifier);
			if (current === void 0) return {
				...definition,
				marker: false,
				systemPrompt: false,
				forbidOverrides: false,
				injectionPosition: definition.injectionPosition ?? 0,
				injectionDepth: definition.injectionDepth ?? 4,
				injectionOrder: definition.injectionOrder ?? 100
			};
			if (current.marker && definition.content !== current.content) throw new Error(`preset module ${JSON.stringify(definition.identifier)} has no editable content`);
			return {
				...current,
				name: definition.name,
				role: definition.role,
				content: definition.content,
				...definition.injectionPosition === void 0 ? {} : { injectionPosition: definition.injectionPosition },
				...definition.injectionDepth === void 0 ? {} : { injectionDepth: definition.injectionDepth },
				...definition.injectionOrder === void 0 ? {} : { injectionOrder: definition.injectionOrder }
			};
		});
		if (request.prompts !== void 0) {
			const nextIds = new Set(request.prompts.map((prompt) => prompt.identifier));
			for (const prompt of active.importedPreset.prompts) if ((prompt.systemPrompt || prompt.marker) && !nextIds.has(prompt.identifier)) throw new Error(`preset built-in module ${JSON.stringify(prompt.identifier)} cannot be deleted`);
		}
		const prompts = new Set(nextPrompts.map((item) => item.identifier));
		const nextPreset = {
			...active.preset,
			prompts: nextPrompts
		};
		for (const entry of request.order) {
			if (!prompts.has(entry.identifier)) throw new Error(`preset has no module ${JSON.stringify(entry.identifier)}`);
			if (entry.enabled && !canTogglePresetPrompt(nextPreset, entry.identifier)) {
				if (!(active.preset.order.find((item) => item.identifier === entry.identifier)?.enabled ?? false)) throw new Error(`preset module ${JSON.stringify(entry.identifier)} cannot be enabled`);
			}
		}
		const contentById = new Map(request.content.map((entry) => [entry.identifier, entry.content]));
		for (const identifier of contentById.keys()) {
			if (!prompts.has(identifier)) throw new Error(`preset has no module ${JSON.stringify(identifier)}`);
			if (!canEditPresetPrompt(active.preset, identifier)) throw new Error(`preset module ${JSON.stringify(identifier)} has no editable content`);
		}
		const scripts = request.regexScripts === void 0 ? presetRegexScripts(active.preset) : request.regexScripts.map((script) => ({ ...script }));
		if (request.regex.length !== scripts.length || request.regex.some((entry) => entry.index >= scripts.length)) throw new Error("preset regex configuration does not match the active script set");
		const regexByIndex = new Map(request.regex.map((entry) => [entry.index, entry]));
		return {
			...structuredClone(active.preset),
			prompts: nextPrompts.map((prompt) => contentById.has(prompt.identifier) ? {
				...prompt,
				content: contentById.get(prompt.identifier)
			} : { ...prompt }),
			order: request.order.map((item) => ({ ...item })),
			generation: withGeneration(active.preset.generation, {
				operation: "generation",
				revision: request.revision,
				...request.generation
			}),
			extensionSummary: {
				...active.preset.extensionSummary,
				regexScriptCount: scripts.length
			},
			regexScripts: scripts.map((script, index) => {
				const configured = regexByIndex.get(index);
				if (configured === void 0) return { ...script };
				return {
					...script,
					disabled: configured.disabled,
					...configured.minDepth === void 0 ? {} : { minDepth: configured.minDepth },
					...configured.maxDepth === void 0 ? {} : { maxDepth: configured.maxDepth }
				};
			})
		};
	}
	if (request.operation === "generation") return {
		...structuredClone(active.preset),
		generation: withGeneration(active.preset.generation, request)
	};
	if (active.preset.prompts.find((item) => item.identifier === request.identifier) === void 0) throw new Error(`preset has no module ${JSON.stringify(request.identifier)}`);
	const nextOrder = active.preset.order.map((item) => ({ ...item }));
	const index = nextOrder.findIndex((item) => item.identifier === request.identifier);
	if (request.operation === "toggle") {
		if (!canTogglePresetPrompt(active.preset, request.identifier)) throw new Error(`preset module ${JSON.stringify(request.identifier)} has no configurable switch`);
		if (index === -1) nextOrder.push({
			identifier: request.identifier,
			enabled: request.enabled
		});
		else nextOrder[index] = {
			...nextOrder[index],
			enabled: request.enabled
		};
		return {
			...structuredClone(active.preset),
			order: nextOrder
		};
	}
	if (request.before === request.identifier) return structuredClone(active.preset);
	if (request.before !== void 0 && !nextOrder.some((item) => item.identifier === request.before)) throw new Error(`preset order has no destination ${JSON.stringify(request.before)}`);
	const entry = index === -1 ? {
		identifier: request.identifier,
		enabled: false
	} : nextOrder.splice(index, 1)[0];
	const destination = request.before === void 0 ? nextOrder.length : nextOrder.findIndex((item) => item.identifier === request.before);
	nextOrder.splice(destination, 0, entry);
	return {
		...structuredClone(active.preset),
		order: nextOrder
	};
}
const PREFIX = "agent-rp:preset-library:v0:";
/** Encode one private command result with a collision-resistant marker. */
function encodePresetLibraryResult(result) {
	return `${PREFIX}${JSON.stringify(result)}`;
}
/** Parse a marked library result, returning undefined for unrelated commands. */
function parsePresetLibraryResult(text) {
	if (text === void 0 || !text.startsWith(PREFIX)) return void 0;
	let value;
	try {
		value = JSON.parse(text.slice(27));
	} catch (error) {
		throw new Error("预设库命令结果不是有效 JSON", { cause: error });
	}
	const result = value;
	if (result === null || typeof result !== "object" || result.format !== 0 || ![
		"list",
		"select",
		"save",
		"rename",
		"delete"
	].includes(String(result.operation)) || !Array.isArray(result.entries) || result.linkedLibraryId !== void 0 && typeof result.linkedLibraryId !== "string" || result.selected !== void 0 && (typeof result.selected !== "object" || result.selected === null || typeof result.selected.libraryId !== "string" || typeof result.selected.name !== "string" || typeof result.selected.preset !== "object" || result.selected.preset === null)) throw new Error("预设库命令结果包含无效字段");
	return result;
}
function resultFor(preset, name, sourceEventSeq, sourceAttachmentId) {
	const enabled = new Set(preset.order.filter((item) => item.enabled).map((item) => item.identifier));
	return {
		version: 0,
		name,
		sourceEventSeq,
		sourceAttachmentId,
		promptCount: preset.prompts.length,
		enabledCount: preset.prompts.filter((item) => enabled.has(item.identifier)).length,
		regexScriptCount: preset.extensionSummary.regexScriptCount
	};
}
function object$7(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function parseMeta(value) {
	const meta = object$7(value, "import_sillytavern_preset metadata");
	const result = object$7(meta.result, "import_sillytavern_preset result");
	const preset = object$7(meta.preset, "import_sillytavern_preset preset");
	if (meta.format !== 0 || result.version !== 0 || preset.format !== 0 || typeof result.name !== "string" || typeof result.sourceEventSeq !== "number" || !Number.isSafeInteger(result.sourceEventSeq) || typeof result.sourceAttachmentId !== "string" || typeof result.promptCount !== "number" || !Number.isSafeInteger(result.promptCount) || typeof result.enabledCount !== "number" || !Number.isSafeInteger(result.enabledCount) || typeof result.regexScriptCount !== "number" || !Number.isSafeInteger(result.regexScriptCount) || !Array.isArray(preset.prompts) || !Array.isArray(preset.order)) throw new Error("import_sillytavern_preset metadata has invalid fields");
	return value;
}
/** Find the last successful preset import in one Session. */
function readActiveSessionPreset(events) {
	let active;
	for (const event of events) {
		if (event.type === "agent-rp/sillytavern-preset-seed") {
			active = {
				result: event.data.result,
				importedPreset: event.data.preset,
				preset: event.data.preset,
				revision: 0,
				...event.data.libraryId === void 0 ? {} : { libraryId: event.data.libraryId }
			};
			continue;
		}
		if (event.type === "command/done" && event.data.kind === "success") {
			const library = parsePresetLibraryResult(event.data.text);
			if (library === void 0) continue;
			if (library.selected !== void 0) active = {
				result: resultFor(library.selected.preset, library.selected.name, event.seq, `library:${library.selected.libraryId}`),
				importedPreset: library.selected.preset,
				preset: library.selected.preset,
				revision: 0,
				libraryId: library.selected.libraryId
			};
			else if (active !== void 0 && library.linkedLibraryId !== void 0) active = {
				...active,
				libraryId: library.linkedLibraryId
			};
			continue;
		}
		if (event.type === "command/run" && event.data.name === "rp-preset-configure" && event.data.args !== void 0) {
			if (active === void 0) continue;
			try {
				active = {
					...active,
					preset: configurePreset(active, parsePresetConfigurationRequest(event.data.args)),
					revision: active.revision + 1
				};
			} catch {}
			continue;
		}
		if (event.type !== "tool/result" || event.data.message.content[0]?.isError === true) continue;
		const callId = String(event.data.message.content[0]?.toolCallId);
		const call = events.find((candidate) => candidate.type === "tool/call" && String(candidate.data.callId) === callId);
		if (call?.type !== "tool/call" || call.data.name !== "import_sillytavern_preset") continue;
		const meta = parseMeta(event.data.meta);
		active = {
			result: meta.result,
			importedPreset: meta.preset,
			preset: meta.preset,
			revision: 0
		};
	}
	return active;
}
/** Activate one preset by extending an existing native roleplay Session. */
function createPresetSessionSeed(events, preset, attachment, libraryId) {
	const { preset: _value, ...result } = preparePresetImportResult(preset, events.length, attachment);
	return [...structuredClone(events), {
		type: "agent-rp/sillytavern-preset-seed",
		seq: events.length,
		time: Date.now(),
		data: {
			format: 0,
			source: {
				attachmentConsumer: "dsh-agent-rp",
				attachments: [attachment]
			},
			result,
			preset,
			...libraryId === void 0 ? {} : { libraryId }
		},
		ignorable: true
	}];
}
/** Build the canonical import result for one normalized preset. */
function preparePresetImportResult(preset, sourceEventSeq, attachment) {
	return {
		...resultFor(preset, preset.name, sourceEventSeq, String(attachment.attachmentId)),
		preset: structuredClone(preset)
	};
}
function createRegexMatcher(options) {
	try {
		return options.regexEngine?.createRegexMatcher();
	} catch {
		return;
	}
}
function includesKey(text, key, caseSensitive, matchWholeWords) {
	if (key.length === 0) return false;
	const haystack = caseSensitive ? text : text.toLocaleLowerCase();
	const needle = caseSensitive ? key : key.toLocaleLowerCase();
	if (!matchWholeWords) return haystack.includes(needle);
	if (/\s/u.test(needle)) return haystack.includes(needle);
	let offset = haystack.indexOf(needle);
	while (offset >= 0) {
		const before = offset === 0 ? "" : haystack[offset - 1];
		const after = offset + needle.length >= haystack.length ? "" : haystack[offset + needle.length];
		if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
		offset = haystack.indexOf(needle, offset + 1);
	}
	return false;
}
/**
* Report whether a V3 regex key is equivalent to a bounded literal substring lookup.
* @param value - raw Character Card V3 regex pattern.
* @returns whether the pattern contains no regex operators or escapes.
*/
function isLiteralRegexPattern(value) {
	return value.length > 0 && !value.includes("/") && !/[\\^$.*+?()[\]{}|]/u.test(value);
}
function hasExecutableTemplate(content) {
	return /<%[=_-]?[\s\S]*?%>/imu.test(content);
}
function keywordMatches(keys, text, entry) {
	return keys.filter((key) => includesKey(text, key, entry.caseSensitive, entry.matchWholeWords));
}
function literalRegexMatches(keys, text, entry) {
	if (keys.some((key) => !isLiteralRegexPattern(key))) return void 0;
	return keys.filter((key) => includesKey(text, key, entry.caseSensitive, false));
}
function regexMatches(keys, text, entry, matcher) {
	if (matcher === void 0) {
		const matchedKeys = literalRegexMatches(keys, text, entry);
		return matchedKeys === void 0 ? {
			ok: false,
			reason: "regex-unsupported"
		} : {
			ok: true,
			matchedKeys
		};
	}
	const result = matcher.match(keys, text, entry.caseSensitive);
	if (result.ok) return {
		ok: true,
		matchedKeys: result.matchedKeys
	};
	return {
		ok: false,
		reason: result.kind === "invalid" ? "regex-invalid" : result.kind === "execution-limit" ? "regex-execution-limit" : "regex-resource-limit"
	};
}
function candidate(entry, messages, bookDepth, options, regexMatcher) {
	const decision = (candidate, reason, matchedKeys = [], matchedSecondaryKeys = []) => ({
		candidate,
		reason,
		matchedKeys,
		matchedSecondaryKeys,
		content: entry.content
	});
	if (!entry.enabled) return decision(false, "disabled");
	if (entry.content.trim().length === 0) return decision(false, "empty-content");
	if (entry.hasDecorators) return decision(false, "decorator-unsupported");
	let activation;
	if (entry.constant) activation = decision(true, "active-constant");
	else {
		const depth = entry.scanDepth ?? bookDepth ?? messages.length;
		const text = depth === 0 ? "" : messages.slice(-Math.max(0, Math.trunc(depth))).join("\n");
		if (entry.useRegex) {
			const primary = regexMatches(entry.keys, text, entry, regexMatcher);
			if (!primary.ok) activation = decision(false, primary.reason);
			else if (primary.matchedKeys.length === 0) {
				const matchedKeys = primary.matchedKeys;
				activation = decision(false, "primary-unmatched", matchedKeys);
			} else {
				const matchedKeys = primary.matchedKeys;
				const secondary = regexMatches(entry.secondaryKeys, text, entry, regexMatcher);
				if (!secondary.ok) activation = decision(false, secondary.reason, matchedKeys);
				else if (!entry.selective || entry.secondaryKeys.length === 0) {
					const matchedSecondaryKeys = secondary.matchedKeys;
					activation = decision(true, "active-keyword", matchedKeys, matchedSecondaryKeys);
				} else {
					const matchedSecondaryKeys = secondary.matchedKeys;
					const matches = entry.secondaryKeys.map((key) => matchedSecondaryKeys.includes(key));
					const secondaryMatches = entry.secondaryLogic === "and-any" ? matches.some(Boolean) : entry.secondaryLogic === "and-all" ? matches.every(Boolean) : entry.secondaryLogic === "not-any" ? matches.every((match) => !match) : matches.some((match) => !match);
					activation = decision(secondaryMatches, secondaryMatches ? "active-keyword" : "secondary-unmatched", matchedKeys, matchedSecondaryKeys);
				}
			}
		} else {
			const matchedKeys = keywordMatches(entry.keys, text, entry);
			if (matchedKeys.length === 0) activation = decision(false, "primary-unmatched", matchedKeys);
			else {
				const matchedSecondaryKeys = keywordMatches(entry.secondaryKeys, text, entry);
				if (!entry.selective || entry.secondaryKeys.length === 0) activation = decision(true, "active-keyword", matchedKeys, matchedSecondaryKeys);
				else {
					const matches = entry.secondaryKeys.map((key) => matchedSecondaryKeys.includes(key));
					const secondaryMatches = entry.secondaryLogic === "and-any" ? matches.some(Boolean) : entry.secondaryLogic === "and-all" ? matches.every(Boolean) : entry.secondaryLogic === "not-any" ? matches.every((match) => !match) : matches.some((match) => !match);
					activation = decision(secondaryMatches, secondaryMatches ? "active-keyword" : "secondary-unmatched", matchedKeys, matchedSecondaryKeys);
				}
			}
		}
	}
	if (!activation.candidate || !hasExecutableTemplate(entry.content)) return activation;
	if (options.renderTemplate === void 0) return {
		...activation,
		candidate: false,
		reason: "template-unsupported"
	};
	const rendered = options.renderTemplate(entry.content, { ...options.worldInfoBookId === void 0 ? {} : { worldInfoBookId: options.worldInfoBookId } });
	if (!rendered.ok) return {
		...activation,
		candidate: false,
		reason: "template-error",
		template: rendered.kind
	};
	if (rendered.text.trim().length === 0) return {
		...activation,
		candidate: false,
		reason: "empty-content",
		content: rendered.text,
		template: "rendered"
	};
	return {
		...activation,
		content: rendered.text,
		template: "rendered"
	};
}
function approximateTokens(text) {
	let ascii = 0;
	let nonAscii = 0;
	for (const character of text) if (character.codePointAt(0) <= 127) ascii += 1;
	else nonAscii += 1;
	return Math.max(1, Math.ceil(ascii / 4) + nonAscii);
}
function budgeted(book, entries) {
	const budget = book.tokenBudget;
	if (budget === void 0) return entries.map((value) => value.index);
	const preferred = [...entries].sort((left, right) => (right.entry.priority ?? right.entry.insertionOrder) - (left.entry.priority ?? left.entry.insertionOrder) || left.entry.insertionOrder - right.entry.insertionOrder);
	const kept = [];
	let used = 0;
	for (const { index, entry, content } of preferred) {
		const cost = approximateTokens(content);
		if (entry.ignoreBudget) {
			kept.push(index);
			continue;
		}
		if (used + cost > budget) continue;
		used += cost;
		kept.push(index);
	}
	return kept.sort((left, right) => left - right);
}
function activeContent(book, entries) {
	const active = entries.filter((value) => value.active).map((value) => ({
		index: value.index,
		entry: book.entries[value.index],
		content: value.resolvedContent
	})).sort((left, right) => left.entry.insertionOrder - right.entry.insertionOrder || left.index - right.index);
	return {
		beforeCharacter: active.filter((value) => value.entry.position === "before_char").map((value) => value.content),
		afterCharacter: active.filter((value) => value.entry.position === "after_char").map((value) => value.content)
	};
}
function inspectLorebookWithMatcher(book, messages, options, matcher) {
	const decisions = book.entries.map((entry, index) => ({
		index,
		entry,
		decision: candidate(entry, messages, book.scanDepth, options, matcher)
	}));
	const candidates = decisions.filter((value) => value.decision.candidate);
	const included = new Set(budgeted(book, candidates.map(({ index, entry, decision }) => ({
		index,
		entry,
		content: decision.content
	}))));
	const entries = decisions.map(({ index, decision }) => ({
		index,
		active: decision.candidate && included.has(index),
		reason: decision.candidate && !included.has(index) ? "budget-excluded" : decision.reason,
		matchedKeys: decision.matchedKeys,
		matchedSecondaryKeys: decision.matchedSecondaryKeys,
		approximateTokens: approximateTokens(decision.content),
		...decision.template === void 0 ? {} : { template: decision.template },
		resolvedContent: decision.content
	}));
	return {
		...activeContent(book, entries),
		entries
	};
}
/**
* Inspect multiple books under their source budgets and one final Session budget.
* @param books - active books in prompt order.
* @param messages - model-visible conversation text in chronological order.
* @param options - isolated template renderer and optional aggregate token cap.
* @returns per-book decisions plus combined prompt fragments.
*/
function inspectLorebooks(books, messages, options = {}) {
	const matcher = createRegexMatcher(options);
	let inspected;
	try {
		inspected = books.map((book) => ({
			id: book.id,
			inspected: inspectLorebookWithMatcher(book.lorebook, messages, {
				...options,
				worldInfoBookId: book.id
			}, matcher)
		}));
	} finally {
		matcher?.dispose();
	}
	const candidates = inspected.flatMap((book, bookIndex) => book.inspected.entries.flatMap((decision) => {
		if (!decision.active) return [];
		return [{
			bookIndex,
			decision,
			entry: books[bookIndex].lorebook.entries[decision.index]
		}];
	}));
	const selected = new Set(candidates.map((value) => `${value.bookIndex}\u0000${value.decision.index}`));
	if (options.tokenBudget !== void 0) {
		selected.clear();
		let used = 0;
		const preferred = [...candidates].sort((left, right) => (right.entry.priority ?? right.entry.insertionOrder) - (left.entry.priority ?? left.entry.insertionOrder) || left.bookIndex - right.bookIndex || left.entry.insertionOrder - right.entry.insertionOrder || left.decision.index - right.decision.index);
		for (const value of preferred) {
			if (used + value.decision.approximateTokens > Math.max(0, options.tokenBudget)) continue;
			used += value.decision.approximateTokens;
			selected.add(`${value.bookIndex}\u0000${value.decision.index}`);
		}
	}
	const resolved = inspected.map((book, bookIndex) => {
		const entries = book.inspected.entries.map((decision) => decision.active && !selected.has(`${bookIndex}\u0000${decision.index}`) ? {
			...decision,
			active: false,
			reason: "session-budget-excluded"
		} : decision);
		return {
			id: book.id,
			inspected: {
				...activeContent(books[bookIndex].lorebook, entries),
				entries
			}
		};
	});
	return {
		beforeCharacter: resolved.flatMap((book) => book.inspected.beforeCharacter),
		afterCharacter: resolved.flatMap((book) => book.inspected.afterCharacter),
		books: resolved,
		approximateTokens: resolved.flatMap((book) => book.inspected.entries).filter((entry) => entry.active).reduce((sum, entry) => sum + entry.approximateTokens, 0),
		...options.tokenBudget === void 0 ? {} : { tokenBudget: options.tokenBudget }
	};
}
const MAX_MACRO_DEPTH = 100;
function characterName(card) {
	return card === void 0 ? "" : card.nickname?.trim() || card.name;
}
function macroClose(value, open) {
	let depth = 0;
	for (let index = open; index < value.length - 1; index += 1) {
		const pair = value.slice(index, index + 2);
		if (pair === "{{") {
			depth += 1;
			index += 1;
			continue;
		}
		if (pair !== "}}") continue;
		depth -= 1;
		index += 1;
		if (depth === 0) return index + 1;
	}
}
function macroParts(source) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < source.length - 1; index += 1) {
		const pair = source.slice(index, index + 2);
		if (pair === "{{") {
			depth += 1;
			index += 1;
			continue;
		}
		if (pair === "}}") {
			depth = Math.max(0, depth - 1);
			index += 1;
			continue;
		}
		if (pair !== "::" || depth !== 0) continue;
		parts.push(source.slice(start, index));
		start = index + 2;
		index += 1;
	}
	parts.push(source.slice(start));
	return parts;
}
function applyUtcOffset(date, source) {
	const match = /^UTC([+-]\d+)$/iu.exec(source);
	if (match === null) return void 0;
	const offset = Number(match[1]);
	if (!Number.isFinite(offset)) return void 0;
	return new Date(date.getTime() + offset * 36e5);
}
function formatDate(date, format) {
	const pad = (value) => String(value).padStart(2, "0");
	const hours = date.getHours();
	const hour12 = hours % 12 === 0 ? 12 : hours % 12;
	const tokens = {
		YYYY: String(date.getFullYear()),
		YY: String(date.getFullYear()).slice(-2),
		MMMM: date.toLocaleString("en-US", { month: "long" }),
		MMM: date.toLocaleString("en-US", { month: "short" }),
		MM: pad(date.getMonth() + 1),
		M: String(date.getMonth() + 1),
		dddd: date.toLocaleString("en-US", { weekday: "long" }),
		ddd: date.toLocaleString("en-US", { weekday: "short" }),
		DD: pad(date.getDate()),
		D: String(date.getDate()),
		HH: pad(hours),
		H: String(hours),
		hh: pad(hour12),
		h: String(hour12),
		mm: pad(date.getMinutes()),
		m: String(date.getMinutes()),
		ss: pad(date.getSeconds()),
		s: String(date.getSeconds()),
		A: hours < 12 ? "AM" : "PM",
		a: hours < 12 ? "am" : "pm"
	};
	const longestFirst = Object.keys(tokens).sort((left, right) => right.length - left.length);
	const pattern = new RegExp(longestFirst.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
	return format.replace(pattern, (token) => tokens[token] ?? token);
}
function resolveTime(name, parts, env) {
	const now = env.now ?? /* @__PURE__ */ new Date();
	const argument = parts.join("::").trim();
	if (name === "time") return formatDate(applyUtcOffset(now, argument) ?? now, "HH:mm");
	if (name === "date") return formatDate(now, "YYYY-MM-DD");
	if (name === "weekday") return formatDate(now, "dddd");
	if (name === "isotime") return formatDate(now, "HH:mm");
	if (name === "isodate") return formatDate(now, "YYYY-MM-DD");
	if (name === "datetimeformat") {
		if (argument === "") return formatDate(now, "HH:mm");
		const shifted = applyUtcOffset(now, parts[0]?.trim() ?? "");
		if (shifted !== void 0 && parts.length >= 2) return formatDate(shifted, parts.slice(1).join("::"));
		return formatDate(now, argument);
	}
	return "";
}
function rollDice(source) {
	if (/^\d+$/u.test(source)) {
		const sides = Number(source);
		if (!Number.isSafeInteger(sides) || sides < 1) return void 0;
		return String(Math.floor(Math.random() * sides) + 1);
	}
	const expression = /^(\d*)d(\d+)((?:[+-]\d+)*)$/iu.exec(source);
	if (expression === null) return void 0;
	const countText = expression[1] ?? "";
	const count = countText === "" ? 1 : Number(countText);
	const sides = Number(expression[2]);
	if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(sides) || sides < 1) return void 0;
	let total = 0;
	for (let index = 0; index < count; index += 1) total += Math.floor(Math.random() * sides) + 1;
	const modifiers = expression[3] ?? "";
	const modifierPattern = /([+-])(\d+)/gu;
	let modifier;
	while ((modifier = modifierPattern.exec(modifiers)) !== null) {
		const value = Number(modifier[2]);
		total += modifier[1] === "+" ? value : -value;
	}
	return String(total);
}
function hashString(value) {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
function lastMessage(messages) {
	if (messages === void 0 || messages.length === 0) return "";
	return messages[messages.length - 1]?.content ?? "";
}
function lastRoleMessage(messages, role) {
	if (messages === void 0) return "";
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === role) return message.content;
	}
	return "";
}
function resolveText(value, env, state, options, depth) {
	if (depth > MAX_MACRO_DEPTH) return value;
	let result = "";
	let cursor = 0;
	while (cursor < value.length) {
		const open = value.indexOf("{{", cursor);
		if (open < 0) {
			result += value.slice(cursor);
			break;
		}
		result += value.slice(cursor, open);
		const close = macroClose(value, open);
		if (close === void 0) {
			result += value.slice(open);
			break;
		}
		const whole = value.slice(open, close);
		const source = value.slice(open + 2, close - 2);
		result += evaluateMacro(source, whole, open, env, state, options, depth);
		cursor = close;
	}
	return result;
}
function evaluateMacro(source, whole, open, env, state, options, depth) {
	const parts = macroParts(source);
	const name = parts.shift()?.trim().toLowerCase() ?? "";
	const card = env.card;
	if (name === "//" || name.startsWith("// ")) return "";
	if (name === "setvar") {
		const variable = parts.shift()?.trim() ?? "";
		if (variable !== "") state.variables.set(variable, resolveText(parts.join("::"), env, state, options, depth + 1));
		return "";
	}
	if (name === "getvar") return state.variables.get(parts.join("::").trim()) ?? "";
	if (name === "char" || name === "group") return characterName(card);
	if (name === "user") return env.userName || "用户";
	if (name === "persona") return env.persona ?? "";
	if (name === "description") return card?.description ?? "";
	if (name === "personality") return card?.personality ?? "";
	if (name === "scenario") return card?.scenario ?? "";
	if (name === "mesexamples") return card?.messageExample ?? "";
	if (name === "version" || name === "charversion" || name === "char_version") return card === void 0 ? "" : String(card.version);
	if (name === "charprompt") return card?.systemPrompt ?? "";
	if (name === "charinstruction") return card?.postHistoryInstructions ?? "";
	if (name === "original") return env.original ?? "";
	if (name === "input") return env.pendingInput ?? "";
	if (name === "lastmessage") return lastMessage(env.messages);
	if (name === "lastmessageid") return env.messages === void 0 || env.messages.length === 0 ? "" : String(env.messages.length - 1);
	if (name === "lastusermessage") return lastRoleMessage(env.messages, "user");
	if (name === "lastcharmessage") return lastRoleMessage(env.messages, "assistant");
	if (name === "time" || name === "date" || name === "weekday" || name === "isotime" || name === "isodate" || name === "datetimeformat") return resolveTime(name, parts, env);
	if (name === "newline") {
		const argument = parts.join("::").trim();
		const count = argument === "" ? 1 : Number(argument);
		return "\n".repeat(Number.isSafeInteger(count) && count > 0 ? Math.min(count, 100) : 1);
	}
	if (name === "noop") return "";
	if (name === "trim") return "";
	if (name === "random") {
		const choices = parts.map((part) => resolveText(part, env, state, options, depth + 1).trim()).filter((part) => part !== "");
		if (choices.length === 0) return "";
		return choices[Math.floor(Math.random() * choices.length)] ?? "";
	}
	if (name === "roll") return rollDice(parts.join("::").trim()) ?? "";
	if (name === "pick") {
		const choices = parts.map((part) => resolveText(part, env, state, options, depth + 1).trim()).filter((part) => part !== "");
		if (choices.length === 0) return "";
		return choices[hashString(`${whole}|${open}|${source}`) % choices.length] ?? "";
	}
	state.unsupported += 1;
	return options.dropUnknown === true ? "" : whole;
}
/**
* Resolve SillyTavern-style macros in model-visible roleplay text.
* @param text - prose containing optional {{macro}} placeholders.
* @param env - identity, chat, and clock context available to macros.
* @param options - unknown-macro policy for this pass.
* @returns resolved text plus a count of macros left unsupported.
*/
function resolveMacros(text, env = {}, options = {}) {
	const state = {
		variables: env.variables ?? /* @__PURE__ */ new Map(),
		unsupported: 0
	};
	let value = text;
	if (env.card !== void 0) {
		const name = characterName(env.card);
		const userName = env.userName || "用户";
		value = value.replace(/<char>|<bot>/giu, name).replace(/<user>/giu, userName);
	}
	return {
		text: resolveText(value, env, state, options, 0),
		unsupported: state.unsupported
	};
}
var require_identity = /* @__PURE__ */ __commonJSMin(((exports) => {
	const ALIAS = Symbol.for("yaml.alias");
	const DOC = Symbol.for("yaml.document");
	const MAP = Symbol.for("yaml.map");
	const PAIR = Symbol.for("yaml.pair");
	const SCALAR = Symbol.for("yaml.scalar");
	const SEQ = Symbol.for("yaml.seq");
	const NODE_TYPE = Symbol.for("yaml.node.type");
	const isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
	const isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
	const isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
	const isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
	const isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
	const isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
	function isCollection(node) {
		if (node && typeof node === "object") switch (node[NODE_TYPE]) {
			case MAP:
			case SEQ: return true;
		}
		return false;
	}
	function isNode(node) {
		if (node && typeof node === "object") switch (node[NODE_TYPE]) {
			case ALIAS:
			case MAP:
			case SCALAR:
			case SEQ: return true;
		}
		return false;
	}
	const hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
	exports.ALIAS = ALIAS;
	exports.DOC = DOC;
	exports.MAP = MAP;
	exports.NODE_TYPE = NODE_TYPE;
	exports.PAIR = PAIR;
	exports.SCALAR = SCALAR;
	exports.SEQ = SEQ;
	exports.hasAnchor = hasAnchor;
	exports.isAlias = isAlias;
	exports.isCollection = isCollection;
	exports.isDocument = isDocument;
	exports.isMap = isMap;
	exports.isNode = isNode;
	exports.isPair = isPair;
	exports.isScalar = isScalar;
	exports.isSeq = isSeq;
}));
var require_visit = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	const BREAK = Symbol("break visit");
	const SKIP = Symbol("skip children");
	const REMOVE = Symbol("remove node");
	/**
	* Apply a visitor to an AST node or document.
	*
	* Walks through the tree (depth-first) starting from `node`, calling a
	* `visitor` function with three arguments:
	*   - `key`: For sequence values and map `Pair`, the node's index in the
	*     collection. Within a `Pair`, `'key'` or `'value'`, correspondingly.
	*     `null` for the root node.
	*   - `node`: The current node.
	*   - `path`: The ancestry of the current node.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this node, continue with next
	*     sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current node, then continue with the next one
	*   - `Node`: Replace the current node, then continue by visiting it
	*   - `number`: While iterating the items of a sequence or map, set the index
	*     of the next step. This is useful especially if the index of the current
	*     node has changed.
	*
	* If `visitor` is a single function, it will be called with all values
	* encountered in the tree, including e.g. `null` values. Alternatively,
	* separate visitor functions may be defined for each `Map`, `Pair`, `Seq`,
	* `Alias` and `Scalar` node. To define the same visitor function for more than
	* one node type, use the `Collection` (map and seq), `Value` (map, seq & scalar)
	* and `Node` (alias, map, seq & scalar) targets. Of all these, only the most
	* specific defined one will be used for each node.
	*/
	function visit(node, visitor) {
		const visitor_ = initVisitor(visitor);
		if (identity.isDocument(node)) {
			if (visit_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE) node.contents = null;
		} else visit_(null, node, visitor_, Object.freeze([]));
	}
	/** Terminate visit traversal completely */
	visit.BREAK = BREAK;
	/** Do not visit the children of the current node */
	visit.SKIP = SKIP;
	/** Remove the current node */
	visit.REMOVE = REMOVE;
	function visit_(key, node, visitor, path) {
		const ctrl = callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
			replaceNode(key, path, ctrl);
			return visit_(key, ctrl, visitor, path);
		}
		if (typeof ctrl !== "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					const ci = visit_(i, node.items[i], visitor, path);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						node.items.splice(i, 1);
						i -= 1;
					}
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				const ck = visit_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				else if (ck === REMOVE) node.key = null;
				const cv = visit_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				else if (cv === REMOVE) node.value = null;
			}
		}
		return ctrl;
	}
	/**
	* Apply an async visitor to an AST node or document.
	*
	* Walks through the tree (depth-first) starting from `node`, calling a
	* `visitor` function with three arguments:
	*   - `key`: For sequence values and map `Pair`, the node's index in the
	*     collection. Within a `Pair`, `'key'` or `'value'`, correspondingly.
	*     `null` for the root node.
	*   - `node`: The current node.
	*   - `path`: The ancestry of the current node.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `Promise`: Must resolve to one of the following values
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this node, continue with next
	*     sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current node, then continue with the next one
	*   - `Node`: Replace the current node, then continue by visiting it
	*   - `number`: While iterating the items of a sequence or map, set the index
	*     of the next step. This is useful especially if the index of the current
	*     node has changed.
	*
	* If `visitor` is a single function, it will be called with all values
	* encountered in the tree, including e.g. `null` values. Alternatively,
	* separate visitor functions may be defined for each `Map`, `Pair`, `Seq`,
	* `Alias` and `Scalar` node. To define the same visitor function for more than
	* one node type, use the `Collection` (map and seq), `Value` (map, seq & scalar)
	* and `Node` (alias, map, seq & scalar) targets. Of all these, only the most
	* specific defined one will be used for each node.
	*/
	async function visitAsync(node, visitor) {
		const visitor_ = initVisitor(visitor);
		if (identity.isDocument(node)) {
			if (await visitAsync_(null, node.contents, visitor_, Object.freeze([node])) === REMOVE) node.contents = null;
		} else await visitAsync_(null, node, visitor_, Object.freeze([]));
	}
	/** Terminate visit traversal completely */
	visitAsync.BREAK = BREAK;
	/** Do not visit the children of the current node */
	visitAsync.SKIP = SKIP;
	/** Remove the current node */
	visitAsync.REMOVE = REMOVE;
	async function visitAsync_(key, node, visitor, path) {
		const ctrl = await callVisitor(key, node, visitor, path);
		if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
			replaceNode(key, path, ctrl);
			return visitAsync_(key, ctrl, visitor, path);
		}
		if (typeof ctrl !== "symbol") {
			if (identity.isCollection(node)) {
				path = Object.freeze(path.concat(node));
				for (let i = 0; i < node.items.length; ++i) {
					const ci = await visitAsync_(i, node.items[i], visitor, path);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						node.items.splice(i, 1);
						i -= 1;
					}
				}
			} else if (identity.isPair(node)) {
				path = Object.freeze(path.concat(node));
				const ck = await visitAsync_("key", node.key, visitor, path);
				if (ck === BREAK) return BREAK;
				else if (ck === REMOVE) node.key = null;
				const cv = await visitAsync_("value", node.value, visitor, path);
				if (cv === BREAK) return BREAK;
				else if (cv === REMOVE) node.value = null;
			}
		}
		return ctrl;
	}
	function initVisitor(visitor) {
		if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) return Object.assign({
			Alias: visitor.Node,
			Map: visitor.Node,
			Scalar: visitor.Node,
			Seq: visitor.Node
		}, visitor.Value && {
			Map: visitor.Value,
			Scalar: visitor.Value,
			Seq: visitor.Value
		}, visitor.Collection && {
			Map: visitor.Collection,
			Seq: visitor.Collection
		}, visitor);
		return visitor;
	}
	function callVisitor(key, node, visitor, path) {
		if (typeof visitor === "function") return visitor(key, node, path);
		if (identity.isMap(node)) return visitor.Map?.(key, node, path);
		if (identity.isSeq(node)) return visitor.Seq?.(key, node, path);
		if (identity.isPair(node)) return visitor.Pair?.(key, node, path);
		if (identity.isScalar(node)) return visitor.Scalar?.(key, node, path);
		if (identity.isAlias(node)) return visitor.Alias?.(key, node, path);
	}
	function replaceNode(key, path, node) {
		const parent = path[path.length - 1];
		if (identity.isCollection(parent)) parent.items[key] = node;
		else if (identity.isPair(parent)) if (key === "key") parent.key = node;
		else parent.value = node;
		else if (identity.isDocument(parent)) parent.contents = node;
		else {
			const pt = identity.isAlias(parent) ? "alias" : "scalar";
			throw new Error(`Cannot replace node with ${pt} parent`);
		}
	}
	exports.visit = visit;
	exports.visitAsync = visitAsync;
}));
var require_directives = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var visit = require_visit();
	const escapeChars = {
		"!": "%21",
		",": "%2C",
		"[": "%5B",
		"]": "%5D",
		"{": "%7B",
		"}": "%7D"
	};
	const escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
	var Directives = class Directives {
		constructor(yaml, tags) {
			/**
			* The directives-end/doc-start marker `---`. If `null`, a marker may still be
			* included in the document's stringified representation.
			*/
			this.docStart = null;
			/** The doc-end marker `...`.  */
			this.docEnd = false;
			this.yaml = Object.assign({}, Directives.defaultYaml, yaml);
			this.tags = Object.assign({}, Directives.defaultTags, tags);
		}
		clone() {
			const copy = new Directives(this.yaml, this.tags);
			copy.docStart = this.docStart;
			return copy;
		}
		/**
		* During parsing, get a Directives instance for the current document and
		* update the stream state according to the current version's spec.
		*/
		atDocument() {
			const res = new Directives(this.yaml, this.tags);
			switch (this.yaml.version) {
				case "1.1":
					this.atNextDocument = true;
					break;
				case "1.2":
					this.atNextDocument = false;
					this.yaml = {
						explicit: Directives.defaultYaml.explicit,
						version: "1.2"
					};
					this.tags = Object.assign({}, Directives.defaultTags);
					break;
			}
			return res;
		}
		/**
		* @param onError - May be called even if the action was successful
		* @returns `true` on success
		*/
		add(line, onError) {
			if (this.atNextDocument) {
				this.yaml = {
					explicit: Directives.defaultYaml.explicit,
					version: "1.1"
				};
				this.tags = Object.assign({}, Directives.defaultTags);
				this.atNextDocument = false;
			}
			const parts = line.trim().split(/[ \t]+/);
			const name = parts.shift();
			switch (name) {
				case "%TAG": {
					if (parts.length !== 2) {
						onError(0, "%TAG directive should contain exactly two parts");
						if (parts.length < 2) return false;
					}
					const [handle, prefix] = parts;
					this.tags[handle] = prefix;
					return true;
				}
				case "%YAML": {
					this.yaml.explicit = true;
					if (parts.length !== 1) {
						onError(0, "%YAML directive should contain exactly one part");
						return false;
					}
					const [version] = parts;
					if (version === "1.1" || version === "1.2") {
						this.yaml.version = version;
						return true;
					} else {
						const isValid = /^\d+\.\d+$/.test(version);
						onError(6, `Unsupported YAML version ${version}`, isValid);
						return false;
					}
				}
				default:
					onError(0, `Unknown directive ${name}`, true);
					return false;
			}
		}
		/**
		* Resolves a tag, matching handles to those defined in %TAG directives.
		*
		* @returns Resolved tag, which may also be the non-specific tag `'!'` or a
		*   `'!local'` tag, or `null` if unresolvable.
		*/
		tagName(source, onError) {
			if (source === "!") return "!";
			if (source[0] !== "!") {
				onError(`Not a valid tag: ${source}`);
				return null;
			}
			if (source[1] === "<") {
				const verbatim = source.slice(2, -1);
				if (verbatim === "!" || verbatim === "!!") {
					onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
					return null;
				}
				if (source[source.length - 1] !== ">") onError("Verbatim tags must end with a >");
				return verbatim;
			}
			const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
			if (!suffix) onError(`The ${source} tag has no suffix`);
			const prefix = this.tags[handle];
			if (prefix) try {
				return prefix + decodeURIComponent(suffix);
			} catch (error) {
				onError(String(error));
				return null;
			}
			if (handle === "!") return source;
			onError(`Could not resolve tag: ${source}`);
			return null;
		}
		/**
		* Given a fully resolved tag, returns its printable string form,
		* taking into account current tag prefixes and defaults.
		*/
		tagString(tag) {
			for (const [handle, prefix] of Object.entries(this.tags)) if (tag.startsWith(prefix)) return handle + escapeTagName(tag.substring(prefix.length));
			return tag[0] === "!" ? tag : `!<${tag}>`;
		}
		toString(doc) {
			const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
			const tagEntries = Object.entries(this.tags);
			let tagNames;
			if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
				const tags = {};
				visit.visit(doc.contents, (_key, node) => {
					if (identity.isNode(node) && node.tag) tags[node.tag] = true;
				});
				tagNames = Object.keys(tags);
			} else tagNames = [];
			for (const [handle, prefix] of tagEntries) {
				if (handle === "!!" && prefix === "tag:yaml.org,2002:") continue;
				if (!doc || tagNames.some((tn) => tn.startsWith(prefix))) lines.push(`%TAG ${handle} ${prefix}`);
			}
			return lines.join("\n");
		}
	};
	Directives.defaultYaml = {
		explicit: false,
		version: "1.2"
	};
	Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
	exports.Directives = Directives;
}));
var require_anchors = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var visit = require_visit();
	/**
	* Verify that the input string is a valid anchor.
	*
	* Will throw on errors.
	*/
	function anchorIsValid(anchor) {
		if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
			const msg = `Anchor must not contain whitespace or control characters: ${JSON.stringify(anchor)}`;
			throw new Error(msg);
		}
		return true;
	}
	function anchorNames(root) {
		const anchors = /* @__PURE__ */ new Set();
		visit.visit(root, { Value(_key, node) {
			if (node.anchor) anchors.add(node.anchor);
		} });
		return anchors;
	}
	/** Find a new anchor name with the given `prefix` and a one-indexed suffix. */
	function findNewAnchor(prefix, exclude) {
		for (let i = 1;; ++i) {
			const name = `${prefix}${i}`;
			if (!exclude.has(name)) return name;
		}
	}
	function createNodeAnchors(doc, prefix) {
		const aliasObjects = [];
		const sourceObjects = /* @__PURE__ */ new Map();
		let prevAnchors = null;
		return {
			onAnchor: (source) => {
				aliasObjects.push(source);
				prevAnchors ?? (prevAnchors = anchorNames(doc));
				const anchor = findNewAnchor(prefix, prevAnchors);
				prevAnchors.add(anchor);
				return anchor;
			},
			/**
			* With circular references, the source node is only resolved after all
			* of its child nodes are. This is why anchors are set only after all of
			* the nodes have been created.
			*/
			setAnchors: () => {
				for (const source of aliasObjects) {
					const ref = sourceObjects.get(source);
					if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) ref.node.anchor = ref.anchor;
					else {
						const error = /* @__PURE__ */ new Error("Failed to resolve repeated object (this should not happen)");
						error.source = source;
						throw error;
					}
				}
			},
			sourceObjects
		};
	}
	exports.anchorIsValid = anchorIsValid;
	exports.anchorNames = anchorNames;
	exports.createNodeAnchors = createNodeAnchors;
	exports.findNewAnchor = findNewAnchor;
}));
var require_applyReviver = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Applies the JSON.parse reviver algorithm as defined in the ECMA-262 spec,
	* in section 24.5.1.1 "Runtime Semantics: InternalizeJSONProperty" of the
	* 2021 edition: https://tc39.es/ecma262/#sec-json.parse
	*
	* Includes extensions for handling Map and Set objects.
	*/
	function applyReviver(reviver, obj, key, val) {
		if (val && typeof val === "object") if (Array.isArray(val)) for (let i = 0, len = val.length; i < len; ++i) {
			const v0 = val[i];
			const v1 = applyReviver(reviver, val, String(i), v0);
			if (v1 === void 0) delete val[i];
			else if (v1 !== v0) val[i] = v1;
		}
		else if (val instanceof Map) for (const k of Array.from(val.keys())) {
			const v0 = val.get(k);
			const v1 = applyReviver(reviver, val, k, v0);
			if (v1 === void 0) val.delete(k);
			else if (v1 !== v0) val.set(k, v1);
		}
		else if (val instanceof Set) for (const v0 of Array.from(val)) {
			const v1 = applyReviver(reviver, val, v0, v0);
			if (v1 === void 0) val.delete(v0);
			else if (v1 !== v0) {
				val.delete(v0);
				val.add(v1);
			}
		}
		else for (const [k, v0] of Object.entries(val)) {
			const v1 = applyReviver(reviver, val, k, v0);
			if (v1 === void 0) delete val[k];
			else if (v1 !== v0) val[k] = v1;
		}
		return reviver.call(obj, key, val);
	}
	exports.applyReviver = applyReviver;
}));
var require_toJS = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	/**
	* Recursively convert any node or its contents to native JavaScript
	*
	* @param value - The input value
	* @param arg - If `value` defines a `toJSON()` method, use this
	*   as its first argument
	* @param ctx - Conversion context, originally set in Document#toJS(). If
	*   `{ keep: true }` is not set, output should be suitable for JSON
	*   stringification.
	*/
	function toJS(value, arg, ctx) {
		if (Array.isArray(value)) return value.map((v, i) => toJS(v, String(i), ctx));
		if (value && typeof value.toJSON === "function") {
			if (!ctx || !identity.hasAnchor(value)) return value.toJSON(arg, ctx);
			const data = {
				aliasCount: 0,
				count: 1,
				res: void 0
			};
			ctx.anchors.set(value, data);
			ctx.onCreate = (res) => {
				data.res = res;
				delete ctx.onCreate;
			};
			const res = value.toJSON(arg, ctx);
			if (ctx.onCreate) ctx.onCreate(res);
			return res;
		}
		if (typeof value === "bigint" && !ctx?.keep) return Number(value);
		return value;
	}
	exports.toJS = toJS;
}));
var require_Node = /* @__PURE__ */ __commonJSMin(((exports) => {
	var applyReviver = require_applyReviver();
	var identity = require_identity();
	var toJS = require_toJS();
	var NodeBase = class {
		constructor(type) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: type });
		}
		/** Create a copy of this node.  */
		clone() {
			const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/** A plain JavaScript representation of this node. */
		toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			if (!identity.isDocument(doc)) throw new TypeError("A document argument is required");
			const ctx = {
				anchors: /* @__PURE__ */ new Map(),
				doc,
				keep: true,
				mapAsMap: mapAsMap === true,
				mapKeyWarned: false,
				maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
			};
			const res = toJS.toJS(this, "", ctx);
			if (typeof onAnchor === "function") for (const { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
	};
	exports.NodeBase = NodeBase;
}));
var require_Alias = /* @__PURE__ */ __commonJSMin(((exports) => {
	var anchors = require_anchors();
	var visit = require_visit();
	var identity = require_identity();
	var Node = require_Node();
	var toJS = require_toJS();
	var Alias = class extends Node.NodeBase {
		constructor(source) {
			super(identity.ALIAS);
			this.source = source;
			Object.defineProperty(this, "tag", { set() {
				throw new Error("Alias nodes cannot have tags");
			} });
		}
		/**
		* Resolve the value of this alias within `doc`, finding the last
		* instance of the `source` anchor before this node.
		*/
		resolve(doc, ctx) {
			if (ctx?.maxAliasCount === 0) throw new ReferenceError("Alias resolution is disabled");
			let nodes;
			if (ctx?.aliasResolveCache) nodes = ctx.aliasResolveCache;
			else {
				nodes = [];
				visit.visit(doc, { Node: (_key, node) => {
					if (identity.isAlias(node) || identity.hasAnchor(node)) nodes.push(node);
				} });
				if (ctx) ctx.aliasResolveCache = nodes;
			}
			let found = void 0;
			for (const node of nodes) {
				if (node === this) break;
				if (node.anchor === this.source) found = node;
			}
			return found;
		}
		toJSON(_arg, ctx) {
			if (!ctx) return { source: this.source };
			const { anchors, doc, maxAliasCount } = ctx;
			const source = this.resolve(doc, ctx);
			if (!source) {
				const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
				throw new ReferenceError(msg);
			}
			let data = anchors.get(source);
			if (!data) {
				toJS.toJS(source, null, ctx);
				data = anchors.get(source);
			}
			/* istanbul ignore if */
			if (data?.res === void 0) throw new ReferenceError("This should not happen: Alias anchor was not resolved?");
			if (maxAliasCount >= 0) {
				data.count += 1;
				if (data.aliasCount === 0) data.aliasCount = getAliasCount(doc, source, anchors);
				if (data.count * data.aliasCount > maxAliasCount) throw new ReferenceError("Excessive alias count indicates a resource exhaustion attack");
			}
			return data.res;
		}
		toString(ctx, _onComment, _onChompKeep) {
			const src = `*${this.source}`;
			if (ctx) {
				anchors.anchorIsValid(this.source);
				if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
					const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
					throw new Error(msg);
				}
				if (ctx.implicitKey) return `${src} `;
			}
			return src;
		}
	};
	function getAliasCount(doc, node, anchors) {
		if (identity.isAlias(node)) {
			const source = node.resolve(doc);
			const anchor = anchors && source && anchors.get(source);
			return anchor ? anchor.count * anchor.aliasCount : 0;
		} else if (identity.isCollection(node)) {
			let count = 0;
			for (const item of node.items) {
				const c = getAliasCount(doc, item, anchors);
				if (c > count) count = c;
			}
			return count;
		} else if (identity.isPair(node)) {
			const kc = getAliasCount(doc, node.key, anchors);
			const vc = getAliasCount(doc, node.value, anchors);
			return Math.max(kc, vc);
		}
		return 1;
	}
	exports.Alias = Alias;
}));
var require_Scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Node = require_Node();
	var toJS = require_toJS();
	const isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
	var Scalar = class extends Node.NodeBase {
		constructor(value) {
			super(identity.SCALAR);
			this.value = value;
		}
		toJSON(arg, ctx) {
			return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
		}
		toString() {
			return String(this.value);
		}
	};
	Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
	Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
	Scalar.PLAIN = "PLAIN";
	Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
	Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
	exports.Scalar = Scalar;
	exports.isScalarValue = isScalarValue;
}));
var require_createNode = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var identity = require_identity();
	var Scalar = require_Scalar();
	const defaultTagPrefix = "tag:yaml.org,2002:";
	function findTagObject(value, tagName, tags) {
		if (tagName) {
			const match = tags.filter((t) => t.tag === tagName);
			const tagObj = match.find((t) => !t.format) ?? match[0];
			if (!tagObj) throw new Error(`Tag ${tagName} not found`);
			return tagObj;
		}
		return tags.find((t) => t.identify?.(value) && !t.format);
	}
	function createNode(value, tagName, ctx) {
		if (identity.isDocument(value)) value = value.contents;
		if (identity.isNode(value)) return value;
		if (identity.isPair(value)) {
			const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
			map.items.push(value);
			return map;
		}
		if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) value = value.valueOf();
		const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
		let ref = void 0;
		if (aliasDuplicateObjects && value && typeof value === "object") {
			ref = sourceObjects.get(value);
			if (ref) {
				ref.anchor ?? (ref.anchor = onAnchor(value));
				return new Alias.Alias(ref.anchor);
			} else {
				ref = {
					anchor: null,
					node: null
				};
				sourceObjects.set(value, ref);
			}
		}
		if (tagName?.startsWith("!!")) tagName = defaultTagPrefix + tagName.slice(2);
		let tagObj = findTagObject(value, tagName, schema.tags);
		if (!tagObj) {
			if (value && typeof value.toJSON === "function") value = value.toJSON();
			if (!value || typeof value !== "object") {
				const node = new Scalar.Scalar(value);
				if (ref) ref.node = node;
				return node;
			}
			tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
		}
		if (onTagObj) {
			onTagObj(tagObj);
			delete ctx.onTagObj;
		}
		const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
		if (tagName) node.tag = tagName;
		else if (!tagObj.default) node.tag = tagObj.tag;
		if (ref) ref.node = node;
		return node;
	}
	exports.createNode = createNode;
}));
var require_Collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var identity = require_identity();
	var Node = require_Node();
	function collectionFromPath(schema, path, value) {
		let v = value;
		for (let i = path.length - 1; i >= 0; --i) {
			const k = path[i];
			if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
				const a = [];
				a[k] = v;
				v = a;
			} else v = /* @__PURE__ */ new Map([[k, v]]);
		}
		return createNode.createNode(v, void 0, {
			aliasDuplicateObjects: false,
			keepUndefined: false,
			onAnchor: () => {
				throw new Error("This should not happen, please report a bug.");
			},
			schema,
			sourceObjects: /* @__PURE__ */ new Map()
		});
	}
	const isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
	var Collection = class extends Node.NodeBase {
		constructor(type, schema) {
			super(type);
			Object.defineProperty(this, "schema", {
				value: schema,
				configurable: true,
				enumerable: false,
				writable: true
			});
		}
		/**
		* Create a copy of this collection.
		*
		* @param schema - If defined, overwrites the original's schema
		*/
		clone(schema) {
			const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
			if (schema) copy.schema = schema;
			copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/**
		* Adds a value to the collection. For `!!map` and `!!omap` the value must
		* be a Pair instance or a `{ key, value }` object, which may not have a key
		* that already exists in the map.
		*/
		addIn(path, value) {
			if (isEmptyPath(path)) this.add(value);
			else {
				const [key, ...rest] = path;
				const node = this.get(key, true);
				if (identity.isCollection(node)) node.addIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
		/**
		* Removes a value from the collection.
		* @returns `true` if the item was found and removed.
		*/
		deleteIn(path) {
			const [key, ...rest] = path;
			if (rest.length === 0) return this.delete(key);
			const node = this.get(key, true);
			if (identity.isCollection(node)) return node.deleteIn(rest);
			else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
		}
		/**
		* Returns item at `key`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		getIn(path, keepScalar) {
			const [key, ...rest] = path;
			const node = this.get(key, true);
			if (rest.length === 0) return !keepScalar && identity.isScalar(node) ? node.value : node;
			else return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
		}
		hasAllNullValues(allowScalar) {
			return this.items.every((node) => {
				if (!identity.isPair(node)) return false;
				const n = node.value;
				return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
			});
		}
		/**
		* Checks if the collection includes a value with the key `key`.
		*/
		hasIn(path) {
			const [key, ...rest] = path;
			if (rest.length === 0) return this.has(key);
			const node = this.get(key, true);
			return identity.isCollection(node) ? node.hasIn(rest) : false;
		}
		/**
		* Sets a value in this collection. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		setIn(path, value) {
			const [key, ...rest] = path;
			if (rest.length === 0) this.set(key, value);
			else {
				const node = this.get(key, true);
				if (identity.isCollection(node)) node.setIn(rest, value);
				else if (node === void 0 && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));
				else throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
			}
		}
	};
	exports.Collection = Collection;
	exports.collectionFromPath = collectionFromPath;
	exports.isEmptyPath = isEmptyPath;
}));
var require_stringifyComment = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Stringifies a comment.
	*
	* Empty comment lines are left empty,
	* lines consisting of a single space are replaced by `#`,
	* and all other lines are prefixed with a `#`.
	*/
	const stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
	function indentComment(comment, indent) {
		if (/^\n+$/.test(comment)) return comment.substring(1);
		return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
	}
	const lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
	exports.indentComment = indentComment;
	exports.lineComment = lineComment;
	exports.stringifyComment = stringifyComment;
}));
var require_foldFlowLines = /* @__PURE__ */ __commonJSMin(((exports) => {
	const FOLD_FLOW = "flow";
	const FOLD_BLOCK = "block";
	const FOLD_QUOTED = "quoted";
	/**
	* Tries to keep input at up to `lineWidth` characters, splitting only on spaces
	* not followed by newlines or spaces unless `mode` is `'quoted'`. Lines are
	* terminated with `\n` and started with `indent`.
	*/
	function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
		if (!lineWidth || lineWidth < 0) return text;
		if (lineWidth < minContentWidth) minContentWidth = 0;
		const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
		if (text.length <= endStep) return text;
		const folds = [];
		const escapedFolds = {};
		let end = lineWidth - indent.length;
		if (typeof indentAtStart === "number") if (indentAtStart > lineWidth - Math.max(2, minContentWidth)) folds.push(0);
		else end = lineWidth - indentAtStart;
		let split = void 0;
		let prev = void 0;
		let overflow = false;
		let i = -1;
		let escStart = -1;
		let escEnd = -1;
		if (mode === FOLD_BLOCK) {
			i = consumeMoreIndentedLines(text, i, indent.length);
			if (i !== -1) end = i + endStep;
		}
		for (let ch; ch = text[i += 1];) {
			if (mode === FOLD_QUOTED && ch === "\\") {
				escStart = i;
				switch (text[i + 1]) {
					case "x":
						i += 3;
						break;
					case "u":
						i += 5;
						break;
					case "U":
						i += 9;
						break;
					default: i += 1;
				}
				escEnd = i;
			}
			if (ch === "\n") {
				if (mode === FOLD_BLOCK) i = consumeMoreIndentedLines(text, i, indent.length);
				end = i + indent.length + endStep;
				split = void 0;
			} else {
				if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
					const next = text[i + 1];
					if (next && next !== " " && next !== "\n" && next !== "	") split = i;
				}
				if (i >= end) if (split) {
					folds.push(split);
					end = split + endStep;
					split = void 0;
				} else if (mode === FOLD_QUOTED) {
					while (prev === " " || prev === "	") {
						prev = ch;
						ch = text[i += 1];
						overflow = true;
					}
					const j = i > escEnd + 1 ? i - 2 : escStart - 1;
					if (escapedFolds[j]) return text;
					folds.push(j);
					escapedFolds[j] = true;
					end = j + endStep;
					split = void 0;
				} else overflow = true;
			}
			prev = ch;
		}
		if (overflow && onOverflow) onOverflow();
		if (folds.length === 0) return text;
		if (onFold) onFold();
		let res = text.slice(0, folds[0]);
		for (let i = 0; i < folds.length; ++i) {
			const fold = folds[i];
			const end = folds[i + 1] || text.length;
			if (fold === 0) res = `\n${indent}${text.slice(0, end)}`;
			else {
				if (mode === FOLD_QUOTED && escapedFolds[fold]) res += `${text[fold]}\\`;
				res += `\n${indent}${text.slice(fold + 1, end)}`;
			}
		}
		return res;
	}
	/**
	* Presumes `i + 1` is at the start of a line
	* @returns index of last newline in more-indented block
	*/
	function consumeMoreIndentedLines(text, i, indent) {
		let end = i;
		let start = i + 1;
		let ch = text[start];
		while (ch === " " || ch === "	") if (i < start + indent) ch = text[++i];
		else {
			do
				ch = text[++i];
			while (ch && ch !== "\n");
			end = i;
			start = i + 1;
			ch = text[start];
		}
		return end;
	}
	exports.FOLD_BLOCK = FOLD_BLOCK;
	exports.FOLD_FLOW = FOLD_FLOW;
	exports.FOLD_QUOTED = FOLD_QUOTED;
	exports.foldFlowLines = foldFlowLines;
}));
var require_stringifyString = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var foldFlowLines = require_foldFlowLines();
	const getFoldOptions = (ctx, isBlock) => ({
		indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
		lineWidth: ctx.options.lineWidth,
		minContentWidth: ctx.options.minContentWidth
	});
	const containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
	function lineLengthOverLimit(str, lineWidth, indentLength) {
		if (!lineWidth || lineWidth < 0) return false;
		const limit = lineWidth - indentLength;
		const strLen = str.length;
		if (strLen <= limit) return false;
		for (let i = 0, start = 0; i < strLen; ++i) if (str[i] === "\n") {
			if (i - start > limit) return true;
			start = i + 1;
			if (strLen - start <= limit) return false;
		}
		return true;
	}
	function doubleQuotedString(value, ctx) {
		const json = JSON.stringify(value);
		if (ctx.options.doubleQuotedAsJSON) return json;
		const { implicitKey } = ctx;
		const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
		const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
		let str = "";
		let start = 0;
		for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
			if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
				str += json.slice(start, i) + "\\ ";
				i += 1;
				start = i;
				ch = "\\";
			}
			if (ch === "\\") switch (json[i + 1]) {
				case "u":
					{
						str += json.slice(start, i);
						const code = json.substr(i + 2, 4);
						switch (code) {
							case "0000":
								str += "\\0";
								break;
							case "0007":
								str += "\\a";
								break;
							case "000b":
								str += "\\v";
								break;
							case "001b":
								str += "\\e";
								break;
							case "0085":
								str += "\\N";
								break;
							case "00a0":
								str += "\\_";
								break;
							case "2028":
								str += "\\L";
								break;
							case "2029":
								str += "\\P";
								break;
							default: if (code.substr(0, 2) === "00") str += "\\x" + code.substr(2);
							else str += json.substr(i, 6);
						}
						i += 5;
						start = i + 1;
					}
					break;
				case "n":
					if (implicitKey || json[i + 2] === "\"" || json.length < minMultiLineLength) i += 1;
					else {
						str += json.slice(start, i) + "\n\n";
						while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== "\"") {
							str += "\n";
							i += 2;
						}
						str += indent;
						if (json[i + 2] === " ") str += "\\";
						i += 1;
						start = i + 1;
					}
					break;
				default: i += 1;
			}
		}
		str = start ? str + json.slice(start) : json;
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
	}
	function singleQuotedString(value, ctx) {
		if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value)) return doubleQuotedString(value, ctx);
		const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
		const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&\n${indent}`) + "'";
		return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
	}
	function quotedString(value, ctx) {
		const { singleQuote } = ctx.options;
		let qs;
		if (singleQuote === false) qs = doubleQuotedString;
		else {
			const hasDouble = value.includes("\"");
			const hasSingle = value.includes("'");
			if (hasDouble && !hasSingle) qs = singleQuotedString;
			else if (hasSingle && !hasDouble) qs = doubleQuotedString;
			else qs = singleQuote ? singleQuotedString : doubleQuotedString;
		}
		return qs(value, ctx);
	}
	let blockEndNewlines;
	try {
		blockEndNewlines = /* @__PURE__ */ new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
	} catch {
		blockEndNewlines = /\n+(?!\n|$)/g;
	}
	function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
		const { blockQuote, commentString, lineWidth } = ctx.options;
		if (!blockQuote || /\n[\t ]+$/.test(value)) return quotedString(value, ctx);
		const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
		const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
		if (!value) return literal ? "|\n" : ">\n";
		let chomp;
		let endStart;
		for (endStart = value.length; endStart > 0; --endStart) {
			const ch = value[endStart - 1];
			if (ch !== "\n" && ch !== "	" && ch !== " ") break;
		}
		let end = value.substring(endStart);
		const endNlPos = end.indexOf("\n");
		if (endNlPos === -1) chomp = "-";
		else if (value === end || endNlPos !== end.length - 1) {
			chomp = "+";
			if (onChompKeep) onChompKeep();
		} else chomp = "";
		if (end) {
			value = value.slice(0, -end.length);
			if (end[end.length - 1] === "\n") end = end.slice(0, -1);
			end = end.replace(blockEndNewlines, `$&${indent}`);
		}
		let startWithSpace = false;
		let startEnd;
		let startNlPos = -1;
		for (startEnd = 0; startEnd < value.length; ++startEnd) {
			const ch = value[startEnd];
			if (ch === " ") startWithSpace = true;
			else if (ch === "\n") startNlPos = startEnd;
			else break;
		}
		let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
		if (start) {
			value = value.substring(start.length);
			start = start.replace(/\n+/g, `$&${indent}`);
		}
		let header = (startWithSpace ? indent ? "2" : "1" : "") + chomp;
		if (comment) {
			header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
			if (onComment) onComment();
		}
		if (!literal) {
			const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
			let literalFallback = false;
			const foldOptions = getFoldOptions(ctx, true);
			if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) foldOptions.onOverflow = () => {
				literalFallback = true;
			};
			const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
			if (!literalFallback) return `>${header}\n${indent}${body}`;
		}
		value = value.replace(/\n+/g, `$&${indent}`);
		return `|${header}\n${indent}${start}${value}${end}`;
	}
	function plainString(item, ctx, onComment, onChompKeep) {
		const { type, value } = item;
		const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
		if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) return quotedString(value, ctx);
		if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
		if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) return blockString(item, ctx, onComment, onChompKeep);
		if (containsDocumentMarker(value)) {
			if (indent === "") {
				ctx.forceBlockIndent = true;
				return blockString(item, ctx, onComment, onChompKeep);
			} else if (implicitKey && indent === indentStep) return quotedString(value, ctx);
		}
		const str = value.replace(/\n+/g, `$&\n${indent}`);
		if (actualString) {
			const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
			const { compat, tags } = ctx.doc.schema;
			if (tags.some(test) || compat?.some(test)) return quotedString(value, ctx);
		}
		return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
	}
	function stringifyString(item, ctx, onComment, onChompKeep) {
		const { implicitKey, inFlow } = ctx;
		const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
		let { type } = item;
		if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
			if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value)) type = Scalar.Scalar.QUOTE_DOUBLE;
		}
		const _stringify = (_type) => {
			switch (_type) {
				case Scalar.Scalar.BLOCK_FOLDED:
				case Scalar.Scalar.BLOCK_LITERAL: return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
				case Scalar.Scalar.QUOTE_DOUBLE: return doubleQuotedString(ss.value, ctx);
				case Scalar.Scalar.QUOTE_SINGLE: return singleQuotedString(ss.value, ctx);
				case Scalar.Scalar.PLAIN: return plainString(ss, ctx, onComment, onChompKeep);
				default: return null;
			}
		};
		let res = _stringify(type);
		if (res === null) {
			const { defaultKeyType, defaultStringType } = ctx.options;
			const t = implicitKey && defaultKeyType || defaultStringType;
			res = _stringify(t);
			if (res === null) throw new Error(`Unsupported default string type ${t}`);
		}
		return res;
	}
	exports.stringifyString = stringifyString;
}));
var require_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
	var anchors = require_anchors();
	var identity = require_identity();
	var stringifyComment = require_stringifyComment();
	var stringifyString = require_stringifyString();
	function createStringifyContext(doc, options) {
		const opt = Object.assign({
			blockQuote: true,
			commentString: stringifyComment.stringifyComment,
			defaultKeyType: null,
			defaultStringType: "PLAIN",
			directives: null,
			doubleQuotedAsJSON: false,
			doubleQuotedMinMultiLineLength: 40,
			falseStr: "false",
			flowCollectionPadding: true,
			indentSeq: true,
			lineWidth: 80,
			minContentWidth: 20,
			nullStr: "null",
			simpleKeys: false,
			singleQuote: null,
			trailingComma: false,
			trueStr: "true",
			verifyAliasOrder: true
		}, doc.schema.toStringOptions, options);
		let inFlow;
		switch (opt.collectionStyle) {
			case "block":
				inFlow = false;
				break;
			case "flow":
				inFlow = true;
				break;
			default: inFlow = null;
		}
		return {
			anchors: /* @__PURE__ */ new Set(),
			doc,
			flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
			indent: "",
			indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
			inFlow,
			options: opt
		};
	}
	function getTagObject(tags, item) {
		if (item.tag) {
			const match = tags.filter((t) => t.tag === item.tag);
			if (match.length > 0) return match.find((t) => t.format === item.format) ?? match[0];
		}
		let tagObj = void 0;
		let obj;
		if (identity.isScalar(item)) {
			obj = item.value;
			let match = tags.filter((t) => t.identify?.(obj));
			if (match.length > 1) {
				const testMatch = match.filter((t) => t.test);
				if (testMatch.length > 0) match = testMatch;
			}
			tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
		} else {
			obj = item;
			tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
		}
		if (!tagObj) {
			const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
			throw new Error(`Tag not resolved for ${name} value`);
		}
		return tagObj;
	}
	function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
		if (!doc.directives) return "";
		const props = [];
		const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
		if (anchor && anchors.anchorIsValid(anchor)) {
			anchors$1.add(anchor);
			props.push(`&${anchor}`);
		}
		const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
		if (tag) props.push(doc.directives.tagString(tag));
		return props.join(" ");
	}
	function stringify(item, ctx, onComment, onChompKeep) {
		if (identity.isPair(item)) return item.toString(ctx, onComment, onChompKeep);
		if (identity.isAlias(item)) {
			if (ctx.doc.directives) return item.toString(ctx);
			if (ctx.resolvedAliases?.has(item)) throw new TypeError(`Cannot stringify circular structure without alias nodes`);
			else {
				if (ctx.resolvedAliases) ctx.resolvedAliases.add(item);
				else ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
				item = item.resolve(ctx.doc);
			}
		}
		let tagObj = void 0;
		const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
		tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
		const props = stringifyProps(node, tagObj, ctx);
		if (props.length > 0) ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
		const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
		if (!props) return str;
		return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}\n${ctx.indent}${str}`;
	}
	exports.createStringifyContext = createStringifyContext;
	exports.stringify = stringify;
}));
var require_stringifyPair = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
		const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
		let keyComment = identity.isNode(key) && key.comment || null;
		if (simpleKeys) {
			if (keyComment) throw new Error("With simple keys, key nodes cannot have comments");
			if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") throw new Error("With simple keys, collection cannot be used as a key value");
		}
		let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
		ctx = Object.assign({}, ctx, {
			allNullValues: false,
			implicitKey: !explicitKey && (simpleKeys || !allNullValues),
			indent: indent + indentStep
		});
		let keyCommentDone = false;
		let chompKeep = false;
		let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
		if (!explicitKey && !ctx.inFlow && str.length > 1024) {
			if (simpleKeys) throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
			explicitKey = true;
		}
		if (ctx.inFlow) {
			if (allNullValues || value == null) {
				if (keyCommentDone && onComment) onComment();
				return str === "" ? "?" : explicitKey ? `? ${str}` : str;
			}
		} else if (allNullValues && !simpleKeys || value == null && explicitKey) {
			str = `? ${str}`;
			if (keyComment && !keyCommentDone) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
			else if (chompKeep && onChompKeep) onChompKeep();
			return str;
		}
		if (keyCommentDone) keyComment = null;
		if (explicitKey) {
			if (keyComment) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
			str = `? ${str}\n${indent}:`;
		} else {
			str = `${str}:`;
			if (keyComment) str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
		}
		let vsb, vcb, valueComment;
		if (identity.isNode(value)) {
			vsb = !!value.spaceBefore;
			vcb = value.commentBefore;
			valueComment = value.comment;
		} else {
			vsb = false;
			vcb = null;
			valueComment = null;
			if (value && typeof value === "object") value = doc.createNode(value);
		}
		ctx.implicitKey = false;
		if (!explicitKey && !keyComment && identity.isScalar(value)) ctx.indentAtStart = str.length + 1;
		chompKeep = false;
		if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) ctx.indent = ctx.indent.substring(2);
		let valueCommentDone = false;
		const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
		let ws = " ";
		if (keyComment || vsb || vcb) {
			ws = vsb ? "\n" : "";
			if (vcb) {
				const cs = commentString(vcb);
				ws += `\n${stringifyComment.indentComment(cs, ctx.indent)}`;
			}
			if (valueStr === "" && !ctx.inFlow) {
				if (ws === "\n" && valueComment) ws = "\n\n";
			} else ws += `\n${ctx.indent}`;
		} else if (!explicitKey && identity.isCollection(value)) {
			const vs0 = valueStr[0];
			const nl0 = valueStr.indexOf("\n");
			const hasNewline = nl0 !== -1;
			const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
			if (hasNewline || !flow) {
				let hasPropsLine = false;
				if (hasNewline && (vs0 === "&" || vs0 === "!")) {
					let sp0 = valueStr.indexOf(" ");
					if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") sp0 = valueStr.indexOf(" ", sp0 + 1);
					if (sp0 === -1 || nl0 < sp0) hasPropsLine = true;
				}
				if (!hasPropsLine) ws = `\n${ctx.indent}`;
			}
		} else if (valueStr === "" || valueStr[0] === "\n") ws = "";
		str += ws + valueStr;
		if (ctx.inFlow) {
			if (valueCommentDone && onComment) onComment();
		} else if (valueComment && !valueCommentDone) str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
		else if (chompKeep && onChompKeep) onChompKeep();
		return str;
	}
	exports.stringifyPair = stringifyPair;
}));
var require_log = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process$2 = __require("process");
	function debug(logLevel, ...messages) {
		if (logLevel === "debug") console.log(...messages);
	}
	function warn(logLevel, warning) {
		if (logLevel === "debug" || logLevel === "warn") if (typeof node_process$2.emitWarning === "function") node_process$2.emitWarning(warning);
		else console.warn(warning);
	}
	exports.debug = debug;
	exports.warn = warn;
}));
var require_merge = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	const MERGE_KEY = "<<";
	const merge = {
		identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
		default: "key",
		tag: "tag:yaml.org,2002:merge",
		test: /^<<$/,
		resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), { addToJSMap: addMergeToJSMap }),
		stringify: () => MERGE_KEY
	};
	const isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
	function addMergeToJSMap(ctx, map, value) {
		const source = resolveAliasValue(ctx, value);
		if (identity.isSeq(source)) for (const it of source.items) mergeValue(ctx, map, it);
		else if (Array.isArray(source)) for (const it of source) mergeValue(ctx, map, it);
		else mergeValue(ctx, map, source);
	}
	function mergeValue(ctx, map, value) {
		const source = resolveAliasValue(ctx, value);
		if (!identity.isMap(source)) throw new Error("Merge sources must be maps or map aliases");
		const srcMap = source.toJSON(null, ctx, Map);
		for (const [key, value] of srcMap) if (map instanceof Map) {
			if (!map.has(key)) map.set(key, value);
		} else if (map instanceof Set) map.add(key);
		else if (!Object.prototype.hasOwnProperty.call(map, key)) Object.defineProperty(map, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
		return map;
	}
	function resolveAliasValue(ctx, value) {
		return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
	}
	exports.addMergeToJSMap = addMergeToJSMap;
	exports.isMergeKey = isMergeKey;
	exports.merge = merge;
}));
var require_addPairToJSMap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var log = require_log();
	var merge = require_merge();
	var stringify = require_stringify();
	var identity = require_identity();
	var toJS = require_toJS();
	function addPairToJSMap(ctx, map, { key, value }) {
		if (identity.isNode(key) && key.addToJSMap) key.addToJSMap(ctx, map, value);
		else if (merge.isMergeKey(ctx, key)) merge.addMergeToJSMap(ctx, map, value);
		else {
			const jsKey = toJS.toJS(key, "", ctx);
			if (map instanceof Map) map.set(jsKey, toJS.toJS(value, jsKey, ctx));
			else if (map instanceof Set) map.add(jsKey);
			else {
				const stringKey = stringifyKey(key, jsKey, ctx);
				const jsValue = toJS.toJS(value, stringKey, ctx);
				if (stringKey in map) Object.defineProperty(map, stringKey, {
					value: jsValue,
					writable: true,
					enumerable: true,
					configurable: true
				});
				else map[stringKey] = jsValue;
			}
		}
		return map;
	}
	function stringifyKey(key, jsKey, ctx) {
		if (jsKey === null) return "";
		if (typeof jsKey !== "object") return String(jsKey);
		if (identity.isNode(key) && ctx?.doc) {
			const strCtx = stringify.createStringifyContext(ctx.doc, {});
			strCtx.anchors = /* @__PURE__ */ new Set();
			for (const node of ctx.anchors.keys()) strCtx.anchors.add(node.anchor);
			strCtx.inFlow = true;
			strCtx.inStringifyKey = true;
			const strKey = key.toString(strCtx);
			if (!ctx.mapKeyWarned) {
				let jsonStr = JSON.stringify(strKey);
				if (jsonStr.length > 40) jsonStr = jsonStr.substring(0, 36) + "...\"";
				log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
				ctx.mapKeyWarned = true;
			}
			return strKey;
		}
		return JSON.stringify(jsKey);
	}
	exports.addPairToJSMap = addPairToJSMap;
}));
var require_Pair = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var stringifyPair = require_stringifyPair();
	var addPairToJSMap = require_addPairToJSMap();
	var identity = require_identity();
	function createPair(key, value, ctx) {
		return new Pair(createNode.createNode(key, void 0, ctx), createNode.createNode(value, void 0, ctx));
	}
	var Pair = class Pair {
		constructor(key, value = null) {
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
			this.key = key;
			this.value = value;
		}
		clone(schema) {
			let { key, value } = this;
			if (identity.isNode(key)) key = key.clone(schema);
			if (identity.isNode(value)) value = value.clone(schema);
			return new Pair(key, value);
		}
		toJSON(_, ctx) {
			const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
			return addPairToJSMap.addPairToJSMap(ctx, pair, this);
		}
		toString(ctx, onComment, onChompKeep) {
			return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
		}
	};
	exports.Pair = Pair;
	exports.createPair = createPair;
}));
var require_stringifyCollection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyCollection(collection, ctx, options) {
		return (ctx.inFlow ?? collection.flow ? stringifyFlowCollection : stringifyBlockCollection)(collection, ctx, options);
	}
	function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
		const { indent, options: { commentString } } = ctx;
		const itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			type: null
		});
		let chompKeep = false;
		const lines = [];
		for (let i = 0; i < items.length; ++i) {
			const item = items[i];
			let comment = null;
			if (identity.isNode(item)) {
				if (!chompKeep && item.spaceBefore) lines.push("");
				addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
				if (item.comment) comment = item.comment;
			} else if (identity.isPair(item)) {
				const ik = identity.isNode(item.key) ? item.key : null;
				if (ik) {
					if (!chompKeep && ik.spaceBefore) lines.push("");
					addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
				}
			}
			chompKeep = false;
			let str = stringify.stringify(item, itemCtx, () => comment = null, () => chompKeep = true);
			if (comment) str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
			if (chompKeep && comment) chompKeep = false;
			lines.push(blockItemPrefix + str);
		}
		let str;
		if (lines.length === 0) str = flowChars.start + flowChars.end;
		else {
			str = lines[0];
			for (let i = 1; i < lines.length; ++i) {
				const line = lines[i];
				str += line ? `\n${indent}${line}` : "\n";
			}
		}
		if (comment) {
			str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
			if (onComment) onComment();
		} else if (chompKeep && onChompKeep) onChompKeep();
		return str;
	}
	function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
		const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
		itemIndent += indentStep;
		const itemCtx = Object.assign({}, ctx, {
			indent: itemIndent,
			inFlow: true,
			type: null
		});
		let reqNewline = false;
		let linesAtValue = 0;
		const lines = [];
		for (let i = 0; i < items.length; ++i) {
			const item = items[i];
			let comment = null;
			if (identity.isNode(item)) {
				if (item.spaceBefore) lines.push("");
				addCommentBefore(ctx, lines, item.commentBefore, false);
				if (item.comment) comment = item.comment;
			} else if (identity.isPair(item)) {
				const ik = identity.isNode(item.key) ? item.key : null;
				if (ik) {
					if (ik.spaceBefore) lines.push("");
					addCommentBefore(ctx, lines, ik.commentBefore, false);
					if (ik.comment) reqNewline = true;
				}
				const iv = identity.isNode(item.value) ? item.value : null;
				if (iv) {
					if (iv.comment) comment = iv.comment;
					if (iv.commentBefore) reqNewline = true;
				} else if (item.value == null && ik?.comment) comment = ik.comment;
			}
			if (comment) reqNewline = true;
			let str = stringify.stringify(item, itemCtx, () => comment = null);
			reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
			if (i < items.length - 1) str += ",";
			else if (ctx.options.trailingComma) {
				if (ctx.options.lineWidth > 0) reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
				if (reqNewline) str += ",";
			}
			if (comment) str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
			lines.push(str);
			linesAtValue = lines.length;
		}
		const { start, end } = flowChars;
		if (lines.length === 0) return start + end;
		else {
			if (!reqNewline) {
				const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
				reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
			}
			if (reqNewline) {
				let str = start;
				for (const line of lines) str += line ? `\n${indentStep}${indent}${line}` : "\n";
				return `${str}\n${indent}${end}`;
			} else return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
		}
	}
	function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
		if (comment && chompKeep) comment = comment.replace(/^\n+/, "");
		if (comment) {
			const ic = stringifyComment.indentComment(commentString(comment), indent);
			lines.push(ic.trimStart());
		}
	}
	exports.stringifyCollection = stringifyCollection;
}));
var require_YAMLMap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyCollection = require_stringifyCollection();
	var addPairToJSMap = require_addPairToJSMap();
	var Collection = require_Collection();
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	function findPair(items, key) {
		const k = identity.isScalar(key) ? key.value : key;
		for (const it of items) if (identity.isPair(it)) {
			if (it.key === key || it.key === k) return it;
			if (identity.isScalar(it.key) && it.key.value === k) return it;
		}
	}
	var YAMLMap = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:map";
		}
		constructor(schema) {
			super(identity.MAP, schema);
			this.items = [];
		}
		/**
		* A generic collection parsing method that can be extended
		* to other node classes that inherit from YAMLMap
		*/
		static from(schema, obj, ctx) {
			const { keepUndefined, replacer } = ctx;
			const map = new this(schema);
			const add = (key, value) => {
				if (typeof replacer === "function") value = replacer.call(obj, key, value);
				else if (Array.isArray(replacer) && !replacer.includes(key)) return;
				if (value !== void 0 || keepUndefined) map.items.push(Pair.createPair(key, value, ctx));
			};
			if (obj instanceof Map) for (const [key, value] of obj) add(key, value);
			else if (obj && typeof obj === "object") for (const key of Object.keys(obj)) add(key, obj[key]);
			if (typeof schema.sortMapEntries === "function") map.items.sort(schema.sortMapEntries);
			return map;
		}
		/**
		* Adds a value to the collection.
		*
		* @param overwrite - If not set `true`, using a key that is already in the
		*   collection will throw. Otherwise, overwrites the previous value.
		*/
		add(pair, overwrite) {
			let _pair;
			if (identity.isPair(pair)) _pair = pair;
			else if (!pair || typeof pair !== "object" || !("key" in pair)) _pair = new Pair.Pair(pair, pair?.value);
			else _pair = new Pair.Pair(pair.key, pair.value);
			const prev = findPair(this.items, _pair.key);
			const sortEntries = this.schema?.sortMapEntries;
			if (prev) {
				if (!overwrite) throw new Error(`Key ${_pair.key} already set`);
				if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value)) prev.value.value = _pair.value;
				else prev.value = _pair.value;
			} else if (sortEntries) {
				const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
				if (i === -1) this.items.push(_pair);
				else this.items.splice(i, 0, _pair);
			} else this.items.push(_pair);
		}
		delete(key) {
			const it = findPair(this.items, key);
			if (!it) return false;
			return this.items.splice(this.items.indexOf(it), 1).length > 0;
		}
		get(key, keepScalar) {
			const node = findPair(this.items, key)?.value;
			return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
		}
		has(key) {
			return !!findPair(this.items, key);
		}
		set(key, value) {
			this.add(new Pair.Pair(key, value), true);
		}
		/**
		* @param ctx - Conversion context, originally set in Document#toJS()
		* @param {Class} Type - If set, forces the returned collection type
		* @returns Instance of Type, Map, or Object
		*/
		toJSON(_, ctx, Type) {
			const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
			if (ctx?.onCreate) ctx.onCreate(map);
			for (const item of this.items) addPairToJSMap.addPairToJSMap(ctx, map, item);
			return map;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			for (const item of this.items) if (!identity.isPair(item)) throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
			if (!ctx.allNullValues && this.hasAllNullValues(false)) ctx = Object.assign({}, ctx, { allNullValues: true });
			return stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "",
				flowChars: {
					start: "{",
					end: "}"
				},
				itemIndent: ctx.indent || "",
				onChompKeep,
				onComment
			});
		}
	};
	exports.YAMLMap = YAMLMap;
	exports.findPair = findPair;
}));
var require_map = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var YAMLMap = require_YAMLMap();
	exports.map = {
		collection: "map",
		default: true,
		nodeClass: YAMLMap.YAMLMap,
		tag: "tag:yaml.org,2002:map",
		resolve(map, onError) {
			if (!identity.isMap(map)) onError("Expected a mapping for this tag");
			return map;
		},
		createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
	};
}));
var require_YAMLSeq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var createNode = require_createNode();
	var stringifyCollection = require_stringifyCollection();
	var Collection = require_Collection();
	var identity = require_identity();
	var Scalar = require_Scalar();
	var toJS = require_toJS();
	var YAMLSeq = class extends Collection.Collection {
		static get tagName() {
			return "tag:yaml.org,2002:seq";
		}
		constructor(schema) {
			super(identity.SEQ, schema);
			this.items = [];
		}
		add(value) {
			this.items.push(value);
		}
		/**
		* Removes a value from the collection.
		*
		* `key` must contain a representation of an integer for this to succeed.
		* It may be wrapped in a `Scalar`.
		*
		* @returns `true` if the item was found and removed.
		*/
		delete(key) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") return false;
			return this.items.splice(idx, 1).length > 0;
		}
		get(key, keepScalar) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") return void 0;
			const it = this.items[idx];
			return !keepScalar && identity.isScalar(it) ? it.value : it;
		}
		/**
		* Checks if the collection includes a value with the key `key`.
		*
		* `key` must contain a representation of an integer for this to succeed.
		* It may be wrapped in a `Scalar`.
		*/
		has(key) {
			const idx = asItemIndex(key);
			return typeof idx === "number" && idx < this.items.length;
		}
		/**
		* Sets a value in this collection. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*
		* If `key` does not contain a representation of an integer, this will throw.
		* It may be wrapped in a `Scalar`.
		*/
		set(key, value) {
			const idx = asItemIndex(key);
			if (typeof idx !== "number") throw new Error(`Expected a valid index, not ${key}.`);
			const prev = this.items[idx];
			if (identity.isScalar(prev) && Scalar.isScalarValue(value)) prev.value = value;
			else this.items[idx] = value;
		}
		toJSON(_, ctx) {
			const seq = [];
			if (ctx?.onCreate) ctx.onCreate(seq);
			let i = 0;
			for (const item of this.items) seq.push(toJS.toJS(item, String(i++), ctx));
			return seq;
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			return stringifyCollection.stringifyCollection(this, ctx, {
				blockItemPrefix: "- ",
				flowChars: {
					start: "[",
					end: "]"
				},
				itemIndent: (ctx.indent || "") + "  ",
				onChompKeep,
				onComment
			});
		}
		static from(schema, obj, ctx) {
			const { replacer } = ctx;
			const seq = new this(schema);
			if (obj && Symbol.iterator in Object(obj)) {
				let i = 0;
				for (let it of obj) {
					if (typeof replacer === "function") {
						const key = obj instanceof Set ? it : String(i++);
						it = replacer.call(obj, key, it);
					}
					seq.items.push(createNode.createNode(it, void 0, ctx));
				}
			}
			return seq;
		}
	};
	function asItemIndex(key) {
		let idx = identity.isScalar(key) ? key.value : key;
		if (idx && typeof idx === "string") idx = Number(idx);
		return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
	}
	exports.YAMLSeq = YAMLSeq;
}));
var require_seq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var YAMLSeq = require_YAMLSeq();
	exports.seq = {
		collection: "seq",
		default: true,
		nodeClass: YAMLSeq.YAMLSeq,
		tag: "tag:yaml.org,2002:seq",
		resolve(seq, onError) {
			if (!identity.isSeq(seq)) onError("Expected a sequence for this tag");
			return seq;
		},
		createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
	};
}));
var require_string = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyString = require_stringifyString();
	exports.string = {
		identify: (value) => typeof value === "string",
		default: true,
		tag: "tag:yaml.org,2002:str",
		resolve: (str) => str,
		stringify(item, ctx, onComment, onChompKeep) {
			ctx = Object.assign({ actualString: true }, ctx);
			return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
		}
	};
}));
var require_null = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	const nullTag = {
		identify: (value) => value == null,
		createNode: () => new Scalar.Scalar(null),
		default: true,
		tag: "tag:yaml.org,2002:null",
		test: /^(?:~|[Nn]ull|NULL)?$/,
		resolve: () => new Scalar.Scalar(null),
		stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
	};
	exports.nullTag = nullTag;
}));
var require_bool$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	const boolTag = {
		identify: (value) => typeof value === "boolean",
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
		resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
		stringify({ source, value }, ctx) {
			if (source && boolTag.test.test(source)) {
				if (value === (source[0] === "t" || source[0] === "T")) return source;
			}
			return value ? ctx.options.trueStr : ctx.options.falseStr;
		}
	};
	exports.boolTag = boolTag;
}));
var require_stringifyNumber = /* @__PURE__ */ __commonJSMin(((exports) => {
	function stringifyNumber({ format, minFractionDigits, tag, value }) {
		if (typeof value === "bigint") return String(value);
		const num = typeof value === "number" ? value : Number(value);
		if (!isFinite(num)) return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
		let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
		if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
			let i = n.indexOf(".");
			if (i < 0) {
				i = n.length;
				n += ".";
			}
			let d = minFractionDigits - (n.length - i - 1);
			while (d-- > 0) n += "0";
		}
		return n;
	}
	exports.stringifyNumber = stringifyNumber;
}));
var require_float$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var stringifyNumber = require_stringifyNumber();
	const floatNaN = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
		stringify: stringifyNumber.stringifyNumber
	};
	const floatExp = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str),
		stringify(node) {
			const num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	};
	exports.float = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
		resolve(str) {
			const node = new Scalar.Scalar(parseFloat(str));
			const dot = str.indexOf(".");
			if (dot !== -1 && str[str.length - 1] === "0") node.minFractionDigits = str.length - dot - 1;
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	};
	exports.floatExp = floatExp;
	exports.floatNaN = floatNaN;
}));
var require_int$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
	const intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
	function intStringify(node, radix, prefix) {
		const { value } = node;
		if (intIdentify(value) && value >= 0) return prefix + value.toString(radix);
		return stringifyNumber.stringifyNumber(node);
	}
	const intOct = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^0o[0-7]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
		stringify: (node) => intStringify(node, 8, "0o")
	};
	const int = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	};
	const intHex = {
		identify: (value) => intIdentify(value) && value >= 0,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^0x[0-9a-fA-F]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int;
	exports.intHex = intHex;
	exports.intOct = intOct;
}));
var require_schema$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var bool = require_bool$1();
	var float = require_float$1();
	var int = require_int$1();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.boolTag,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float
	];
}));
var require_schema$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var map = require_map();
	var seq = require_seq();
	function intIdentify(value) {
		return typeof value === "bigint" || Number.isInteger(value);
	}
	const stringifyJSON = ({ value }) => JSON.stringify(value);
	const jsonScalars = [
		{
			identify: (value) => typeof value === "string",
			default: true,
			tag: "tag:yaml.org,2002:str",
			resolve: (str) => str,
			stringify: stringifyJSON
		},
		{
			identify: (value) => value == null,
			createNode: () => new Scalar.Scalar(null),
			default: true,
			tag: "tag:yaml.org,2002:null",
			test: /^null$/,
			resolve: () => null,
			stringify: stringifyJSON
		},
		{
			identify: (value) => typeof value === "boolean",
			default: true,
			tag: "tag:yaml.org,2002:bool",
			test: /^true$|^false$/,
			resolve: (str) => str === "true",
			stringify: stringifyJSON
		},
		{
			identify: intIdentify,
			default: true,
			tag: "tag:yaml.org,2002:int",
			test: /^-?(?:0|[1-9][0-9]*)$/,
			resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
			stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
		},
		{
			identify: (value) => typeof value === "number",
			default: true,
			tag: "tag:yaml.org,2002:float",
			test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
			resolve: (str) => parseFloat(str),
			stringify: stringifyJSON
		}
	];
	exports.schema = [map.map, seq.seq].concat(jsonScalars, {
		default: true,
		tag: "",
		test: /^/,
		resolve(str, onError) {
			onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
			return str;
		}
	});
}));
var require_binary = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_buffer = __require("buffer");
	var Scalar = require_Scalar();
	var stringifyString = require_stringifyString();
	exports.binary = {
		identify: (value) => value instanceof Uint8Array,
		default: false,
		tag: "tag:yaml.org,2002:binary",
		/**
		* Returns a Buffer in node and an Uint8Array in browsers
		*
		* To use the resulting buffer as an image, you'll want to do something like:
		*
		*   const blob = new Blob([buffer], { type: 'image/jpeg' })
		*   document.querySelector('#photo').src = URL.createObjectURL(blob)
		*/
		resolve(src, onError) {
			if (typeof node_buffer.Buffer === "function") return node_buffer.Buffer.from(src, "base64");
			else if (typeof atob === "function") {
				const str = atob(src.replace(/[\n\r]/g, ""));
				const buffer = new Uint8Array(str.length);
				for (let i = 0; i < str.length; ++i) buffer[i] = str.charCodeAt(i);
				return buffer;
			} else {
				onError("This environment does not support reading binary tags; either Buffer or atob is required");
				return src;
			}
		},
		stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
			if (!value) return "";
			const buf = value;
			let str;
			if (typeof node_buffer.Buffer === "function") str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
			else if (typeof btoa === "function") {
				let s = "";
				for (let i = 0; i < buf.length; ++i) s += String.fromCharCode(buf[i]);
				str = btoa(s);
			} else throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
			type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
			if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
				const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
				const n = Math.ceil(str.length / lineWidth);
				const lines = new Array(n);
				for (let i = 0, o = 0; i < n; ++i, o += lineWidth) lines[i] = str.substr(o, lineWidth);
				str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
			}
			return stringifyString.stringifyString({
				comment,
				type,
				value: str
			}, ctx, onComment, onChompKeep);
		}
	};
}));
var require_pairs = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	var YAMLSeq = require_YAMLSeq();
	function resolvePairs(seq, onError) {
		if (identity.isSeq(seq)) for (let i = 0; i < seq.items.length; ++i) {
			let item = seq.items[i];
			if (identity.isPair(item)) continue;
			else if (identity.isMap(item)) {
				if (item.items.length > 1) onError("Each pair must have its own sequence indicator");
				const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
				if (item.commentBefore) pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}\n${pair.key.commentBefore}` : item.commentBefore;
				if (item.comment) {
					const cn = pair.value ?? pair.key;
					cn.comment = cn.comment ? `${item.comment}\n${cn.comment}` : item.comment;
				}
				item = pair;
			}
			seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
		}
		else onError("Expected a sequence for this tag");
		return seq;
	}
	function createPairs(schema, iterable, ctx) {
		const { replacer } = ctx;
		const pairs = new YAMLSeq.YAMLSeq(schema);
		pairs.tag = "tag:yaml.org,2002:pairs";
		let i = 0;
		if (iterable && Symbol.iterator in Object(iterable)) for (let it of iterable) {
			if (typeof replacer === "function") it = replacer.call(iterable, String(i++), it);
			let key, value;
			if (Array.isArray(it)) if (it.length === 2) {
				key = it[0];
				value = it[1];
			} else throw new TypeError(`Expected [key, value] tuple: ${it}`);
			else if (it && it instanceof Object) {
				const keys = Object.keys(it);
				if (keys.length === 1) {
					key = keys[0];
					value = it[key];
				} else throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
			} else key = it;
			pairs.items.push(Pair.createPair(key, value, ctx));
		}
		return pairs;
	}
	const pairs = {
		collection: "seq",
		default: false,
		tag: "tag:yaml.org,2002:pairs",
		resolve: resolvePairs,
		createNode: createPairs
	};
	exports.createPairs = createPairs;
	exports.pairs = pairs;
	exports.resolvePairs = resolvePairs;
}));
var require_omap = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var toJS = require_toJS();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var pairs = require_pairs();
	var YAMLOMap = class YAMLOMap extends YAMLSeq.YAMLSeq {
		constructor() {
			super();
			this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
			this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
			this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
			this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
			this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
			this.tag = YAMLOMap.tag;
		}
		/**
		* If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
		* but TypeScript won't allow widening the signature of a child method.
		*/
		toJSON(_, ctx) {
			if (!ctx) return super.toJSON(_);
			const map = /* @__PURE__ */ new Map();
			if (ctx?.onCreate) ctx.onCreate(map);
			for (const pair of this.items) {
				let key, value;
				if (identity.isPair(pair)) {
					key = toJS.toJS(pair.key, "", ctx);
					value = toJS.toJS(pair.value, key, ctx);
				} else key = toJS.toJS(pair, "", ctx);
				if (map.has(key)) throw new Error("Ordered maps must not include duplicate keys");
				map.set(key, value);
			}
			return map;
		}
		static from(schema, iterable, ctx) {
			const pairs$1 = pairs.createPairs(schema, iterable, ctx);
			const omap = new this();
			omap.items = pairs$1.items;
			return omap;
		}
	};
	YAMLOMap.tag = "tag:yaml.org,2002:omap";
	const omap = {
		collection: "seq",
		identify: (value) => value instanceof Map,
		nodeClass: YAMLOMap,
		default: false,
		tag: "tag:yaml.org,2002:omap",
		resolve(seq, onError) {
			const pairs$1 = pairs.resolvePairs(seq, onError);
			const seenKeys = [];
			for (const { key } of pairs$1.items) if (identity.isScalar(key)) if (seenKeys.includes(key.value)) onError(`Ordered maps must not include duplicate keys: ${key.value}`);
			else seenKeys.push(key.value);
			return Object.assign(new YAMLOMap(), pairs$1);
		},
		createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
	};
	exports.YAMLOMap = YAMLOMap;
	exports.omap = omap;
}));
var require_bool = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function boolStringify({ value, source }, ctx) {
		if (source && (value ? trueTag : falseTag).test.test(source)) return source;
		return value ? ctx.options.trueStr : ctx.options.falseStr;
	}
	const trueTag = {
		identify: (value) => value === true,
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
		resolve: () => new Scalar.Scalar(true),
		stringify: boolStringify
	};
	const falseTag = {
		identify: (value) => value === false,
		default: true,
		tag: "tag:yaml.org,2002:bool",
		test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
		resolve: () => new Scalar.Scalar(false),
		stringify: boolStringify
	};
	exports.falseTag = falseTag;
	exports.trueTag = trueTag;
}));
var require_float = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var stringifyNumber = require_stringifyNumber();
	const floatNaN = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
		resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
		stringify: stringifyNumber.stringifyNumber
	};
	const floatExp = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "EXP",
		test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
		resolve: (str) => parseFloat(str.replace(/_/g, "")),
		stringify(node) {
			const num = Number(node.value);
			return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
		}
	};
	exports.float = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
		resolve(str) {
			const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
			const dot = str.indexOf(".");
			if (dot !== -1) {
				const f = str.substring(dot + 1).replace(/_/g, "");
				if (f[f.length - 1] === "0") node.minFractionDigits = f.length;
			}
			return node;
		},
		stringify: stringifyNumber.stringifyNumber
	};
	exports.floatExp = floatExp;
	exports.floatNaN = floatNaN;
}));
var require_int = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	const intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
	function intResolve(str, offset, radix, { intAsBigInt }) {
		const sign = str[0];
		if (sign === "-" || sign === "+") offset += 1;
		str = str.substring(offset).replace(/_/g, "");
		if (intAsBigInt) {
			switch (radix) {
				case 2:
					str = `0b${str}`;
					break;
				case 8:
					str = `0o${str}`;
					break;
				case 16:
					str = `0x${str}`;
					break;
			}
			const n = BigInt(str);
			return sign === "-" ? BigInt(-1) * n : n;
		}
		const n = parseInt(str, radix);
		return sign === "-" ? -1 * n : n;
	}
	function intStringify(node, radix, prefix) {
		const { value } = node;
		if (intIdentify(value)) {
			const str = value.toString(radix);
			return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
		}
		return stringifyNumber.stringifyNumber(node);
	}
	const intBin = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "BIN",
		test: /^[-+]?0b[0-1_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
		stringify: (node) => intStringify(node, 2, "0b")
	};
	const intOct = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "OCT",
		test: /^[-+]?0[0-7_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
		stringify: (node) => intStringify(node, 8, "0")
	};
	const int = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		test: /^[-+]?[0-9][0-9_]*$/,
		resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
		stringify: stringifyNumber.stringifyNumber
	};
	const intHex = {
		identify: intIdentify,
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "HEX",
		test: /^[-+]?0x[0-9a-fA-F_]+$/,
		resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
		stringify: (node) => intStringify(node, 16, "0x")
	};
	exports.int = int;
	exports.intBin = intBin;
	exports.intHex = intHex;
	exports.intOct = intOct;
}));
var require_set = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var YAMLSet = class YAMLSet extends YAMLMap.YAMLMap {
		constructor(schema) {
			super(schema);
			this.tag = YAMLSet.tag;
		}
		add(key) {
			let pair;
			if (identity.isPair(key)) pair = key;
			else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null) pair = new Pair.Pair(key.key, null);
			else pair = new Pair.Pair(key, null);
			if (!YAMLMap.findPair(this.items, pair.key)) this.items.push(pair);
		}
		/**
		* If `keepPair` is `true`, returns the Pair matching `key`.
		* Otherwise, returns the value of that Pair's key.
		*/
		get(key, keepPair) {
			const pair = YAMLMap.findPair(this.items, key);
			return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
		}
		set(key, value) {
			if (typeof value !== "boolean") throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
			const prev = YAMLMap.findPair(this.items, key);
			if (prev && !value) this.items.splice(this.items.indexOf(prev), 1);
			else if (!prev && value) this.items.push(new Pair.Pair(key));
		}
		toJSON(_, ctx) {
			return super.toJSON(_, ctx, Set);
		}
		toString(ctx, onComment, onChompKeep) {
			if (!ctx) return JSON.stringify(this);
			if (this.hasAllNullValues(true)) return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
			else throw new Error("Set items must all have null values");
		}
		static from(schema, iterable, ctx) {
			const { replacer } = ctx;
			const set = new this(schema);
			if (iterable && Symbol.iterator in Object(iterable)) for (let value of iterable) {
				if (typeof replacer === "function") value = replacer.call(iterable, value, value);
				set.items.push(Pair.createPair(value, null, ctx));
			}
			return set;
		}
	};
	YAMLSet.tag = "tag:yaml.org,2002:set";
	const set = {
		collection: "map",
		identify: (value) => value instanceof Set,
		nodeClass: YAMLSet,
		default: false,
		tag: "tag:yaml.org,2002:set",
		createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
		resolve(map, onError) {
			if (identity.isMap(map)) if (map.hasAllNullValues(true)) return Object.assign(new YAMLSet(), map);
			else onError("Set items must all have null values");
			else onError("Expected a mapping for this tag");
			return map;
		}
	};
	exports.YAMLSet = YAMLSet;
	exports.set = set;
}));
var require_timestamp = /* @__PURE__ */ __commonJSMin(((exports) => {
	var stringifyNumber = require_stringifyNumber();
	/** Internal types handle bigint as number, because TS can't figure it out. */
	function parseSexagesimal(str, asBigInt) {
		const sign = str[0];
		const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
		const num = (n) => asBigInt ? BigInt(n) : Number(n);
		const res = parts.replace(/_/g, "").split(":").reduce((res, p) => res * num(60) + num(p), num(0));
		return sign === "-" ? num(-1) * res : res;
	}
	/**
	* hhhh:mm:ss.sss
	*
	* Internal types handle bigint as number, because TS can't figure it out.
	*/
	function stringifySexagesimal(node) {
		let { value } = node;
		let num = (n) => n;
		if (typeof value === "bigint") num = (n) => BigInt(n);
		else if (isNaN(value) || !isFinite(value)) return stringifyNumber.stringifyNumber(node);
		let sign = "";
		if (value < 0) {
			sign = "-";
			value *= num(-1);
		}
		const _60 = num(60);
		const parts = [value % _60];
		if (value < 60) parts.unshift(0);
		else {
			value = (value - parts[0]) / _60;
			parts.unshift(value % _60);
			if (value >= 60) {
				value = (value - parts[0]) / _60;
				parts.unshift(value);
			}
		}
		return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
	}
	const intTime = {
		identify: (value) => typeof value === "bigint" || Number.isInteger(value),
		default: true,
		tag: "tag:yaml.org,2002:int",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
		resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
		stringify: stringifySexagesimal
	};
	const floatTime = {
		identify: (value) => typeof value === "number",
		default: true,
		tag: "tag:yaml.org,2002:float",
		format: "TIME",
		test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
		resolve: (str) => parseSexagesimal(str, false),
		stringify: stringifySexagesimal
	};
	const timestamp = {
		identify: (value) => value instanceof Date,
		default: true,
		tag: "tag:yaml.org,2002:timestamp",
		test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
		resolve(str) {
			const match = str.match(timestamp.test);
			if (!match) throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
			const [, year, month, day, hour, minute, second] = match.map(Number);
			const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
			let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
			const tz = match[8];
			if (tz && tz !== "Z") {
				let d = parseSexagesimal(tz, false);
				if (Math.abs(d) < 30) d *= 60;
				date -= 6e4 * d;
			}
			return new Date(date);
		},
		stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
	};
	exports.floatTime = floatTime;
	exports.intTime = intTime;
	exports.timestamp = timestamp;
}));
var require_schema = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var binary = require_binary();
	var bool = require_bool();
	var float = require_float();
	var int = require_int();
	var merge = require_merge();
	var omap = require_omap();
	var pairs = require_pairs();
	var set = require_set();
	var timestamp = require_timestamp();
	exports.schema = [
		map.map,
		seq.seq,
		string.string,
		_null.nullTag,
		bool.trueTag,
		bool.falseTag,
		int.intBin,
		int.intOct,
		int.int,
		int.intHex,
		float.floatNaN,
		float.floatExp,
		float.float,
		binary.binary,
		merge.merge,
		omap.omap,
		pairs.pairs,
		set.set,
		timestamp.intTime,
		timestamp.floatTime,
		timestamp.timestamp
	];
}));
var require_tags = /* @__PURE__ */ __commonJSMin(((exports) => {
	var map = require_map();
	var _null = require_null();
	var seq = require_seq();
	var string = require_string();
	var bool = require_bool$1();
	var float = require_float$1();
	var int = require_int$1();
	var schema = require_schema$2();
	var schema$1 = require_schema$1();
	var binary = require_binary();
	var merge = require_merge();
	var omap = require_omap();
	var pairs = require_pairs();
	var schema$2 = require_schema();
	var set = require_set();
	var timestamp = require_timestamp();
	const schemas = /* @__PURE__ */ new Map([
		["core", schema.schema],
		["failsafe", [
			map.map,
			seq.seq,
			string.string
		]],
		["json", schema$1.schema],
		["yaml11", schema$2.schema],
		["yaml-1.1", schema$2.schema]
	]);
	const tagsByName = {
		binary: binary.binary,
		bool: bool.boolTag,
		float: float.float,
		floatExp: float.floatExp,
		floatNaN: float.floatNaN,
		floatTime: timestamp.floatTime,
		int: int.int,
		intHex: int.intHex,
		intOct: int.intOct,
		intTime: timestamp.intTime,
		map: map.map,
		merge: merge.merge,
		null: _null.nullTag,
		omap: omap.omap,
		pairs: pairs.pairs,
		seq: seq.seq,
		set: set.set,
		timestamp: timestamp.timestamp
	};
	const coreKnownTags = {
		"tag:yaml.org,2002:binary": binary.binary,
		"tag:yaml.org,2002:merge": merge.merge,
		"tag:yaml.org,2002:omap": omap.omap,
		"tag:yaml.org,2002:pairs": pairs.pairs,
		"tag:yaml.org,2002:set": set.set,
		"tag:yaml.org,2002:timestamp": timestamp.timestamp
	};
	function getTags(customTags, schemaName, addMergeTag) {
		const schemaTags = schemas.get(schemaName);
		if (schemaTags && !customTags) return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
		let tags = schemaTags;
		if (!tags) if (Array.isArray(customTags)) tags = [];
		else {
			const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
			throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
		}
		if (Array.isArray(customTags)) for (const tag of customTags) tags = tags.concat(tag);
		else if (typeof customTags === "function") tags = customTags(tags.slice());
		if (addMergeTag) tags = tags.concat(merge.merge);
		return tags.reduce((tags, tag) => {
			const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
			if (!tagObj) {
				const tagName = JSON.stringify(tag);
				const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
				throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
			}
			if (!tags.includes(tagObj)) tags.push(tagObj);
			return tags;
		}, []);
	}
	exports.coreKnownTags = coreKnownTags;
	exports.getTags = getTags;
}));
var require_Schema = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var map = require_map();
	var seq = require_seq();
	var string = require_string();
	var tags = require_tags();
	const sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	exports.Schema = class Schema {
		constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
			this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
			this.name = typeof schema === "string" && schema || "core";
			this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
			this.tags = tags.getTags(customTags, this.name, merge);
			this.toStringOptions = toStringDefaults ?? null;
			Object.defineProperty(this, identity.MAP, { value: map.map });
			Object.defineProperty(this, identity.SCALAR, { value: string.string });
			Object.defineProperty(this, identity.SEQ, { value: seq.seq });
			this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
		}
		clone() {
			const copy = Object.create(Schema.prototype, Object.getOwnPropertyDescriptors(this));
			copy.tags = this.tags.slice();
			return copy;
		}
	};
}));
var require_stringifyDocument = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var stringify = require_stringify();
	var stringifyComment = require_stringifyComment();
	function stringifyDocument(doc, options) {
		const lines = [];
		let hasDirectives = options.directives === true;
		if (options.directives !== false && doc.directives) {
			const dir = doc.directives.toString(doc);
			if (dir) {
				lines.push(dir);
				hasDirectives = true;
			} else if (doc.directives.docStart) hasDirectives = true;
		}
		if (hasDirectives) lines.push("---");
		const ctx = stringify.createStringifyContext(doc, options);
		const { commentString } = ctx.options;
		if (doc.commentBefore) {
			if (lines.length !== 1) lines.unshift("");
			const cs = commentString(doc.commentBefore);
			lines.unshift(stringifyComment.indentComment(cs, ""));
		}
		let chompKeep = false;
		let contentComment = null;
		if (doc.contents) {
			if (identity.isNode(doc.contents)) {
				if (doc.contents.spaceBefore && hasDirectives) lines.push("");
				if (doc.contents.commentBefore) {
					const cs = commentString(doc.contents.commentBefore);
					lines.push(stringifyComment.indentComment(cs, ""));
				}
				ctx.forceBlockIndent = !!doc.comment;
				contentComment = doc.contents.comment;
			}
			const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
			let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
			if (contentComment) body += stringifyComment.lineComment(body, "", commentString(contentComment));
			if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") lines[lines.length - 1] = `--- ${body}`;
			else lines.push(body);
		} else lines.push(stringify.stringify(doc.contents, ctx));
		if (doc.directives?.docEnd) if (doc.comment) {
			const cs = commentString(doc.comment);
			if (cs.includes("\n")) {
				lines.push("...");
				lines.push(stringifyComment.indentComment(cs, ""));
			} else lines.push(`... ${cs}`);
		} else lines.push("...");
		else {
			let dc = doc.comment;
			if (dc && chompKeep) dc = dc.replace(/^\n+/, "");
			if (dc) {
				if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "") lines.push("");
				lines.push(stringifyComment.indentComment(commentString(dc), ""));
			}
		}
		return lines.join("\n") + "\n";
	}
	exports.stringifyDocument = stringifyDocument;
}));
var require_Document = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var Collection = require_Collection();
	var identity = require_identity();
	var Pair = require_Pair();
	var toJS = require_toJS();
	var Schema = require_Schema();
	var stringifyDocument = require_stringifyDocument();
	var anchors = require_anchors();
	var applyReviver = require_applyReviver();
	var createNode = require_createNode();
	var directives = require_directives();
	var Document = class Document {
		constructor(value, replacer, options) {
			/** A comment before this Document */
			this.commentBefore = null;
			/** A comment immediately after this Document */
			this.comment = null;
			/** Errors encountered during parsing. */
			this.errors = [];
			/** Warnings encountered during parsing. */
			this.warnings = [];
			Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
			let _replacer = null;
			if (typeof replacer === "function" || Array.isArray(replacer)) _replacer = replacer;
			else if (options === void 0 && replacer) {
				options = replacer;
				replacer = void 0;
			}
			const opt = Object.assign({
				intAsBigInt: false,
				keepSourceTokens: false,
				logLevel: "warn",
				prettyErrors: true,
				strict: true,
				stringKeys: false,
				uniqueKeys: true,
				version: "1.2"
			}, options);
			this.options = opt;
			let { version } = opt;
			if (options?._directives) {
				this.directives = options._directives.atDocument();
				if (this.directives.yaml.explicit) version = this.directives.yaml.version;
			} else this.directives = new directives.Directives({ version });
			this.setSchema(version, options);
			this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
		}
		/**
		* Create a deep copy of this Document and its contents.
		*
		* Custom Node values that inherit from `Object` still refer to their original instances.
		*/
		clone() {
			const copy = Object.create(Document.prototype, { [identity.NODE_TYPE]: { value: identity.DOC } });
			copy.commentBefore = this.commentBefore;
			copy.comment = this.comment;
			copy.errors = this.errors.slice();
			copy.warnings = this.warnings.slice();
			copy.options = Object.assign({}, this.options);
			if (this.directives) copy.directives = this.directives.clone();
			copy.schema = this.schema.clone();
			copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
			if (this.range) copy.range = this.range.slice();
			return copy;
		}
		/** Adds a value to the document. */
		add(value) {
			if (assertCollection(this.contents)) this.contents.add(value);
		}
		/** Adds a value to the document. */
		addIn(path, value) {
			if (assertCollection(this.contents)) this.contents.addIn(path, value);
		}
		/**
		* Create a new `Alias` node, ensuring that the target `node` has the required anchor.
		*
		* If `node` already has an anchor, `name` is ignored.
		* Otherwise, the `node.anchor` value will be set to `name`,
		* or if an anchor with that name is already present in the document,
		* `name` will be used as a prefix for a new unique anchor.
		* If `name` is undefined, the generated anchor will use 'a' as a prefix.
		*/
		createAlias(node, name) {
			if (!node.anchor) {
				const prev = anchors.anchorNames(this);
				node.anchor = !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
			}
			return new Alias.Alias(node.anchor);
		}
		createNode(value, replacer, options) {
			let _replacer = void 0;
			if (typeof replacer === "function") {
				value = replacer.call({ "": value }, "", value);
				_replacer = replacer;
			} else if (Array.isArray(replacer)) {
				const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
				const asStr = replacer.filter(keyToStr).map(String);
				if (asStr.length > 0) replacer = replacer.concat(asStr);
				_replacer = replacer;
			} else if (options === void 0 && replacer) {
				options = replacer;
				replacer = void 0;
			}
			const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
			const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(this, anchorPrefix || "a");
			const ctx = {
				aliasDuplicateObjects: aliasDuplicateObjects ?? true,
				keepUndefined: keepUndefined ?? false,
				onAnchor,
				onTagObj,
				replacer: _replacer,
				schema: this.schema,
				sourceObjects
			};
			const node = createNode.createNode(value, tag, ctx);
			if (flow && identity.isCollection(node)) node.flow = true;
			setAnchors();
			return node;
		}
		/**
		* Convert a key and a value into a `Pair` using the current schema,
		* recursively wrapping all values as `Scalar` or `Collection` nodes.
		*/
		createPair(key, value, options = {}) {
			const k = this.createNode(key, null, options);
			const v = this.createNode(value, null, options);
			return new Pair.Pair(k, v);
		}
		/**
		* Removes a value from the document.
		* @returns `true` if the item was found and removed.
		*/
		delete(key) {
			return assertCollection(this.contents) ? this.contents.delete(key) : false;
		}
		/**
		* Removes a value from the document.
		* @returns `true` if the item was found and removed.
		*/
		deleteIn(path) {
			if (Collection.isEmptyPath(path)) {
				if (this.contents == null) return false;
				this.contents = null;
				return true;
			}
			return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
		}
		/**
		* Returns item at `key`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		get(key, keepScalar) {
			return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
		}
		/**
		* Returns item at `path`, or `undefined` if not found. By default unwraps
		* scalar values from their surrounding node; to disable set `keepScalar` to
		* `true` (collections are always returned intact).
		*/
		getIn(path, keepScalar) {
			if (Collection.isEmptyPath(path)) return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
			return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
		}
		/**
		* Checks if the document includes a value with the key `key`.
		*/
		has(key) {
			return identity.isCollection(this.contents) ? this.contents.has(key) : false;
		}
		/**
		* Checks if the document includes a value at `path`.
		*/
		hasIn(path) {
			if (Collection.isEmptyPath(path)) return this.contents !== void 0;
			return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
		}
		/**
		* Sets a value in this document. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		set(key, value) {
			if (this.contents == null) this.contents = Collection.collectionFromPath(this.schema, [key], value);
			else if (assertCollection(this.contents)) this.contents.set(key, value);
		}
		/**
		* Sets a value in this document. For `!!set`, `value` needs to be a
		* boolean to add/remove the item from the set.
		*/
		setIn(path, value) {
			if (Collection.isEmptyPath(path)) this.contents = value;
			else if (this.contents == null) this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
			else if (assertCollection(this.contents)) this.contents.setIn(path, value);
		}
		/**
		* Change the YAML version and schema used by the document.
		* A `null` version disables support for directives, explicit tags, anchors, and aliases.
		* It also requires the `schema` option to be given as a `Schema` instance value.
		*
		* Overrides all previously set schema options.
		*/
		setSchema(version, options = {}) {
			if (typeof version === "number") version = String(version);
			let opt;
			switch (version) {
				case "1.1":
					if (this.directives) this.directives.yaml.version = "1.1";
					else this.directives = new directives.Directives({ version: "1.1" });
					opt = {
						resolveKnownTags: false,
						schema: "yaml-1.1"
					};
					break;
				case "1.2":
				case "next":
					if (this.directives) this.directives.yaml.version = version;
					else this.directives = new directives.Directives({ version });
					opt = {
						resolveKnownTags: true,
						schema: "core"
					};
					break;
				case null:
					if (this.directives) delete this.directives;
					opt = null;
					break;
				default: {
					const sv = JSON.stringify(version);
					throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
				}
			}
			if (options.schema instanceof Object) this.schema = options.schema;
			else if (opt) this.schema = new Schema.Schema(Object.assign(opt, options));
			else throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
		}
		toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
			const ctx = {
				anchors: /* @__PURE__ */ new Map(),
				doc: this,
				keep: !json,
				mapAsMap: mapAsMap === true,
				mapKeyWarned: false,
				maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
			};
			const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
			if (typeof onAnchor === "function") for (const { count, res } of ctx.anchors.values()) onAnchor(res, count);
			return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
		}
		/**
		* A JSON representation of the document `contents`.
		*
		* @param jsonArg Used by `JSON.stringify` to indicate the array index or
		*   property name.
		*/
		toJSON(jsonArg, onAnchor) {
			return this.toJS({
				json: true,
				jsonArg,
				mapAsMap: false,
				onAnchor
			});
		}
		/** A YAML representation of the document. */
		toString(options = {}) {
			if (this.errors.length > 0) throw new Error("Document with errors cannot be stringified");
			if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
				const s = JSON.stringify(options.indent);
				throw new Error(`"indent" option must be a positive integer, not ${s}`);
			}
			return stringifyDocument.stringifyDocument(this, options);
		}
	};
	function assertCollection(contents) {
		if (identity.isCollection(contents)) return true;
		throw new Error("Expected a YAML collection as document contents");
	}
	exports.Document = Document;
}));
var require_errors = /* @__PURE__ */ __commonJSMin(((exports) => {
	var YAMLError = class extends Error {
		constructor(name, pos, code, message) {
			super();
			this.name = name;
			this.code = code;
			this.message = message;
			this.pos = pos;
		}
	};
	var YAMLParseError = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLParseError", pos, code, message);
		}
	};
	var YAMLWarning = class extends YAMLError {
		constructor(pos, code, message) {
			super("YAMLWarning", pos, code, message);
		}
	};
	const prettifyError = (src, lc) => (error) => {
		if (error.pos[0] === -1) return;
		error.linePos = error.pos.map((pos) => lc.linePos(pos));
		const { line, col } = error.linePos[0];
		error.message += ` at line ${line}, column ${col}`;
		let ci = col - 1;
		let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
		if (ci >= 60 && lineStr.length > 80) {
			const trimStart = Math.min(ci - 39, lineStr.length - 79);
			lineStr = "…" + lineStr.substring(trimStart);
			ci -= trimStart - 1;
		}
		if (lineStr.length > 80) lineStr = lineStr.substring(0, 79) + "…";
		if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
			let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
			if (prev.length > 80) prev = prev.substring(0, 79) + "…\n";
			lineStr = prev + lineStr;
		}
		if (/[^ ]/.test(lineStr)) {
			let count = 1;
			const end = error.linePos[1];
			if (end?.line === line && end.col > col) count = Math.max(1, Math.min(end.col - col, 80 - ci));
			const pointer = " ".repeat(ci) + "^".repeat(count);
			error.message += `:\n\n${lineStr}\n${pointer}\n`;
		}
	};
	exports.YAMLError = YAMLError;
	exports.YAMLParseError = YAMLParseError;
	exports.YAMLWarning = YAMLWarning;
	exports.prettifyError = prettifyError;
}));
var require_resolve_props = /* @__PURE__ */ __commonJSMin(((exports) => {
	function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
		let spaceBefore = false;
		let atNewline = startOnNewline;
		let hasSpace = startOnNewline;
		let comment = "";
		let commentSep = "";
		let hasNewline = false;
		let reqSpace = false;
		let tab = null;
		let anchor = null;
		let tag = null;
		let newlineAfterProp = null;
		let comma = null;
		let found = null;
		let start = null;
		for (const token of tokens) {
			if (reqSpace) {
				if (token.type !== "space" && token.type !== "newline" && token.type !== "comma") onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
				reqSpace = false;
			}
			if (tab) {
				if (atNewline && token.type !== "comment" && token.type !== "newline") onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
				tab = null;
			}
			switch (token.type) {
				case "space":
					if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) tab = token;
					hasSpace = true;
					break;
				case "comment": {
					if (!hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					const cb = token.source.substring(1) || " ";
					if (!comment) comment = cb;
					else comment += commentSep + cb;
					commentSep = "";
					atNewline = false;
					break;
				}
				case "newline":
					if (atNewline) {
						if (comment) comment += token.source;
						else if (!found || indicator !== "seq-item-ind") spaceBefore = true;
					} else commentSep += token.source;
					atNewline = true;
					hasNewline = true;
					if (anchor || tag) newlineAfterProp = token;
					hasSpace = true;
					break;
				case "anchor":
					if (anchor) onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
					if (token.source.endsWith(":")) onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
					anchor = token;
					start ?? (start = token.offset);
					atNewline = false;
					hasSpace = false;
					reqSpace = true;
					break;
				case "tag":
					if (tag) onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
					tag = token;
					start ?? (start = token.offset);
					atNewline = false;
					hasSpace = false;
					reqSpace = true;
					break;
				case indicator:
					if (anchor || tag) onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
					if (found) onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
					found = token;
					atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
					hasSpace = false;
					break;
				case "comma": if (flow) {
					if (comma) onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
					comma = token;
					atNewline = false;
					hasSpace = false;
					break;
				}
				default:
					onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
					atNewline = false;
					hasSpace = false;
			}
		}
		const last = tokens[tokens.length - 1];
		const end = last ? last.offset + last.source.length : offset;
		if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
		if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq")) onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
		return {
			comma,
			found,
			spaceBefore,
			comment,
			hasNewline,
			anchor,
			tag,
			newlineAfterProp,
			end,
			start: start ?? end
		};
	}
	exports.resolveProps = resolveProps;
}));
var require_util_contains_newline = /* @__PURE__ */ __commonJSMin(((exports) => {
	function containsNewline(key) {
		if (!key) return null;
		switch (key.type) {
			case "alias":
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				if (key.source.includes("\n")) return true;
				if (key.end) {
					for (const st of key.end) if (st.type === "newline") return true;
				}
				return false;
			case "flow-collection":
				for (const it of key.items) {
					for (const st of it.start) if (st.type === "newline") return true;
					if (it.sep) {
						for (const st of it.sep) if (st.type === "newline") return true;
					}
					if (containsNewline(it.key) || containsNewline(it.value)) return true;
				}
				return false;
			default: return true;
		}
	}
	exports.containsNewline = containsNewline;
}));
var require_util_flow_indent_check = /* @__PURE__ */ __commonJSMin(((exports) => {
	var utilContainsNewline = require_util_contains_newline();
	function flowIndentCheck(indent, fc, onError) {
		if (fc?.type === "flow-collection") {
			const end = fc.end[0];
			if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) onError(end, "BAD_INDENT", "Flow end indicator should be more indented than parent", true);
		}
	}
	exports.flowIndentCheck = flowIndentCheck;
}));
var require_util_map_includes = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	function mapIncludes(ctx, items, search) {
		const { uniqueKeys } = ctx.options;
		if (uniqueKeys === false) return false;
		const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
		return items.some((pair) => isEqual(pair.key, search));
	}
	exports.mapIncludes = mapIncludes;
}));
var require_resolve_block_map = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var resolveProps = require_resolve_props();
	var utilContainsNewline = require_util_contains_newline();
	var utilFlowIndentCheck = require_util_flow_indent_check();
	var utilMapIncludes = require_util_map_includes();
	const startColMsg = "All mapping items must start at the same column";
	function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
		const map = new ((tag?.nodeClass) ?? YAMLMap.YAMLMap)(ctx.schema);
		if (ctx.atRoot) ctx.atRoot = false;
		let offset = bm.offset;
		let commentEnd = null;
		for (const collItem of bm.items) {
			const { start, key, sep, value } = collItem;
			const keyProps = resolveProps.resolveProps(start, {
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: bm.indent,
				startOnNewline: true
			});
			const implicitKey = !keyProps.found;
			if (implicitKey) {
				if (key) {
					if (key.type === "block-seq") onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
					else if ("indent" in key && key.indent !== bm.indent) onError(offset, "BAD_INDENT", startColMsg);
				}
				if (!keyProps.anchor && !keyProps.tag && !sep) {
					commentEnd = keyProps.end;
					if (keyProps.comment) if (map.comment) map.comment += "\n" + keyProps.comment;
					else map.comment = keyProps.comment;
					continue;
				}
				if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
			} else if (keyProps.found?.indent !== bm.indent) onError(offset, "BAD_INDENT", startColMsg);
			ctx.atKey = true;
			const keyStart = keyProps.end;
			const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
			if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
			ctx.atKey = false;
			if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode)) onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
			const valueProps = resolveProps.resolveProps(sep ?? [], {
				indicator: "map-value-ind",
				next: value,
				offset: keyNode.range[2],
				onError,
				parentIndent: bm.indent,
				startOnNewline: !key || key.type === "block-scalar"
			});
			offset = valueProps.end;
			if (valueProps.found) {
				if (implicitKey) {
					if (value?.type === "block-map" && !valueProps.hasNewline) onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
					if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024) onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
				}
				const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
				if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
				offset = valueNode.range[2];
				const pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				map.items.push(pair);
			} else {
				if (implicitKey) onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
				if (valueProps.comment) if (keyNode.comment) keyNode.comment += "\n" + valueProps.comment;
				else keyNode.comment = valueProps.comment;
				const pair = new Pair.Pair(keyNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				map.items.push(pair);
			}
		}
		if (commentEnd && commentEnd < offset) onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
		map.range = [
			bm.offset,
			offset,
			commentEnd ?? offset
		];
		return map;
	}
	exports.resolveBlockMap = resolveBlockMap;
}));
var require_resolve_block_seq = /* @__PURE__ */ __commonJSMin(((exports) => {
	var YAMLSeq = require_YAMLSeq();
	var resolveProps = require_resolve_props();
	var utilFlowIndentCheck = require_util_flow_indent_check();
	function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
		const seq = new ((tag?.nodeClass) ?? YAMLSeq.YAMLSeq)(ctx.schema);
		if (ctx.atRoot) ctx.atRoot = false;
		if (ctx.atKey) ctx.atKey = false;
		let offset = bs.offset;
		let commentEnd = null;
		for (const { start, value } of bs.items) {
			const props = resolveProps.resolveProps(start, {
				indicator: "seq-item-ind",
				next: value,
				offset,
				onError,
				parentIndent: bs.indent,
				startOnNewline: true
			});
			if (!props.found) if (props.anchor || props.tag || value) if (value?.type === "block-seq") onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
			else onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
			else {
				commentEnd = props.end;
				if (props.comment) seq.comment = props.comment;
				continue;
			}
			const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
			if (ctx.schema.compat) utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
			offset = node.range[2];
			seq.items.push(node);
		}
		seq.range = [
			bs.offset,
			offset,
			commentEnd ?? offset
		];
		return seq;
	}
	exports.resolveBlockSeq = resolveBlockSeq;
}));
var require_resolve_end = /* @__PURE__ */ __commonJSMin(((exports) => {
	function resolveEnd(end, offset, reqSpace, onError) {
		let comment = "";
		if (end) {
			let hasSpace = false;
			let sep = "";
			for (const token of end) {
				const { source, type } = token;
				switch (type) {
					case "space":
						hasSpace = true;
						break;
					case "comment": {
						if (reqSpace && !hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
						const cb = source.substring(1) || " ";
						if (!comment) comment = cb;
						else comment += sep + cb;
						sep = "";
						break;
					}
					case "newline":
						if (comment) sep += source;
						hasSpace = true;
						break;
					default: onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
				}
				offset += source.length;
			}
		}
		return {
			comment,
			offset
		};
	}
	exports.resolveEnd = resolveEnd;
}));
var require_resolve_flow_collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Pair = require_Pair();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var resolveEnd = require_resolve_end();
	var resolveProps = require_resolve_props();
	var utilContainsNewline = require_util_contains_newline();
	var utilMapIncludes = require_util_map_includes();
	const blockMsg = "Block collections are not allowed within flow collections";
	const isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
	function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
		const isMap = fc.start.source === "{";
		const fcName = isMap ? "flow map" : "flow sequence";
		const coll = new ((tag?.nodeClass) ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq))(ctx.schema);
		coll.flow = true;
		const atRoot = ctx.atRoot;
		if (atRoot) ctx.atRoot = false;
		if (ctx.atKey) ctx.atKey = false;
		let offset = fc.offset + fc.start.source.length;
		for (let i = 0; i < fc.items.length; ++i) {
			const collItem = fc.items[i];
			const { start, key, sep, value } = collItem;
			const props = resolveProps.resolveProps(start, {
				flow: fcName,
				indicator: "explicit-key-ind",
				next: key ?? sep?.[0],
				offset,
				onError,
				parentIndent: fc.indent,
				startOnNewline: false
			});
			if (!props.found) {
				if (!props.anchor && !props.tag && !sep && !value) {
					if (i === 0 && props.comma) onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
					else if (i < fc.items.length - 1) onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
					if (props.comment) if (coll.comment) coll.comment += "\n" + props.comment;
					else coll.comment = props.comment;
					offset = props.end;
					continue;
				}
				if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key)) onError(key, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
			}
			if (i === 0) {
				if (props.comma) onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
			} else {
				if (!props.comma) onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
				if (props.comment) {
					let prevItemComment = "";
					loop: for (const st of start) switch (st.type) {
						case "comma":
						case "space": break;
						case "comment":
							prevItemComment = st.source.substring(1);
							break loop;
						default: break loop;
					}
					if (prevItemComment) {
						let prev = coll.items[coll.items.length - 1];
						if (identity.isPair(prev)) prev = prev.value ?? prev.key;
						if (prev.comment) prev.comment += "\n" + prevItemComment;
						else prev.comment = prevItemComment;
						props.comment = props.comment.substring(prevItemComment.length + 1);
					}
				}
			}
			if (!isMap && !sep && !props.found) {
				const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
				coll.items.push(valueNode);
				offset = valueNode.range[2];
				if (isBlock(value)) onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
			} else {
				ctx.atKey = true;
				const keyStart = props.end;
				const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
				if (isBlock(key)) onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
				ctx.atKey = false;
				const valueProps = resolveProps.resolveProps(sep ?? [], {
					flow: fcName,
					indicator: "map-value-ind",
					next: value,
					offset: keyNode.range[2],
					onError,
					parentIndent: fc.indent,
					startOnNewline: false
				});
				if (valueProps.found) {
					if (!isMap && !props.found && ctx.options.strict) {
						if (sep) for (const st of sep) {
							if (st === valueProps.found) break;
							if (st.type === "newline") {
								onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
								break;
							}
						}
						if (props.start < valueProps.found.offset - 1024) onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
					}
				} else if (value) if ("source" in value && value.source?.[0] === ":") onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
				else onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
				const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
				if (valueNode) {
					if (isBlock(value)) onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
				} else if (valueProps.comment) if (keyNode.comment) keyNode.comment += "\n" + valueProps.comment;
				else keyNode.comment = valueProps.comment;
				const pair = new Pair.Pair(keyNode, valueNode);
				if (ctx.options.keepSourceTokens) pair.srcToken = collItem;
				if (isMap) {
					const map = coll;
					if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode)) onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
					map.items.push(pair);
				} else {
					const map = new YAMLMap.YAMLMap(ctx.schema);
					map.flow = true;
					map.items.push(pair);
					const endRange = (valueNode ?? keyNode).range;
					map.range = [
						keyNode.range[0],
						endRange[1],
						endRange[2]
					];
					coll.items.push(map);
				}
				offset = valueNode ? valueNode.range[2] : valueProps.end;
			}
		}
		const expectedEnd = isMap ? "}" : "]";
		const [ce, ...ee] = fc.end;
		let cePos = offset;
		if (ce?.source === expectedEnd) cePos = ce.offset + ce.source.length;
		else {
			const name = fcName[0].toUpperCase() + fcName.substring(1);
			const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
			onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
			if (ce && ce.source.length !== 1) ee.unshift(ce);
		}
		if (ee.length > 0) {
			const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
			if (end.comment) if (coll.comment) coll.comment += "\n" + end.comment;
			else coll.comment = end.comment;
			coll.range = [
				fc.offset,
				cePos,
				end.offset
			];
		} else coll.range = [
			fc.offset,
			cePos,
			cePos
		];
		return coll;
	}
	exports.resolveFlowCollection = resolveFlowCollection;
}));
var require_compose_collection = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	var resolveBlockMap = require_resolve_block_map();
	var resolveBlockSeq = require_resolve_block_seq();
	var resolveFlowCollection = require_resolve_flow_collection();
	function resolveCollection(CN, ctx, token, onError, tagName, tag) {
		const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
		const Coll = coll.constructor;
		if (tagName === "!" || tagName === Coll.tagName) {
			coll.tag = Coll.tagName;
			return coll;
		}
		if (tagName) coll.tag = tagName;
		return coll;
	}
	function composeCollection(CN, ctx, token, props, onError) {
		const tagToken = props.tag;
		const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
		if (token.type === "block-seq") {
			const { anchor, newlineAfterProp: nl } = props;
			const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
			if (lastProp && (!nl || nl.offset < lastProp.offset)) onError(lastProp, "MISSING_CHAR", "Missing newline after block sequence props");
		}
		const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
		if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") return resolveCollection(CN, ctx, token, onError, tagName);
		let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
		if (!tag) {
			const kt = ctx.schema.knownTags[tagName];
			if (kt?.collection === expType) {
				ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
				tag = kt;
			} else {
				if (kt) onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
				else onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
				return resolveCollection(CN, ctx, token, onError, tagName);
			}
		}
		const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
		const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
		const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
		node.range = coll.range;
		node.tag = tagName;
		if (tag?.format) node.format = tag.format;
		return node;
	}
	exports.composeCollection = composeCollection;
}));
var require_resolve_block_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	function resolveBlockScalar(ctx, scalar, onError) {
		const start = scalar.offset;
		const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
		if (!header) return {
			value: "",
			type: null,
			comment: "",
			range: [
				start,
				start,
				start
			]
		};
		const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
		const lines = scalar.source ? splitLines(scalar.source) : [];
		let chompStart = lines.length;
		for (let i = lines.length - 1; i >= 0; --i) {
			const content = lines[i][1];
			if (content === "" || content === "\r") chompStart = i;
			else break;
		}
		if (chompStart === 0) {
			const value = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
			let end = start + header.length;
			if (scalar.source) end += scalar.source.length;
			return {
				value,
				type,
				comment: header.comment,
				range: [
					start,
					end,
					end
				]
			};
		}
		let trimIndent = scalar.indent + header.indent;
		let offset = scalar.offset + header.length;
		let contentStart = 0;
		for (let i = 0; i < chompStart; ++i) {
			const [indent, content] = lines[i];
			if (content === "" || content === "\r") {
				if (header.indent === 0 && indent.length > trimIndent) trimIndent = indent.length;
			} else {
				if (indent.length < trimIndent) onError(offset + indent.length, "MISSING_CHAR", "Block scalars with more-indented leading empty lines must use an explicit indentation indicator");
				if (header.indent === 0) trimIndent = indent.length;
				contentStart = i;
				if (trimIndent === 0 && !ctx.atRoot) onError(offset, "BAD_INDENT", "Block scalar values in collections must be indented");
				break;
			}
			offset += indent.length + content.length + 1;
		}
		for (let i = lines.length - 1; i >= chompStart; --i) if (lines[i][0].length > trimIndent) chompStart = i + 1;
		let value = "";
		let sep = "";
		let prevMoreIndented = false;
		for (let i = 0; i < contentStart; ++i) value += lines[i][0].slice(trimIndent) + "\n";
		for (let i = contentStart; i < chompStart; ++i) {
			let [indent, content] = lines[i];
			offset += indent.length + content.length + 1;
			const crlf = content[content.length - 1] === "\r";
			if (crlf) content = content.slice(0, -1);
			/* istanbul ignore if already caught in lexer */
			if (content && indent.length < trimIndent) {
				const message = `Block scalar lines must not be less indented than their ${header.indent ? "explicit indentation indicator" : "first line"}`;
				onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
				indent = "";
			}
			if (type === Scalar.Scalar.BLOCK_LITERAL) {
				value += sep + indent.slice(trimIndent) + content;
				sep = "\n";
			} else if (indent.length > trimIndent || content[0] === "	") {
				if (sep === " ") sep = "\n";
				else if (!prevMoreIndented && sep === "\n") sep = "\n\n";
				value += sep + indent.slice(trimIndent) + content;
				sep = "\n";
				prevMoreIndented = true;
			} else if (content === "") if (sep === "\n") value += "\n";
			else sep = "\n";
			else {
				value += sep + content;
				sep = " ";
				prevMoreIndented = false;
			}
		}
		switch (header.chomp) {
			case "-": break;
			case "+":
				for (let i = chompStart; i < lines.length; ++i) value += "\n" + lines[i][0].slice(trimIndent);
				if (value[value.length - 1] !== "\n") value += "\n";
				break;
			default: value += "\n";
		}
		const end = start + header.length + scalar.source.length;
		return {
			value,
			type,
			comment: header.comment,
			range: [
				start,
				end,
				end
			]
		};
	}
	function parseBlockScalarHeader({ offset, props }, strict, onError) {
		/* istanbul ignore if should not happen */
		if (props[0].type !== "block-scalar-header") {
			onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
			return null;
		}
		const { source } = props[0];
		const mode = source[0];
		let indent = 0;
		let chomp = "";
		let error = -1;
		for (let i = 1; i < source.length; ++i) {
			const ch = source[i];
			if (!chomp && (ch === "-" || ch === "+")) chomp = ch;
			else {
				const n = Number(ch);
				if (!indent && n) indent = n;
				else if (error === -1) error = offset + i;
			}
		}
		if (error !== -1) onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
		let hasSpace = false;
		let comment = "";
		let length = source.length;
		for (let i = 1; i < props.length; ++i) {
			const token = props[i];
			switch (token.type) {
				case "space": hasSpace = true;
				case "newline":
					length += token.source.length;
					break;
				case "comment":
					if (strict && !hasSpace) onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
					length += token.source.length;
					comment = token.source.substring(1);
					break;
				case "error":
					onError(token, "UNEXPECTED_TOKEN", token.message);
					length += token.source.length;
					break;
				/* istanbul ignore next should not happen */
				default: {
					onError(token, "UNEXPECTED_TOKEN", `Unexpected token in block scalar header: ${token.type}`);
					const ts = token.source;
					if (ts && typeof ts === "string") length += ts.length;
				}
			}
		}
		return {
			mode,
			indent,
			chomp,
			comment,
			length
		};
	}
	/** @returns Array of lines split up as `[indent, content]` */
	function splitLines(source) {
		const split = source.split(/\n( *)/);
		const first = split[0];
		const m = first.match(/^( *)/);
		const lines = [m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first]];
		for (let i = 1; i < split.length; i += 2) lines.push([split[i], split[i + 1]]);
		return lines;
	}
	exports.resolveBlockScalar = resolveBlockScalar;
}));
var require_resolve_flow_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Scalar = require_Scalar();
	var resolveEnd = require_resolve_end();
	function resolveFlowScalar(scalar, strict, onError) {
		const { offset, type, source, end } = scalar;
		let _type;
		let value;
		const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
		switch (type) {
			case "scalar":
				_type = Scalar.Scalar.PLAIN;
				value = plainValue(source, _onError);
				break;
			case "single-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_SINGLE;
				value = singleQuotedValue(source, _onError);
				break;
			case "double-quoted-scalar":
				_type = Scalar.Scalar.QUOTE_DOUBLE;
				value = doubleQuotedValue(source, _onError);
				break;
			/* istanbul ignore next should not happen */
			default:
				onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
				return {
					value: "",
					type: null,
					comment: "",
					range: [
						offset,
						offset + source.length,
						offset + source.length
					]
				};
		}
		const valueEnd = offset + source.length;
		const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
		return {
			value,
			type: _type,
			comment: re.comment,
			range: [
				offset,
				valueEnd,
				re.offset
			]
		};
	}
	function plainValue(source, onError) {
		let badChar = "";
		switch (source[0]) {
			/* istanbul ignore next should not happen */
			case "	":
				badChar = "a tab character";
				break;
			case ",":
				badChar = "flow indicator character ,";
				break;
			case "%":
				badChar = "directive indicator character %";
				break;
			case "|":
			case ">":
				badChar = `block scalar indicator ${source[0]}`;
				break;
			case "@":
			case "`":
				badChar = `reserved character ${source[0]}`;
				break;
		}
		if (badChar) onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
		return foldLines(source);
	}
	function singleQuotedValue(source, onError) {
		if (source[source.length - 1] !== "'" || source.length === 1) onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
		return foldLines(source.slice(1, -1)).replace(/''/g, "'");
	}
	function foldLines(source) {
		/**
		* The negative lookbehind here and in the `re` RegExp is to
		* prevent causing a polynomial search time in certain cases.
		*
		* The try-catch is for Safari, which doesn't support this yet:
		* https://caniuse.com/js-regexp-lookbehind
		*/
		let first, line;
		try {
			first = /* @__PURE__ */ new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
			line = /* @__PURE__ */ new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
		} catch {
			first = /(.*?)[ \t]*\r?\n/sy;
			line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
		}
		let match = first.exec(source);
		if (!match) return source;
		let res = match[1];
		let sep = " ";
		let pos = first.lastIndex;
		line.lastIndex = pos;
		while (match = line.exec(source)) {
			if (match[1] === "") if (sep === "\n") res += sep;
			else sep = "\n";
			else {
				res += sep + match[1];
				sep = " ";
			}
			pos = line.lastIndex;
		}
		const last = /[ \t]*(.*)/sy;
		last.lastIndex = pos;
		match = last.exec(source);
		return res + sep + (match?.[1] ?? "");
	}
	function doubleQuotedValue(source, onError) {
		let res = "";
		for (let i = 1; i < source.length - 1; ++i) {
			const ch = source[i];
			if (ch === "\r" && source[i + 1] === "\n") continue;
			if (ch === "\n") {
				const { fold, offset } = foldNewline(source, i);
				res += fold;
				i = offset;
			} else if (ch === "\\") {
				let next = source[++i];
				const cc = escapeCodes[next];
				if (cc) res += cc;
				else if (next === "\n") {
					next = source[i + 1];
					while (next === " " || next === "	") next = source[++i + 1];
				} else if (next === "\r" && source[i + 1] === "\n") {
					next = source[++i + 1];
					while (next === " " || next === "	") next = source[++i + 1];
				} else if (next === "x" || next === "u" || next === "U") {
					const length = next === "x" ? 2 : next === "u" ? 4 : 8;
					res += parseCharCode(source, i + 1, length, onError);
					i += length;
				} else {
					const raw = source.substr(i - 1, 2);
					onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
					res += raw;
				}
			} else if (ch === " " || ch === "	") {
				const wsStart = i;
				let next = source[i + 1];
				while (next === " " || next === "	") next = source[++i + 1];
				if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n")) res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
			} else res += ch;
		}
		if (source[source.length - 1] !== "\"" || source.length === 1) onError(source.length, "MISSING_CHAR", "Missing closing \"quote");
		return res;
	}
	/**
	* Fold a single newline into a space, multiple newlines to N - 1 newlines.
	* Presumes `source[offset] === '\n'`
	*/
	function foldNewline(source, offset) {
		let fold = "";
		let ch = source[offset + 1];
		while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
			if (ch === "\r" && source[offset + 2] !== "\n") break;
			if (ch === "\n") fold += "\n";
			offset += 1;
			ch = source[offset + 1];
		}
		if (!fold) fold = " ";
		return {
			fold,
			offset
		};
	}
	const escapeCodes = {
		"0": "\0",
		a: "\x07",
		b: "\b",
		e: "\x1B",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "	",
		v: "\v",
		N: "",
		_: "\xA0",
		L: "\u2028",
		P: "\u2029",
		" ": " ",
		"\"": "\"",
		"/": "/",
		"\\": "\\",
		"	": "	"
	};
	function parseCharCode(source, offset, length, onError) {
		const cc = source.substr(offset, length);
		const code = cc.length === length && /^[0-9a-fA-F]+$/.test(cc) ? parseInt(cc, 16) : NaN;
		try {
			return String.fromCodePoint(code);
		} catch {
			const raw = source.substr(offset - 2, length + 2);
			onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
			return raw;
		}
	}
	exports.resolveFlowScalar = resolveFlowScalar;
}));
var require_compose_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var identity = require_identity();
	var Scalar = require_Scalar();
	var resolveBlockScalar = require_resolve_block_scalar();
	var resolveFlowScalar = require_resolve_flow_scalar();
	function composeScalar(ctx, token, tagToken, onError) {
		const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
		const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
		let tag;
		if (ctx.options.stringKeys && ctx.atKey) tag = ctx.schema[identity.SCALAR];
		else if (tagName) tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
		else if (token.type === "scalar") tag = findScalarTagByTest(ctx, value, token, onError);
		else tag = ctx.schema[identity.SCALAR];
		let scalar;
		try {
			const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
			scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
			scalar = new Scalar.Scalar(value);
		}
		scalar.range = range;
		scalar.source = value;
		if (type) scalar.type = type;
		if (tagName) scalar.tag = tagName;
		if (tag.format) scalar.format = tag.format;
		if (comment) scalar.comment = comment;
		return scalar;
	}
	function findScalarTagByName(schema, value, tagName, tagToken, onError) {
		if (tagName === "!") return schema[identity.SCALAR];
		const matchWithTest = [];
		for (const tag of schema.tags) if (!tag.collection && tag.tag === tagName) if (tag.default && tag.test) matchWithTest.push(tag);
		else return tag;
		for (const tag of matchWithTest) if (tag.test?.test(value)) return tag;
		const kt = schema.knownTags[tagName];
		if (kt && !kt.collection) {
			schema.tags.push(Object.assign({}, kt, {
				default: false,
				test: void 0
			}));
			return kt;
		}
		onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
		return schema[identity.SCALAR];
	}
	function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
		const tag = schema.tags.find((tag) => (tag.default === true || atKey && tag.default === "key") && tag.test?.test(value)) || schema[identity.SCALAR];
		if (schema.compat) {
			const compat = schema.compat.find((tag) => tag.default && tag.test?.test(value)) ?? schema[identity.SCALAR];
			if (tag.tag !== compat.tag) onError(token, "TAG_RESOLVE_FAILED", `Value may be parsed as either ${directives.tagString(tag.tag)} or ${directives.tagString(compat.tag)}`, true);
		}
		return tag;
	}
	exports.composeScalar = composeScalar;
}));
var require_util_empty_scalar_position = /* @__PURE__ */ __commonJSMin(((exports) => {
	function emptyScalarPosition(offset, before, pos) {
		if (before) {
			pos ?? (pos = before.length);
			for (let i = pos - 1; i >= 0; --i) {
				let st = before[i];
				switch (st.type) {
					case "space":
					case "comment":
					case "newline":
						offset -= st.source.length;
						continue;
				}
				st = before[++i];
				while (st?.type === "space") {
					offset += st.source.length;
					st = before[++i];
				}
				break;
			}
		}
		return offset;
	}
	exports.emptyScalarPosition = emptyScalarPosition;
}));
var require_compose_node = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Alias = require_Alias();
	var identity = require_identity();
	var composeCollection = require_compose_collection();
	var composeScalar = require_compose_scalar();
	var resolveEnd = require_resolve_end();
	var utilEmptyScalarPosition = require_util_empty_scalar_position();
	const CN = {
		composeNode,
		composeEmptyNode
	};
	function composeNode(ctx, token, props, onError) {
		const atKey = ctx.atKey;
		const { spaceBefore, comment, anchor, tag } = props;
		let node;
		let isSrcToken = true;
		switch (token.type) {
			case "alias":
				node = composeAlias(ctx, token, onError);
				if (anchor || tag) onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
				break;
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "block-scalar":
				node = composeScalar.composeScalar(ctx, token, tag, onError);
				if (anchor) node.anchor = anchor.source.substring(1);
				break;
			case "block-map":
			case "block-seq":
			case "flow-collection":
				try {
					node = composeCollection.composeCollection(CN, ctx, token, props, onError);
					if (anchor) node.anchor = anchor.source.substring(1);
				} catch (error) {
					onError(token, "RESOURCE_EXHAUSTION", error instanceof Error ? error.message : String(error));
				}
				break;
			default:
				onError(token, "UNEXPECTED_TOKEN", token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`);
				isSrcToken = false;
		}
		node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
		if (anchor && node.anchor === "") onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
		if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) onError(tag ?? token, "NON_STRING_KEY", "With stringKeys, all keys must be strings");
		if (spaceBefore) node.spaceBefore = true;
		if (comment) if (token.type === "scalar" && token.source === "") node.comment = comment;
		else node.commentBefore = comment;
		if (ctx.options.keepSourceTokens && isSrcToken) node.srcToken = token;
		return node;
	}
	function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
		const token = {
			type: "scalar",
			offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
			indent: -1,
			source: ""
		};
		const node = composeScalar.composeScalar(ctx, token, tag, onError);
		if (anchor) {
			node.anchor = anchor.source.substring(1);
			if (node.anchor === "") onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
		}
		if (spaceBefore) node.spaceBefore = true;
		if (comment) {
			node.comment = comment;
			node.range[2] = end;
		}
		return node;
	}
	function composeAlias({ options }, { offset, source, end }, onError) {
		const alias = new Alias.Alias(source.substring(1));
		if (alias.source === "") onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
		if (alias.source.endsWith(":")) onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
		const valueEnd = offset + source.length;
		const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
		alias.range = [
			offset,
			valueEnd,
			re.offset
		];
		if (re.comment) alias.comment = re.comment;
		return alias;
	}
	exports.composeEmptyNode = composeEmptyNode;
	exports.composeNode = composeNode;
}));
var require_compose_doc = /* @__PURE__ */ __commonJSMin(((exports) => {
	var Document = require_Document();
	var composeNode = require_compose_node();
	var resolveEnd = require_resolve_end();
	var resolveProps = require_resolve_props();
	function composeDoc(options, directives, { offset, start, value, end }, onError) {
		const opts = Object.assign({ _directives: directives }, options);
		const doc = new Document.Document(void 0, opts);
		const ctx = {
			atKey: false,
			atRoot: true,
			directives: doc.directives,
			options: doc.options,
			schema: doc.schema
		};
		const props = resolveProps.resolveProps(start, {
			indicator: "doc-start",
			next: value ?? end?.[0],
			offset,
			onError,
			parentIndent: 0,
			startOnNewline: true
		});
		if (props.found) {
			doc.directives.docStart = true;
			if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline) onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
		}
		doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
		const contentEnd = doc.contents.range[2];
		const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
		if (re.comment) doc.comment = re.comment;
		doc.range = [
			offset,
			contentEnd,
			re.offset
		];
		return doc;
	}
	exports.composeDoc = composeDoc;
}));
var require_composer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process$1 = __require("process");
	var directives = require_directives();
	var Document = require_Document();
	var errors = require_errors();
	var identity = require_identity();
	var composeDoc = require_compose_doc();
	var resolveEnd = require_resolve_end();
	function getErrorPos(src) {
		if (typeof src === "number") return [src, src + 1];
		if (Array.isArray(src)) return src.length === 2 ? src : [src[0], src[1]];
		const { offset, source } = src;
		return [offset, offset + (typeof source === "string" ? source.length : 1)];
	}
	function parsePrelude(prelude) {
		let comment = "";
		let atComment = false;
		let afterEmptyLine = false;
		for (let i = 0; i < prelude.length; ++i) {
			const source = prelude[i];
			switch (source[0]) {
				case "#":
					comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
					atComment = true;
					afterEmptyLine = false;
					break;
				case "%":
					if (prelude[i + 1]?.[0] !== "#") i += 1;
					atComment = false;
					break;
				default:
					if (!atComment) afterEmptyLine = true;
					atComment = false;
			}
		}
		return {
			comment,
			afterEmptyLine
		};
	}
	/**
	* Compose a stream of CST nodes into a stream of YAML Documents.
	*
	* ```ts
	* import { Composer, Parser } from 'yaml'
	*
	* const src: string = ...
	* const tokens = new Parser().parse(src)
	* const docs = new Composer().compose(tokens)
	* ```
	*/
	var Composer = class {
		constructor(options = {}) {
			this.doc = null;
			this.atDirectives = false;
			this.prelude = [];
			this.errors = [];
			this.warnings = [];
			this.onError = (source, code, message, warning) => {
				const pos = getErrorPos(source);
				if (warning) this.warnings.push(new errors.YAMLWarning(pos, code, message));
				else this.errors.push(new errors.YAMLParseError(pos, code, message));
			};
			this.directives = new directives.Directives({ version: options.version || "1.2" });
			this.options = options;
		}
		decorate(doc, afterDoc) {
			const { comment, afterEmptyLine } = parsePrelude(this.prelude);
			if (comment) {
				const dc = doc.contents;
				if (afterDoc) doc.comment = doc.comment ? `${doc.comment}\n${comment}` : comment;
				else if (afterEmptyLine || doc.directives.docStart || !dc) doc.commentBefore = comment;
				else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
					let it = dc.items[0];
					if (identity.isPair(it)) it = it.key;
					const cb = it.commentBefore;
					it.commentBefore = cb ? `${comment}\n${cb}` : comment;
				} else {
					const cb = dc.commentBefore;
					dc.commentBefore = cb ? `${comment}\n${cb}` : comment;
				}
			}
			if (afterDoc) {
				for (let i = 0; i < this.errors.length; ++i) doc.errors.push(this.errors[i]);
				for (let i = 0; i < this.warnings.length; ++i) doc.warnings.push(this.warnings[i]);
			} else {
				doc.errors = this.errors;
				doc.warnings = this.warnings;
			}
			this.prelude = [];
			this.errors = [];
			this.warnings = [];
		}
		/**
		* Current stream status information.
		*
		* Mostly useful at the end of input for an empty stream.
		*/
		streamInfo() {
			return {
				comment: parsePrelude(this.prelude).comment,
				directives: this.directives,
				errors: this.errors,
				warnings: this.warnings
			};
		}
		/**
		* Compose tokens into documents.
		*
		* @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
		* @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
		*/
		*compose(tokens, forceDoc = false, endOffset = -1) {
			for (const token of tokens) yield* this.next(token);
			yield* this.end(forceDoc, endOffset);
		}
		/** Advance the composer by one CST token. */
		*next(token) {
			if (node_process$1.env.LOG_STREAM) console.dir(token, { depth: null });
			switch (token.type) {
				case "directive":
					this.directives.add(token.source, (offset, message, warning) => {
						const pos = getErrorPos(token);
						pos[0] += offset;
						this.onError(pos, "BAD_DIRECTIVE", message, warning);
					});
					this.prelude.push(token.source);
					this.atDirectives = true;
					break;
				case "document": {
					const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
					if (this.atDirectives && !doc.directives.docStart) this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
					this.decorate(doc, false);
					if (this.doc) yield this.doc;
					this.doc = doc;
					this.atDirectives = false;
					break;
				}
				case "byte-order-mark":
				case "space": break;
				case "comment":
				case "newline":
					this.prelude.push(token.source);
					break;
				case "error": {
					const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
					const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
					if (this.atDirectives || !this.doc) this.errors.push(error);
					else this.doc.errors.push(error);
					break;
				}
				case "doc-end": {
					if (!this.doc) {
						this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", "Unexpected doc-end without preceding document"));
						break;
					}
					this.doc.directives.docEnd = true;
					const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
					this.decorate(this.doc, true);
					if (end.comment) {
						const dc = this.doc.comment;
						this.doc.comment = dc ? `${dc}\n${end.comment}` : end.comment;
					}
					this.doc.range[2] = end.offset;
					break;
				}
				default: this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
			}
		}
		/**
		* Call at end of input to yield any remaining document.
		*
		* @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
		* @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
		*/
		*end(forceDoc = false, endOffset = -1) {
			if (this.doc) {
				this.decorate(this.doc, true);
				yield this.doc;
				this.doc = null;
			} else if (forceDoc) {
				const opts = Object.assign({ _directives: this.directives }, this.options);
				const doc = new Document.Document(void 0, opts);
				if (this.atDirectives) this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
				doc.range = [
					0,
					endOffset,
					endOffset
				];
				this.decorate(doc, false);
				yield doc;
			}
		}
	};
	exports.Composer = Composer;
}));
var require_cst_scalar = /* @__PURE__ */ __commonJSMin(((exports) => {
	var resolveBlockScalar = require_resolve_block_scalar();
	var resolveFlowScalar = require_resolve_flow_scalar();
	var errors = require_errors();
	var stringifyString = require_stringifyString();
	function resolveAsScalar(token, strict = true, onError) {
		if (token) {
			const _onError = (pos, code, message) => {
				const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
				if (onError) onError(offset, code, message);
				else throw new errors.YAMLParseError([offset, offset + 1], code, message);
			};
			switch (token.type) {
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
				case "block-scalar": return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
			}
		}
		return null;
	}
	/**
	* Create a new scalar token with `value`
	*
	* Values that represent an actual string but may be parsed as a different type should use a `type` other than `'PLAIN'`,
	* as this function does not support any schema operations and won't check for such conflicts.
	*
	* @param value The string representation of the value, which will have its content properly indented.
	* @param context.end Comments and whitespace after the end of the value, or after the block scalar header. If undefined, a newline will be added.
	* @param context.implicitKey Being within an implicit key may affect the resolved type of the token's value.
	* @param context.indent The indent level of the token.
	* @param context.inFlow Is this scalar within a flow collection? This may affect the resolved type of the token's value.
	* @param context.offset The offset position of the token.
	* @param context.type The preferred type of the scalar token. If undefined, the previous type of the `token` will be used, defaulting to `'PLAIN'`.
	*/
	function createScalarToken(value, context) {
		const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
		const source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey,
			indent: indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: true,
				lineWidth: -1
			}
		});
		const end = context.end ?? [{
			type: "newline",
			offset: -1,
			indent,
			source: "\n"
		}];
		switch (source[0]) {
			case "|":
			case ">": {
				const he = source.indexOf("\n");
				const head = source.substring(0, he);
				const body = source.substring(he + 1) + "\n";
				const props = [{
					type: "block-scalar-header",
					offset,
					indent,
					source: head
				}];
				if (!addEndtoBlockProps(props, end)) props.push({
					type: "newline",
					offset: -1,
					indent,
					source: "\n"
				});
				return {
					type: "block-scalar",
					offset,
					indent,
					props,
					source: body
				};
			}
			case "\"": return {
				type: "double-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			case "'": return {
				type: "single-quoted-scalar",
				offset,
				indent,
				source,
				end
			};
			default: return {
				type: "scalar",
				offset,
				indent,
				source,
				end
			};
		}
	}
	/**
	* Set the value of `token` to the given string `value`, overwriting any previous contents and type that it may have.
	*
	* Best efforts are made to retain any comments previously associated with the `token`,
	* though all contents within a collection's `items` will be overwritten.
	*
	* Values that represent an actual string but may be parsed as a different type should use a `type` other than `'PLAIN'`,
	* as this function does not support any schema operations and won't check for such conflicts.
	*
	* @param token Any token. If it does not include an `indent` value, the value will be stringified as if it were an implicit key.
	* @param value The string representation of the value, which will have its content properly indented.
	* @param context.afterKey In most cases, values after a key should have an additional level of indentation.
	* @param context.implicitKey Being within an implicit key may affect the resolved type of the token's value.
	* @param context.inFlow Being within a flow collection may affect the resolved type of the token's value.
	* @param context.type The preferred type of the scalar token. If undefined, the previous type of the `token` will be used, defaulting to `'PLAIN'`.
	*/
	function setScalarValue(token, value, context = {}) {
		let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
		let indent = "indent" in token ? token.indent : null;
		if (afterKey && typeof indent === "number") indent += 2;
		if (!type) switch (token.type) {
			case "single-quoted-scalar":
				type = "QUOTE_SINGLE";
				break;
			case "double-quoted-scalar":
				type = "QUOTE_DOUBLE";
				break;
			case "block-scalar": {
				const header = token.props[0];
				if (header.type !== "block-scalar-header") throw new Error("Invalid block scalar header");
				type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
				break;
			}
			default: type = "PLAIN";
		}
		const source = stringifyString.stringifyString({
			type,
			value
		}, {
			implicitKey: implicitKey || indent === null,
			indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
			inFlow,
			options: {
				blockQuote: true,
				lineWidth: -1
			}
		});
		switch (source[0]) {
			case "|":
			case ">":
				setBlockScalarValue(token, source);
				break;
			case "\"":
				setFlowScalarValue(token, source, "double-quoted-scalar");
				break;
			case "'":
				setFlowScalarValue(token, source, "single-quoted-scalar");
				break;
			default: setFlowScalarValue(token, source, "scalar");
		}
	}
	function setBlockScalarValue(token, source) {
		const he = source.indexOf("\n");
		const head = source.substring(0, he);
		const body = source.substring(he + 1) + "\n";
		if (token.type === "block-scalar") {
			const header = token.props[0];
			if (header.type !== "block-scalar-header") throw new Error("Invalid block scalar header");
			header.source = head;
			token.source = body;
		} else {
			const { offset } = token;
			const indent = "indent" in token ? token.indent : -1;
			const props = [{
				type: "block-scalar-header",
				offset,
				indent,
				source: head
			}];
			if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0)) props.push({
				type: "newline",
				offset: -1,
				indent,
				source: "\n"
			});
			for (const key of Object.keys(token)) if (key !== "type" && key !== "offset") delete token[key];
			Object.assign(token, {
				type: "block-scalar",
				indent,
				props,
				source: body
			});
		}
	}
	/** @returns `true` if last token is a newline */
	function addEndtoBlockProps(props, end) {
		if (end) for (const st of end) switch (st.type) {
			case "space":
			case "comment":
				props.push(st);
				break;
			case "newline":
				props.push(st);
				return true;
		}
		return false;
	}
	function setFlowScalarValue(token, source, type) {
		switch (token.type) {
			case "scalar":
			case "double-quoted-scalar":
			case "single-quoted-scalar":
				token.type = type;
				token.source = source;
				break;
			case "block-scalar": {
				const end = token.props.slice(1);
				let oa = source.length;
				if (token.props[0].type === "block-scalar-header") oa -= token.props[0].source.length;
				for (const tok of end) tok.offset += oa;
				delete token.props;
				Object.assign(token, {
					type,
					source,
					end
				});
				break;
			}
			case "block-map":
			case "block-seq": {
				const nl = {
					type: "newline",
					offset: token.offset + source.length,
					indent: token.indent,
					source: "\n"
				};
				delete token.items;
				Object.assign(token, {
					type,
					source,
					end: [nl]
				});
				break;
			}
			default: {
				const indent = "indent" in token ? token.indent : -1;
				const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
				for (const key of Object.keys(token)) if (key !== "type" && key !== "offset") delete token[key];
				Object.assign(token, {
					type,
					indent,
					source,
					end
				});
			}
		}
	}
	exports.createScalarToken = createScalarToken;
	exports.resolveAsScalar = resolveAsScalar;
	exports.setScalarValue = setScalarValue;
}));
var require_cst_stringify = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Stringify a CST document, token, or collection item
	*
	* Fair warning: This applies no validation whatsoever, and
	* simply concatenates the sources in their logical order.
	*/
	const stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
	function stringifyToken(token) {
		switch (token.type) {
			case "block-scalar": {
				let res = "";
				for (const tok of token.props) res += stringifyToken(tok);
				return res + token.source;
			}
			case "block-map":
			case "block-seq": {
				let res = "";
				for (const item of token.items) res += stringifyItem(item);
				return res;
			}
			case "flow-collection": {
				let res = token.start.source;
				for (const item of token.items) res += stringifyItem(item);
				for (const st of token.end) res += st.source;
				return res;
			}
			case "document": {
				let res = stringifyItem(token);
				if (token.end) for (const st of token.end) res += st.source;
				return res;
			}
			default: {
				let res = token.source;
				if ("end" in token && token.end) for (const st of token.end) res += st.source;
				return res;
			}
		}
	}
	function stringifyItem({ start, key, sep, value }) {
		let res = "";
		for (const st of start) res += st.source;
		if (key) res += stringifyToken(key);
		if (sep) for (const st of sep) res += st.source;
		if (value) res += stringifyToken(value);
		return res;
	}
	exports.stringify = stringify;
}));
var require_cst_visit = /* @__PURE__ */ __commonJSMin(((exports) => {
	const BREAK = Symbol("break visit");
	const SKIP = Symbol("skip children");
	const REMOVE = Symbol("remove item");
	/**
	* Apply a visitor to a CST document or item.
	*
	* Walks through the tree (depth-first) starting from the root, calling a
	* `visitor` function with two arguments when entering each item:
	*   - `item`: The current item, which included the following members:
	*     - `start: SourceToken[]` – Source tokens before the key or value,
	*       possibly including its anchor or tag.
	*     - `key?: Token | null` – Set for pair values. May then be `null`, if
	*       the key before the `:` separator is empty.
	*     - `sep?: SourceToken[]` – Source tokens between the key and the value,
	*       which should include the `:` map value indicator if `value` is set.
	*     - `value?: Token` – The value of a sequence item, or of a map pair.
	*   - `path`: The steps from the root to the current node, as an array of
	*     `['key' | 'value', number]` tuples.
	*
	* The return value of the visitor may be used to control the traversal:
	*   - `undefined` (default): Do nothing and continue
	*   - `visit.SKIP`: Do not visit the children of this token, continue with
	*      next sibling
	*   - `visit.BREAK`: Terminate traversal completely
	*   - `visit.REMOVE`: Remove the current item, then continue with the next one
	*   - `number`: Set the index of the next step. This is useful especially if
	*     the index of the current token has changed.
	*   - `function`: Define the next visitor for this item. After the original
	*     visitor is called on item entry, next visitors are called after handling
	*     a non-empty `key` and when exiting the item.
	*/
	function visit(cst, visitor) {
		if ("type" in cst && cst.type === "document") cst = {
			start: cst.start,
			value: cst.value
		};
		_visit(Object.freeze([]), cst, visitor);
	}
	/** Terminate visit traversal completely */
	visit.BREAK = BREAK;
	/** Do not visit the children of the current item */
	visit.SKIP = SKIP;
	/** Remove the current item */
	visit.REMOVE = REMOVE;
	/** Find the item at `path` from `cst` as the root */
	visit.itemAtPath = (cst, path) => {
		let item = cst;
		for (const [field, index] of path) {
			const tok = item?.[field];
			if (tok && "items" in tok) item = tok.items[index];
			else return void 0;
		}
		return item;
	};
	/**
	* Get the immediate parent collection of the item at `path` from `cst` as the root.
	*
	* Throws an error if the collection is not found, which should never happen if the item itself exists.
	*/
	visit.parentCollection = (cst, path) => {
		const parent = visit.itemAtPath(cst, path.slice(0, -1));
		const field = path[path.length - 1][0];
		const coll = parent?.[field];
		if (coll && "items" in coll) return coll;
		throw new Error("Parent collection not found");
	};
	function _visit(path, item, visitor) {
		let ctrl = visitor(item, path);
		if (typeof ctrl === "symbol") return ctrl;
		for (const field of ["key", "value"]) {
			const token = item[field];
			if (token && "items" in token) {
				for (let i = 0; i < token.items.length; ++i) {
					const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
					if (typeof ci === "number") i = ci - 1;
					else if (ci === BREAK) return BREAK;
					else if (ci === REMOVE) {
						token.items.splice(i, 1);
						i -= 1;
					}
				}
				if (typeof ctrl === "function" && field === "key") ctrl = ctrl(item, path);
			}
		}
		return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
	}
	exports.visit = visit;
}));
var require_cst = /* @__PURE__ */ __commonJSMin(((exports) => {
	var cstScalar = require_cst_scalar();
	var cstStringify = require_cst_stringify();
	var cstVisit = require_cst_visit();
	/** The byte order mark */
	const BOM = "﻿";
	/** Start of doc-mode */
	const DOCUMENT = "";
	/** Unexpected end of flow-mode */
	const FLOW_END = "";
	/** Next token is a scalar value */
	const SCALAR = "";
	/** @returns `true` if `token` is a flow or block collection */
	const isCollection = (token) => !!token && "items" in token;
	/** @returns `true` if `token` is a flow or block scalar; not an alias */
	const isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
	/* istanbul ignore next */
	/** Get a printable representation of a lexer token */
	function prettyToken(token) {
		switch (token) {
			case BOM: return "<BOM>";
			case DOCUMENT: return "<DOC>";
			case FLOW_END: return "<FLOW_END>";
			case SCALAR: return "<SCALAR>";
			default: return JSON.stringify(token);
		}
	}
	/** Identify the type of a lexer token. May return `null` for unknown tokens. */
	function tokenType(source) {
		switch (source) {
			case BOM: return "byte-order-mark";
			case DOCUMENT: return "doc-mode";
			case FLOW_END: return "flow-error-end";
			case SCALAR: return "scalar";
			case "---": return "doc-start";
			case "...": return "doc-end";
			case "":
			case "\n":
			case "\r\n": return "newline";
			case "-": return "seq-item-ind";
			case "?": return "explicit-key-ind";
			case ":": return "map-value-ind";
			case "{": return "flow-map-start";
			case "}": return "flow-map-end";
			case "[": return "flow-seq-start";
			case "]": return "flow-seq-end";
			case ",": return "comma";
		}
		switch (source[0]) {
			case " ":
			case "	": return "space";
			case "#": return "comment";
			case "%": return "directive-line";
			case "*": return "alias";
			case "&": return "anchor";
			case "!": return "tag";
			case "'": return "single-quoted-scalar";
			case "\"": return "double-quoted-scalar";
			case "|":
			case ">": return "block-scalar-header";
		}
		return null;
	}
	exports.createScalarToken = cstScalar.createScalarToken;
	exports.resolveAsScalar = cstScalar.resolveAsScalar;
	exports.setScalarValue = cstScalar.setScalarValue;
	exports.stringify = cstStringify.stringify;
	exports.visit = cstVisit.visit;
	exports.BOM = BOM;
	exports.DOCUMENT = DOCUMENT;
	exports.FLOW_END = FLOW_END;
	exports.SCALAR = SCALAR;
	exports.isCollection = isCollection;
	exports.isScalar = isScalar;
	exports.prettyToken = prettyToken;
	exports.tokenType = tokenType;
}));
var require_lexer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var cst = require_cst();
	function isEmpty(ch) {
		switch (ch) {
			case void 0:
			case " ":
			case "\n":
			case "\r":
			case "	": return true;
			default: return false;
		}
	}
	const hexDigits = /* @__PURE__ */ new Set("0123456789ABCDEFabcdef");
	const tagChars = /* @__PURE__ */ new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
	const flowIndicatorChars = /* @__PURE__ */ new Set(",[]{}");
	const invalidAnchorChars = /* @__PURE__ */ new Set(" ,[]{}\n\r	");
	const isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
	/**
	* Splits an input string into lexical tokens, i.e. smaller strings that are
	* easily identifiable by `tokens.tokenType()`.
	*
	* Lexing starts always in a "stream" context. Incomplete input may be buffered
	* until a complete token can be emitted.
	*
	* In addition to slices of the original input, the following control characters
	* may also be emitted:
	*
	* - `\x02` (Start of Text): A document starts with the next token
	* - `\x18` (Cancel): Unexpected end of flow-mode (indicates an error)
	* - `\x1f` (Unit Separator): Next token is a scalar value
	* - `\u{FEFF}` (Byte order mark): Emitted separately outside documents
	*/
	var Lexer = class {
		constructor() {
			/**
			* Flag indicating whether the end of the current buffer marks the end of
			* all input
			*/
			this.atEnd = false;
			/**
			* Explicit indent set in block scalar header, as an offset from the current
			* minimum indent, so e.g. set to 1 from a header `|2+`. Set to -1 if not
			* explicitly set.
			*/
			this.blockScalarIndent = -1;
			/**
			* Block scalars that include a + (keep) chomping indicator in their header
			* include trailing empty lines, which are otherwise excluded from the
			* scalar's contents.
			*/
			this.blockScalarKeep = false;
			/** Current input */
			this.buffer = "";
			/**
			* Flag noting whether the map value indicator : can immediately follow this
			* node within a flow context.
			*/
			this.flowKey = false;
			/** Count of surrounding flow collection levels. */
			this.flowLevel = 0;
			/**
			* Minimum level of indentation required for next lines to be parsed as a
			* part of the current scalar value.
			*/
			this.indentNext = 0;
			/** Indentation level of the current line. */
			this.indentValue = 0;
			/** Position of the next \n character. */
			this.lineEndPos = null;
			/** Stores the state of the lexer if reaching the end of incpomplete input */
			this.next = null;
			/** A pointer to `buffer`; the current position of the lexer. */
			this.pos = 0;
		}
		/**
		* Generate YAML tokens from the `source` string. If `incomplete`,
		* a part of the last line may be left as a buffer for the next call.
		*
		* @returns A generator of lexical tokens
		*/
		*lex(source, incomplete = false) {
			if (source) {
				if (typeof source !== "string") throw TypeError("source is not a string");
				this.buffer = this.buffer ? this.buffer + source : source;
				this.lineEndPos = null;
			}
			this.atEnd = !incomplete;
			let next = this.next ?? "stream";
			while (next && (incomplete || this.hasChars(1))) next = yield* this.parseNext(next);
		}
		atLineEnd() {
			let i = this.pos;
			let ch = this.buffer[i];
			while (ch === " " || ch === "	") ch = this.buffer[++i];
			if (!ch || ch === "#" || ch === "\n") return true;
			if (ch === "\r") return this.buffer[i + 1] === "\n";
			return false;
		}
		charAt(n) {
			return this.buffer[this.pos + n];
		}
		continueScalar(offset) {
			let ch = this.buffer[offset];
			if (this.indentNext > 0) {
				let indent = 0;
				while (ch === " ") ch = this.buffer[++indent + offset];
				if (ch === "\r") {
					const next = this.buffer[indent + offset + 1];
					if (next === "\n" || !next && !this.atEnd) return offset + indent + 1;
				}
				return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
			}
			if (ch === "-" || ch === ".") {
				const dt = this.buffer.substr(offset, 3);
				if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3])) return -1;
			}
			return offset;
		}
		getLine() {
			let end = this.lineEndPos;
			if (typeof end !== "number" || end !== -1 && end < this.pos) {
				end = this.buffer.indexOf("\n", this.pos);
				this.lineEndPos = end;
			}
			if (end === -1) return this.atEnd ? this.buffer.substring(this.pos) : null;
			if (this.buffer[end - 1] === "\r") end -= 1;
			return this.buffer.substring(this.pos, end);
		}
		hasChars(n) {
			return this.pos + n <= this.buffer.length;
		}
		setNext(state) {
			this.buffer = this.buffer.substring(this.pos);
			this.pos = 0;
			this.lineEndPos = null;
			this.next = state;
			return null;
		}
		peek(n) {
			return this.buffer.substr(this.pos, n);
		}
		*parseNext(next) {
			switch (next) {
				case "stream": return yield* this.parseStream();
				case "line-start": return yield* this.parseLineStart();
				case "block-start": return yield* this.parseBlockStart();
				case "doc": return yield* this.parseDocument();
				case "flow": return yield* this.parseFlowCollection();
				case "quoted-scalar": return yield* this.parseQuotedScalar();
				case "block-scalar": return yield* this.parseBlockScalar();
				case "plain-scalar": return yield* this.parsePlainScalar();
			}
		}
		*parseStream() {
			let line = this.getLine();
			if (line === null) return this.setNext("stream");
			if (line[0] === cst.BOM) {
				yield* this.pushCount(1);
				line = line.substring(1);
			}
			if (line[0] === "%") {
				let dirEnd = line.length;
				let cs = line.indexOf("#");
				while (cs !== -1) {
					const ch = line[cs - 1];
					if (ch === " " || ch === "	") {
						dirEnd = cs - 1;
						break;
					} else cs = line.indexOf("#", cs + 1);
				}
				while (true) {
					const ch = line[dirEnd - 1];
					if (ch === " " || ch === "	") dirEnd -= 1;
					else break;
				}
				const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
				yield* this.pushCount(line.length - n);
				this.pushNewline();
				return "stream";
			}
			if (this.atLineEnd()) {
				const sp = yield* this.pushSpaces(true);
				yield* this.pushCount(line.length - sp);
				yield* this.pushNewline();
				return "stream";
			}
			yield cst.DOCUMENT;
			return yield* this.parseLineStart();
		}
		*parseLineStart() {
			const ch = this.charAt(0);
			if (!ch && !this.atEnd) return this.setNext("line-start");
			if (ch === "-" || ch === ".") {
				if (!this.atEnd && !this.hasChars(4)) return this.setNext("line-start");
				const s = this.peek(3);
				if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
					yield* this.pushCount(3);
					this.indentValue = 0;
					this.indentNext = 0;
					return s === "---" ? "doc" : "stream";
				}
			}
			this.indentValue = yield* this.pushSpaces(false);
			if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1))) this.indentNext = this.indentValue;
			return yield* this.parseBlockStart();
		}
		*parseBlockStart() {
			const [ch0, ch1] = this.peek(2);
			if (!ch1 && !this.atEnd) return this.setNext("block-start");
			if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
				const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
				this.indentNext = this.indentValue + 1;
				this.indentValue += n;
				return "block-start";
			}
			return "doc";
		}
		*parseDocument() {
			yield* this.pushSpaces(true);
			const line = this.getLine();
			if (line === null) return this.setNext("doc");
			let n = yield* this.pushIndicators();
			switch (line[n]) {
				case "#": yield* this.pushCount(line.length - n);
				case void 0:
					yield* this.pushNewline();
					return yield* this.parseLineStart();
				case "{":
				case "[":
					yield* this.pushCount(1);
					this.flowKey = false;
					this.flowLevel = 1;
					return "flow";
				case "}":
				case "]":
					yield* this.pushCount(1);
					return "doc";
				case "*":
					yield* this.pushUntil(isNotAnchorChar);
					return "doc";
				case "\"":
				case "'": return yield* this.parseQuotedScalar();
				case "|":
				case ">":
					n += yield* this.parseBlockScalarHeader();
					n += yield* this.pushSpaces(true);
					yield* this.pushCount(line.length - n);
					yield* this.pushNewline();
					return yield* this.parseBlockScalar();
				default: return yield* this.parsePlainScalar();
			}
		}
		*parseFlowCollection() {
			let nl, sp;
			let indent = -1;
			do {
				nl = yield* this.pushNewline();
				if (nl > 0) {
					sp = yield* this.pushSpaces(false);
					this.indentValue = indent = sp;
				} else sp = 0;
				sp += yield* this.pushSpaces(true);
			} while (nl + sp > 0);
			const line = this.getLine();
			if (line === null) return this.setNext("flow");
			if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
				if (!(indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}"))) {
					this.flowLevel = 0;
					yield cst.FLOW_END;
					return yield* this.parseLineStart();
				}
			}
			let n = 0;
			while (line[n] === ",") {
				n += yield* this.pushCount(1);
				n += yield* this.pushSpaces(true);
				this.flowKey = false;
			}
			n += yield* this.pushIndicators();
			switch (line[n]) {
				case void 0: return "flow";
				case "#":
					yield* this.pushCount(line.length - n);
					return "flow";
				case "{":
				case "[":
					yield* this.pushCount(1);
					this.flowKey = false;
					this.flowLevel += 1;
					return "flow";
				case "}":
				case "]":
					yield* this.pushCount(1);
					this.flowKey = true;
					this.flowLevel -= 1;
					return this.flowLevel ? "flow" : "doc";
				case "*":
					yield* this.pushUntil(isNotAnchorChar);
					return "flow";
				case "\"":
				case "'":
					this.flowKey = true;
					return yield* this.parseQuotedScalar();
				case ":": {
					const next = this.charAt(1);
					if (this.flowKey || isEmpty(next) || next === ",") {
						this.flowKey = false;
						yield* this.pushCount(1);
						yield* this.pushSpaces(true);
						return "flow";
					}
				}
				default:
					this.flowKey = false;
					return yield* this.parsePlainScalar();
			}
		}
		*parseQuotedScalar() {
			const quote = this.charAt(0);
			let end = this.buffer.indexOf(quote, this.pos + 1);
			if (quote === "'") while (end !== -1 && this.buffer[end + 1] === "'") end = this.buffer.indexOf("'", end + 2);
			else while (end !== -1) {
				let n = 0;
				while (this.buffer[end - 1 - n] === "\\") n += 1;
				if (n % 2 === 0) break;
				end = this.buffer.indexOf("\"", end + 1);
			}
			const qb = this.buffer.substring(0, end);
			let nl = qb.indexOf("\n", this.pos);
			if (nl !== -1) {
				while (nl !== -1) {
					const cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = qb.indexOf("\n", cs);
				}
				if (nl !== -1) end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
			}
			if (end === -1) {
				if (!this.atEnd) return this.setNext("quoted-scalar");
				end = this.buffer.length;
			}
			yield* this.pushToIndex(end + 1, false);
			return this.flowLevel ? "flow" : "doc";
		}
		*parseBlockScalarHeader() {
			this.blockScalarIndent = -1;
			this.blockScalarKeep = false;
			let i = this.pos;
			while (true) {
				const ch = this.buffer[++i];
				if (ch === "+") this.blockScalarKeep = true;
				else if (ch > "0" && ch <= "9") this.blockScalarIndent = Number(ch) - 1;
				else if (ch !== "-") break;
			}
			return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
		}
		*parseBlockScalar() {
			let nl = this.pos - 1;
			let indent = 0;
			let ch;
			loop: for (let i = this.pos; ch = this.buffer[i]; ++i) switch (ch) {
				case " ":
					indent += 1;
					break;
				case "\n":
					nl = i;
					indent = 0;
					break;
				case "\r": {
					const next = this.buffer[i + 1];
					if (!next && !this.atEnd) return this.setNext("block-scalar");
					if (next === "\n") break;
				}
				default: break loop;
			}
			if (!ch && !this.atEnd) return this.setNext("block-scalar");
			if (indent >= this.indentNext) {
				if (this.blockScalarIndent === -1) this.indentNext = indent;
				else this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
				do {
					const cs = this.continueScalar(nl + 1);
					if (cs === -1) break;
					nl = this.buffer.indexOf("\n", cs);
				} while (nl !== -1);
				if (nl === -1) {
					if (!this.atEnd) return this.setNext("block-scalar");
					nl = this.buffer.length;
				}
			}
			let i = nl + 1;
			ch = this.buffer[i];
			while (ch === " ") ch = this.buffer[++i];
			if (ch === "	") {
				while (ch === "	" || ch === " " || ch === "\r" || ch === "\n") ch = this.buffer[++i];
				nl = i - 1;
			} else if (!this.blockScalarKeep) do {
				let i = nl - 1;
				let ch = this.buffer[i];
				if (ch === "\r") ch = this.buffer[--i];
				const lastChar = i;
				while (ch === " ") ch = this.buffer[--i];
				if (ch === "\n" && i >= this.pos && i + 1 + indent > lastChar) nl = i;
				else break;
			} while (true);
			yield cst.SCALAR;
			yield* this.pushToIndex(nl + 1, true);
			return yield* this.parseLineStart();
		}
		*parsePlainScalar() {
			const inFlow = this.flowLevel > 0;
			let end = this.pos - 1;
			let i = this.pos - 1;
			let ch;
			while (ch = this.buffer[++i]) if (ch === ":") {
				const next = this.buffer[i + 1];
				if (isEmpty(next) || inFlow && flowIndicatorChars.has(next)) break;
				end = i;
			} else if (isEmpty(ch)) {
				let next = this.buffer[i + 1];
				if (ch === "\r") if (next === "\n") {
					i += 1;
					ch = "\n";
					next = this.buffer[i + 1];
				} else end = i;
				if (next === "#" || inFlow && flowIndicatorChars.has(next)) break;
				if (ch === "\n") {
					const cs = this.continueScalar(i + 1);
					if (cs === -1) break;
					i = Math.max(i, cs - 2);
				}
			} else {
				if (inFlow && flowIndicatorChars.has(ch)) break;
				end = i;
			}
			if (!ch && !this.atEnd) return this.setNext("plain-scalar");
			yield cst.SCALAR;
			yield* this.pushToIndex(end + 1, true);
			return inFlow ? "flow" : "doc";
		}
		*pushCount(n) {
			if (n > 0) {
				yield this.buffer.substr(this.pos, n);
				this.pos += n;
				return n;
			}
			return 0;
		}
		*pushToIndex(i, allowEmpty) {
			const s = this.buffer.slice(this.pos, i);
			if (s) {
				yield s;
				this.pos += s.length;
				return s.length;
			} else if (allowEmpty) yield "";
			return 0;
		}
		*pushIndicators() {
			let n = 0;
			loop: while (true) {
				switch (this.charAt(0)) {
					case "!":
						n += yield* this.pushTag();
						n += yield* this.pushSpaces(true);
						continue loop;
					case "&":
						n += yield* this.pushUntil(isNotAnchorChar);
						n += yield* this.pushSpaces(true);
						continue loop;
					case "-":
					case "?":
					case ":": {
						const inFlow = this.flowLevel > 0;
						const ch1 = this.charAt(1);
						if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
							if (!inFlow) this.indentNext = this.indentValue + 1;
							else if (this.flowKey) this.flowKey = false;
							n += yield* this.pushCount(1);
							n += yield* this.pushSpaces(true);
							continue loop;
						}
					}
				}
				break loop;
			}
			return n;
		}
		*pushTag() {
			if (this.charAt(1) === "<") {
				let i = this.pos + 2;
				let ch = this.buffer[i];
				while (!isEmpty(ch) && ch !== ">") ch = this.buffer[++i];
				return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
			} else {
				let i = this.pos + 1;
				let ch = this.buffer[i];
				while (ch) if (tagChars.has(ch)) ch = this.buffer[++i];
				else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) ch = this.buffer[i += 3];
				else break;
				return yield* this.pushToIndex(i, false);
			}
		}
		*pushNewline() {
			const ch = this.buffer[this.pos];
			if (ch === "\n") return yield* this.pushCount(1);
			else if (ch === "\r" && this.charAt(1) === "\n") return yield* this.pushCount(2);
			else return 0;
		}
		*pushSpaces(allowTabs) {
			let i = this.pos - 1;
			let ch;
			do
				ch = this.buffer[++i];
			while (ch === " " || allowTabs && ch === "	");
			const n = i - this.pos;
			if (n > 0) {
				yield this.buffer.substr(this.pos, n);
				this.pos = i;
			}
			return n;
		}
		*pushUntil(test) {
			let i = this.pos;
			let ch = this.buffer[i];
			while (!test(ch)) ch = this.buffer[++i];
			return yield* this.pushToIndex(i, false);
		}
	};
	exports.Lexer = Lexer;
}));
var require_line_counter = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Tracks newlines during parsing in order to provide an efficient API for
	* determining the one-indexed `{ line, col }` position for any offset
	* within the input.
	*/
	var LineCounter = class {
		constructor() {
			this.lineStarts = [];
			/**
			* Should be called in ascending order. Otherwise, call
			* `lineCounter.lineStarts.sort()` before calling `linePos()`.
			*/
			this.addNewLine = (offset) => this.lineStarts.push(offset);
			/**
			* Performs a binary search and returns the 1-indexed { line, col }
			* position of `offset`. If `line === 0`, `addNewLine` has never been
			* called or `offset` is before the first known newline.
			*/
			this.linePos = (offset) => {
				let low = 0;
				let high = this.lineStarts.length;
				while (low < high) {
					const mid = low + high >> 1;
					if (this.lineStarts[mid] < offset) low = mid + 1;
					else high = mid;
				}
				if (this.lineStarts[low] === offset) return {
					line: low + 1,
					col: 1
				};
				if (low === 0) return {
					line: 0,
					col: offset
				};
				const start = this.lineStarts[low - 1];
				return {
					line: low,
					col: offset - start + 1
				};
			};
		}
	};
	exports.LineCounter = LineCounter;
}));
var require_parser = /* @__PURE__ */ __commonJSMin(((exports) => {
	var node_process = __require("process");
	var cst = require_cst();
	var lexer = require_lexer();
	function includesToken(list, type) {
		for (let i = 0; i < list.length; ++i) if (list[i].type === type) return true;
		return false;
	}
	function findNonEmptyIndex(list) {
		for (let i = 0; i < list.length; ++i) switch (list[i].type) {
			case "space":
			case "comment":
			case "newline": break;
			default: return i;
		}
		return -1;
	}
	function isFlowToken(token) {
		switch (token?.type) {
			case "alias":
			case "scalar":
			case "single-quoted-scalar":
			case "double-quoted-scalar":
			case "flow-collection": return true;
			default: return false;
		}
	}
	function getPrevProps(parent) {
		switch (parent.type) {
			case "document": return parent.start;
			case "block-map": {
				const it = parent.items[parent.items.length - 1];
				return it.sep ?? it.start;
			}
			case "block-seq": return parent.items[parent.items.length - 1].start;
			/* istanbul ignore next should not happen */
			default: return [];
		}
	}
	/** Note: May modify input array */
	function getFirstKeyStartProps(prev) {
		if (prev.length === 0) return [];
		let i = prev.length;
		loop: while (--i >= 0) switch (prev[i].type) {
			case "doc-start":
			case "explicit-key-ind":
			case "map-value-ind":
			case "seq-item-ind":
			case "newline": break loop;
		}
		while (prev[++i]?.type === "space");
		return prev.splice(i, prev.length);
	}
	function arrayPushArray(target, source) {
		if (source.length < 1e5) Array.prototype.push.apply(target, source);
		else for (let i = 0; i < source.length; ++i) target.push(source[i]);
	}
	function fixFlowSeqItems(fc) {
		if (fc.start.type === "flow-seq-start") {
			for (const it of fc.items) if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
				if (it.key) it.value = it.key;
				delete it.key;
				if (isFlowToken(it.value)) if (it.value.end) arrayPushArray(it.value.end, it.sep);
				else it.value.end = it.sep;
				else arrayPushArray(it.start, it.sep);
				delete it.sep;
			}
		}
	}
	/**
	* A YAML concrete syntax tree (CST) parser
	*
	* ```ts
	* const src: string = ...
	* for (const token of new Parser().parse(src)) {
	*   // token: Token
	* }
	* ```
	*
	* To use the parser with a user-provided lexer:
	*
	* ```ts
	* function* parse(source: string, lexer: Lexer) {
	*   const parser = new Parser()
	*   for (const lexeme of lexer.lex(source))
	*     yield* parser.next(lexeme)
	*   yield* parser.end()
	* }
	*
	* const src: string = ...
	* const lexer = new Lexer()
	* for (const token of parse(src, lexer)) {
	*   // token: Token
	* }
	* ```
	*/
	var Parser = class {
		/**
		* @param onNewLine - If defined, called separately with the start position of
		*   each new line (in `parse()`, including the start of input).
		*/
		constructor(onNewLine) {
			/** If true, space and sequence indicators count as indentation */
			this.atNewLine = true;
			/** If true, next token is a scalar value */
			this.atScalar = false;
			/** Current indentation level */
			this.indent = 0;
			/** Current offset since the start of parsing */
			this.offset = 0;
			/** On the same line with a block map key */
			this.onKeyLine = false;
			/** Top indicates the node that's currently being built */
			this.stack = [];
			/** The source of the current token, set in parse() */
			this.source = "";
			/** The type of the current token, set in parse() */
			this.type = "";
			this.lexer = new lexer.Lexer();
			this.onNewLine = onNewLine;
		}
		/**
		* Parse `source` as a YAML stream.
		* If `incomplete`, a part of the last line may be left as a buffer for the next call.
		*
		* Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
		*
		* @returns A generator of tokens representing each directive, document, and other structure.
		*/
		*parse(source, incomplete = false) {
			if (this.onNewLine && this.offset === 0) this.onNewLine(0);
			for (const lexeme of this.lexer.lex(source, incomplete)) yield* this.next(lexeme);
			if (!incomplete) yield* this.end();
		}
		/**
		* Advance the parser by the `source` of one lexical token.
		*/
		*next(source) {
			this.source = source;
			if (node_process.env.LOG_TOKENS) console.log("|", cst.prettyToken(source));
			if (this.atScalar) {
				this.atScalar = false;
				yield* this.step();
				this.offset += source.length;
				return;
			}
			const type = cst.tokenType(source);
			if (!type) {
				const message = `Not a YAML token: ${source}`;
				yield* this.pop({
					type: "error",
					offset: this.offset,
					message,
					source
				});
				this.offset += source.length;
			} else if (type === "scalar") {
				this.atNewLine = false;
				this.atScalar = true;
				this.type = "scalar";
			} else {
				this.type = type;
				yield* this.step();
				switch (type) {
					case "newline":
						this.atNewLine = true;
						this.indent = 0;
						if (this.onNewLine) this.onNewLine(this.offset + source.length);
						break;
					case "space":
						if (this.atNewLine && source[0] === " ") this.indent += source.length;
						break;
					case "explicit-key-ind":
					case "map-value-ind":
					case "seq-item-ind":
						if (this.atNewLine) this.indent += source.length;
						break;
					case "doc-mode":
					case "flow-error-end": return;
					default: this.atNewLine = false;
				}
				this.offset += source.length;
			}
		}
		/** Call at end of input to push out any remaining constructions */
		*end() {
			while (this.stack.length > 0) yield* this.pop();
		}
		get sourceToken() {
			return {
				type: this.type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		*step() {
			const top = this.peek(1);
			if (this.type === "doc-end" && top?.type !== "doc-end") {
				while (this.stack.length > 0) yield* this.pop();
				this.stack.push({
					type: "doc-end",
					offset: this.offset,
					source: this.source
				});
				return;
			}
			if (!top) return yield* this.stream();
			switch (top.type) {
				case "document": return yield* this.document(top);
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return yield* this.scalar(top);
				case "block-scalar": return yield* this.blockScalar(top);
				case "block-map": return yield* this.blockMap(top);
				case "block-seq": return yield* this.blockSequence(top);
				case "flow-collection": return yield* this.flowCollection(top);
				case "doc-end": return yield* this.documentEnd(top);
			}
			/* istanbul ignore next should not happen */
			yield* this.pop();
		}
		peek(n) {
			return this.stack[this.stack.length - n];
		}
		*pop(error) {
			const token = error ?? this.stack.pop();
			/* istanbul ignore if should not happen */
			if (!token) yield {
				type: "error",
				offset: this.offset,
				source: "",
				message: "Tried to pop an empty stack"
			};
			else if (this.stack.length === 0) yield token;
			else {
				const top = this.peek(1);
				if (token.type === "block-scalar") token.indent = "indent" in top ? top.indent : 0;
				else if (token.type === "flow-collection" && top.type === "document") token.indent = 0;
				if (token.type === "flow-collection") fixFlowSeqItems(token);
				switch (top.type) {
					case "document":
						top.value = token;
						break;
					case "block-scalar":
						top.props.push(token);
						break;
					case "block-map": {
						const it = top.items[top.items.length - 1];
						if (it.value) {
							top.items.push({
								start: [],
								key: token,
								sep: []
							});
							this.onKeyLine = true;
							return;
						} else if (it.sep) it.value = token;
						else {
							Object.assign(it, {
								key: token,
								sep: []
							});
							this.onKeyLine = !it.explicitKey;
							return;
						}
						break;
					}
					case "block-seq": {
						const it = top.items[top.items.length - 1];
						if (it.value) top.items.push({
							start: [],
							value: token
						});
						else it.value = token;
						break;
					}
					case "flow-collection": {
						const it = top.items[top.items.length - 1];
						if (!it || it.value) top.items.push({
							start: [],
							key: token,
							sep: []
						});
						else if (it.sep) it.value = token;
						else Object.assign(it, {
							key: token,
							sep: []
						});
						return;
					}
					/* istanbul ignore next should not happen */
					default:
						yield* this.pop();
						yield* this.pop(token);
				}
				if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
					const last = token.items[token.items.length - 1];
					if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
						if (top.type === "document") top.end = last.start;
						else top.items.push({ start: last.start });
						token.items.splice(-1, 1);
					}
				}
			}
		}
		*stream() {
			switch (this.type) {
				case "directive-line":
					yield {
						type: "directive",
						offset: this.offset,
						source: this.source
					};
					return;
				case "byte-order-mark":
				case "space":
				case "comment":
				case "newline":
					yield this.sourceToken;
					return;
				case "doc-mode":
				case "doc-start": {
					const doc = {
						type: "document",
						offset: this.offset,
						start: []
					};
					if (this.type === "doc-start") doc.start.push(this.sourceToken);
					this.stack.push(doc);
					return;
				}
			}
			yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML stream`,
				source: this.source
			};
		}
		*document(doc) {
			if (doc.value) return yield* this.lineEnd(doc);
			switch (this.type) {
				case "doc-start":
					if (findNonEmptyIndex(doc.start) !== -1) {
						yield* this.pop();
						yield* this.step();
					} else doc.start.push(this.sourceToken);
					return;
				case "anchor":
				case "tag":
				case "space":
				case "comment":
				case "newline":
					doc.start.push(this.sourceToken);
					return;
			}
			const bv = this.startBlockValue(doc);
			if (bv) this.stack.push(bv);
			else yield {
				type: "error",
				offset: this.offset,
				message: `Unexpected ${this.type} token in YAML document`,
				source: this.source
			};
		}
		*scalar(scalar) {
			if (this.type === "map-value-ind") {
				const start = getFirstKeyStartProps(getPrevProps(this.peek(2)));
				let sep;
				if (scalar.end) {
					sep = scalar.end;
					sep.push(this.sourceToken);
					delete scalar.end;
				} else sep = [this.sourceToken];
				const map = {
					type: "block-map",
					offset: scalar.offset,
					indent: scalar.indent,
					items: [{
						start,
						key: scalar,
						sep
					}]
				};
				this.onKeyLine = true;
				this.stack[this.stack.length - 1] = map;
			} else yield* this.lineEnd(scalar);
		}
		*blockScalar(scalar) {
			switch (this.type) {
				case "space":
				case "comment":
				case "newline":
					scalar.props.push(this.sourceToken);
					return;
				case "scalar":
					scalar.source = this.source;
					this.atNewLine = true;
					this.indent = 0;
					if (this.onNewLine) {
						let nl = this.source.indexOf("\n") + 1;
						while (nl !== 0) {
							this.onNewLine(this.offset + nl);
							nl = this.source.indexOf("\n", nl) + 1;
						}
					}
					yield* this.pop();
					break;
				/* istanbul ignore next should not happen */
				default:
					yield* this.pop();
					yield* this.step();
			}
		}
		*blockMap(map) {
			const it = map.items[map.items.length - 1];
			switch (this.type) {
				case "newline":
					this.onKeyLine = false;
					if (it.value) {
						const end = "end" in it.value ? it.value.end : void 0;
						if ((Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment") end?.push(this.sourceToken);
						else map.items.push({ start: [this.sourceToken] });
					} else if (it.sep) it.sep.push(this.sourceToken);
					else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) map.items.push({ start: [this.sourceToken] });
					else if (it.sep) it.sep.push(this.sourceToken);
					else {
						if (this.atIndentedComment(it.start, map.indent)) {
							const end = map.items[map.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start);
								end.push(this.sourceToken);
								map.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
			}
			if (this.indent >= map.indent) {
				const atMapIndent = !this.onKeyLine && this.indent === map.indent;
				const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
				let start = [];
				if (atNextItem && it.sep && !it.value) {
					const nl = [];
					for (let i = 0; i < it.sep.length; ++i) {
						const st = it.sep[i];
						switch (st.type) {
							case "newline":
								nl.push(i);
								break;
							case "space": break;
							case "comment":
								if (st.indent > map.indent) nl.length = 0;
								break;
							default: nl.length = 0;
						}
					}
					if (nl.length >= 2) start = it.sep.splice(nl[1]);
				}
				switch (this.type) {
					case "anchor":
					case "tag":
						if (atNextItem || it.value) {
							start.push(this.sourceToken);
							map.items.push({ start });
							this.onKeyLine = true;
						} else if (it.sep) it.sep.push(this.sourceToken);
						else it.start.push(this.sourceToken);
						return;
					case "explicit-key-ind":
						if (!it.sep && !it.explicitKey) {
							it.start.push(this.sourceToken);
							it.explicitKey = true;
						} else if (atNextItem || it.value) {
							start.push(this.sourceToken);
							map.items.push({
								start,
								explicitKey: true
							});
						} else this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [this.sourceToken],
								explicitKey: true
							}]
						});
						this.onKeyLine = true;
						return;
					case "map-value-ind":
						if (it.explicitKey) if (!it.sep) if (includesToken(it.start, "newline")) Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						else {
							const start = getFirstKeyStartProps(it.start);
							this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start,
									key: null,
									sep: [this.sourceToken]
								}]
							});
						}
						else if (it.value) map.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start,
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
							const start = getFirstKeyStartProps(it.start);
							const key = it.key;
							const sep = it.sep;
							sep.push(this.sourceToken);
							delete it.key;
							delete it.sep;
							this.stack.push({
								type: "block-map",
								offset: this.offset,
								indent: this.indent,
								items: [{
									start,
									key,
									sep
								}]
							});
						} else if (start.length > 0) it.sep = it.sep.concat(start, this.sourceToken);
						else it.sep.push(this.sourceToken);
						else if (!it.sep) Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						else if (it.value || atNextItem) map.items.push({
							start,
							key: null,
							sep: [this.sourceToken]
						});
						else if (includesToken(it.sep, "map-value-ind")) this.stack.push({
							type: "block-map",
							offset: this.offset,
							indent: this.indent,
							items: [{
								start: [],
								key: null,
								sep: [this.sourceToken]
							}]
						});
						else it.sep.push(this.sourceToken);
						this.onKeyLine = true;
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						const fs = this.flowScalar(this.type);
						if (atNextItem || it.value) {
							map.items.push({
								start,
								key: fs,
								sep: []
							});
							this.onKeyLine = true;
						} else if (it.sep) this.stack.push(fs);
						else {
							Object.assign(it, {
								key: fs,
								sep: []
							});
							this.onKeyLine = true;
						}
						return;
					}
					default: {
						const bv = this.startBlockValue(map);
						if (bv) {
							if (bv.type === "block-seq") {
								if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
									yield* this.pop({
										type: "error",
										offset: this.offset,
										message: "Unexpected block-seq-ind on same line with key",
										source: this.source
									});
									return;
								}
							} else if (atMapIndent) map.items.push({ start });
							this.stack.push(bv);
							return;
						}
					}
				}
			}
			yield* this.pop();
			yield* this.step();
		}
		*blockSequence(seq) {
			const it = seq.items[seq.items.length - 1];
			switch (this.type) {
				case "newline":
					if (it.value) {
						const end = "end" in it.value ? it.value.end : void 0;
						if ((Array.isArray(end) ? end[end.length - 1] : void 0)?.type === "comment") end?.push(this.sourceToken);
						else seq.items.push({ start: [this.sourceToken] });
					} else it.start.push(this.sourceToken);
					return;
				case "space":
				case "comment":
					if (it.value) seq.items.push({ start: [this.sourceToken] });
					else {
						if (this.atIndentedComment(it.start, seq.indent)) {
							const end = seq.items[seq.items.length - 2]?.value?.end;
							if (Array.isArray(end)) {
								arrayPushArray(end, it.start);
								end.push(this.sourceToken);
								seq.items.pop();
								return;
							}
						}
						it.start.push(this.sourceToken);
					}
					return;
				case "anchor":
				case "tag":
					if (it.value || this.indent <= seq.indent) break;
					it.start.push(this.sourceToken);
					return;
				case "seq-item-ind":
					if (this.indent !== seq.indent) break;
					if (it.value || includesToken(it.start, "seq-item-ind")) seq.items.push({ start: [this.sourceToken] });
					else it.start.push(this.sourceToken);
					return;
			}
			if (this.indent > seq.indent) {
				const bv = this.startBlockValue(seq);
				if (bv) {
					this.stack.push(bv);
					return;
				}
			}
			yield* this.pop();
			yield* this.step();
		}
		*flowCollection(fc) {
			const it = fc.items[fc.items.length - 1];
			if (this.type === "flow-error-end") {
				let top;
				do {
					yield* this.pop();
					top = this.peek(1);
				} while (top?.type === "flow-collection");
			} else if (fc.end.length === 0) {
				switch (this.type) {
					case "comma":
					case "explicit-key-ind":
						if (!it || it.sep) fc.items.push({ start: [this.sourceToken] });
						else it.start.push(this.sourceToken);
						return;
					case "map-value-ind":
						if (!it || it.value) fc.items.push({
							start: [],
							key: null,
							sep: [this.sourceToken]
						});
						else if (it.sep) it.sep.push(this.sourceToken);
						else Object.assign(it, {
							key: null,
							sep: [this.sourceToken]
						});
						return;
					case "space":
					case "comment":
					case "newline":
					case "anchor":
					case "tag":
						if (!it || it.value) fc.items.push({ start: [this.sourceToken] });
						else if (it.sep) it.sep.push(this.sourceToken);
						else it.start.push(this.sourceToken);
						return;
					case "alias":
					case "scalar":
					case "single-quoted-scalar":
					case "double-quoted-scalar": {
						const fs = this.flowScalar(this.type);
						if (!it || it.value) fc.items.push({
							start: [],
							key: fs,
							sep: []
						});
						else if (it.sep) this.stack.push(fs);
						else Object.assign(it, {
							key: fs,
							sep: []
						});
						return;
					}
					case "flow-map-end":
					case "flow-seq-end":
						fc.end.push(this.sourceToken);
						return;
				}
				const bv = this.startBlockValue(fc);
				/* istanbul ignore else should not happen */
				if (bv) this.stack.push(bv);
				else {
					yield* this.pop();
					yield* this.step();
				}
			} else {
				const parent = this.peek(2);
				if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
					yield* this.pop();
					yield* this.step();
				} else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
					const start = getFirstKeyStartProps(getPrevProps(parent));
					fixFlowSeqItems(fc);
					const sep = fc.end.splice(1, fc.end.length);
					sep.push(this.sourceToken);
					const map = {
						type: "block-map",
						offset: fc.offset,
						indent: fc.indent,
						items: [{
							start,
							key: fc,
							sep
						}]
					};
					this.onKeyLine = true;
					this.stack[this.stack.length - 1] = map;
				} else yield* this.lineEnd(fc);
			}
		}
		flowScalar(type) {
			if (this.onNewLine) {
				let nl = this.source.indexOf("\n") + 1;
				while (nl !== 0) {
					this.onNewLine(this.offset + nl);
					nl = this.source.indexOf("\n", nl) + 1;
				}
			}
			return {
				type,
				offset: this.offset,
				indent: this.indent,
				source: this.source
			};
		}
		startBlockValue(parent) {
			switch (this.type) {
				case "alias":
				case "scalar":
				case "single-quoted-scalar":
				case "double-quoted-scalar": return this.flowScalar(this.type);
				case "block-scalar-header": return {
					type: "block-scalar",
					offset: this.offset,
					indent: this.indent,
					props: [this.sourceToken],
					source: ""
				};
				case "flow-map-start":
				case "flow-seq-start": return {
					type: "flow-collection",
					offset: this.offset,
					indent: this.indent,
					start: this.sourceToken,
					items: [],
					end: []
				};
				case "seq-item-ind": return {
					type: "block-seq",
					offset: this.offset,
					indent: this.indent,
					items: [{ start: [this.sourceToken] }]
				};
				case "explicit-key-ind": {
					this.onKeyLine = true;
					const start = getFirstKeyStartProps(getPrevProps(parent));
					start.push(this.sourceToken);
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							explicitKey: true
						}]
					};
				}
				case "map-value-ind": {
					this.onKeyLine = true;
					const start = getFirstKeyStartProps(getPrevProps(parent));
					return {
						type: "block-map",
						offset: this.offset,
						indent: this.indent,
						items: [{
							start,
							key: null,
							sep: [this.sourceToken]
						}]
					};
				}
			}
			return null;
		}
		atIndentedComment(start, indent) {
			if (this.type !== "comment") return false;
			if (this.indent <= indent) return false;
			return start.every((st) => st.type === "newline" || st.type === "space");
		}
		*documentEnd(docEnd) {
			if (this.type !== "doc-mode") {
				if (docEnd.end) docEnd.end.push(this.sourceToken);
				else docEnd.end = [this.sourceToken];
				if (this.type === "newline") yield* this.pop();
			}
		}
		*lineEnd(token) {
			switch (this.type) {
				case "comma":
				case "doc-start":
				case "doc-end":
				case "flow-seq-end":
				case "flow-map-end":
				case "map-value-ind":
					yield* this.pop();
					yield* this.step();
					break;
				case "newline": this.onKeyLine = false;
				default:
					if (token.end) token.end.push(this.sourceToken);
					else token.end = [this.sourceToken];
					if (this.type === "newline") yield* this.pop();
			}
		}
	};
	exports.Parser = Parser;
}));
var require_public_api = /* @__PURE__ */ __commonJSMin(((exports) => {
	var composer = require_composer();
	var Document = require_Document();
	var errors = require_errors();
	var log = require_log();
	var identity = require_identity();
	var lineCounter = require_line_counter();
	var parser = require_parser();
	function parseOptions(options) {
		const prettyErrors = options.prettyErrors !== false;
		return {
			lineCounter: options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null,
			prettyErrors
		};
	}
	/**
	* Parse the input as a stream of YAML documents.
	*
	* Documents should be separated from each other by `...` or `---` marker lines.
	*
	* @returns If an empty `docs` array is returned, it will be of type
	*   EmptyStream and contain additional stream information. In
	*   TypeScript, you should use `'empty' in docs` as a type guard for it.
	*/
	function parseAllDocuments(source, options = {}) {
		const { lineCounter, prettyErrors } = parseOptions(options);
		const parser$1 = new parser.Parser(lineCounter?.addNewLine);
		const composer$1 = new composer.Composer(options);
		const docs = Array.from(composer$1.compose(parser$1.parse(source)));
		if (prettyErrors && lineCounter) for (const doc of docs) {
			doc.errors.forEach(errors.prettifyError(source, lineCounter));
			doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		}
		if (docs.length > 0) return docs;
		return Object.assign([], { empty: true }, composer$1.streamInfo());
	}
	/** Parse an input string into a single YAML.Document */
	function parseDocument(source, options = {}) {
		const { lineCounter, prettyErrors } = parseOptions(options);
		const parser$1 = new parser.Parser(lineCounter?.addNewLine);
		const composer$1 = new composer.Composer(options);
		let doc = null;
		for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) if (!doc) doc = _doc;
		else if (doc.options.logLevel !== "silent") {
			doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
			break;
		}
		if (prettyErrors && lineCounter) {
			doc.errors.forEach(errors.prettifyError(source, lineCounter));
			doc.warnings.forEach(errors.prettifyError(source, lineCounter));
		}
		return doc;
	}
	function parse(src, reviver, options) {
		let _reviver = void 0;
		if (typeof reviver === "function") _reviver = reviver;
		else if (options === void 0 && reviver && typeof reviver === "object") options = reviver;
		const doc = parseDocument(src, options);
		if (!doc) return null;
		doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
		if (doc.errors.length > 0) if (doc.options.logLevel !== "silent") throw doc.errors[0];
		else doc.errors = [];
		return doc.toJS(Object.assign({ reviver: _reviver }, options));
	}
	function stringify(value, replacer, options) {
		let _replacer = null;
		if (typeof replacer === "function" || Array.isArray(replacer)) _replacer = replacer;
		else if (options === void 0 && replacer) options = replacer;
		if (typeof options === "string") options = options.length;
		if (typeof options === "number") {
			const indent = Math.round(options);
			options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
		}
		if (value === void 0) {
			const { keepUndefined } = options ?? replacer ?? {};
			if (!keepUndefined) return void 0;
		}
		if (identity.isDocument(value) && !_replacer) return value.toString(options);
		return new Document.Document(value, _replacer, options).toString(options);
	}
	exports.parse = parse;
	exports.parseAllDocuments = parseAllDocuments;
	exports.parseDocument = parseDocument;
	exports.stringify = stringify;
}));
var import_dist = (/* @__PURE__ */ __commonJSMin(((exports) => {
	var composer = require_composer();
	var Document = require_Document();
	var Schema = require_Schema();
	var errors = require_errors();
	var Alias = require_Alias();
	var identity = require_identity();
	var Pair = require_Pair();
	var Scalar = require_Scalar();
	var YAMLMap = require_YAMLMap();
	var YAMLSeq = require_YAMLSeq();
	require_cst();
	var lexer = require_lexer();
	var lineCounter = require_line_counter();
	var parser = require_parser();
	var publicApi = require_public_api();
	var visit = require_visit();
	exports.Composer = composer.Composer;
	exports.Document = Document.Document;
	exports.Schema = Schema.Schema;
	exports.YAMLError = errors.YAMLError;
	exports.YAMLParseError = errors.YAMLParseError;
	exports.YAMLWarning = errors.YAMLWarning;
	exports.Alias = Alias.Alias;
	exports.isAlias = identity.isAlias;
	exports.isCollection = identity.isCollection;
	exports.isDocument = identity.isDocument;
	exports.isMap = identity.isMap;
	exports.isNode = identity.isNode;
	exports.isPair = identity.isPair;
	exports.isScalar = identity.isScalar;
	exports.isSeq = identity.isSeq;
	exports.Pair = Pair.Pair;
	exports.Scalar = Scalar.Scalar;
	exports.YAMLMap = YAMLMap.YAMLMap;
	exports.YAMLSeq = YAMLSeq.YAMLSeq;
	exports.Lexer = lexer.Lexer;
	exports.LineCounter = lineCounter.LineCounter;
	exports.Parser = parser.Parser;
	exports.parse = publicApi.parse;
	exports.parseAllDocuments = publicApi.parseAllDocuments;
	exports.parseDocument = publicApi.parseDocument;
	exports.stringify = publicApi.stringify;
	exports.visit = visit.visit;
	exports.visitAsync = visit.visitAsync;
})))();
/** Session-owned Tavern Helper variable compatibility. */
const STATE_PREFIX = "agent-rp-tavern-helper-v0:";
const MAX_MUTATION_BYTES = 2 * 1024 * 1024;
const MAX_WORLDBOOK_ENTRIES = 1e4;
const MAX_CHAT_MESSAGES = 1e4;
const MAX_INJECTED_PROMPTS = 256;
const MAX_INJECTED_PROMPT_CHARS = 256 * 1024;
const MAX_SCRIPT_TREES = 512;
function record$2(value, name) {
	const snapshot = snapshotJsonValue(value);
	if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) throw new Error(`${name} must be a JSON object`);
	return snapshot;
}
function text$2(value, label, fallback = "") {
	if (value === void 0) return fallback;
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}
function finite$1(value, label, fallback) {
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
	return value;
}
function nullablePositive(value, label) {
	if (value === void 0 || value === null) return null;
	const number = finite$1(value, label, 0);
	return number > 0 ? number : null;
}
function stringArray(value, label) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
	return [...new Set(value)];
}
function worldbookName(value) {
	const name = text$2(value, "Tavern Helper worldbook name").trim();
	if (name === "" || name.length > 512) throw new Error("Tavern Helper worldbook name is invalid");
	return name;
}
function nested(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function integer(value, label) {
	if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer`);
	return Number(value);
}
function chatMessage(value, index, creating) {
	const message = nested(value);
	const role = message.role;
	if (role !== void 0 && role !== "system" && role !== "assistant" && role !== "user") throw new Error(`chat message[${index}].role is invalid`);
	if (creating && role === void 0) throw new Error(`chat message[${index}].role is required`);
	const body = message.message === void 0 ? void 0 : text$2(message.message, `chat message[${index}].message`);
	if (creating && body === void 0) throw new Error(`chat message[${index}].message is required`);
	if (message.is_hidden !== void 0 && typeof message.is_hidden !== "boolean") throw new Error(`chat message[${index}].is_hidden must be a boolean`);
	const strings = (candidate, label) => {
		if (candidate === void 0) return void 0;
		if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
		return candidate;
	};
	const records = (candidate, label) => {
		if (candidate === void 0) return void 0;
		if (!Array.isArray(candidate)) throw new Error(`${label} must be an object array`);
		return candidate.map((item, itemIndex) => record$2(item, `${label}[${itemIndex}]`));
	};
	const swipes = strings(message.swipes, `chat message[${index}].swipes`);
	const swipesData = records(message.swipes_data, `chat message[${index}].swipes_data`);
	const swipesInfo = records(message.swipes_info, `chat message[${index}].swipes_info`);
	return {
		...message.message_id === void 0 ? {} : { message_id: integer(message.message_id, `chat message[${index}].message_id`) },
		...message.name === void 0 ? {} : { name: text$2(message.name, `chat message[${index}].name`) },
		...role === void 0 ? {} : { role },
		...message.is_hidden === void 0 ? {} : { is_hidden: message.is_hidden },
		...body === void 0 ? {} : { message: body },
		...message.data === void 0 ? {} : { data: record$2(message.data, `chat message[${index}].data`) },
		...message.extra === void 0 ? {} : { extra: record$2(message.extra, `chat message[${index}].extra`) },
		...message.swipe_id === void 0 ? {} : { swipe_id: integer(message.swipe_id, `chat message[${index}].swipe_id`) },
		...swipes === void 0 ? {} : { swipes },
		...swipesData === void 0 ? {} : { swipes_data: swipesData },
		...swipesInfo === void 0 ? {} : { swipes_info: swipesInfo }
	};
}
function chatMessages(value, creating) {
	if (!Array.isArray(value) || value.length > MAX_CHAT_MESSAGES) throw new Error("Tavern Helper chat messages are invalid");
	return value.map((message, index) => chatMessage(message, index, creating));
}
function scriptTreeId(value, label) {
	const id = text$2(value, label).trim();
	if (id === "" || id.length > 512) throw new Error(`${label} is invalid`);
	return id;
}
function scriptTreeBoolean(value, label, fallback) {
	if (value === void 0) return fallback;
	if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
	return value;
}
function tavernScript(value, label, ids) {
	const script = nested(value);
	if (script.type !== "script") throw new Error(`${label}.type must be 'script'`);
	const id = scriptTreeId(script.id, `${label}.id`);
	if (ids.has(id)) throw new Error(`Tavern Helper script tree id '${id}' is duplicated`);
	ids.add(id);
	const button = nested(script.button);
	const rawButtons = button.buttons ?? [];
	if (!Array.isArray(rawButtons) || rawButtons.length > 50) throw new Error(`${label}.button.buttons is invalid`);
	const buttons = rawButtons.map((value, index) => {
		const item = nested(value);
		return {
			name: text$2(item.name, `${label}.button.buttons[${index}].name`),
			visible: scriptTreeBoolean(item.visible, `${label}.button.buttons[${index}].visible`, true)
		};
	});
	const exported = nested(script.export_with);
	return {
		type: "script",
		enabled: scriptTreeBoolean(script.enabled, `${label}.enabled`, false),
		name: text$2(script.name, `${label}.name`),
		id,
		content: text$2(script.content, `${label}.content`),
		info: text$2(script.info, `${label}.info`),
		button: {
			enabled: scriptTreeBoolean(button.enabled, `${label}.button.enabled`, true),
			buttons
		},
		data: record$2(script.data ?? {}, `${label}.data`),
		export_with: {
			data: scriptTreeBoolean(exported.data, `${label}.export_with.data`, true),
			button: scriptTreeBoolean(exported.button, `${label}.export_with.button`, true)
		}
	};
}
function tavernScriptTrees(value, label = "Tavern Helper script trees") {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	const ids = /* @__PURE__ */ new Set();
	let count = 0;
	const trees = value.map((candidate, index) => {
		const tree = nested(candidate);
		const treeLabel = `${label}[${index}]`;
		count++;
		if (tree.type !== "folder") return tavernScript(candidate, treeLabel, ids);
		const id = scriptTreeId(tree.id, `${treeLabel}.id`);
		if (ids.has(id)) throw new Error(`Tavern Helper script tree id '${id}' is duplicated`);
		ids.add(id);
		const children = tree.scripts ?? [];
		if (!Array.isArray(children)) throw new Error(`${treeLabel}.scripts must be an array`);
		count += children.length;
		if (count > MAX_SCRIPT_TREES) throw new Error("Tavern Helper script tree is too large");
		return {
			type: "folder",
			enabled: scriptTreeBoolean(tree.enabled, `${treeLabel}.enabled`, false),
			name: text$2(tree.name, `${treeLabel}.name`),
			id,
			icon: text$2(tree.icon, `${treeLabel}.icon`, "fa-solid fa-folder"),
			color: text$2(tree.color, `${treeLabel}.color`),
			scripts: children.map((script, scriptIndex) => tavernScript(script, `${treeLabel}.scripts[${scriptIndex}]`, ids))
		};
	});
	if (count > MAX_SCRIPT_TREES) throw new Error("Tavern Helper script tree is too large");
	return trees;
}
function flattenedTavernScripts(trees) {
	return trees.flatMap((tree) => tree.type === "folder" ? tree.scripts : [tree]);
}
function tavernScriptScopeIds(state, scope) {
	const override = state.scriptTrees?.[scope];
	if (override !== void 0) return new Set(flattenedTavernScripts(override).map((script) => script.id));
	if (scope === "global") return /* @__PURE__ */ new Set();
	if (scope === "preset") return new Set(state.presetScriptIds ?? []);
	const excluded = /* @__PURE__ */ new Set([...state.presetScriptIds ?? [], ...flattenedTavernScripts(state.scriptTrees?.global ?? []).map((script) => script.id)]);
	return new Set(Object.keys(state.scripts).filter((id) => !excluded.has(id)));
}
function worldbookEntry(value, index, used) {
	const entry = nested(value);
	let uid = entry.uid === void 0 ? index : finite$1(entry.uid, `worldbook[${index}].uid`, index);
	if (!Number.isSafeInteger(uid) || uid < 0 || uid >= 1e6) uid = index % 1e6;
	while (used.has(uid)) uid = (uid + 1) % 1e6;
	used.add(uid);
	const strategy = nested(entry.strategy);
	const secondary = nested(strategy.keys_secondary);
	const strategyType = strategy.type === "selective" || strategy.type === "vectorized" ? strategy.type : "constant";
	const secondaryLogic = secondary.logic === "and_all" || secondary.logic === "not_all" || secondary.logic === "not_any" ? secondary.logic : "and_any";
	const scanDepth = strategy.scan_depth === "same_as_global" || strategy.scan_depth === void 0 ? "same_as_global" : Math.max(0, finite$1(strategy.scan_depth, `worldbook[${index}].strategy.scan_depth`, 0));
	const position = nested(entry.position);
	const positionTypes = /* @__PURE__ */ new Set([
		"before_character_definition",
		"after_character_definition",
		"before_example_messages",
		"after_example_messages",
		"before_author_note",
		"after_author_note",
		"at_depth",
		"outlet"
	]);
	const positionType = typeof position.type === "string" && positionTypes.has(position.type) ? position.type : "at_depth";
	const role = position.role === "assistant" || position.role === "user" ? position.role : "system";
	const recursion = nested(entry.recursion);
	const effect = nested(entry.effect);
	const extra = entry.extra === void 0 ? void 0 : record$2(entry.extra, `worldbook[${index}].extra`);
	return {
		uid,
		name: text$2(entry.name, `worldbook[${index}].name`),
		enabled: entry.enabled !== false,
		strategy: {
			type: strategyType,
			keys: stringArray(strategy.keys ?? [], `worldbook[${index}].strategy.keys`),
			keys_secondary: {
				logic: secondaryLogic,
				keys: stringArray(secondary.keys ?? [], `worldbook[${index}].strategy.keys_secondary.keys`)
			},
			scan_depth: scanDepth
		},
		position: {
			type: positionType,
			role,
			depth: finite$1(position.depth, `worldbook[${index}].position.depth`, 4),
			order: finite$1(position.order, `worldbook[${index}].position.order`, 100)
		},
		content: text$2(entry.content, `worldbook[${index}].content`),
		probability: Math.min(100, Math.max(0, finite$1(entry.probability, `worldbook[${index}].probability`, 100))),
		recursion: {
			prevent_incoming: recursion.prevent_incoming === true,
			prevent_outgoing: recursion.prevent_outgoing === true,
			delay_until: nullablePositive(recursion.delay_until, `worldbook[${index}].recursion.delay_until`)
		},
		effect: {
			sticky: nullablePositive(effect.sticky, `worldbook[${index}].effect.sticky`),
			cooldown: nullablePositive(effect.cooldown, `worldbook[${index}].effect.cooldown`),
			delay: nullablePositive(effect.delay, `worldbook[${index}].effect.delay`)
		},
		...extra === void 0 ? {} : { extra },
		...entry.ignoreBudget === true ? { ignoreBudget: true } : {}
	};
}
function worldbookEntries(value) {
	if (!Array.isArray(value) || value.length > MAX_WORLDBOOK_ENTRIES) throw new Error("Tavern Helper worldbook entries are invalid");
	const used = /* @__PURE__ */ new Set();
	return value.map((entry, index) => worldbookEntry(entry, index, used));
}
function injectedPrompt(value, index, scriptId) {
	const prompt = nested(value);
	const id = text$2(prompt.id, `injected prompt[${index}].id`).trim();
	if (id === "" || id.length > 512) throw new Error(`injected prompt[${index}].id is invalid`);
	if (prompt.position !== "in_chat" && prompt.position !== "none") throw new Error(`injected prompt[${index}].position is invalid`);
	if (prompt.role !== "system" && prompt.role !== "assistant" && prompt.role !== "user") throw new Error(`injected prompt[${index}].role is invalid`);
	const depth = integer(prompt.depth, `injected prompt[${index}].depth`);
	const content = text$2(prompt.content, `injected prompt[${index}].content`);
	if (depth < 0 || depth > 2e4 || content.length > MAX_INJECTED_PROMPT_CHARS) throw new Error(`injected prompt[${index}] is too large`);
	const owner = scriptId ?? text$2(prompt.scriptId, `injected prompt[${index}].scriptId`);
	if (owner === "") throw new Error(`injected prompt[${index}].scriptId is invalid`);
	if (prompt.shouldScan !== void 0 && typeof prompt.shouldScan !== "boolean" || prompt.should_scan !== void 0 && typeof prompt.should_scan !== "boolean" || prompt.once !== void 0 && typeof prompt.once !== "boolean") throw new Error(`injected prompt[${index}] flags are invalid`);
	return {
		id,
		scriptId: owner,
		position: prompt.position,
		depth,
		role: prompt.role,
		content,
		shouldScan: prompt.shouldScan === void 0 ? prompt.should_scan === true : prompt.shouldScan === true,
		once: prompt.once === true
	};
}
function injectedPrompts(value, scriptId) {
	if (!Array.isArray(value) || value.length > MAX_INJECTED_PROMPTS) throw new Error("Tavern Helper injected prompts are invalid");
	const prompts = value.map((prompt, index) => injectedPrompt(prompt, index, scriptId));
	if (new Set(prompts.map((prompt) => prompt.id)).size !== prompts.length) throw new Error("Tavern Helper injected prompt ids must be unique");
	return prompts;
}
/** Create the script state for one active card while retaining Session-wide namespaces. */
function initializeTavernHelperState(frontend, characterSourceId, previous) {
	const sameCharacter = previous?.characterSourceId === characterSourceId;
	const characterOverride = sameCharacter ? previous?.scriptTrees?.character : void 0;
	const activeCharacterScripts = characterOverride === void 0 ? frontend.tavernHelperScripts : flattenedTavernScripts(characterOverride);
	const activeGlobalScripts = flattenedTavernScripts(previous?.scriptTrees?.global ?? []);
	const globalScripts = Object.fromEntries(activeGlobalScripts.map((script) => [script.id, previous?.scripts[script.id] ?? script.data]));
	const presetScripts = Object.fromEntries((previous?.presetScriptIds ?? []).flatMap((id) => {
		const value = previous?.scripts[id];
		return value === void 0 ? [] : [[id, value]];
	}));
	const scripts = {
		...globalScripts,
		...presetScripts,
		...Object.fromEntries(activeCharacterScripts.map((script) => [script.id, sameCharacter ? previous?.scripts[script.id] ?? script.data : script.data]))
	};
	const scriptIds = new Set(Object.keys(scripts));
	const prompts = previous?.injectedPrompts?.filter((prompt) => scriptIds.has(prompt.scriptId));
	const scriptTrees = previous?.scriptTrees === void 0 ? void 0 : {
		...previous.scriptTrees.global === void 0 ? {} : { global: previous.scriptTrees.global },
		...previous.scriptTrees.preset === void 0 ? {} : { preset: previous.scriptTrees.preset },
		...!sameCharacter || previous.scriptTrees.character === void 0 ? {} : { character: previous.scriptTrees.character }
	};
	return {
		format: 0,
		characterSourceId,
		...previous?.presetSourceId === void 0 ? {} : { presetSourceId: previous.presetSourceId },
		...previous?.presetScriptIds === void 0 ? {} : { presetScriptIds: previous.presetScriptIds },
		revision: sameCharacter ? previous.revision : 0,
		scopes: {
			global: previous?.scopes.global ?? {},
			preset: previous?.scopes.preset ?? {},
			character: sameCharacter ? previous.scopes.character : frontend.tavernHelperVariables,
			chat: previous?.scopes.chat ?? {},
			message: sameCharacter ? previous.scopes.message : {}
		},
		scripts,
		...scriptTrees === void 0 ? {} : { scriptTrees },
		...prompts === void 0 ? {} : { injectedPrompts: prompts },
		...previous?.worldbooks === void 0 ? {} : { worldbooks: previous.worldbooks },
		...previous?.deletedWorldbookNames === void 0 ? {} : { deletedWorldbookNames: previous.deletedWorldbookNames },
		...previous?.worldbookBindings === void 0 ? {} : { worldbookBindings: previous.worldbookBindings },
		...previous?.hiddenPrefix === void 0 ? {} : { hiddenPrefix: previous.hiddenPrefix }
	};
}
/** Activate one preset's variables and scripts without resetting character or chat state. */
function initializeTavernHelperPresetState(state, scripts, variables, presetSourceId) {
	const samePreset = state.presetSourceId === presetSourceId;
	const previousPresetIds = new Set(state.presetScriptIds ?? []);
	const characterScripts = Object.fromEntries(Object.entries(state.scripts).filter(([id]) => !previousPresetIds.has(id)));
	const presetOverride = samePreset ? state.scriptTrees?.preset : void 0;
	const activePresetScripts = presetOverride === void 0 ? scripts : flattenedTavernScripts(presetOverride);
	const nextScripts = {
		...characterScripts,
		...Object.fromEntries(activePresetScripts.map((script) => [script.id, samePreset ? state.scripts[script.id] ?? script.data : script.data]))
	};
	const scriptIds = new Set(Object.keys(nextScripts));
	const scriptTrees = state.scriptTrees === void 0 ? void 0 : samePreset ? state.scriptTrees : Object.fromEntries(Object.entries(state.scriptTrees).filter(([scope]) => scope !== "preset"));
	return {
		...state,
		presetSourceId,
		presetScriptIds: activePresetScripts.map((script) => script.id),
		scopes: {
			...state.scopes,
			preset: samePreset ? state.scopes.preset : variables
		},
		scripts: nextScripts,
		...scriptTrees === void 0 ? {} : { scriptTrees },
		...state.injectedPrompts === void 0 ? {} : { injectedPrompts: state.injectedPrompts.filter((prompt) => scriptIds.has(prompt.scriptId)) }
	};
}
/** Parse one browser-authored variable replacement. */
function parseTavernHelperMutationRequest(raw) {
	if (new TextEncoder().encode(raw).byteLength > MAX_MUTATION_BYTES) throw new Error("Tavern Helper update is too large");
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error("Tavern Helper variable update is not valid JSON", { cause: error });
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Tavern Helper variable update must be an object");
	const value = parsed;
	if (value.format === 0 && value.operation === "set-chat-messages") {
		const messages = chatMessages(value.messages, false);
		if (messages.some((message) => message.message_id === void 0)) throw new Error("set-chat-messages requires message_id");
		return {
			format: 0,
			operation: value.operation,
			messages
		};
	}
	if (value.format === 0 && value.operation === "create-chat-messages") {
		const rawInsertAt = value.insertAt ?? value.insert_at ?? "end";
		const insertAt = rawInsertAt === "end" ? rawInsertAt : integer(rawInsertAt, "create-chat-messages insertAt");
		return {
			format: 0,
			operation: value.operation,
			messages: chatMessages(value.messages, true),
			insertAt
		};
	}
	if (value.format === 0 && value.operation === "delete-chat-messages") {
		if (!Array.isArray(value.messageIds) || value.messageIds.some((messageId) => !Number.isSafeInteger(messageId))) throw new Error("delete-chat-messages requires integer messageIds");
		return {
			format: 0,
			operation: value.operation,
			messageIds: value.messageIds
		};
	}
	if (value.format === 0 && value.operation === "rotate-chat-messages") return {
		format: 0,
		operation: value.operation,
		begin: integer(value.begin, "rotate-chat-messages begin"),
		middle: integer(value.middle, "rotate-chat-messages middle"),
		end: integer(value.end, "rotate-chat-messages end")
	};
	if (value.format === 0 && value.operation === "set-chat-hidden") {
		const start = integer(value.start, "set-chat-hidden start");
		const end = integer(value.end, "set-chat-hidden end");
		if (start < 0 || end < start || typeof value.hidden !== "boolean") throw new Error("set-chat-hidden requires a valid non-negative range and hidden flag");
		return {
			format: 0,
			operation: value.operation,
			start,
			end,
			hidden: value.hidden
		};
	}
	if (value.format === 0 && value.operation === "replace-script-trees") {
		if (value.scope !== "global" && value.scope !== "preset" && value.scope !== "character") throw new Error("Tavern Helper script tree scope is invalid");
		return {
			format: 0,
			operation: value.operation,
			scope: value.scope,
			trees: tavernScriptTrees(value.trees)
		};
	}
	if (value.format === 0 && value.operation === "replace-worldbook") return {
		format: 0,
		operation: value.operation,
		name: worldbookName(value.name),
		entries: worldbookEntries(value.entries)
	};
	if (value.format === 0 && value.operation === "delete-worldbook") return {
		format: 0,
		operation: value.operation,
		name: worldbookName(value.name)
	};
	if (value.format === 0 && value.operation === "bind-global-worldbooks") return {
		format: 0,
		operation: value.operation,
		names: stringArray(value.names, "global worldbook names").map(worldbookName)
	};
	if (value.format === 0 && value.operation === "bind-character-worldbooks") {
		const primary = value.primary === null ? null : worldbookName(value.primary);
		return {
			format: 0,
			operation: value.operation,
			primary,
			additional: stringArray(value.additional, "additional character worldbook names").map(worldbookName)
		};
	}
	if (value.format === 0 && value.operation === "bind-chat-worldbook") return {
		format: 0,
		operation: value.operation,
		name: value.name === null ? null : worldbookName(value.name)
	};
	if (value.format === 0 && value.operation === "replace-script-injections") {
		if (typeof value.scriptId !== "string" || value.scriptId === "") throw new Error("Tavern Helper injected prompts require a scriptId");
		return {
			format: 0,
			operation: value.operation,
			scriptId: value.scriptId,
			prompts: injectedPrompts(value.prompts, value.scriptId).map(({ scriptId: _scriptId, ...prompt }) => prompt)
		};
	}
	if (value.format !== 0 || value.scope !== "global" && value.scope !== "preset" && value.scope !== "character" && value.scope !== "chat" && value.scope !== "message" && value.scope !== "script") throw new Error("Tavern Helper variable update has an unsupported scope");
	if (value.scriptId !== void 0 && typeof value.scriptId !== "string") throw new Error("Tavern Helper scriptId must be a string");
	return {
		format: 0,
		scope: value.scope,
		...value.scriptId === void 0 ? {} : { scriptId: value.scriptId },
		variables: record$2(value.variables, "Tavern Helper variables")
	};
}
/** Apply one validated namespace replacement. */
function applyTavernHelperMutation(state, request) {
	if ("operation" in request) {
		if (request.operation === "set-chat-messages" || request.operation === "create-chat-messages" || request.operation === "delete-chat-messages" || request.operation === "rotate-chat-messages" || request.operation === "set-chat-hidden") return {
			...state,
			revision: state.revision + 1,
			lastMutation: { scope: "chat" }
		};
		if (request.operation === "replace-script-trees") {
			const scriptTrees = {
				...state.scriptTrees,
				[request.scope]: request.trees
			};
			const scopeIds = {
				global: request.scope === "global" ? new Set(flattenedTavernScripts(request.trees).map((script) => script.id)) : tavernScriptScopeIds(state, "global"),
				preset: request.scope === "preset" ? new Set(flattenedTavernScripts(request.trees).map((script) => script.id)) : tavernScriptScopeIds(state, "preset"),
				character: request.scope === "character" ? new Set(flattenedTavernScripts(request.trees).map((script) => script.id)) : tavernScriptScopeIds(state, "character")
			};
			const activeIds = /* @__PURE__ */ new Set([
				...scopeIds.global,
				...scopeIds.preset,
				...scopeIds.character
			]);
			const scripts = Object.fromEntries(Object.entries(state.scripts).filter(([id]) => activeIds.has(id)));
			for (const script of flattenedTavernScripts(request.trees)) scripts[script.id] = script.data;
			return {
				...state,
				revision: state.revision + 1,
				...request.scope === "preset" ? { presetScriptIds: [...scopeIds.preset] } : {},
				scripts,
				scriptTrees,
				...state.injectedPrompts === void 0 ? {} : { injectedPrompts: state.injectedPrompts.filter((prompt) => activeIds.has(prompt.scriptId)) },
				lastMutation: { scope: "script-tree" }
			};
		}
		if (request.operation === "replace-script-injections") {
			if (!(request.scriptId in state.scripts)) throw new Error("Tavern Helper injected prompts have an unknown scriptId");
			const replacedIds = new Set(request.prompts.map((prompt) => prompt.id));
			return {
				...state,
				revision: state.revision + 1,
				injectedPrompts: [...(state.injectedPrompts ?? []).filter((prompt) => prompt.scriptId !== request.scriptId && !replacedIds.has(prompt.id)), ...request.prompts.map((prompt) => ({
					...prompt,
					scriptId: request.scriptId
				}))],
				lastMutation: {
					scope: "injection",
					scriptId: request.scriptId
				}
			};
		}
		if (request.operation === "replace-worldbook") {
			const deleted = new Set(state.deletedWorldbookNames ?? []);
			deleted.delete(request.name);
			return {
				...state,
				revision: state.revision + 1,
				worldbooks: {
					...state.worldbooks,
					[request.name]: request.entries
				},
				deletedWorldbookNames: [...deleted],
				lastMutation: { scope: "worldbook" }
			};
		}
		if (request.operation === "delete-worldbook") {
			const worldbooks = Object.fromEntries(Object.entries(state.worldbooks ?? {}).filter(([name]) => name !== request.name));
			return {
				...state,
				revision: state.revision + 1,
				worldbooks,
				deletedWorldbookNames: [.../* @__PURE__ */ new Set([...state.deletedWorldbookNames ?? [], request.name])],
				lastMutation: { scope: "worldbook" }
			};
		}
		const bindings = state.worldbookBindings ?? {};
		const worldbookBindings = request.operation === "bind-global-worldbooks" ? {
			...bindings,
			global: request.names
		} : request.operation === "bind-character-worldbooks" ? {
			...bindings,
			character: {
				primary: request.primary,
				additional: request.additional
			}
		} : {
			...bindings,
			chat: request.name
		};
		return {
			...state,
			revision: state.revision + 1,
			worldbookBindings,
			lastMutation: { scope: "worldbook" }
		};
	}
	if (request.scope === "script") {
		const scriptId = request.scriptId;
		if (scriptId === void 0 || !(scriptId in state.scripts)) throw new Error("Tavern Helper script variable update has an unknown scriptId");
		return {
			...state,
			revision: state.revision + 1,
			scripts: {
				...state.scripts,
				[scriptId]: request.variables
			},
			lastMutation: {
				scope: "script",
				scriptId
			}
		};
	}
	return {
		...state,
		revision: state.revision + 1,
		scopes: {
			...state.scopes,
			[request.scope]: request.variables
		},
		lastMutation: { scope: request.scope }
	};
}
/** Serialize one state snapshot into a private command result. */
function encodeTavernHelperState(state) {
	return `${STATE_PREFIX}${JSON.stringify(state)}`;
}
/** Decode a Tavern Helper state from an unrelated-or-matching command result. */
function decodeTavernHelperState(text) {
	if (text === void 0 || !text.startsWith(STATE_PREFIX)) return void 0;
	const parsed = JSON.parse(text.slice(26));
	if (parsed.format !== 0 || typeof parsed.characterSourceId !== "string" || typeof parsed.revision !== "number" || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0) throw new Error("Tavern Helper state header is invalid");
	const scopes = record$2(parsed.scopes, "Tavern Helper scopes");
	const scripts = record$2(parsed.scripts, "Tavern Helper scripts");
	const parsedScopes = Object.fromEntries([
		"global",
		"preset",
		"character",
		"chat",
		"message"
	].map((key) => [key, record$2(scopes[key], `Tavern Helper ${key} variables`)]));
	const parsedScripts = Object.fromEntries(Object.entries(scripts).map(([id, value]) => [id, record$2(value, `Tavern Helper script ${id} variables`)]));
	const parsedScriptTrees = parsed.scriptTrees === void 0 ? void 0 : (() => {
		const scopes = record$2(parsed.scriptTrees, "Tavern Helper script trees");
		const unsupported = Object.keys(scopes).find((scope) => scope !== "global" && scope !== "preset" && scope !== "character");
		if (unsupported !== void 0) throw new Error(`Tavern Helper script tree scope '${unsupported}' is invalid`);
		return Object.fromEntries(Object.entries(scopes).map(([scope, trees]) => [scope, tavernScriptTrees(trees, `Tavern Helper ${scope} script trees`)]));
	})();
	if (parsedScriptTrees !== void 0 && Object.values(parsedScriptTrees).flatMap((trees) => flattenedTavernScripts(trees ?? [])).some((script) => !(script.id in parsedScripts))) throw new Error("Tavern Helper script trees reference missing script variables");
	const parsedWorldbooks = parsed.worldbooks === void 0 ? void 0 : Object.fromEntries(Object.entries(record$2(parsed.worldbooks, "Tavern Helper worldbooks")).map(([name, entries]) => [worldbookName(name), worldbookEntries(entries)]));
	const parsedInjectedPrompts = parsed.injectedPrompts === void 0 ? void 0 : injectedPrompts(parsed.injectedPrompts);
	if (parsedInjectedPrompts?.some((prompt) => !(prompt.scriptId in parsedScripts)) === true) throw new Error("Tavern Helper injected prompts reference an unknown scriptId");
	const deletedWorldbookNames = parsed.deletedWorldbookNames === void 0 ? void 0 : stringArray(parsed.deletedWorldbookNames, "Tavern Helper deleted worldbook names").map(worldbookName);
	let hiddenPrefix;
	if (parsed.hiddenPrefix !== void 0) {
		if (!Array.isArray(parsed.hiddenPrefix) || parsed.hiddenPrefix.length > MAX_CHAT_MESSAGES) throw new Error("Tavern Helper hidden chat prefix is invalid");
		hiddenPrefix = parsed.hiddenPrefix.map((item, index) => {
			const message = nested(item);
			const seq = integer(message.seq, `hidden chat message[${index}].seq`);
			if (seq < 0 || message.role !== "assistant" && message.role !== "user") throw new Error(`hidden chat message[${index}] is invalid`);
			if (typeof message.text !== "string") throw new Error(`hidden chat message[${index}].text must be a string`);
			return {
				seq,
				role: message.role,
				text: message.text
			};
		});
	}
	let worldbookBindings;
	if (parsed.worldbookBindings !== void 0) {
		const bindings = record$2(parsed.worldbookBindings, "Tavern Helper worldbook bindings");
		const global = bindings.global === void 0 ? void 0 : stringArray(bindings.global, "global worldbook names").map(worldbookName);
		const chat = bindings.chat === void 0 || bindings.chat === null ? bindings.chat : worldbookName(bindings.chat);
		const characterValue = bindings.character === void 0 ? void 0 : record$2(bindings.character, "character worldbook bindings");
		const primary = characterValue?.primary === void 0 || characterValue.primary === null ? characterValue?.primary : worldbookName(characterValue.primary);
		const additional = characterValue === void 0 ? void 0 : stringArray(characterValue.additional, "additional character worldbook names").map(worldbookName);
		worldbookBindings = {
			...global === void 0 ? {} : { global },
			...characterValue === void 0 ? {} : { character: {
				primary: primary ?? null,
				additional: additional ?? []
			} },
			...chat === void 0 ? {} : { chat }
		};
	}
	if (parsed.presetSourceId !== void 0 && typeof parsed.presetSourceId !== "string") throw new Error("Tavern Helper preset source is invalid");
	if (parsed.presetScriptIds !== void 0 && (!Array.isArray(parsed.presetScriptIds) || parsed.presetScriptIds.some((value) => typeof value !== "string"))) throw new Error("Tavern Helper preset script ids are invalid");
	const mutation = parsed.lastMutation;
	let lastMutation;
	if (mutation !== void 0) {
		if (typeof mutation !== "object" || mutation === null || Array.isArray(mutation)) throw new Error("Tavern Helper last mutation is invalid");
		const value = mutation;
		if (value.scope !== "global" && value.scope !== "preset" && value.scope !== "character" && value.scope !== "chat" && value.scope !== "message" && value.scope !== "script" && value.scope !== "worldbook" && value.scope !== "injection" && value.scope !== "script-tree") throw new Error("Tavern Helper last mutation scope is invalid");
		if (value.scriptId !== void 0 && typeof value.scriptId !== "string") throw new Error("Tavern Helper last mutation scriptId is invalid");
		lastMutation = {
			scope: value.scope,
			...value.scriptId === void 0 ? {} : { scriptId: value.scriptId }
		};
	}
	return {
		format: 0,
		characterSourceId: parsed.characterSourceId,
		...parsed.presetSourceId === void 0 ? {} : { presetSourceId: parsed.presetSourceId },
		...parsed.presetScriptIds === void 0 ? {} : { presetScriptIds: parsed.presetScriptIds },
		revision: parsed.revision,
		scopes: parsedScopes,
		scripts: parsedScripts,
		...parsedScriptTrees === void 0 ? {} : { scriptTrees: parsedScriptTrees },
		...parsedInjectedPrompts === void 0 ? {} : { injectedPrompts: parsedInjectedPrompts },
		...hiddenPrefix === void 0 ? {} : { hiddenPrefix },
		...parsedWorldbooks === void 0 ? {} : { worldbooks: parsedWorldbooks },
		...deletedWorldbookNames === void 0 ? {} : { deletedWorldbookNames },
		...worldbookBindings === void 0 ? {} : { worldbookBindings },
		...lastMutation === void 0 ? {} : { lastMutation }
	};
}
/** Project durable script injections into the existing in-chat prompt inserter. */
function tavernInjectedInChatPrompts(state) {
	return (state?.injectedPrompts ?? []).flatMap((prompt) => prompt.position === "in_chat" && prompt.content.trim() !== "" ? [{
		role: prompt.role,
		content: prompt.content,
		depth: prompt.depth,
		order: 100
	}] : []);
}
/** Return script prompt text that participates in the next lorebook scan. */
function tavernInjectedScanText(state) {
	return (state?.injectedPrompts ?? []).flatMap((prompt) => prompt.shouldScan && prompt.content.trim() !== "" ? [prompt.content] : []);
}
/** Fold the latest Tavern Helper state from private command results. */
function readTavernHelperState(events) {
	let state;
	for (const event of events) {
		if (event.type !== "command/done" || event.data.kind !== "success") continue;
		const decoded = decodeTavernHelperState(event.data.text);
		if (decoded !== void 0) state = decoded;
	}
	return state;
}
/** Minimal persistent MVU state for imported Character Cards. */
function jsonRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function unwrapInitializer(content) {
	const source = content.match(/<initvar>\s*([\s\S]*?)\s*<\/initvar>/iu)?.[1] ?? content;
	return source.trim().match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/u)?.[1] ?? source;
}
function initializerContents(card) {
	return [...card.lorebook?.entries ?? []].sort((left, right) => left.insertionOrder - right.insertionOrder).flatMap((entry) => {
		const tagged = /<initvar>[\s\S]*?<\/initvar>/iu.test(entry.content);
		const named = /\[initvar\]/iu.test(`${entry.comment ?? ""}\n${entry.name ?? ""}`);
		return tagged || named ? [unwrapInitializer(entry.content)] : [];
	});
}
function mergeInitialRecord(target, source) {
	for (const [key, value] of Object.entries(source)) {
		const current = jsonRecord(target[key]);
		const incoming = jsonRecord(value);
		if (current !== void 0 && incoming !== void 0) mergeInitialRecord(current, incoming);
		else target[key] = value;
	}
}
/** Read and merge the card-owned initial `stat_data` without activating hidden initializer lore. */
function readInitialMvuState(card) {
	const contents = initializerContents(card);
	if (contents.length === 0) return void 0;
	const merged = {};
	for (const content of contents) {
		const snapshot = snapshotJsonValue((0, import_dist.parse)(content, { maxAliasCount: 100 }));
		const record = snapshot === void 0 ? void 0 : jsonRecord(snapshot);
		if (record === void 0) throw new Error("Character Card MVU initializer must contain one JSON-compatible object");
		mergeInitialRecord(merged, record);
	}
	return merged;
}
/** Fold the latest durable MVU snapshot, falling back to the card initializer. */
function readCurrentMvuState(card, events) {
	let statData = readInitialMvuState(card);
	let updateCount = 0;
	let lastError;
	for (const event of events) {
		if (event.type === "command/done" && event.data.kind === "success") {
			const scriptState = decodeTavernHelperState(event.data.text);
			const scope = scriptState?.lastMutation?.scope;
			if (scriptState !== void 0 && (scope === "message" || scope === "chat")) {
				const replacement = scriptState.scopes[scope].stat_data;
				if (replacement !== void 0 && jsonRecord(replacement) !== void 0) {
					const initializing = statData === void 0;
					statData = replacement;
					if (!initializing) updateCount += 1;
					lastError = void 0;
				}
			}
			continue;
		}
		if (event.type !== "assistant/message" || statData === void 0) continue;
		const text = event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
		if (!/<UpdateVariable(?:variable)?>/iu.test(text)) continue;
		try {
			const update = applyMvuReply(statData, text);
			if (update === void 0) continue;
			statData = update.statData;
			updateCount += 1;
			lastError = void 0;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
	}
	if (statData === void 0) return void 0;
	return {
		statData,
		updateCount,
		...lastError === void 0 ? {} : { lastError }
	};
}
function pointerSegments(pointer) {
	if (pointer === "" || pointer === "/") return [];
	if (!pointer.startsWith("/")) throw new Error(`MVU path must be a JSON Pointer: ${pointer}`);
	const segments = pointer.slice(1).split("/").map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
	return segments[0] === "stat_data" ? segments.slice(1) : segments;
}
function parentAt(root, pointer) {
	const segments = pointerSegments(pointer);
	const key = segments.pop();
	if (key === void 0) throw new Error("MVU operation cannot replace the stat_data root");
	let current = root;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) throw new Error(`MVU path does not exist: ${pointer}`);
			current = current[index];
			continue;
		}
		const record = jsonRecord(current);
		if (record === void 0 || !(segment in record)) throw new Error(`MVU path does not exist: ${pointer}`);
		current = record[segment];
	}
	const parent = Array.isArray(current) ? current : jsonRecord(current);
	if (parent === void 0) throw new Error(`MVU path parent is not a container: ${pointer}`);
	return {
		parent,
		key
	};
}
function arrayIndex(array, key, append) {
	if (append && key === "-") return array.length;
	const index = Number(key);
	if (!Number.isSafeInteger(index) || index < 0 || index > array.length || !append && index === array.length) throw new Error(`MVU array index is unavailable: ${key}`);
	return index;
}
function readAt(root, pointer) {
	const { parent, key } = parentAt(root, pointer);
	if (Array.isArray(parent)) return parent[arrayIndex(parent, key, false)];
	if (!(key in parent)) throw new Error(`MVU path does not exist: ${pointer}`);
	return parent[key];
}
function removeAt(root, pointer) {
	const { parent, key } = parentAt(root, pointer);
	if (Array.isArray(parent)) return parent.splice(arrayIndex(parent, key, false), 1)[0];
	if (!(key in parent)) throw new Error(`MVU path does not exist: ${pointer}`);
	const value = parent[key];
	delete parent[key];
	return value;
}
function insertAt(root, pointer, value) {
	const { parent, key } = parentAt(root, pointer);
	if (Array.isArray(parent)) {
		parent.splice(arrayIndex(parent, key, true), 0, value);
		return;
	}
	if (key in parent) throw new Error(`MVU insert path already exists: ${pointer}`);
	parent[key] = value;
}
function replaceAt(root, pointer, value) {
	const { parent, key } = parentAt(root, pointer);
	if (Array.isArray(parent)) parent[arrayIndex(parent, key, false)] = value;
	else {
		if (!(key in parent)) throw new Error(`MVU replace path does not exist: ${pointer}`);
		parent[key] = value;
	}
}
function operation(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("MVU patch entries must be objects");
	const record = value;
	if (record.op !== "replace" && record.op !== "delta" && record.op !== "insert" && record.op !== "remove" && record.op !== "move") throw new Error(`Unsupported MVU operation: ${String(record.op)}`);
	if (record.path !== void 0 && typeof record.path !== "string") throw new Error("MVU operation path must be a string");
	if (record.from !== void 0 && typeof record.from !== "string") throw new Error("MVU move source must be a string");
	if (record.to !== void 0 && typeof record.to !== "string") throw new Error("MVU move destination must be a string");
	const snapshot = record.value === void 0 ? void 0 : snapshotJsonValue(record.value);
	if (record.value !== void 0 && snapshot === void 0) throw new Error("MVU operation value must be JSON-compatible");
	return {
		op: record.op,
		...record.path === void 0 ? {} : { path: record.path },
		...record.from === void 0 ? {} : { from: record.from },
		...record.to === void 0 ? {} : { to: record.to },
		...snapshot === void 0 ? {} : { value: snapshot }
	};
}
function patchArrays(text) {
	return [...text.matchAll(/<UpdateVariable(?:variable)?>\s*([\s\S]*?)\s*<\/UpdateVariable(?:variable)?>/giu)].map((match) => {
		const encoded = (match[1] ?? "").match(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/iu)?.[1];
		if (encoded === void 0) throw new Error("UpdateVariable is missing JSONPatch");
		const parsed = JSON.parse(encoded);
		if (!Array.isArray(parsed)) throw new Error("MVU JSONPatch must be an array");
		return parsed.map(operation);
	});
}
/** Apply every complete `<UpdateVariable>` JSON Patch block atomically. */
function applyMvuReply(current, text) {
	if (!/<UpdateVariable(?:variable)?>/iu.test(text)) return void 0;
	const batches = patchArrays(text);
	const cloned = snapshotJsonValue(current);
	if (cloned === void 0) throw new Error("Current MVU state is not JSON-compatible");
	let count = 0;
	for (const batch of batches) for (const item of batch) {
		const path = item.path;
		if (item.op === "move") {
			const from = item.from;
			const to = item.to ?? path;
			if (from === void 0 || to === void 0) throw new Error("MVU move requires from and to");
			insertAt(cloned, to, removeAt(cloned, from));
		} else if (item.op === "remove") {
			if (path === void 0) throw new Error("MVU remove requires path");
			removeAt(cloned, path);
		} else if (item.op === "insert") {
			if (path === void 0 || item.value === void 0) throw new Error("MVU insert requires path and value");
			insertAt(cloned, path, item.value);
		} else if (item.op === "replace") {
			if (path === void 0 || item.value === void 0) throw new Error("MVU replace requires path and value");
			replaceAt(cloned, path, item.value);
		} else {
			if (path === void 0 || typeof item.value !== "number") throw new Error("MVU delta requires path and numeric value");
			const before = readAt(cloned, path);
			if (typeof before !== "number") throw new Error(`MVU delta path is not numeric: ${path}`);
			replaceAt(cloned, path, before + item.value);
		}
		count += 1;
	}
	return {
		statData: cloned,
		appliedOperations: count
	};
}
/** Collect the inert card-authored rules needed by a dedicated MVU update call. */
function renderMvuUpdateInstructions(card, statData) {
	const entries = card.lorebook?.entries.filter((entry) => entry.enabled && !entry.hasDecorators && !/<%[\s\S]*?%>/u.test(entry.content) && /(?:变量更新规则|变量输出格式|<UpdateVariable>)/iu.test(entry.content)) ?? [];
	if (entries.length === 0) return void 0;
	return entries.sort((left, right) => left.insertionOrder - right.insertionOrder).map((entry) => substituteMvuMacros(entry.content, statData)).join("\n\n");
}
/** Collect a card-authored ten-choice contract for a dedicated completion call. */
function renderChoiceInstructions(card) {
	const symbols = [
		"①",
		"②",
		"③",
		"④",
		"⑤",
		"⑥",
		"⑦",
		"⑧",
		"⑨",
		"⑩"
	];
	return card.lorebook?.entries.filter((entry) => entry.enabled && entry.constant && !entry.hasDecorators && !/<%[\s\S]*?%>/u.test(entry.content) && symbols.every((symbol) => entry.content.includes(`<${symbol}>`) && entry.content.includes(`</${symbol}>`))).sort((left, right) => left.insertionOrder - right.insertionOrder).map((entry) => entry.content).join("\n\n") || void 0;
}
/** Normalize one complete card-authored ten-choice module. */
function normalizeChoiceSupplement(raw) {
	const choices = [
		"①",
		"②",
		"③",
		"④",
		"⑤",
		"⑥",
		"⑦",
		"⑧",
		"⑨",
		"⑩"
	].map((symbol) => {
		const matches = [...raw.matchAll(new RegExp(`<${symbol}>\\s*([\\s\\S]*?)\\s*</${symbol}>`, "gu"))];
		if (matches.length !== 1) return void 0;
		const value = matches[0]?.[1]?.trim();
		return value === void 0 || value.length === 0 || /<[①②③④⑤⑥⑦⑧⑨⑩]>/u.test(value) ? void 0 : `<${symbol}>${value}</${symbol}>`;
	});
	return choices.some((choice) => choice === void 0) ? void 0 : choices.join("\n");
}
/** Normalize a narrow model response to one complete, valid MVU block. */
function normalizeMvuSupplement(current, raw) {
	const fenced = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
	const complete = fenced.match(/<UpdateVariable(?:variable)?>[\s\S]*?<\/UpdateVariable(?:variable)>/iu)?.[0];
	const jsonPatch = fenced.match(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/iu)?.[1];
	let candidate = complete;
	if (candidate === void 0 && jsonPatch !== void 0) candidate = `<UpdateVariable>\n<Analysis>Dedicated MVU state update.</Analysis>\n<JSONPatch>\n${jsonPatch}\n</JSONPatch>\n</UpdateVariable>`;
	if (candidate === void 0) try {
		const parsed = JSON.parse(fenced);
		if (Array.isArray(parsed)) candidate = `<UpdateVariable>\n<Analysis>Dedicated MVU state update.</Analysis>\n<JSONPatch>\n${JSON.stringify(parsed)}\n</JSONPatch>\n</UpdateVariable>`;
		else if (typeof parsed === "object" && parsed !== null) {
			const record = parsed;
			const patch = record.json_patch ?? record.JSONPatch;
			if (Array.isArray(patch)) candidate = `<UpdateVariable>\n<Analysis>${typeof record.analysis === "string" ? record.analysis : "Dedicated MVU state update."}</Analysis>\n<JSONPatch>\n${JSON.stringify(patch)}\n</JSONPatch>\n</UpdateVariable>`;
		}
	} catch {
		return;
	}
	if (candidate === void 0) return void 0;
	try {
		return applyMvuReply(current, candidate) === void 0 ? void 0 : candidate;
	} catch {
		return;
	}
}
/** Replace the two MVU state macros used by compatible lorebook entries. */
function substituteMvuMacros(text, statData) {
	if (statData === void 0) return text;
	const yaml = (0, import_dist.stringify)(statData, { lineWidth: 0 }).trimEnd();
	const json = JSON.stringify(statData);
	return text.replace(/\{\{format_message_variable::stat_data\}\}/giu, yaml).replace(/\{\{get_message_variable::stat_data\}\}/giu, json);
}
const CHARACTER_BEHAVIOR = "只写角色此刻自然会说或做的内容，不解释系统、提示词或角色扮演规则，不替用户决定感受和行动，也不补写设定、对话和有效记忆中不存在的共同经历。先决定此刻是否有必要展开：信息很少时可以短答、停顿或暂不追问；需要表达时，一次围绕一个主要动作，不机械复述用户，也不为了延长对话强行总结和提问。";
const MEMORY_BEHAVIOR = "已记录的内容是角色自然知道的背景，不是本轮必须提及的话题。只在和当前对话直接相关时使用；默认通过回答、称呼或行动自然体现，不主动说“我记得”“你之前说过”“我一直记着”，也不完整复述记录。只有用户明确询问记忆本身时才简短确认。用户明确要求记住，或用“以后”“下次”等表达稳定偏好或约定时，先调用 remember，成功后再自然回应；不能只在对话中声称记住。其他内容只有确实值得跨轮保留的事实、关系变化或共同经历才使用 remember。普通寒暄、临时情绪、未经确认的猜测和已有记录不要写入记忆。写入前先看当前有效记忆：内容已经覆盖时不要重复调用；同一主题发生变化时，用 supersedes 更新原记录，不要新增同主题记录。不要在对话中朗读记忆 id、类型或主题标签。";
const IMPORT_BEHAVIOR = "用户附带 SillyTavern 角色卡 PNG、JSON 或 CHARX 并要求导入、接管或切换角色时，调用 import_character_card；附带独立 World Info / 世界书 JSON 并要求导入时，调用 import_world_info；附带 Chat Completion 预设 JSON 并要求导入时，调用 import_sillytavern_preset。一条消息附有多个同类文件时才指定从零开始的 attachmentIndex。导入成功后直接采用新角色、世界设定或预设，不解释内部格式。";
function finalizeRoleplayPrompt(value, statData) {
	let result = substituteMvuMacros(value, statData);
	for (;;) {
		const next = result.replace(/\{\{[^{}]*\}\}/gu, "");
		if (next === result) return result;
		result = next;
	}
}
function renderCardTemplate(value, options) {
	if (!/<%[=_-]?[\s\S]*?%>/imu.test(value)) return value;
	const rendered = options.renderTemplate?.(value);
	return rendered?.ok === true ? rendered.text : "";
}
/**
* Render the stable character contract installed as the Agent-scoped persona.
* @param config - normalized character identity and opening state.
* @returns model-visible system prompt text.
*/
function renderCharacterPrompt(config, loreBefore = [], loreAfter = []) {
	return finalizeRoleplayPrompt([
		`你是${config.characterName}。你不是扮演该角色的助手，也不是旁白；直接以${config.characterName}的身份与用户相处和交谈。`,
		...loreBefore,
		`角色设定：${config.persona}`,
		`当前场景：${config.scenario}`,
		`初始关系：${config.relationship}`,
		...loreAfter,
		CHARACTER_BEHAVIOR,
		MEMORY_BEHAVIOR,
		IMPORT_BEHAVIOR
	].join("\n\n"));
}
/**
* Render the identity contract for a chat import that has history but no Character Card.
* @param characterName - character named by the SillyTavern chat header.
* @param userName - optional user name retained by that header.
* @param userPersona - optional Persona description selected for the current Session.
* @returns model-visible prompt that continues imported history without applying the deployment default persona.
*/
function renderImportedChatPrompt(characterName, userName, userPersona) {
	return finalizeRoleplayPrompt([
		`你是${characterName}。直接以${characterName}的身份延续当前会话。`,
		...userName === void 0 ? [] : [`与您对话的人在导入记录中名为${userName}。`],
		...userPersona?.trim() ? [`对方当前选择的 Persona：\n${userPersona.trim()}`] : [],
		"以已导入的对话历史为准；缺少角色卡时，不要补用其他角色的身份、经历、场景或关系设定。",
		CHARACTER_BEHAVIOR,
		MEMORY_BEHAVIOR,
		IMPORT_BEHAVIOR
	].join("\n\n"));
}
/** Activate every Session book under one aggregate budget while retaining source identity. */
function renderSessionLorebooks(input) {
	const scanText = input.scanText ?? [];
	const inspected = inspectLorebooks(input.books, [...visibleDialogue(input.session, input.pendingMessages ?? [], input.context), ...scanText], {
		...input.templateOptions ?? {},
		tokenBudget: input.tokenBudget
	});
	const render = (values) => values.map((value) => {
		let result = substituteMvuMacros(value, input.statData);
		if (input.context !== void 0) result = resolveMacros(result, input.context, { dropUnknown: false }).text;
		return result;
	});
	return {
		...inspected,
		beforeCharacter: render(inspected.beforeCharacter),
		afterCharacter: render(inspected.afterCharacter),
		books: inspected.books.map((book) => ({
			...book,
			inspected: {
				...book.inspected,
				beforeCharacter: render(book.inspected.beforeCharacter),
				afterCharacter: render(book.inspected.afterCharacter)
			}
		}))
	};
}
/**
* Resolve the stable SillyTavern macros used throughout Character Card text.
* @param value - card-owned prose.
* @param card - active Character Card.
* @param userName - Session-imported user name, or a neutral fallback when none is known.
* @returns prose with character, user, time, and random macros resolved.
*/
function substituteCardMacros$1(value, card, userName = "用户") {
	return resolveMacros(value, {
		card,
		userName
	}, { dropUnknown: false }).text;
}
/**
* Render an imported Character Card as the complete Agent persona.
* @param card - active Session-owned card.
* @param loreBefore - active before-character lorebook text.
* @param loreAfter - active after-character lorebook text.
* @returns model-visible system prompt text.
*/
function renderImportedCharacterPrompt(card, loreBefore, loreAfter, userName, statData, userPersona, templateOptions = {}) {
	const name = card.nickname?.trim() || card.name;
	const original = `你是${name}。直接以${name}的身份与用户相处和交谈。`;
	const parts = [
		renderCardTemplate(card.systemPrompt.trim().length === 0 ? original : substituteCardMacros$1(card.systemPrompt.replaceAll("{{original}}", original), card, userName), templateOptions),
		...loreBefore.map((value) => substituteCardMacros$1(value, card, userName)),
		`角色描述：${renderCardTemplate(substituteCardMacros$1(card.description, card, userName), templateOptions)}`,
		`性格：${renderCardTemplate(substituteCardMacros$1(card.personality, card, userName), templateOptions)}`,
		`当前场景：${renderCardTemplate(substituteCardMacros$1(card.scenario, card, userName), templateOptions)}`,
		...userPersona?.trim() ? [`与角色对话的人：${resolveMacros(userPersona.trim(), {
			card,
			...userName === void 0 ? {} : { userName }
		}, { dropUnknown: false }).text}`] : [],
		...card.messageExample.trim().length === 0 ? [] : [`对话示例：\n${renderCardTemplate(substituteCardMacros$1(card.messageExample, card, userName), templateOptions)}`],
		...loreAfter.map((value) => substituteCardMacros$1(value, card, userName)),
		CHARACTER_BEHAVIOR,
		MEMORY_BEHAVIOR,
		IMPORT_BEHAVIOR
	];
	if (card.postHistoryInstructions.trim().length > 0) parts.push(renderCardTemplate(substituteCardMacros$1(card.postHistoryInstructions.replaceAll("{{original}}", ""), card, userName), templateOptions));
	if (statData !== void 0) parts.push("每次回复都必须在正文末尾完整输出一个 <UpdateVariable><Analysis>…</Analysis><JSONPatch>[…]</JSONPatch></UpdateVariable>；没有变量变化时 JSONPatch 也输出空数组。");
	return finalizeRoleplayPrompt(parts.join("\n\n"), statData);
}
function dialogueText(messages) {
	return messages.flatMap((message) => {
		if (message.source.kind !== "user" && message.source.kind !== "model") return [];
		return message.content.flatMap((block) => block.type === "text" ? [block.text] : []);
	});
}
function dialogueTranscript(messages) {
	return messages.flatMap((message) => {
		if (message.source.kind !== "user" && message.source.kind !== "model" || message.role !== "user" && message.role !== "assistant") return [];
		return [{
			role: message.role,
			content: message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
		}];
	});
}
function macroMessages$1(session, pendingMessages) {
	const history = session.deriveMessages();
	const historyIds = new Set(history.map((message) => message.id));
	return [...history, ...pendingMessages.filter((message) => !historyIds.has(message.id))].flatMap((message) => {
		if (message.source.kind !== "user" && message.source.kind !== "model" || message.role !== "user" && message.role !== "assistant") return [];
		return [{
			role: message.role,
			content: message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
		}];
	});
}
function resolveDialogueTexts(texts, session, pendingMessages, context) {
	const messages = macroMessages$1(session, pendingMessages);
	const pendingInput = texts.length === 0 ? void 0 : texts[texts.length - 1];
	return texts.map((text) => resolveMacros(text, {
		...context,
		messages,
		...pendingInput === void 0 ? {} : { pendingInput }
	}, { dropUnknown: false }).text);
}
function visibleDialogue(session, pendingMessages, context) {
	const history = session.deriveMessages();
	const historyIds = new Set(history.map((message) => message.id));
	const texts = [...history.flatMap((message) => {
		if (message.source.kind !== "user" && message.source.kind !== "model") return [];
		return message.content.flatMap((block) => block.type === "text" ? [block.text] : []);
	}), ...dialogueText(pendingMessages.filter((message) => !historyIds.has(message.id)))];
	return context === void 0 ? texts : resolveDialogueTexts(texts, session, pendingMessages, context);
}
/** Return model-visible dialogue text for preset marker assembly. */
function roleplayVisibleDialogue(session, pendingMessages = [], context) {
	return visibleDialogue(session, pendingMessages, context);
}
/** Return role-preserving model-visible dialogue for isolated prompt templates. */
function roleplayVisibleTranscript(session, pendingMessages = [], context) {
	const history = session.deriveMessages();
	const historyIds = new Set(history.map((message) => message.id));
	const transcript = [...dialogueTranscript(history), ...dialogueTranscript(pendingMessages.filter((message) => !historyIds.has(message.id)))];
	if (context === void 0) return transcript;
	const messages = macroMessages$1(session, pendingMessages);
	const pendingInput = transcript.length === 0 ? void 0 : transcript[transcript.length - 1]?.content;
	return transcript.map((message) => ({
		role: message.role,
		content: resolveMacros(message.content, {
			...context,
			messages,
			...pendingInput === void 0 ? {} : { pendingInput }
		}, { dropUnknown: false }).text
	}));
}
/**
* Render the complete active-memory snapshot for the next model request.
* @param events - current Session event history.
* @returns model-visible dynamic context with ids needed for later correction.
*/
function renderMemoryContext(events) {
	const { active } = readAgentRpMemoryHistory(events);
	if (active.length === 0) return "";
	return finalizeRoleplayPrompt(["角色已知的持久背景如下。这不是本轮要逐条提及的清单；方括号内仅是更新记忆所需的内部索引：", ...active.map((record) => `- [${record.id} | ${record.kind} | ${record.subject}] ${record.text}`)].join("\n"));
}
/** Isolated, deterministic rendering for the supported SillyTavern EJS subset. */
const MAX_TEMPLATE_CHARS = 256 * 1024;
const MAX_OUTPUT_CHARS = 256 * 1024;
const MAX_RESOURCE_CHARS = 4 * 1024 * 1024;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_STACK_BYTES = 512 * 1024;
const MAX_INTERRUPT_POLLS = 512;
const MAX_PENDING_JOBS = 1024;
const MAX_RENDERER_EVALUATIONS = 256;
const MAX_REGEX_PATTERN_CHARS = 16 * 1024;
const MAX_REGEX_INPUT_CHARS = 512 * 1024;
const MAX_REGEX_EVALUATIONS = 4096;
const MAX_REGEX_PATTERN_CHARS_PER_MATCHER = 2 * 1024 * 1024;
const MAX_REGEX_INTERRUPT_POLLS = 64;
let quickjsModule;
/** Project normalized Session lorebooks into the read-only EJS resource index. */
function createEjsWorldInfoBooks(books) {
	return books.map((book) => ({
		id: book.id,
		...book.name === void 0 ? {} : { name: book.name },
		entries: book.lorebook.entries.map((entry) => ({
			sourceId: entry.sourceId,
			...entry.name === void 0 ? {} : { name: entry.name },
			...entry.comment === void 0 ? {} : { comment: entry.comment },
			content: entry.content
		}))
	}));
}
function segments(template) {
	const result = [];
	const literalClosings = (value) => value.replaceAll("%%>", "%>");
	let cursor = 0;
	let trimLeadingWhitespace = false;
	while (cursor < template.length) {
		const opening = template.indexOf("<%", cursor);
		if (opening < 0) {
			const tail = literalClosings(trimLeadingWhitespace ? template.slice(cursor).replace(/^\s+/u, "") : template.slice(cursor));
			if (tail !== "") result.push({
				kind: "text",
				value: tail
			});
			return result;
		}
		let text = template.slice(cursor, opening);
		if (trimLeadingWhitespace) text = text.replace(/^\s+/u, "");
		const marker = template[opening + 2];
		if (marker === "%") {
			if (text !== "") result.push({
				kind: "text",
				value: literalClosings(text)
			});
			result.push({
				kind: "text",
				value: "<%"
			});
			cursor = opening + 3;
			trimLeadingWhitespace = false;
			continue;
		}
		if (marker === "_") text = text.replace(/\s+$/u, "");
		if (text !== "") result.push({
			kind: "text",
			value: literalClosings(text)
		});
		const contentStart = opening + (marker === "=" || marker === "-" || marker === "#" || marker === "_" ? 3 : 2);
		const closing = template.indexOf("%>", contentStart);
		if (closing < 0) return void 0;
		const closeMarker = template[closing - 1];
		const contentEnd = closeMarker === "-" || closeMarker === "_" ? closing - 1 : closing;
		const value = template.slice(contentStart, contentEnd);
		if (marker !== "#") result.push({
			kind: marker === "=" ? "escaped" : marker === "-" ? "raw" : "code",
			value
		});
		cursor = closing + 2;
		if (closeMarker === "_") trimLeadingWhitespace = true;
		else {
			trimLeadingWhitespace = false;
			if (closeMarker === "-") {
				if (template.startsWith("\r\n", cursor)) cursor += 2;
				else if (template[cursor] === "\n" || template[cursor] === "\r") cursor += 1;
			}
		}
	}
	return result;
}
function compileTemplate(template, context) {
	const parsed = segments(template);
	if (parsed === void 0) return void 0;
	const transcript = context.transcript ?? [];
	const transcriptIsMessagePrefix = transcript.length <= context.messages.length && transcript.every((message, index) => message.content === context.messages[index]);
	const input = JSON.stringify({
		char: context.characterName,
		user: context.userName,
		messages: transcriptIsMessagePrefix ? context.messages.slice(transcript.length) : context.messages,
		transcript,
		transcriptIsMessagePrefix,
		variables: context.variables ?? {},
		scopes: context.variableScopes ?? {},
		...context.statData === void 0 ? {} : { stat_data: context.statData }
	});
	const statements = parsed.map((segment) => {
		if (segment.kind === "text") return `__append(${JSON.stringify(segment.value)});`;
		if (segment.kind === "escaped") return `__append(__escape((${segment.value})));`;
		if (segment.kind === "raw") return `__append((${segment.value}));`;
		return segment.value;
	}).join("\n");
	return `(async () => {
    'use strict';
    const __input = JSON.parse(${JSON.stringify(input)});
    let __output = '';
    const __append = value => {
      if (value === undefined || value === null) return;
      __output += String(value);
      if (__output.length > ${MAX_OUTPUT_CHARS}) throw new Error('__AGENT_RP_EJS_OUTPUT_LIMIT__');
    };
    const __escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;',
    })[character]);
    const __owns = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
    const char = __input.char;
    const user = __input.user;
    const charName = char;
    const userName = user;
    const runType = 'generate';
    const __transcript = __input.transcript;
    const messages = __input.transcriptIsMessagePrefix
      ? [...__transcript.map(message => message.content), ...__input.messages]
      : __input.messages;
    const __normalizeMessageId = value => {
      const id = Number(value);
      if (!Number.isSafeInteger(id)) return -1;
      return id < 0 ? __transcript.length + id : id;
    };
    const __messageRole = value => value === 'system' || value === 'user' || value === 'assistant' ? value : undefined;
    const getChatMessage = (id, role = undefined) => {
      const index = __normalizeMessageId(id);
      const message = index < 0 || index >= __transcript.length ? undefined : __transcript[index];
      const selectedRole = __messageRole(role);
      if (message === undefined || (role !== undefined && selectedRole === undefined) || (selectedRole !== undefined && message.role !== selectedRole)) return '';
      return message.content;
    };
    const getChatMessages = (first, second = undefined, third = undefined) => {
      if (typeof second !== 'number') {
        const count = Number(first);
        const role = __messageRole(second);
        if (!Number.isSafeInteger(count) || count <= 0 || (second !== undefined && role === undefined)) return [];
        const selected = role === undefined ? __transcript : __transcript.filter(message => message.role === role);
        return selected.slice(Math.max(0, selected.length - count)).map(message => message.content);
      }
      const start = __normalizeMessageId(first);
      const end = __normalizeMessageId(second);
      const role = __messageRole(third);
      if (start < 0 || end < start || start >= __transcript.length || (third !== undefined && role === undefined)) return [];
      return __transcript.slice(start, Math.min(end + 1, __transcript.length))
        .filter(message => role === undefined || message.role === role)
        .map(message => message.content);
    };
    const __lastMessageByRole = role => {
      for (let index = __transcript.length - 1; index >= 0; index -= 1) {
        if (__transcript[index].role === role) return { id: index, content: __transcript[index].content };
      }
      return { id: -1, content: '' };
    };
    const __lastUser = __lastMessageByRole('user');
    const __lastCharacter = __lastMessageByRole('assistant');
    const lastMessageId = __transcript.length - 1;
    const lastUserMessageId = __lastUser.id;
    const lastCharMessageId = __lastCharacter.id;
    const lastUserMessage = __lastUser.content;
    const lastCharMessage = __lastCharacter.content;
    const lastMessage = lastMessageId < 0
      ? (messages.length === 0 ? '' : messages[messages.length - 1])
      : __transcript[lastMessageId].content;
    const variableScopes = __input.scopes;
    const stat_data = __input.stat_data;
    const __plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const __set = (record, key, value) => Object.defineProperty(record, key, {
      value, enumerable: true, configurable: true, writable: true,
    });
    const __merge = (target, source) => {
      if (!__plain(source)) return target;
      for (const key of Object.keys(source)) {
        const value = source[key];
        if (__plain(value)) {
          const current = __plain(target[key]) ? target[key] : Object.create(null);
          __set(target, key, __merge(current, value));
        } else {
          __set(target, key, Array.isArray(value) ? value.slice() : value);
        }
      }
      return target;
    };
    const __cloneDeep = (value, seen = new WeakMap()) => {
      if (value === null || typeof value !== 'object') return value;
      if (seen.has(value)) return seen.get(value);
      const target = Array.isArray(value) ? [] : Object.create(null);
      seen.set(value, target);
      for (const key of Object.keys(value)) __set(target, key, __cloneDeep(value[key], seen));
      return target;
    };
    const __path = value => (Array.isArray(value) ? value : String(value)
      .replace(/\\[([^\\]]+)\\]/g, '.$1').split('.'))
      .map(segment => String(segment).replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const __readPath = (record, path, fallback) => {
      let current = record;
      for (const segment of __path(path)) {
        if (current === null || typeof current !== 'object' || !__owns(current, segment)) return fallback;
        current = current[segment];
      }
      return current;
    };
    const __writePath = (record, path, value) => {
      const segments = __path(path);
      if (segments.length === 0) return record;
      let current = record;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        const next = segments[index + 1];
        const child = current[segment];
        if (child === null || typeof child !== 'object') {
          __set(current, segment, /^\\d+$/u.test(next) ? [] : Object.create(null));
        }
        current = current[segment];
      }
      __set(current, segments[segments.length - 1], value);
      return record;
    };
    const __deletePath = (record, path) => {
      const segments = __path(path);
      let current = record;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (current === null || typeof current !== 'object' || !__owns(current, segment)) return;
        current = current[segment];
      }
      if (current !== null && typeof current === 'object') delete current[segments.at(-1)];
    };
    const __flattenPaths = values => values.flatMap(value => Array.isArray(value) ? value : [value]);
    const _ = Object.freeze({
      get: (record, path, fallback = undefined) => __readPath(record, path, fallback),
      cloneDeep: value => __cloneDeep(value),
      mapValues: (record, iteratee) => {
        const result = Object.create(null);
        if (record === null || typeof record !== 'object') return result;
        for (const key of Object.keys(record)) __set(result, key, iteratee(record[key], key, record));
        return result;
      },
      isEmpty: value => {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
        if (value instanceof Map || value instanceof Set) return value.size === 0;
        return typeof value === 'object' ? Object.keys(value).length === 0 : true;
      },
      omit: (record, ...paths) => {
        const result = __cloneDeep(record);
        for (const path of __flattenPaths(paths)) __deletePath(result, path);
        return result;
      },
      pick: (record, ...paths) => {
        const result = Object.create(null);
        const missing = Object.create(null);
        for (const path of __flattenPaths(paths)) {
          const value = __readPath(record, path, missing);
          if (value !== missing) __writePath(result, path, __cloneDeep(value));
        }
        return result;
      },
      transform: (record, iteratee, accumulator = Array.isArray(record) ? [] : Object.create(null)) => {
        if (record === null || typeof record !== 'object') return accumulator;
        for (const key of Object.keys(record)) {
          if (iteratee(accumulator, record[key], Array.isArray(record) ? Number(key) : key, record) === false) break;
        }
        return accumulator;
      },
    });
    const __yamlScalar = value => {
      if (value === null) return 'null';
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return JSON.stringify(String(value));
    };
    const __yamlLines = (value, depth = 0) => {
      const indent = '  '.repeat(depth);
      if (value === null || typeof value !== 'object') return [indent + __yamlScalar(value)];
      const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
      if (entries.length === 0) return [indent + (Array.isArray(value) ? '[]' : '{}')];
      return entries.flatMap(([key, item]) => {
        const prefix = Array.isArray(value) ? '-' : JSON.stringify(String(key)) + ':';
        if (item === null || typeof item !== 'object') return [indent + prefix + ' ' + __yamlScalar(item)];
        return [indent + prefix, ...__yamlLines(item, depth + 1)];
      });
    };
    const YAML = Object.freeze({ stringify: value => value === undefined ? undefined : __yamlLines(value).join('\\n') + '\\n' });
    const variables = [
      variableScopes.global, variableScopes.preset, variableScopes.character,
      variableScopes.chat, variableScopes.message, __input.variables,
    ].reduce((result, record) => __merge(result, record), Object.create(null));
    if (stat_data !== undefined) __set(variables, 'stat_data', stat_data);
    const __read = (record, name, fallback) => {
      if (name === null) return record;
      const key = String(name);
      if (__owns(record, key)) return record[key];
      let current = record;
      for (const segment of key.split('.')) {
        if (current === null || typeof current !== 'object' || !__owns(current, segment)) return fallback;
        current = current[segment];
      }
      return current;
    };
    const __scopeNames = new Set(['cache', 'global', 'preset', 'character', 'local', 'chat', 'message', 'initial']);
    const __fallback = value => __plain(value)
      ? (__owns(value, 'defaults') ? value.defaults : undefined)
      : typeof value === 'string' && __scopeNames.has(value) ? undefined : value;
    const __scope = value => {
      const option = __plain(value) ? value : {};
      const requested = typeof value === 'string' ? value
        : typeof option.scope === 'string' ? option.scope
          : typeof option.type === 'string' ? option.type : 'cache';
      if (requested === 'global') return variableScopes.global ?? {};
      if (requested === 'preset') return variableScopes.preset ?? {};
      if (requested === 'character') return variableScopes.character ?? {};
      if (requested === 'local' || requested === 'chat') return variableScopes.chat ?? {};
      if (requested === 'message') return variableScopes.message ?? {};
      if (requested === 'initial') return {};
      return variables;
    };
    const getvar = (name, options = undefined) => __read(__scope(options), name, __fallback(options));
    const __scoped = scope => (name, options = undefined) => __read(scope, name, __fallback(options));
    const getchatvar = __scoped(variableScopes.chat ?? {});
    const getglobalvar = __scoped(variableScopes.global ?? {});
    const getlocalvar = getchatvar;
    const getpresetvar = __scoped(variableScopes.preset ?? {});
    const getcharactervar = __scoped(variableScopes.character ?? {});
    const getmessagevar = __scoped(variableScopes.message ?? {});
    const getVar = getvar;
    const getChatVar = getchatvar;
    const getGlobalVar = getglobalvar;
    const getLocalVar = getlocalvar;
    const getPresetVar = getpresetvar;
    const getCharacterVar = getcharactervar;
    const getMessageVar = getmessagevar;
    const getWorldInfo = async (...args) => globalThis.__agentRpGetWorldInfo(...args);
    const getwi = getWorldInfo;
    const print = (...values) => { for (const value of values) __append(value); };
    globalThis.Date = undefined;
    Math.random = () => { throw new Error('__AGENT_RP_EJS_NONDETERMINISTIC__'); };
    ${statements}
    return __output;
  })()`;
}
function failureKind(value) {
	if (typeof value !== "object" || value === null) return "runtime-error";
	const record = value;
	const message = typeof record.message === "string" ? record.message : "";
	if (message.includes("__AGENT_RP_EJS_OUTPUT_LIMIT__")) return "output-limit";
	if (message.includes("__AGENT_RP_EJS_RESOURCE_UNSUPPORTED__")) return "resource-unsupported";
	if (message.includes("__AGENT_RP_EJS_RESOURCE_LIMIT__")) return "resource-limit";
	if (message.includes("interrupted")) return "execution-limit";
	if (/out of memory|memory limit/iu.test(message)) return "memory-limit";
	if (record.name === "SyntaxError") return "syntax-error";
	return "runtime-error";
}
function parsedRegexPattern(value, caseSensitive) {
	if (value === "") return void 0;
	let source = value;
	let flags = "";
	if (value[0] === "/") {
		let escaped = false;
		let inClass = false;
		let closing = -1;
		for (let index = 1; index < value.length; index += 1) {
			const character = value[index];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === "[") inClass = true;
			else if (character === "]") inClass = false;
			else if (character === "/" && !inClass) closing = index;
		}
		if (closing > 0) {
			source = value.slice(1, closing);
			flags = value.slice(closing + 1);
			if (!/^[a-z]*$/u.test(flags)) return void 0;
		}
	}
	if (!caseSensitive && !flags.includes("i")) flags += "i";
	return {
		source,
		flags
	};
}
function regexFailure(value) {
	if (typeof value !== "object" || value === null) return "invalid";
	const record = value;
	const message = typeof record.message === "string" ? record.message : "";
	if (message.includes("interrupted")) return "execution-limit";
	if (/out of memory|memory limit/iu.test(message)) return "resource-limit";
	return "invalid";
}
function createQuickJsRegexMatcher(quickjs) {
	const runtime = quickjs.newRuntime();
	runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
	runtime.setMaxStackSize(MAX_STACK_BYTES);
	let polls = 0;
	runtime.setInterruptHandler(() => ++polls > MAX_REGEX_INTERRUPT_POLLS);
	const vm = runtime.newContext();
	const compiled = vm.evalCode("(pattern, flags, text) => new RegExp(pattern, flags).test(text)", "agent-rp:world-info-regex");
	let matchFunction;
	if (compiled.error !== void 0) compiled.error.dispose();
	else matchFunction = compiled.value;
	let disposed = false;
	let evaluations = 0;
	let patternChars = 0;
	return {
		match(keys, text, caseSensitive) {
			if (disposed || matchFunction === void 0 || text.length > MAX_REGEX_INPUT_CHARS) return {
				ok: false,
				kind: "resource-limit"
			};
			if (evaluations + keys.length > MAX_REGEX_EVALUATIONS) return {
				ok: false,
				kind: "resource-limit"
			};
			const matchedKeys = [];
			for (const key of keys) {
				const parsed = parsedRegexPattern(key, caseSensitive);
				if (parsed === void 0 || parsed.source.length > MAX_REGEX_PATTERN_CHARS) return {
					ok: false,
					kind: "invalid"
				};
				patternChars += parsed.source.length;
				evaluations += 1;
				if (patternChars > MAX_REGEX_PATTERN_CHARS_PER_MATCHER) return {
					ok: false,
					kind: "resource-limit"
				};
				let patternHandle;
				let flagsHandle;
				let textHandle;
				try {
					patternHandle = vm.newString(parsed.source);
					flagsHandle = vm.newString(parsed.flags);
					textHandle = vm.newString(text);
					polls = 0;
					const result = vm.callFunction(matchFunction, vm.undefined, patternHandle, flagsHandle, textHandle);
					const errorHandle = result.error;
					if (errorHandle !== void 0) {
						const error = vm.dump(errorHandle);
						errorHandle.dispose();
						return {
							ok: false,
							kind: regexFailure(error)
						};
					}
					const valueHandle = result.value;
					if (valueHandle === void 0) return {
						ok: false,
						kind: "invalid"
					};
					const matched = vm.dump(valueHandle);
					valueHandle.dispose();
					if (typeof matched !== "boolean") return {
						ok: false,
						kind: "invalid"
					};
					if (matched) matchedKeys.push(key);
				} catch (error) {
					return {
						ok: false,
						kind: regexFailure(error)
					};
				} finally {
					patternHandle?.dispose();
					flagsHandle?.dispose();
					textHandle?.dispose();
				}
			}
			return {
				ok: true,
				matchedKeys
			};
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			matchFunction?.dispose();
			vm.dispose();
			runtime.dispose();
		}
	};
}
/** QuickJS-backed evaluator; every render gets a fresh runtime and context. */
var EjsTemplateEngine = class EjsTemplateEngine {
	quickjs;
	constructor(quickjs) {
		this.quickjs = quickjs;
	}
	/** Load the embedded QuickJS WebAssembly module once during plugin startup. */
	static async create() {
		quickjsModule ??= newQuickJSWASMModuleFromVariant(variant);
		return new EjsTemplateEngine(await quickjsModule);
	}
	/** Render one template without exposing Host globals, modules, files, or network APIs. */
	render(template, context, target = {}) {
		if (template.length > MAX_TEMPLATE_CHARS) return {
			ok: false,
			kind: "source-limit"
		};
		const code = compileTemplate(template, context);
		if (code === void 0) return {
			ok: false,
			kind: "syntax-error"
		};
		const runtime = this.quickjs.newRuntime();
		runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
		runtime.setMaxStackSize(MAX_STACK_BYTES);
		let polls = 0;
		runtime.setInterruptHandler(() => ++polls > MAX_INTERRUPT_POLLS);
		const vm = runtime.newContext();
		try {
			let resourceReads = 0;
			let resourceChars = 0;
			const lookup = vm.newFunction("__agentRpGetWorldInfo", (...handles) => {
				resourceReads += 1;
				if (resourceReads > 128) throw new Error("__AGENT_RP_EJS_RESOURCE_LIMIT__");
				const args = handles.map((handle) => vm.dump(handle));
				const books = context.worldInfoBooks ?? [];
				const explicitEntry = typeof args[1] === "string" || typeof args[1] === "number";
				const selectedBooks = explicitEntry ? books.filter((book) => book.id === String(args[0]) || book.name === args[0]) : target.worldInfoBookId === void 0 ? books : books.filter((book) => book.id === target.worldInfoBookId);
				const query = explicitEntry ? args[1] : args[0];
				const text = (typeof query === "string" || typeof query === "number" ? selectedBooks.flatMap((book) => book.entries).find((item) => item.sourceId === String(query) || item.name === query || item.comment === query) : void 0)?.content ?? "";
				if (/<%[=_-]?[\s\S]*?%>/imu.test(text)) throw new Error("__AGENT_RP_EJS_RESOURCE_UNSUPPORTED__");
				resourceChars += text.length;
				if (resourceChars > MAX_RESOURCE_CHARS) throw new Error("__AGENT_RP_EJS_RESOURCE_LIMIT__");
				return vm.newString(text);
			});
			vm.setProp(vm.global, "__agentRpGetWorldInfo", lookup);
			lookup.dispose();
			const result = vm.evalCode(code, "agent-rp:ejs");
			const errorHandle = result.error;
			if (errorHandle !== void 0) {
				const error = vm.dump(errorHandle);
				errorHandle.dispose();
				return {
					ok: false,
					kind: failureKind(error)
				};
			}
			const promiseHandle = result.value;
			if (promiseHandle === void 0) return {
				ok: false,
				kind: "runtime-error"
			};
			const jobs = runtime.executePendingJobs(MAX_PENDING_JOBS);
			const jobError = jobs.error;
			if (jobError !== void 0) {
				const error = jobError.context.dump(jobError);
				jobError.dispose();
				jobs.dispose();
				promiseHandle.dispose();
				return {
					ok: false,
					kind: failureKind(error)
				};
			}
			jobs.dispose();
			const settled = vm.getPromiseState(promiseHandle);
			promiseHandle.dispose();
			if (settled.type === "pending") return {
				ok: false,
				kind: "execution-limit"
			};
			if (settled.type === "rejected") {
				const error = vm.dump(settled.error);
				settled.error.dispose();
				return {
					ok: false,
					kind: failureKind(error)
				};
			}
			const value = vm.dump(settled.value);
			settled.value.dispose();
			return typeof value === "string" ? {
				ok: true,
				text: value
			} : {
				ok: false,
				kind: "runtime-error"
			};
		} catch (error) {
			return {
				ok: false,
				kind: failureKind(error)
			};
		} finally {
			vm.dispose();
			runtime.dispose();
		}
	}
	/** Bind one immutable context and cap the number of templates evaluated for one prompt or projection pass. */
	createRenderer(context) {
		let evaluations = 0;
		return (template, target) => {
			if (evaluations >= MAX_RENDERER_EVALUATIONS) return {
				ok: false,
				kind: "execution-limit"
			};
			evaluations += 1;
			return this.render(template, context, target);
		};
	}
	/** Create one bounded matcher that never executes untrusted regex in the Host JavaScript engine. */
	createRegexMatcher() {
		return createQuickJsRegexMatcher(this.quickjs);
	}
};
/** Installation of the profile bundle's managed Agent RP preset. */
/** Preset id selected by the bundle's profile patch. */
const AGENT_RP_PRESET_ID = "agent-rp";
const OWNER = "@dsh-external/dsh-agent-rp";
const MANIFEST = ".dsh-agent-rp-owner.json";
const PRESET_FILES = ["agent.cordis.yml", "preset.yml"];
function digest(files) {
	const hash = createHash("sha256");
	for (const [filename, content] of [[PRESET_FILES[0], files[0]], [PRESET_FILES[1], files[1]]]) {
		hash.update(filename);
		hash.update("\0");
		hash.update(content);
		hash.update("\0");
	}
	return hash.digest("hex");
}
function readPresetFiles(directory) {
	return [readFileSync(join(directory, PRESET_FILES[0]), "utf8"), readFileSync(join(directory, PRESET_FILES[1]), "utf8")];
}
function readOwnedManifest(directory) {
	let value;
	try {
		value = JSON.parse(readFileSync(join(directory, MANIFEST), "utf8"));
	} catch (error) {
		throw new Error(`Agent RP preset ${JSON.stringify(directory)} is not managed by ${OWNER}`, { cause: error });
	}
	const record = value;
	if (record?.owner !== OWNER || record.format !== 0 || typeof record.digest !== "string") throw new Error(`Agent RP preset ${JSON.stringify(directory)} has an invalid ownership manifest`);
	return record;
}
function assertUnmodified(directory, manifest) {
	const expectedEntries = /* @__PURE__ */ new Set([...PRESET_FILES, MANIFEST]);
	const entries = readdirSync(directory);
	if (entries.length !== expectedEntries.size || entries.some((entry) => !expectedEntries.has(entry))) throw new Error(`managed Agent RP preset ${JSON.stringify(directory)} contains unowned files`);
	if (digest(readPresetFiles(directory)) !== manifest.digest) throw new Error(`managed Agent RP preset ${JSON.stringify(directory)} was edited locally; copy it to another preset id before upgrading`);
}
function stagePreset(root, files, manifest) {
	const staging = join(root, `.${AGENT_RP_PRESET_ID}.install-${process.pid}-${randomUUID()}`);
	mkdirSync(staging);
	try {
		writeFileSync(join(staging, PRESET_FILES[0]), files[0], {
			encoding: "utf8",
			mode: 384
		});
		writeFileSync(join(staging, PRESET_FILES[1]), files[1], {
			encoding: "utf8",
			mode: 384
		});
		writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		return staging;
	} catch (error) {
		rmSync(staging, {
			recursive: true,
			force: true
		});
		throw error;
	}
}
/**
* Install or upgrade the package-owned preset without overwriting local work.
* @param options - optional filesystem roots used by focused tests.
* @returns whether the managed preset was created, updated, or already current.
*/
function installBundledAgentRpPreset(options = {}) {
	const source = resolve(options.sourceDir ?? fileURLToPath(new URL("../preset/", import.meta.url)));
	const root = resolve(options.presetRoot ?? dshHomePath(".agent-presets"));
	const target = join(root, AGENT_RP_PRESET_ID);
	const files = readPresetFiles(source);
	const sourceDigest = digest(files);
	const nextManifest = {
		owner: OWNER,
		format: 0,
		digest: sourceDigest
	};
	mkdirSync(root, {
		recursive: true,
		mode: 448
	});
	if (existsSync(target)) {
		const current = readOwnedManifest(target);
		assertUnmodified(target, current);
		if (current.digest === sourceDigest) return "unchanged";
	}
	const staging = stagePreset(root, files, nextManifest);
	if (!existsSync(target)) try {
		renameSync(staging, target);
		return "created";
	} catch (error) {
		rmSync(staging, {
			recursive: true,
			force: true
		});
		throw error;
	}
	const backup = join(root, `.${AGENT_RP_PRESET_ID}.backup-${process.pid}-${randomUUID()}`);
	renameSync(target, backup);
	try {
		renameSync(staging, target);
	} catch (error) {
		renameSync(backup, target);
		rmSync(staging, {
			recursive: true,
			force: true
		});
		throw error;
	}
	rmSync(backup, {
		recursive: true,
		force: true
	});
	return "updated";
}
/** Validate one UI-only preset command; its existing command/run event is the durable mutation. */
function configurePresetFromCommand(invocation) {
	const events = invocation.agent.session.events;
	const current = events.at(-1);
	if (current?.type !== "command/run" || current.data.name !== "rp-preset-configure" || current.data.args !== invocation.rawInput) throw new Error("preset configuration command is not the current session event");
	const active = readActiveSessionPreset(events.slice(0, -1));
	if (active === void 0) throw new Error("this roleplay Session has no imported preset");
	configurePreset(active, parsePresetConfigurationRequest(invocation.rawInput));
	return { kind: "success" };
}
/** Browser-safe values shared by the local Persona library and Roleplay UI. */
/** Same-origin endpoint served by the Agent RP Host plugin. */
const PERSONA_LIBRARY_PATH = "/api/agent-rp/personas";
/** Validate and normalize a Persona snapshot crossing a Session command or event boundary. */
function parseSessionPersonaSnapshot(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Persona 快照不是对象");
	const record = value;
	const keys = Object.keys(record);
	if (typeof record.id !== "string" || !/^persona-[0-9a-f-]+$/u.test(record.id) || typeof record.name !== "string" || record.name.trim() === "" || record.name.trim().length > 120 || typeof record.description !== "string" || record.description.trim().length > 12e3 || keys.some((key) => key !== "id" && key !== "name" && key !== "description")) throw new Error("Persona 快照字段无效");
	return {
		id: record.id,
		name: record.name.trim(),
		description: record.description.trim()
	};
}
/** Browser-safe protocol for changing one Roleplay Session's Persona. */
const RESULT_PREFIX$2 = "agent-rp-persona-v0:";
function object$6(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}不是对象`);
	return value;
}
/** Validate one private Persona command request. */
function parsePersonaCommandRequest(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("Persona 请求不是有效 JSON", { cause: error });
	}
	const record = object$6(value, "Persona 请求");
	if (record.format !== 0 || Object.keys(record).some((key) => key !== "format" && key !== "persona")) throw new Error("Persona 请求字段无效");
	const persona = record.persona === void 0 ? void 0 : parseSessionPersonaSnapshot(record.persona);
	return {
		format: 0,
		...persona === void 0 ? {} : { persona }
	};
}
/** Serialize one Persona selection into a Session command result. */
function encodePersonaCommandRecord(record) {
	return `${RESULT_PREFIX$2}${JSON.stringify(record)}`;
}
/** Decode one Persona command result while declining unrelated output. */
function decodePersonaCommandRecord(source) {
	if (source?.startsWith(RESULT_PREFIX$2) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(20));
	} catch (error) {
		throw new Error("Persona 结果不是有效 JSON", { cause: error });
	}
	const record = object$6(value, "Persona 结果");
	if (record.format !== 0 || typeof record.sourceEventSeq !== "number" || !Number.isSafeInteger(record.sourceEventSeq) || record.sourceEventSeq < 0 || record.fallbackUserName !== void 0 && (typeof record.fallbackUserName !== "string" || record.fallbackUserName.trim() === "") || Object.keys(record).some((key) => ![
		"format",
		"sourceEventSeq",
		"persona",
		"fallbackUserName"
	].includes(key))) throw new Error("Persona 结果字段无效");
	const persona = record.persona === void 0 ? void 0 : parseSessionPersonaSnapshot(record.persona);
	const fallbackUserName = typeof record.fallbackUserName === "string" ? record.fallbackUserName.trim() : void 0;
	return {
		format: 0,
		sourceEventSeq: record.sourceEventSeq,
		...persona === void 0 ? {} : { persona },
		...fallbackUserName === void 0 ? {} : { fallbackUserName }
	};
}
/** Validate and normalize one Session-owned Persona snapshot. */
function parseSessionPersona(value) {
	return parseSessionPersonaSnapshot(value);
}
/** Return the latest Persona snapshot explicitly selected for one Session. */
function readSessionPersona(events) {
	return readSessionPersonaSelection(events).persona;
}
/** Return the latest Persona choice and whether the Session explicitly owns it. */
function readSessionPersonaSelection(events) {
	let active;
	let explicit = false;
	let fallbackUserName;
	for (const event of events) {
		if (event.type === "command/done" && event.data.kind === "success") {
			const launch = decodeCharacterLibraryLaunch(event.data.text);
			if (launch?.persona !== void 0) {
				active = launch.persona;
				explicit = true;
				fallbackUserName = void 0;
				continue;
			}
			const selection = decodePersonaCommandRecord(event.data.text);
			if (selection !== void 0) {
				const source = events[selection.sourceEventSeq];
				if (source?.type !== "command/run" || source.data.name !== "rp-persona" || source.seq >= event.seq || String(source.data.commandId) !== String(event.data.commandId)) throw new Error("Persona 结果没有对应的命令来源");
				active = selection.persona;
				explicit = true;
				fallbackUserName = selection.fallbackUserName;
			}
			continue;
		}
		if (event.type !== "agent-rp/persona-seed") continue;
		if (event.data.format !== 0) throw new Error("Persona Session 事件格式不受支持");
		active = parseSessionPersona(event.data.persona);
		explicit = true;
		fallbackUserName = void 0;
	}
	return {
		explicit,
		...active === void 0 ? {} : { persona: active },
		...fallbackUserName === void 0 ? {} : { fallbackUserName }
	};
}
/** Resolve the Persona description and user name used by the next model request. */
function resolveSessionPersonaIdentity(events, characterUserName, chatUserName) {
	const selection = readSessionPersonaSelection(events);
	if (selection.explicit) return {
		...selection.persona === void 0 ? {} : { persona: selection.persona },
		...selection.persona?.name === void 0 && selection.fallbackUserName === void 0 ? {} : { userName: selection.persona?.name ?? selection.fallbackUserName }
	};
	const userName = characterUserName ?? chatUserName;
	return { ...userName === void 0 ? {} : { userName } };
}
const RESULT_PREFIX$1 = "agent-rp-generation-v0:";
function object$5(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`);
	return value;
}
function eventSeq(value, label) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效`);
	return value;
}
/** Parse one browser generation request without accepting extra fields. */
function parseGenerationRequest(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("回复操作请求不是有效 JSON", { cause: error });
	}
	const request = object$5(value, "回复操作请求");
	const replySeq = eventSeq(request.replySeq, "回复序号");
	if (request.operation === "regenerate" || request.operation === "continue") {
		if (Object.keys(request).some((key) => key !== "operation" && key !== "replySeq")) throw new Error("回复操作请求包含未知字段");
		return {
			operation: request.operation,
			replySeq
		};
	}
	if (request.operation === "select") {
		const versionIndex = eventSeq(request.versionIndex, "版本序号");
		if (Object.keys(request).some((key) => key !== "operation" && key !== "replySeq" && key !== "versionIndex")) throw new Error("回复操作请求包含未知字段");
		return {
			operation: "select",
			replySeq,
			versionIndex
		};
	}
	throw new Error("未知的回复操作");
}
function uniqueSeqs(value, label) {
	if (value.length === 0 || value.some((seq) => !Number.isSafeInteger(seq) || seq < 0) || new Set(value).size !== value.length) throw new Error(`${label}无效`);
	return value;
}
function parseGenerationState(data, eventSeq) {
	const assistantSeqs = uniqueSeqs(data.assistantSeqs, "回复来源序号");
	const versionSeqs = uniqueSeqs(data.versions.map((version) => version.seq), "回复版本序号");
	if (data.format !== 0 || !/^[0-9a-f-]{36}$/iu.test(data.groupId) || data.operation !== "regenerate" && data.operation !== "continue" && data.operation !== "select" || !Number.isSafeInteger(data.originSeq) || data.originSeq < 0 || !Number.isSafeInteger(data.anchorSeq) || data.anchorSeq < 0 || !Number.isSafeInteger(data.selectedVersionSeq) || data.selectedVersionSeq < 0 || !Number.isSafeInteger(data.surfaceSeq) || data.surfaceSeq < 0 || data.versions.some((version) => typeof version.text !== "string" || version.text.trim() === "") || versionSeqs[0] !== data.originSeq || !versionSeqs.includes(data.selectedVersionSeq) || !assistantSeqs.includes(data.originSeq)) throw new Error("回复版本事件无效");
	return {
		...data,
		eventSeq
	};
}
/** Encode one complete reply-version snapshot into a supported command result. */
function encodeGenerationState(data) {
	return `${RESULT_PREFIX$1}${JSON.stringify(data)}`;
}
/** Decode one reply-version snapshot, declining unrelated command output. */
function decodeGenerationState(source) {
	if (source?.startsWith(RESULT_PREFIX$1) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(23));
	} catch (error) {
		throw new Error("回复版本结果不是有效 JSON", { cause: error });
	}
	return object$5(value, "回复版本结果");
}
/** Fold the latest durable snapshot for every reply group. */
function readGenerationGroups(events) {
	const groups = /* @__PURE__ */ new Map();
	for (const event of events) {
		const data = event.type === "command/done" && event.data.kind === "success" ? decodeGenerationState(event.data.text) : event.type === "agent-rp/generation-state" ? event.data : void 0;
		if (data === void 0) continue;
		const group = parseGenerationState(data, event.seq);
		for (const seq of [
			...group.assistantSeqs,
			...group.versions.map((version) => version.seq),
			group.anchorSeq,
			group.surfaceSeq
		]) if (seq >= event.seq || events[seq]?.type !== "assistant/message") throw new Error("回复版本引用了不存在的助手消息");
		groups.set(group.groupId, group);
	}
	return [...groups.values()].sort((left, right) => left.eventSeq - right.eventSeq);
}
function assistantEvent(events, seq) {
	const event = events[seq];
	if (event?.type !== "assistant/message") throw new Error("目标回复不存在");
	return event;
}
function visibleText(event) {
	return event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n").trim();
}
function replacementMessage(message, content = message.content) {
	const { kind: _kind, ...source } = message.source;
	return createAssistantMessage({
		content,
		source
	});
}
function continuedContent(before, continuation) {
	const result = structuredClone([...before, ...continuation]);
	const joinAt = before.length - 1;
	const left = result[joinAt];
	const right = result[joinAt + 1];
	if (left?.type === "text" && right?.type === "text") result.splice(joinAt, 2, {
		type: "text",
		text: `${left.text}${right.text}`
	});
	return result;
}
function sourceSeqs(nodes, selectedVersionSeq) {
	return [.../* @__PURE__ */ new Set([...nodes, selectedVersionSeq])];
}
function appendCurrentReplySurface(agent, currentSurfaceSeq, selected, content) {
	const nodes = [...agent.session.surface.nodes];
	const startIndex = nodes.indexOf(currentSurfaceSeq);
	if (startIndex < 0) throw new Error("回复已不在当前对话末尾");
	const shadowed = nodes.slice(startIndex);
	const start = shadowed[0];
	const end = shadowed.at(-1);
	if (start === void 0 || end === void 0) throw new Error("当前回复不可替换");
	return agent.session.append("assistant/message", {
		turn: selected.data.turn,
		step: selected.data.step,
		message: replacementMessage(selected.data.message, content),
		...selected.data.usage === void 0 ? {} : { usage: selected.data.usage }
	}, {
		surfaceOp: {
			op: "replace",
			start,
			end
		},
		sourceEventSeqs: sourceSeqs(shadowed, selected.seq)
	});
}
function latestReply(agent, replySeq) {
	const events = agent.session.events;
	const surfaceSeq = agent.session.surface.nodes.at(-1);
	if (surfaceSeq === void 0) throw new Error("当前会话还没有角色回复");
	const group = readGenerationGroups(events).findLast((candidate) => candidate.anchorSeq === replySeq);
	if (group !== void 0) {
		if (group.surfaceSeq !== surfaceSeq) {
			const currentSurface = assistantEvent(events, surfaceSeq);
			const selected = group.versions.find((version) => version.seq === group.selectedVersionSeq);
			if (selected === void 0 || visibleText(currentSurface) !== selected.text) throw new Error("只能操作对话末尾的角色回复");
		}
		return {
			group,
			surfaceSeq,
			selectedSeq: group.selectedVersionSeq
		};
	}
	const reply = assistantEvent(events, replySeq);
	if (reply.surfaceOp !== "append" || surfaceSeq !== reply.seq || visibleText(reply) === "") throw new Error("只能操作对话末尾的角色回复");
	return {
		surfaceSeq,
		selectedSeq: reply.seq
	};
}
function mvuSnapshot(agent) {
	const active = readActiveSessionCharacter(agent.session.events);
	if (active === void 0) return void 0;
	const surfaceEvents = agent.session.surface.nodes.map((seq) => agent.session.events[seq]).filter((event) => event.type === "assistant/message");
	return readCurrentMvuState(cardFromImportMeta(active.meta), surfaceEvents);
}
function appendState(agent, record) {
	const mvu = mvuSnapshot(agent);
	return {
		format: 0,
		...record,
		...mvu === void 0 ? {} : { mvu }
	};
}
function instruction(operation) {
	return operation === "regenerate" ? "Write a fresh alternative response to the latest user turn. Stay fully in character and preserve established facts, but do not mention, summarize, revise, or continue the previous response. Output only the replacement roleplay response." : "Continue the latest in-character response seamlessly from its final sentence. Do not repeat or summarize any existing text. Output only the continuation.";
}
async function generate$1(agent, operation, signal) {
	if (agent.status !== "idle" || agent.inbox.hasPending) throw new Error("请等待当前回复完成后再操作");
	const before = agent.session.seq;
	const onAbort = () => {
		agent.cancel({ kind: "user" });
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		agent.followup(createUserMessage({
			content: [{
				type: "text",
				text: instruction(operation)
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-agent-rp-generation",
				form: "notice",
				summary: operation === "regenerate" ? "正在重写角色回复" : "正在续写角色回复"
			}
		}));
		await agent.whenIdle();
		signal.throwIfAborted();
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
	const generated = agent.session.events.slice(before).findLast((event) => event.type === "assistant/message" && event.surfaceOp === "append");
	if (generated === void 0 || visibleText(generated) === "") throw new Error("模型没有生成可用的角色回复");
	return generated.seq;
}
/** Execute Regenerate, Swipe selection, or Continue against the current Roleplay reply. */
async function executeGenerationCommand(invocation) {
	const request = parseGenerationRequest(invocation.rawInput);
	const current = latestReply(invocation.agent, request.replySeq);
	const events = invocation.agent.session.events;
	const existing = current.group;
	const groupId = existing?.groupId ?? crypto.randomUUID();
	const originSeq = existing?.originSeq ?? current.selectedSeq;
	const assistantSeqs = [...existing?.assistantSeqs ?? [originSeq]];
	const versions = [...existing?.versions ?? [{
		seq: originSeq,
		text: visibleText(assistantEvent(events, originSeq))
	}]];
	if (request.operation === "select") {
		const selectedVersion = versions[request.versionIndex];
		if (selectedVersion === void 0) throw new Error("所选回复版本不存在");
		const selectedSeq = selectedVersion.seq;
		if (selectedSeq === current.selectedSeq) {
			if (existing === void 0) throw new Error("当前回复还没有其他版本");
			return {
				kind: "success",
				text: encodeGenerationState(existing),
				sourceEventSeq: existing.surfaceSeq
			};
		}
		const selected = assistantEvent(events, selectedSeq);
		const surface = appendCurrentReplySurface(invocation.agent, current.surfaceSeq, selected);
		const state = appendState(invocation.agent, {
			groupId,
			operation: "select",
			originSeq,
			anchorSeq: existing?.anchorSeq ?? originSeq,
			assistantSeqs,
			versions,
			selectedVersionSeq: selectedSeq,
			surfaceSeq: surface.seq
		});
		return {
			kind: "success",
			text: encodeGenerationState(state),
			sourceEventSeq: state.surfaceSeq
		};
	}
	let generatedSeq;
	try {
		generatedSeq = await generate$1(invocation.agent, request.operation, invocation.signal);
		const generated = assistantEvent(invocation.agent.session.events, generatedSeq);
		assistantSeqs.push(generatedSeq);
		let selectedSeq = generatedSeq;
		let surface;
		if (request.operation === "continue") {
			const content = continuedContent(assistantEvent(invocation.agent.session.events, current.selectedSeq).data.message.content, generated.data.message.content);
			surface = appendCurrentReplySurface(invocation.agent, current.surfaceSeq, generated, content);
			selectedSeq = surface.seq;
			versions.push({
				seq: selectedSeq,
				text: content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n").trim()
			});
		} else {
			surface = appendCurrentReplySurface(invocation.agent, current.surfaceSeq, generated);
			versions.push({
				seq: selectedSeq,
				text: visibleText(generated)
			});
		}
		const state = appendState(invocation.agent, {
			groupId,
			operation: request.operation,
			originSeq,
			anchorSeq: existing?.anchorSeq ?? request.replySeq,
			assistantSeqs,
			versions,
			selectedVersionSeq: selectedSeq,
			surfaceSeq: surface.seq
		});
		return {
			kind: "success",
			text: encodeGenerationState(state),
			sourceEventSeq: state.surfaceSeq
		};
	} catch (error) {
		const surfaceNodes = invocation.agent.session.surface.nodes;
		if (surfaceNodes.includes(current.surfaceSeq) && surfaceNodes.at(-1) !== current.surfaceSeq) {
			const selected = assistantEvent(invocation.agent.session.events, current.selectedSeq);
			appendCurrentReplySurface(invocation.agent, current.surfaceSeq, selected);
		}
		throw error;
	}
}
function importedScriptEntry(entry) {
	const logic = entry.strategy.keys_secondary.logic;
	const before = entry.position.type === "before_character_definition" || entry.position.type === "before_example_messages" || entry.position.type === "before_author_note";
	return {
		sourceId: String(entry.uid),
		...entry.name === "" ? {} : { name: entry.name },
		keys: entry.strategy.keys,
		secondaryKeys: entry.strategy.keys_secondary.keys,
		content: entry.content,
		enabled: entry.enabled && entry.probability > 0,
		insertionOrder: entry.position.order,
		selective: entry.strategy.type === "selective",
		constant: entry.strategy.type === "constant",
		caseSensitive: false,
		matchWholeWords: false,
		secondaryLogic: logic === "and_all" ? "and-all" : logic === "not_all" ? "not-all" : logic === "not_any" ? "not-any" : "and-any",
		...entry.strategy.scan_depth === "same_as_global" ? {} : { scanDepth: entry.strategy.scan_depth },
		position: before ? "before_char" : "after_char",
		priority: entry.position.order,
		ignoreBudget: entry.ignoreBudget === true,
		useRegex: false,
		hasDecorators: false
	};
}
/** Convert one script-authored Tavern Helper book into the prompt runtime representation. */
function tavernWorldbookLorebook(name, entries) {
	return {
		name,
		recursiveScanning: false,
		entries: entries.map(importedScriptEntry)
	};
}
/** Apply script replacements, creations, and deletions without mutating imported sources. */
function withTavernWorldbooks(sources, state) {
	if (state === void 0) return sources;
	const deleted = new Set(state.deletedWorldbookNames ?? []);
	const replacements = state.worldbooks ?? {};
	const names = /* @__PURE__ */ new Set();
	const result = sources.flatMap((source) => {
		names.add(source.name);
		if (deleted.has(source.name)) return [];
		const entries = replacements[source.name];
		return [{
			...source,
			...entries === void 0 ? {} : { lorebook: tavernWorldbookLorebook(source.name, entries) }
		}];
	});
	for (const [name, entries] of Object.entries(replacements)) {
		if (names.has(name) || deleted.has(name)) continue;
		result.push({
			id: `script:${name}`,
			name,
			source: "standalone",
			lorebook: tavernWorldbookLorebook(name, entries),
			degradations: []
		});
	}
	return result;
}
/** Select prompt-active books from the bindings scripts have explicitly changed. */
function activeTavernWorldbooks(sources, state) {
	const bindings = state?.worldbookBindings;
	if (bindings === void 0) return sources.filter((source) => !source.id.startsWith("script:"));
	const active = /* @__PURE__ */ new Set();
	if (bindings.character === void 0) {
		for (const source of sources) if (source.source === "character") active.add(source.name);
	} else {
		if (bindings.character.primary !== null) active.add(bindings.character.primary);
		for (const name of bindings.character.additional) active.add(name);
	}
	if (bindings.global === void 0) {
		for (const source of sources) if (source.source === "standalone" && !source.id.startsWith("script:")) active.add(source.name);
	} else for (const name of bindings.global) active.add(name);
	if (bindings.chat !== void 0 && bindings.chat !== null) active.add(bindings.chat);
	return sources.filter((source) => active.has(source.name));
}
const RESULT_PREFIX = "agent-rp-world-info-v0:";
const INITIAL_STATE = {
	format: 0,
	revision: 0,
	overrides: []
};
/** Resolve an older overlay snapshot to the current aggregate World Info cap. */
function worldInfoTokenBudget(state) {
	return state.tokenBudget ?? 4096;
}
function object$4(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`);
	return value;
}
function nonNegativeInteger$1(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须是非负整数`);
	return value;
}
function finite(value, label) {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}必须是有限数字`);
	return value;
}
function optionalFinite(value, label) {
	return value === void 0 || value === null ? void 0 : finite(value, label);
}
function text$1(value, label) {
	if (typeof value !== "string") throw new Error(`${label}必须是文本`);
	return value;
}
function optionalText$1(value, label) {
	return value === void 0 ? void 0 : text$1(value, label);
}
function textArray(value, label) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label}必须是文本数组`);
	return [...value];
}
function editable(value, label) {
	const entry = object$4(value, label);
	const secondaryLogic = entry.secondaryLogic;
	const position = entry.position;
	if (secondaryLogic !== "and-any" && secondaryLogic !== "and-all" && secondaryLogic !== "not-any" && secondaryLogic !== "not-all") throw new Error(`${label}.secondaryLogic 无效`);
	if (position !== "before_char" && position !== "after_char") throw new Error(`${label}.position 无效`);
	for (const key of [
		"enabled",
		"selective",
		"constant",
		"caseSensitive",
		"matchWholeWords",
		"ignoreBudget"
	]) if (typeof entry[key] !== "boolean") throw new Error(`${label}.${key} 必须是布尔值`);
	const scanDepth = optionalFinite(entry.scanDepth, `${label}.scanDepth`);
	if (scanDepth !== void 0 && scanDepth < 0) throw new Error(`${label}.scanDepth 不能小于零`);
	const priority = optionalFinite(entry.priority, `${label}.priority`);
	const name = optionalText$1(entry.name, `${label}.name`);
	const comment = optionalText$1(entry.comment, `${label}.comment`);
	return {
		...name === void 0 ? {} : { name },
		...comment === void 0 ? {} : { comment },
		keys: textArray(entry.keys, `${label}.keys`),
		secondaryKeys: textArray(entry.secondaryKeys, `${label}.secondaryKeys`),
		content: text$1(entry.content, `${label}.content`),
		enabled: entry.enabled,
		insertionOrder: finite(entry.insertionOrder, `${label}.insertionOrder`),
		selective: entry.selective,
		constant: entry.constant,
		caseSensitive: entry.caseSensitive,
		matchWholeWords: entry.matchWholeWords,
		secondaryLogic,
		...scanDepth === void 0 ? {} : { scanDepth },
		position,
		...priority === void 0 ? {} : { priority },
		ignoreBudget: entry.ignoreBudget
	};
}
function target(record, label) {
	const bookId = text$1(record.bookId, `${label}.bookId`);
	if (bookId.trim() === "") throw new Error(`${label}.bookId 不能为空`);
	return {
		bookId,
		entryIndex: nonNegativeInteger$1(record.entryIndex, `${label}.entryIndex`)
	};
}
/** Parse one private World Info manager request. */
function parseWorldInfoConfigurationRequest(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("世界书操作请求不是有效 JSON", { cause: error });
	}
	const record = object$4(value, "世界书操作请求");
	const revision = nonNegativeInteger$1(record.revision, "revision");
	if (record.operation === "reset-all") return {
		operation: "reset-all",
		revision
	};
	if (record.operation === "set-budget") {
		const tokenBudget = nonNegativeInteger$1(record.tokenBudget, "tokenBudget");
		if (tokenBudget > 1e5) throw new Error("tokenBudget 过大");
		return {
			operation: "set-budget",
			revision,
			tokenBudget
		};
	}
	const addressed = target(record, "世界书操作请求");
	if (record.operation === "toggle") {
		if (typeof record.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
		return {
			operation: "toggle",
			revision,
			...addressed,
			enabled: record.enabled
		};
	}
	if (record.operation === "edit") return {
		operation: "edit",
		revision,
		...addressed,
		entry: editable(record.entry, "entry")
	};
	if (record.operation === "delete") {
		if (typeof record.deleted !== "boolean") throw new Error("deleted 必须是布尔值");
		return {
			operation: "delete",
			revision,
			...addressed,
			deleted: record.deleted
		};
	}
	if (record.operation === "reset-entry") return {
		operation: "reset-entry",
		revision,
		...addressed
	};
	throw new Error("未知的世界书操作");
}
function parseOverride(value, index) {
	const record = object$4(value, `overrides[${index}]`);
	const addressed = target(record, `overrides[${index}]`);
	if (typeof record.deleted !== "boolean") throw new Error(`overrides[${index}].deleted 必须是布尔值`);
	return {
		...addressed,
		deleted: record.deleted,
		...record.entry === void 0 ? {} : { entry: editable(record.entry, `overrides[${index}].entry`) }
	};
}
function parseState(value) {
	const record = object$4(value, "世界书配置");
	if (record.format !== 0 || !Array.isArray(record.overrides)) throw new Error("世界书配置格式无效");
	const parsed = record.overrides.map(parseOverride);
	const keys = parsed.map((item) => `${item.bookId}\u0000${item.entryIndex}`);
	if (new Set(keys).size !== keys.length) throw new Error("世界书配置包含重复条目");
	const overrides = parsed.filter((item) => item.deleted || item.entry !== void 0);
	const tokenBudget = record.tokenBudget === void 0 ? void 0 : nonNegativeInteger$1(record.tokenBudget, "tokenBudget");
	if (tokenBudget !== void 0 && tokenBudget > 1e5) throw new Error("世界书配置 tokenBudget 过大");
	return {
		format: 0,
		revision: nonNegativeInteger$1(record.revision, "revision"),
		overrides,
		...tokenBudget === void 0 ? {} : { tokenBudget }
	};
}
/** Encode one complete overlay snapshot into a supported command result. */
function encodeWorldInfoConfiguration(state) {
	return `${RESULT_PREFIX}${JSON.stringify(state)}`;
}
/** Decode one overlay snapshot, declining unrelated command output. */
function decodeWorldInfoConfiguration(source) {
	if (source?.startsWith(RESULT_PREFIX) !== true) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(23));
	} catch (error) {
		throw new Error("世界书配置结果不是有效 JSON", { cause: error });
	}
	return parseState(value);
}
/** Read the last complete World Info overlay snapshot from one Session. */
function readWorldInfoConfiguration(events) {
	let state = INITIAL_STATE;
	for (const event of events) {
		if (event.type !== "command/done" || event.data.kind !== "success") continue;
		state = decodeWorldInfoConfiguration(event.data.text) ?? state;
	}
	return state;
}
/** Extract the safe editable fields while retaining unsupported source fields separately. */
function editableWorldInfoEntry(entry) {
	return {
		...entry.name === void 0 ? {} : { name: entry.name },
		...entry.comment === void 0 ? {} : { comment: entry.comment },
		keys: entry.keys,
		secondaryKeys: entry.secondaryKeys,
		content: entry.content,
		enabled: entry.enabled,
		insertionOrder: entry.insertionOrder,
		selective: entry.selective,
		constant: entry.constant,
		caseSensitive: entry.caseSensitive,
		matchWholeWords: entry.matchWholeWords,
		secondaryLogic: entry.secondaryLogic,
		...entry.scanDepth === void 0 ? {} : { scanDepth: entry.scanDepth },
		position: entry.position,
		...entry.priority === void 0 ? {} : { priority: entry.priority },
		ignoreBudget: entry.ignoreBudget
	};
}
function applyEditable(entry, value) {
	return {
		sourceId: entry.sourceId,
		...value,
		useRegex: entry.useRegex,
		hasDecorators: entry.hasDecorators
	};
}
/** Apply one session overlay while retaining deleted entries for management UI. */
function configuredLorebook(source, state) {
	const overrides = new Map(state.overrides.filter((item) => item.bookId === source.id).map((item) => [item.entryIndex, item]));
	const deleted = /* @__PURE__ */ new Set();
	const entries = source.lorebook.entries.map((entry, index) => {
		const override = overrides.get(index);
		if (override?.deleted === true) deleted.add(index);
		const configured = override?.entry === void 0 ? entry : applyEditable(entry, override.entry);
		return override?.deleted === true ? {
			...configured,
			enabled: false
		} : configured;
	});
	return {
		lorebook: {
			...source.lorebook,
			entries
		},
		deleted
	};
}
function replaceOverride(state, bookId, entryIndex, update) {
	const updated = update(state.overrides.find((item) => item.bookId === bookId && item.entryIndex === entryIndex) ?? {
		bookId,
		entryIndex,
		deleted: false
	});
	const next = updated?.deleted === false && updated.entry === void 0 ? void 0 : updated;
	return {
		...state,
		revision: state.revision + 1,
		overrides: [...state.overrides.filter((item) => item.bookId !== bookId || item.entryIndex !== entryIndex), ...next === void 0 ? [] : [next]]
	};
}
/** Apply one validated request against currently imported books. */
function configureWorldInfo(state, request, sources) {
	if (request.revision !== state.revision) throw new Error("世界书已在别处改变，请刷新后重试");
	if (request.operation === "reset-all") return {
		...state,
		revision: state.revision + 1,
		overrides: []
	};
	if (request.operation === "set-budget") return {
		...state,
		revision: state.revision + 1,
		tokenBudget: request.tokenBudget
	};
	const source = sources.find((book) => book.id === request.bookId);
	const original = source?.lorebook.entries[request.entryIndex];
	if (source === void 0 || original === void 0) throw new Error("目标世界书条目不存在");
	if (request.operation === "reset-entry") return replaceOverride(state, request.bookId, request.entryIndex, () => void 0);
	if (request.operation === "edit") return replaceOverride(state, request.bookId, request.entryIndex, (current) => ({
		...current,
		entry: request.entry
	}));
	if (request.operation === "toggle") return replaceOverride(state, request.bookId, request.entryIndex, (current) => ({
		...current,
		entry: {
			...current.entry ?? editableWorldInfoEntry(original),
			enabled: request.enabled
		}
	}));
	return replaceOverride(state, request.bookId, request.entryIndex, (current) => ({
		...current,
		deleted: request.deleted
	}));
}
/** Message-source field identifying a logged model-only prompt-regex replacement. */
const PROMPT_REGEX_SOURCE_MARKER = "dshAgentRpPromptRegex";
const PROMPT_REGEX_OUTCOMES = /* @__PURE__ */ new Set([
	"applied",
	"disabled",
	"display-only",
	"placement",
	"depth",
	"invalid",
	"no-match"
]);
function promptRegexTraceRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	if (record.format !== 0 || typeof record.turn !== "number" || !Number.isSafeInteger(record.turn) || record.turn < 0 || typeof record.step !== "number" || !Number.isSafeInteger(record.step) || record.step < 0 || typeof record.messageCount !== "number" || !Number.isSafeInteger(record.messageCount) || record.messageCount < 0 || typeof record.replacementCount !== "number" || !Number.isSafeInteger(record.replacementCount) || record.replacementCount < 0 || !Array.isArray(record.scripts)) return void 0;
	const scripts = [];
	for (const value of record.scripts) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
		const script = value;
		if (script.source !== "preset" && script.source !== "character" || typeof script.index !== "number" || !Number.isSafeInteger(script.index) || script.index < 0 || typeof script.scriptName !== "string" || typeof script.outcome !== "string" || !PROMPT_REGEX_OUTCOMES.has(script.outcome) || typeof script.affectedMessages !== "number" || !Number.isSafeInteger(script.affectedMessages) || script.affectedMessages < 0) return void 0;
		scripts.push({
			source: script.source,
			index: script.index,
			scriptName: script.scriptName,
			outcome: script.outcome,
			affectedMessages: script.affectedMessages
		});
	}
	return {
		format: 0,
		turn: record.turn,
		step: record.step,
		messageCount: record.messageCount,
		replacementCount: record.replacementCount,
		scripts
	};
}
/** Read model-only replacement metadata without trusting durable source fields. */
function readPromptRegexSourceMarker(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	if (record.format !== 0 || typeof record.originalSeq !== "number" || !Number.isSafeInteger(record.originalSeq) || record.originalSeq < 0) return void 0;
	const trace = promptRegexTraceRecord(record.trace);
	return {
		format: 0,
		originalSeq: record.originalSeq,
		...trace === void 0 ? {} : { trace }
	};
}
function substituteCardMacros(value, card, userName = "用户", transform = (replacement) => replacement) {
	const name = card.nickname?.trim() || card.name;
	return value.replace(/\{\{char\}\}|<char>|<bot>/giu, transform(name)).replace(/\{\{user\}\}|<user>/giu, transform(userName));
}
function compileRegex(value) {
	try {
		const literal = value.match(/^\/([\s\S]*)\/([a-z]*)$/iu);
		if (literal === null) return new RegExp(value);
		const flags = literal[2] ?? "";
		if (flags !== "" && !/^(?!.*?(.).*?\1)[dgimsuvy]+$/u.test(flags)) return new RegExp(value);
		return new RegExp(literal[1] ?? "", flags);
	} catch (_invalidRegex) {
		return;
	}
}
/** Describe executable coverage without returning a script expression or replacement. */
function summarizeCharacterRegexScript(script) {
	const placement = [...new Set(script.placement)];
	const supportedPlacement = placement.filter((value) => value === 1 || value === 2);
	const unsupportedPlacement = placement.filter((value) => value !== 1 && value !== 2);
	const valid = script.findRegex !== "" && compileRegex(script.findRegex) !== void 0;
	const substitutionSupported = [
		0,
		1,
		2
	].includes(Number(script.substituteRegex));
	const state = script.disabled ? "disabled" : !valid ? "invalid" : supportedPlacement.length === 0 ? "unsupported" : unsupportedPlacement.length > 0 || !substitutionSupported ? "partial" : "active";
	return {
		scriptName: script.scriptName,
		enabled: !script.disabled,
		state,
		placement,
		unsupportedPlacement,
		display: script.markdownOnly || !script.markdownOnly && !script.promptOnly,
		prompt: script.promptOnly || !script.markdownOnly && !script.promptOnly,
		runOnEdit: script.runOnEdit,
		minDepth: script.minDepth,
		maxDepth: script.maxDepth
	};
}
function escapeRegexMacro(value) {
	return value.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gu, (character) => {
		switch (character) {
			case "\n": return "\\n";
			case "\r": return "\\r";
			case "	": return "\\t";
			case "\v": return "\\v";
			case "\f": return "\\f";
			case "\0": return "\\0";
			default: return `\\${character}`;
		}
	});
}
function substitutedFindRegex(script, card, userName) {
	switch (Number(script.substituteRegex)) {
		case 1: return substituteCardMacros(script.findRegex, card, userName);
		case 2: return substituteCardMacros(script.findRegex, card, userName, escapeRegexMacro);
		default: return script.findRegex;
	}
}
function inDepth(script, depth) {
	if (depth === void 0) return true;
	if (script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) return false;
	return script.maxDepth === null || script.maxDepth < 0 || depth <= script.maxDepth;
}
function filterMatch(value, trimStrings, card, userName) {
	return trimStrings.reduce((text, trim) => text.replaceAll(substituteCardMacros(trim, card, userName), ""), value);
}
function applyScript(raw, script, card, userName) {
	return applyScriptWithOutcome(raw, script, card, userName).text;
}
function applyScriptWithOutcome(raw, script, card, userName) {
	const find = compileRegex(substitutedFindRegex(script, card, userName));
	if (find === void 0 || script.findRegex === "") return {
		text: raw,
		outcome: "invalid"
	};
	if (raw === "") return {
		text: raw,
		outcome: "no-match"
	};
	let matched = false;
	return {
		text: raw.replace(find, (...args) => {
			matched = true;
			const groups = typeof args.at(-1) === "object" && args.at(-1) !== null ? args.at(-1) : void 0;
			return substituteCardMacros(script.replaceString.replace(/\{\{match\}\}/giu, "$0").replace(/\$(\d+)|\$<([^>]+)>/gu, (_token, numeric, named) => {
				const match = numeric === void 0 ? groups?.[named ?? ""] : args[Number(numeric)];
				return typeof match === "string" ? filterMatch(match, script.trimStrings, card, userName) : "";
			}), card, userName);
		}),
		outcome: matched ? "applied" : "no-match"
	};
}
function runScripts(raw, card, placement, view, depth, userName, presetScripts = []) {
	const scripts = [...presetScripts, ...card.frontend.regexScripts];
	const normalized = scripts.reduce((text, script) => {
		if (script.disabled || !script.placement.includes(placement) || !inDepth(script, depth)) return text;
		return !script.markdownOnly && !script.promptOnly ? applyScript(text, script, card, userName) : text;
	}, raw);
	return scripts.reduce((text, script) => {
		if (script.disabled || !script.placement.includes(placement) || !inDepth(script, depth)) return text;
		return (view === "display" ? script.markdownOnly : script.promptOnly) ? applyScript(text, script, card, userName) : text;
	}, normalized);
}
function removeVisibleTextToken(value, token) {
	if (token === "") return value;
	let result = "";
	let cursor = 0;
	let index = value.indexOf(token);
	while (index >= 0) {
		result += value.slice(cursor, index);
		const lower = value.toLocaleLowerCase();
		const insideTag = value.lastIndexOf("<", index) > value.lastIndexOf(">", index);
		const insideRawElement = [
			"script",
			"style",
			"template"
		].some((tag) => lower.lastIndexOf(`<${tag}`, index) > lower.lastIndexOf(`</${tag}`, index));
		if (insideTag || insideRawElement) result += token;
		cursor = index + token.length;
		index = value.indexOf(token, cursor);
	}
	return result + value.slice(cursor);
}
function stripDisplayOnlyCharacterMediaFields(value, raw) {
	const filenames = [...raw.matchAll(/<角色图片(?:\s[^<>]*?)?>[\s\S]*?<\/角色图片\s*>/giu)].map((match) => match[0]).flatMap((field) => [...field.matchAll(/<img(?:\s[^<>]*?)?>([^<>]*?\.(?:avif|gif|jpe?g|png|webp))<\/img\s*>/giu)].map((match) => match[1]?.trim() ?? "").filter(Boolean));
	let visible = value.replace(/<角色图片(?:\s[^<>]*?)?>([\s\S]*?)<\/角色图片\s*>/giu, (_field, content) => /<img\b[^>]*\bsrc\s*=/iu.test(content) ? content : "");
	for (const filename of new Set(filenames)) visible = removeVisibleTextToken(visible, filename);
	return visible;
}
/** Apply character display-only scripts without executing their HTML. */
function renderCharacterDisplay(raw, card, placement, depth, userName, presetScripts) {
	return stripDisplayOnlyCharacterMediaFields(runScripts(raw, card, placement, "display", depth, userName, presetScripts), raw);
}
/** Render the prompt view and explain each script without exposing its expression or replacement. */
function traceCharacterPromptView(raw, card, placement, depth, userName, presetScripts = []) {
	const scripts = [...presetScripts, ...card.frontend.regexScripts];
	const outcomes = /* @__PURE__ */ new Map();
	let text = raw;
	for (const [index, script] of scripts.entries()) if (script.disabled) outcomes.set(index, "disabled");
	else if (!script.placement.includes(placement)) outcomes.set(index, "placement");
	else if (!inDepth(script, depth)) outcomes.set(index, "depth");
	else if (script.markdownOnly || script.promptOnly) {
		if (script.markdownOnly && !script.promptOnly) outcomes.set(index, "display-only");
	} else {
		const result = applyScriptWithOutcome(text, script, card, userName);
		text = result.text;
		outcomes.set(index, result.outcome);
	}
	for (const [index, script] of scripts.entries()) {
		if (outcomes.has(index)) continue;
		if (!script.promptOnly) {
			outcomes.set(index, "display-only");
			continue;
		}
		const result = applyScriptWithOutcome(text, script, card, userName);
		text = result.text;
		outcomes.set(index, result.outcome);
	}
	return {
		text,
		scripts: scripts.map((script, index) => ({
			index,
			scriptName: script.scriptName,
			outcome: outcomes.get(index) ?? "no-match"
		}))
	};
}
const projectionSchema = { parse(value) {
	const record = value;
	const validCardVersion = record?.cardVersion === void 0 || record.cardVersion === 1 || record.cardVersion === 2 || record.cardVersion === 3;
	const validSource = record?.source === "character-card" || record?.source === "sillytavern-chat" || record?.source === "preset";
	if (record === null || typeof record !== "object" || typeof record.characterName !== "string" || record.originalCharacterName !== void 0 && typeof record.originalCharacterName !== "string" || typeof record.description !== "string" || typeof record.personality !== "string" || typeof record.scenario !== "string" || record.userName !== void 0 && typeof record.userName !== "string" || record.persona !== void 0 && (typeof record.persona !== "object" || record.persona === null) || !Array.isArray(record.generations) || record.currentReplySeq !== void 0 && (typeof record.currentReplySeq !== "number" || !Number.isSafeInteger(record.currentReplySeq) || record.currentReplySeq < 0) || !validCardVersion || record.characterCardRaw !== void 0 && (typeof record.characterCardRaw !== "object" || record.characterCardRaw === null || Array.isArray(record.characterCardRaw)) || record.avatarAttachmentId !== void 0 && typeof record.avatarAttachmentId !== "string" || record.avatarLibraryId !== void 0 && typeof record.avatarLibraryId !== "string" || typeof record.importedMessageCount !== "number" || !Number.isSafeInteger(record.importedMessageCount) || record.importedMessageCount < 0 || typeof record.worldInfoCount !== "number" || !Number.isSafeInteger(record.worldInfoCount) || record.worldInfoCount < 0 || typeof record.worldInfo !== "object" || record.worldInfo === null || record.frontend !== void 0 && (typeof record.frontend !== "object" || record.frontend === null) || record.tavern !== void 0 && (typeof record.tavern !== "object" || record.tavern === null) || record.preset !== void 0 && (typeof record.preset !== "object" || record.preset === null) || !Array.isArray(record.presetLibrary) || record.lastRequest !== void 0 && (typeof record.lastRequest !== "object" || record.lastRequest === null) || record.promptRegex !== void 0 && (typeof record.promptRegex !== "object" || record.promptRegex === null) || !validSource) throw new Error("invalid agentRp projection");
	return value;
} };
const INITIAL_CHARACTER = {
	characterName: "角色会话",
	description: "",
	personality: "",
	scenario: "",
	importedMessageCount: 0,
	source: "preset"
};
function jsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function cardProjection(previous, meta, card) {
	const result = meta.result;
	return {
		character: {
			characterName: card.nickname?.trim() || card.name,
			originalCharacterName: card.name,
			description: card.description.trim(),
			personality: card.personality.trim(),
			scenario: card.scenario.trim(),
			...result.userName === void 0 ? {} : { userName: result.userName },
			...previous.persona === void 0 ? {} : { persona: previous.persona },
			cardVersion: result.cardVersion,
			characterCardRaw: card.raw,
			...result.transport === "png" ? { avatarAttachmentId: result.sourceAttachmentId } : {},
			...result.transport === "charx" && result.libraryId !== void 0 ? { avatarLibraryId: result.libraryId } : {},
			importedMessageCount: previous.importedMessageCount,
			frontend: card.frontend,
			source: "character-card"
		},
		lorebookEntries: card.lorebook?.entries.length ?? 0
	};
}
function mvuAfterTavernMutation(current, tavern) {
	const scope = tavern.lastMutation?.scope;
	if (scope !== "message" && scope !== "chat") return current;
	const statData = tavern.scopes[scope].stat_data;
	if (statData === void 0 || jsonObject(statData) === void 0) return current;
	return {
		statData,
		updateCount: (current?.updateCount ?? 0) + 1
	};
}
function cardLorebookSource(meta, card) {
	if (card.lorebook === void 0) return void 0;
	return {
		id: `character:${meta.result.sourceAttachmentId}`,
		name: card.lorebook.name?.trim() || `${card.nickname?.trim() || card.name}的世界书`,
		source: "character",
		lorebook: card.lorebook,
		degradations: card.degradations.filter((value) => value.startsWith("lorebook-"))
	};
}
function standaloneLorebookSource(meta) {
	const worldInfo = JSON.parse(JSON.stringify(meta.raw));
	const parsed = parseWorldInfoJson(JSON.stringify(worldInfo));
	return {
		id: `standalone:${meta.result.sourceAttachmentId}`,
		name: meta.result.name,
		source: "standalone",
		lorebook: parsed.lorebook,
		degradations: meta.result.degradations.filter((value) => value !== "entry-regex")
	};
}
function surfaceText(event) {
	if (event.type === "user/message") {
		if (event.data.source.kind !== "user" && event.data.source.kind !== "model") return void 0;
		return event.data.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	}
	if (event.type === "assistant/message") {
		if (event.data.message.source.kind !== "model") return void 0;
		return event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	}
}
function surfaceRole(event) {
	if (event.type === "user/message" && (event.data.source.kind === "user" || event.data.source.kind === "model")) return "user";
	if (event.type === "assistant/message" && event.data.message.source.kind === "model") return "assistant";
}
function applySurface(surface, event) {
	if (event.type !== "user/message" && event.type !== "assistant/message" && event.type !== "tool/result") return surface;
	const message = event.type === "user/message" ? event.data : event.data.message;
	if (event.type !== "tool/result" && typeof message.source["dshAgentRpPromptRegex"] === "object") return surface;
	const text = surfaceText(event);
	const role = surfaceRole(event);
	const node = {
		seq: event.seq,
		...text === void 0 ? {} : { text },
		...role === void 0 ? {} : { role }
	};
	const operation = event.surfaceOp;
	if (operation === void 0) return surface;
	if (operation === "append") return [...surface, node];
	const start = surface.findIndex((value) => value.seq === operation.start);
	const end = surface.findIndex((value) => value.seq === operation.end);
	if (start < 0 || end < start) return surface;
	return [
		...surface.slice(0, start),
		node,
		...surface.slice(end + 1)
	];
}
function promptRegexTrace(event) {
	const source = event.type === "user/message" ? event.data.source : event.type === "assistant/message" ? event.data.message.source : void 0;
	if (source === void 0) return void 0;
	return readPromptRegexSourceMarker(source[PROMPT_REGEX_SOURCE_MARKER])?.trace;
}
function worldInfoProjection(state, ejsTemplateEngine) {
	const sources = withTavernWorldbooks([...state.cardLorebook === void 0 ? [] : [state.cardLorebook], ...Object.values(state.standaloneWorldInfos)], state.tavern);
	const messages = state.surface.flatMap((node) => node.text === void 0 ? [] : [node.text]);
	const transcript = state.surface.flatMap((node) => node.text === void 0 || node.role === void 0 ? [] : [{
		role: node.role,
		content: node.text
	}]);
	const configuredSources = sources.map((source) => ({
		source,
		configured: configuredLorebook(source, state.worldInfoConfiguration)
	}));
	const templateOptions = ejsTemplateEngine === void 0 ? {} : {
		regexEngine: ejsTemplateEngine,
		renderTemplate: ejsTemplateEngine.createRenderer({
			characterName: state.character.characterName,
			userName: state.character.persona?.name ?? state.character.userName ?? "用户",
			messages,
			transcript,
			variableScopes: state.tavern?.scopes ?? {},
			...state.mvu === void 0 ? {} : { statData: state.mvu.statData },
			worldInfoBooks: createEjsWorldInfoBooks(configuredSources.map(({ source, configured }) => ({
				id: source.id,
				name: source.name,
				lorebook: configured.lorebook
			})))
		})
	};
	let activeCount = 0;
	const aggregateBudget = worldInfoTokenBudget(state.worldInfoConfiguration);
	const inspectedCollection = inspectLorebooks(configuredSources.map(({ source, configured }) => ({
		id: source.id,
		lorebook: configured.lorebook
	})), messages, {
		...templateOptions,
		tokenBudget: aggregateBudget
	});
	const books = configuredSources.map(({ source, configured }, sourceIndex) => {
		const inspected = inspectedCollection.books[sourceIndex].inspected;
		const overrides = new Map(state.worldInfoConfiguration.overrides.filter((item) => item.bookId === source.id).map((item) => [item.entryIndex, item]));
		return {
			id: source.id,
			name: source.name,
			source: source.source,
			...source.lorebook.scanDepth === void 0 ? {} : { scanDepth: source.lorebook.scanDepth },
			...source.lorebook.tokenBudget === void 0 ? {} : { tokenBudget: source.lorebook.tokenBudget },
			recursiveScanning: source.lorebook.recursiveScanning,
			degradations: source.degradations,
			entries: configured.lorebook.entries.map((entry, index) => {
				const decision = inspected.entries[index];
				const override = overrides.get(index);
				const deleted = configured.deleted.has(index);
				if (decision.active && !deleted) activeCount += 1;
				return {
					index,
					sourceId: entry.sourceId,
					...editableWorldInfoEntry(entry),
					useRegex: entry.useRegex,
					hasDecorators: entry.hasDecorators,
					active: decision.active && !deleted,
					reason: deleted ? "deleted" : decision.reason,
					matchedKeys: decision.matchedKeys,
					matchedSecondaryKeys: decision.matchedSecondaryKeys,
					approximateTokens: decision.approximateTokens,
					...decision.template === void 0 ? {} : { template: decision.template },
					modified: override?.entry !== void 0,
					deleted
				};
			})
		};
	});
	return {
		revision: state.worldInfoConfiguration.revision,
		activeCount,
		tokenBudget: aggregateBudget,
		approximateTokens: inspectedCollection.approximateTokens,
		budgetExcludedCount: inspectedCollection.books.flatMap((book) => book.inspected.entries).filter((entry) => entry.reason === "session-budget-excluded").length,
		books
	};
}
function toolCallId(event) {
	const first = event.data.message.content[0];
	return first === void 0 ? void 0 : String(first.toolCallId);
}
function toolFailed(event) {
	return event.data.message.content[0]?.isError === true;
}
function parseCharacterMeta(value) {
	const meta = jsonObject(value);
	const result = jsonObject(meta?.result);
	if (meta?.format !== 0 || result?.version !== 0 || meta.raw === void 0 || typeof result.name !== "string" || result.cardVersion !== 1 && result.cardVersion !== 2 && result.cardVersion !== 3 || typeof result.sourceAttachmentId !== "string" || result.transport !== "png" && result.transport !== "json") return void 0;
	return value;
}
function parseWorldInfoMeta(value) {
	const meta = jsonObject(value);
	const result = jsonObject(meta?.result);
	if (meta?.format !== 0 || result?.version !== 0 || meta.raw === void 0 || typeof result.sourceAttachmentId !== "string" || typeof result.entryCount !== "number" || !Number.isSafeInteger(result.entryCount) || result.entryCount < 0) return void 0;
	return value;
}
function parsePresetMeta(value) {
	const meta = jsonObject(value);
	const result = jsonObject(meta?.result);
	const preset = jsonObject(meta?.preset);
	if (meta?.format !== 0 || result?.version !== 0 || preset?.format !== 0 || typeof result.name !== "string" || typeof result.promptCount !== "number" || !Number.isSafeInteger(result.promptCount) || typeof result.enabledCount !== "number" || !Number.isSafeInteger(result.enabledCount) || typeof result.regexScriptCount !== "number" || !Number.isSafeInteger(result.regexScriptCount)) return void 0;
	return value;
}
function presetProjection(name, preset, revision, importedPreset = preset, libraryId) {
	const generation = preset.generation;
	const enabled = new Set(preset.order.filter((entry) => entry.enabled).map((entry) => entry.identifier));
	const promptsById = new Map(preset.prompts.map((prompt) => [prompt.identifier, prompt]));
	const importedPromptsById = new Map(importedPreset.prompts.map((prompt) => [prompt.identifier, prompt]));
	const importedOrderById = new Map(importedPreset.order.map((entry, position) => [entry.identifier, {
		...entry,
		position
	}]));
	const regexScripts = presetRegexScripts(preset);
	const helperScripts = presetTavernHelperScripts(preset);
	const compatibility = preset.extensionCompatibility;
	const appliedGeneration = [
		generation.temperature === void 0 ? void 0 : "temperature",
		generation.maxTokens === void 0 ? void 0 : "maxTokens（受模型上限约束）",
		generation.reasoningEffort === void 0 || generation.reasoningEffort === "auto" ? void 0 : "reasoningEffort（按当前模型能力）"
	].filter((value) => value !== void 0);
	const preservedGeneration = [
		generation.topP === void 0 ? void 0 : "top_p",
		generation.topK === void 0 ? void 0 : "top_k",
		generation.topA === void 0 ? void 0 : "top_a",
		generation.minP === void 0 ? void 0 : "min_p",
		generation.frequencyPenalty === void 0 ? void 0 : "frequency_penalty",
		generation.presencePenalty === void 0 ? void 0 : "presence_penalty",
		generation.repetitionPenalty === void 0 ? void 0 : "repetition_penalty",
		generation.reasoningEffort === "auto" ? "reasoning_effort（auto，跟随模型）" : void 0
	].filter((value) => value !== void 0);
	const extensionStatus = compatibility === void 0 ? [preset.extensionSummary.hasSPreset ? {
		name: "SPreset",
		detail: "旧导入未记录子功能状态，需重新导入后核对",
		state: "unsupported"
	} : void 0, preset.extensionSummary.hasTavernHelper ? {
		name: "Tavern Helper",
		detail: "旧导入未记录脚本状态，需重新导入后核对",
		state: "unsupported"
	} : void 0].filter((value) => value !== void 0) : [
		compatibility?.macroNestEnabled === void 0 ? void 0 : {
			name: "嵌套宏",
			detail: compatibility.macroNestEnabled ? "已由 Agent RP 组装器执行" : "原预设未启用",
			state: compatibility.macroNestEnabled ? "active" : "inactive"
		},
		compatibility?.chatSquashEnabled === void 0 ? void 0 : {
			name: "Chat Squash",
			detail: compatibility.chatSquashEnabled ? "原预设已启用，当前 Host 尚未执行" : "原预设已关闭，无需执行",
			state: compatibility.chatSquashEnabled ? "unsupported" : "inactive"
		},
		compatibility?.regexBindingEnabled === void 0 ? void 0 : {
			name: "预设正则绑定",
			detail: compatibility.regexBindingEnabled ? "绑定扩展已启用；当前仅执行预设自带正则" : compatibility.regexBindingMatchesPresetScripts === true ? "绑定扩展已关闭；同一批预设正则已由 Agent RP 接管" : "原预设已关闭，无需执行",
			state: compatibility.regexBindingEnabled ? "unsupported" : compatibility.regexBindingMatchesPresetScripts === true ? "active" : "inactive"
		},
		compatibility?.tavernHelperScriptCount === void 0 ? void 0 : {
			name: "Tavern Helper 脚本",
			detail: [
				compatibility.tavernHelperFormat === "entries" ? "条目数组" : compatibility.tavernHelperFormat === "object" ? "对象格式" : void 0,
				`${helperScripts.filter((script) => script.enabled).length}/${helperScripts.length} 个脚本接管`,
				compatibility.tavernHelperVariableCount === void 0 ? void 0 : `${compatibility.tavernHelperVariableCount} 个变量`,
				compatibility.tavernHelperIgnoredFieldCount === void 0 || compatibility.tavernHelperIgnoredFieldCount === 0 ? void 0 : `${compatibility.tavernHelperIgnoredFieldCount} 个扩展字段未接管`
			].filter((value) => value !== void 0).join(" · "),
			state: helperScripts.some((script) => script.enabled) ? "active" : "inactive"
		}
	].filter((value) => value !== void 0);
	return {
		...libraryId === void 0 ? {} : { libraryId },
		name,
		promptCount: preset.prompts.length,
		enabledCount: preset.prompts.filter((prompt) => enabled.has(prompt.identifier)).length,
		revision,
		prompts: [...preset.order.flatMap((entry) => {
			const prompt = promptsById.get(entry.identifier);
			return prompt === void 0 ? [] : [{
				...(() => {
					const importedPrompt = importedPromptsById.get(prompt.identifier);
					return {
						imported: importedPrompt !== void 0,
						importedName: importedPrompt?.name ?? prompt.name,
						importedRole: importedPrompt?.role ?? prompt.role,
						...importedPrompt?.injectionPosition === void 0 ? {} : { importedInjectionPosition: importedPrompt.injectionPosition },
						...importedPrompt?.injectionDepth === void 0 ? {} : { importedInjectionDepth: importedPrompt.injectionDepth },
						...importedPrompt?.injectionOrder === void 0 ? {} : { importedInjectionOrder: importedPrompt.injectionOrder }
					};
				})(),
				identifier: prompt.identifier,
				name: prompt.name,
				role: prompt.role,
				content: prompt.content,
				importedContent: importedPromptsById.get(prompt.identifier)?.content ?? prompt.content,
				contentModified: prompt.content !== importedPromptsById.get(prompt.identifier)?.content,
				importedAttached: importedOrderById.has(prompt.identifier),
				importedEnabled: importedOrderById.get(prompt.identifier)?.enabled ?? false,
				...importedOrderById.get(prompt.identifier) === void 0 ? {} : { importedPosition: importedOrderById.get(prompt.identifier).position },
				marker: prompt.marker,
				systemPrompt: prompt.systemPrompt,
				forbidOverrides: prompt.forbidOverrides,
				...prompt.injectionPosition === void 0 ? {} : { injectionPosition: prompt.injectionPosition },
				...prompt.injectionDepth === void 0 ? {} : { injectionDepth: prompt.injectionDepth },
				...prompt.injectionOrder === void 0 ? {} : { injectionOrder: prompt.injectionOrder },
				attached: true,
				enabled: entry.enabled,
				toggleable: canTogglePresetPrompt(preset, prompt.identifier),
				editable: canEditPresetPrompt(preset, prompt.identifier),
				deletable: !prompt.systemPrompt && !prompt.marker
			}];
		}), ...preset.prompts.filter((prompt) => !preset.order.some((entry) => entry.identifier === prompt.identifier)).map((prompt) => ({
			...(() => {
				const importedPrompt = importedPromptsById.get(prompt.identifier);
				return {
					imported: importedPrompt !== void 0,
					importedName: importedPrompt?.name ?? prompt.name,
					importedRole: importedPrompt?.role ?? prompt.role,
					...importedPrompt?.injectionPosition === void 0 ? {} : { importedInjectionPosition: importedPrompt.injectionPosition },
					...importedPrompt?.injectionDepth === void 0 ? {} : { importedInjectionDepth: importedPrompt.injectionDepth },
					...importedPrompt?.injectionOrder === void 0 ? {} : { importedInjectionOrder: importedPrompt.injectionOrder }
				};
			})(),
			identifier: prompt.identifier,
			name: prompt.name,
			role: prompt.role,
			content: prompt.content,
			importedContent: importedPromptsById.get(prompt.identifier)?.content ?? prompt.content,
			contentModified: prompt.content !== importedPromptsById.get(prompt.identifier)?.content,
			importedAttached: importedOrderById.has(prompt.identifier),
			importedEnabled: importedOrderById.get(prompt.identifier)?.enabled ?? false,
			...importedOrderById.get(prompt.identifier) === void 0 ? {} : { importedPosition: importedOrderById.get(prompt.identifier).position },
			marker: prompt.marker,
			systemPrompt: prompt.systemPrompt,
			forbidOverrides: prompt.forbidOverrides,
			...prompt.injectionPosition === void 0 ? {} : { injectionPosition: prompt.injectionPosition },
			...prompt.injectionDepth === void 0 ? {} : { injectionDepth: prompt.injectionDepth },
			...prompt.injectionOrder === void 0 ? {} : { injectionOrder: prompt.injectionOrder },
			attached: false,
			enabled: false,
			toggleable: canTogglePresetPrompt(preset, prompt.identifier),
			editable: canEditPresetPrompt(preset, prompt.identifier),
			deletable: !prompt.systemPrompt && !prompt.marker
		}))],
		generation: {
			...generation.temperature === void 0 ? {} : { temperature: generation.temperature },
			...generation.maxTokens === void 0 ? {} : { maxTokens: generation.maxTokens },
			...generation.reasoningEffort === void 0 ? {} : { reasoningEffort: generation.reasoningEffort },
			...generation.topP === void 0 ? {} : { topP: generation.topP },
			...generation.topK === void 0 ? {} : { topK: generation.topK },
			...generation.topA === void 0 ? {} : { topA: generation.topA },
			...generation.minP === void 0 ? {} : { minP: generation.minP },
			...generation.frequencyPenalty === void 0 ? {} : { frequencyPenalty: generation.frequencyPenalty },
			...generation.presencePenalty === void 0 ? {} : { presencePenalty: generation.presencePenalty },
			...generation.repetitionPenalty === void 0 ? {} : { repetitionPenalty: generation.repetitionPenalty }
		},
		formats: { ...preset.formats },
		degradedRoleCount: preset.prompts.filter((prompt) => enabled.has(prompt.identifier) && prompt.role !== "system" && prompt.injectionPosition !== 1).length,
		preservedInChatCount: preset.prompts.filter((prompt) => enabled.has(prompt.identifier) && prompt.injectionPosition === 1).length,
		regexScriptCount: preset.extensionSummary.regexScriptCount,
		enabledRegexScriptCount: regexScripts.filter((script) => !script.disabled).length,
		activeDisplayRegexCount: regexScripts.filter((script) => !script.disabled && script.markdownOnly).length,
		preservedPromptRegexCount: regexScripts.filter((script) => !script.disabled && (!script.markdownOnly || script.promptOnly)).length,
		regexScripts: regexScripts.map((script, index) => ({
			...script,
			index
		})),
		tavernHelperScripts: helperScripts,
		tavernHelperVariables: preset.tavernHelperVariables ?? {},
		appliedGeneration,
		preservedGeneration,
		omittedExtensions: [preset.extensionSummary.hasSPreset ? "SPreset" : void 0, preset.extensionSummary.hasTavernHelper ? "Tavern Helper" : void 0].filter((value) => value !== void 0),
		extensionStatus
	};
}
function withoutCall(calls, callId) {
	return Object.fromEntries(Object.entries(calls).filter(([id]) => id !== callId));
}
/** Build one projection definition with an optional isolated EJS evaluator. */
function createAgentRpProjectionDefinition(ejsTemplateEngine) {
	return {
		key: "agentRp",
		schema: projectionSchema,
		init: () => ({
			character: INITIAL_CHARACTER,
			cardWorldInfoCount: 0,
			standaloneWorldInfos: {},
			worldInfoConfiguration: {
				format: 0,
				revision: 0,
				overrides: []
			},
			surface: [],
			calls: {},
			personaCommands: {},
			presetLibrary: [],
			generations: {}
		}),
		apply(state, event) {
			const surface = applySurface(state.surface, event);
			const withSurface = surface === state.surface ? state : {
				...state,
				surface
			};
			const trace = promptRegexTrace(event);
			if (trace !== void 0) return {
				...withSurface,
				promptRegex: trace
			};
			if (event.type === "command/run" && event.data.name === "rp-persona") return {
				...withSurface,
				personaCommands: {
					...withSurface.personaCommands,
					[String(event.data.commandId)]: event.seq
				}
			};
			if (event.type === "command/done") {
				const commandId = String(event.data.commandId);
				const sourceEventSeq = withSurface.personaCommands[commandId];
				if (sourceEventSeq !== void 0) {
					const { [commandId]: _completed, ...personaCommands } = withSurface.personaCommands;
					if (event.data.kind !== "success") return {
						...withSurface,
						personaCommands
					};
					try {
						const record = decodePersonaCommandRecord(event.data.text);
						if (record === void 0 || record.sourceEventSeq !== sourceEventSeq) return {
							...withSurface,
							personaCommands
						};
						const { persona: _persona, userName: _userName, ...character } = withSurface.character;
						return {
							...withSurface,
							personaCommands,
							character: {
								...character,
								...record.persona === void 0 ? {} : {
									persona: record.persona,
									userName: record.persona.name
								},
								...record.persona !== void 0 || record.fallbackUserName === void 0 ? {} : { userName: record.fallbackUserName }
							}
						};
					} catch {
						return {
							...withSurface,
							personaCommands
						};
					}
				}
			}
			if (event.type === "command/done" && event.data.kind === "success") try {
				const tavern = decodeTavernHelperState(event.data.text);
				if (tavern !== void 0) {
					const mvu = mvuAfterTavernMutation(withSurface.mvu, tavern);
					return {
						...withSurface,
						tavern,
						...mvu === void 0 ? {} : { mvu }
					};
				}
			} catch {
				return withSurface;
			}
			const generation = event.type === "command/done" && event.data.kind === "success" ? decodeGenerationState(event.data.text) : event.type === "agent-rp/generation-state" ? event.data : void 0;
			if (generation !== void 0) return {
				...withSurface,
				...generation.mvu === void 0 ? {} : { mvu: generation.mvu },
				generations: {
					...state.generations,
					[generation.groupId]: generation
				},
				currentReplySeq: generation.anchorSeq
			};
			if (event.type === "command/done" && event.data.kind === "success") {
				let directWorldInfo;
				try {
					const record = decodeWorldInfoLibraryImport(event.data.text);
					if (record !== void 0) {
						const meta = parseWorldInfoImportMeta(record.meta);
						directWorldInfo = {
							key: meta.result.sourceAttachmentId,
							source: standaloneLorebookSource(meta)
						};
					}
				} catch {
					return withSurface;
				}
				if (directWorldInfo !== void 0) return {
					...withSurface,
					standaloneWorldInfos: {
						...withSurface.standaloneWorldInfos,
						[directWorldInfo.key]: directWorldInfo.source
					}
				};
			}
			if (event.type === "command/done" && event.data.kind === "success") {
				let worldInfoConfiguration;
				try {
					worldInfoConfiguration = decodeWorldInfoConfiguration(event.data.text);
				} catch {
					return withSurface;
				}
				if (worldInfoConfiguration !== void 0) return {
					...withSurface,
					worldInfoConfiguration
				};
			}
			if (event.type === "agent-rp/persona-seed") try {
				const persona = parseSessionPersona(event.data.persona);
				return {
					...withSurface,
					character: {
						...withSurface.character,
						userName: persona.name,
						persona
					}
				};
			} catch {
				return withSurface;
			}
			if (event.type === "agent-rp/sillytavern-chat-import") {
				const identity = readSillyTavernChatIdentity([event]);
				return {
					...withSurface,
					character: {
						...withSurface.character,
						...withSurface.character.source === "preset" && identity !== void 0 ? {
							characterName: identity.characterName,
							source: "sillytavern-chat"
						} : {},
						...identity?.userName === void 0 ? {} : { userName: identity.userName },
						importedMessageCount: event.data.messages.length
					}
				};
			}
			if (event.type === "command/done" && event.data.kind === "success") {
				let chat;
				let launch;
				try {
					launch = decodeCharacterLibraryLaunch(event.data.text);
					chat = decodeSillyTavernChatCommandRecord(event.data.text) ?? launch?.chat;
				} catch {
					return withSurface;
				}
				if (chat !== void 0) {
					const withChat = {
						...withSurface,
						character: {
							...withSurface.character,
							...withSurface.character.source === "preset" && chat.characterName !== void 0 ? {
								characterName: chat.characterName,
								source: "sillytavern-chat"
							} : {},
							...chat.userName === void 0 ? {} : { userName: chat.userName },
							importedMessageCount: chat.messageCount
						}
					};
					if (launch === void 0) return withChat;
					const card = parseCharacterCardValue(launch.meta.raw);
					const projected = cardProjection(withChat.character, launch.meta, card);
					const { avatarAttachmentId: _avatarAttachmentId, ...libraryCharacter } = projected.character;
					const cardLorebook = cardLorebookSource(launch.meta, card);
					const { cardLorebook: _previousLorebook, ...withoutCardLorebook } = withChat;
					return {
						...withoutCardLorebook,
						character: {
							...libraryCharacter,
							avatarLibraryId: launch.libraryId,
							...launch.persona === void 0 ? {} : { persona: launch.persona }
						},
						cardWorldInfoCount: projected.lorebookEntries,
						...cardLorebook === void 0 ? {} : { cardLorebook },
						mvu: readCurrentMvuState(card, []),
						tavern: initializeTavernHelperState(card.frontend, launch.meta.result.sourceAttachmentId, withChat.tavern)
					};
				}
			}
			if (event.type === "agent-rp/character-card-seed") {
				const card = parseCharacterCardValue(event.data.meta.raw);
				const projected = cardProjection(withSurface.character, event.data.meta, card);
				const libraryId = "characterLibraryId" in event.data.source ? event.data.source.characterLibraryId : void 0;
				const cardLorebook = cardLorebookSource(event.data.meta, card);
				const { cardLorebook: _previousLorebook, ...withoutCardLorebook } = withSurface;
				return {
					...withoutCardLorebook,
					character: libraryId === void 0 ? projected.character : {
						...projected.character,
						avatarLibraryId: libraryId
					},
					cardWorldInfoCount: projected.lorebookEntries,
					...cardLorebook === void 0 ? {} : { cardLorebook },
					mvu: readCurrentMvuState(card, []),
					tavern: initializeTavernHelperState(card.frontend, event.data.meta.result.sourceAttachmentId, withSurface.tavern)
				};
			}
			if (event.type === "command/done" && event.data.kind === "success") {
				let launch;
				try {
					launch = decodeCharacterLibraryLaunch(event.data.text);
				} catch {
					return withSurface;
				}
				if (launch !== void 0) {
					const card = parseCharacterCardValue(launch.meta.raw);
					const projected = cardProjection(withSurface.character, launch.meta, card);
					const { avatarAttachmentId: _avatarAttachmentId, ...libraryCharacter } = projected.character;
					const cardLorebook = cardLorebookSource(launch.meta, card);
					const { cardLorebook: _previousLorebook, ...withoutCardLorebook } = withSurface;
					return {
						...withoutCardLorebook,
						character: {
							...libraryCharacter,
							avatarLibraryId: launch.libraryId,
							...launch.persona === void 0 ? {} : { persona: launch.persona }
						},
						cardWorldInfoCount: projected.lorebookEntries,
						...cardLorebook === void 0 ? {} : { cardLorebook },
						mvu: readCurrentMvuState(card, []),
						tavern: initializeTavernHelperState(card.frontend, launch.meta.result.sourceAttachmentId, withSurface.tavern)
					};
				}
			}
			if (event.type === "agent-rp/sillytavern-preset-seed") {
				const presetState = {
					result: event.data.result,
					importedPreset: event.data.preset,
					preset: event.data.preset,
					revision: 0,
					...event.data.libraryId === void 0 ? {} : { libraryId: event.data.libraryId }
				};
				return {
					...withSurface,
					preset: presetProjection(event.data.result.name, event.data.preset, 0, event.data.preset, event.data.libraryId),
					presetState,
					...withSurface.tavern === void 0 ? {} : { tavern: initializeTavernHelperPresetState(withSurface.tavern, presetTavernHelperScripts(event.data.preset), event.data.preset.tavernHelperVariables ?? {}, event.data.result.sourceAttachmentId) }
				};
			}
			if (event.type === "command/done" && event.data.kind === "success") {
				let library;
				try {
					library = parsePresetLibraryResult(event.data.text);
				} catch {
					return withSurface;
				}
				if (library === void 0) return withSurface;
				if (library.selected !== void 0) {
					const selected = library.selected;
					const presetState = {
						result: {
							version: 0,
							name: selected.name,
							sourceEventSeq: event.seq,
							sourceAttachmentId: `library:${selected.libraryId}`,
							promptCount: selected.preset.prompts.length,
							enabledCount: selected.preset.order.filter((item) => item.enabled).length,
							regexScriptCount: selected.preset.extensionSummary.regexScriptCount
						},
						importedPreset: selected.preset,
						preset: selected.preset,
						revision: 0,
						libraryId: selected.libraryId
					};
					return {
						...withSurface,
						presetLibrary: library.entries,
						preset: presetProjection(selected.name, selected.preset, 0, selected.preset, selected.libraryId),
						presetState,
						...withSurface.tavern === void 0 ? {} : { tavern: initializeTavernHelperPresetState(withSurface.tavern, presetTavernHelperScripts(selected.preset), selected.preset.tavernHelperVariables ?? {}, `library:${selected.libraryId}`) }
					};
				}
				if (withSurface.preset === void 0 || withSurface.presetState === void 0 || library.linkedLibraryId === void 0) return {
					...withSurface,
					presetLibrary: library.entries
				};
				return {
					...withSurface,
					presetLibrary: library.entries,
					preset: {
						...withSurface.preset,
						libraryId: library.linkedLibraryId
					},
					presetState: {
						...withSurface.presetState,
						libraryId: library.linkedLibraryId
					}
				};
			}
			if (event.type === "command/run" && event.data.name === "rp-preset-configure" && event.data.args !== void 0) {
				if (withSurface.preset === void 0 || withSurface.presetState === void 0) return withSurface;
				try {
					const configured = configurePreset(withSurface.presetState, parsePresetConfigurationRequest(event.data.args));
					const revision = withSurface.presetState.revision + 1;
					return {
						...withSurface,
						preset: presetProjection(withSurface.preset.name, configured, revision, withSurface.presetState.importedPreset, withSurface.presetState.libraryId),
						presetState: {
							...withSurface.presetState,
							preset: configured,
							revision
						}
					};
				} catch {
					return withSurface;
				}
			}
			if (event.type === "request/header") {
				const config = event.data.header.config;
				return {
					...withSurface,
					lastRequest: {
						eventSeq: event.seq,
						time: event.time,
						...withSurface.presetState === void 0 ? {} : {
							presetName: withSurface.presetState.result.name,
							presetRevision: withSurface.presetState.revision
						},
						system: event.data.header.system ?? "",
						config: {
							provider: config.provider,
							model: config.model,
							...config.reasoningEffort === void 0 ? {} : { reasoningEffort: String(config.reasoningEffort) },
							...config.temperature === void 0 ? {} : { temperature: config.temperature },
							...config.maxTokens === void 0 ? {} : { maxTokens: config.maxTokens },
							...config.stop === void 0 ? {} : { stop: config.stop }
						},
						toolNames: event.data.header.tools?.map((tool) => tool.name) ?? []
					}
				};
			}
			if (event.type === "assistant/message" && event.surfaceOp === "append") {
				const text = event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
				const nextState = text.trim() === "" ? withSurface : {
					...withSurface,
					currentReplySeq: event.seq
				};
				if (withSurface.mvu === void 0 || !/<UpdateVariable(?:variable)?>/iu.test(text)) return nextState;
				try {
					const update = applyMvuReply(withSurface.mvu.statData, text);
					return update === void 0 ? nextState : {
						...nextState,
						mvu: {
							statData: update.statData,
							updateCount: withSurface.mvu.updateCount + 1
						}
					};
				} catch (error) {
					return {
						...nextState,
						mvu: {
							...withSurface.mvu,
							lastError: error instanceof Error ? error.message : String(error)
						}
					};
				}
			}
			if (event.type === "tool/call") {
				const kind = event.data.name === "import_character_card" ? "character-card" : event.data.name === "import_world_info" ? "world-info" : event.data.name === "import_sillytavern_preset" ? "preset" : void 0;
				return kind === void 0 ? withSurface : {
					...withSurface,
					calls: {
						...withSurface.calls,
						[String(event.data.callId)]: kind
					}
				};
			}
			if (event.type !== "tool/result") return withSurface;
			const callId = toolCallId(event);
			if (callId === void 0) return withSurface;
			const kind = withSurface.calls[callId];
			if (kind === void 0) return withSurface;
			const calls = withoutCall(withSurface.calls, callId);
			if (toolFailed(event)) return {
				...withSurface,
				calls
			};
			if (kind === "character-card") {
				const meta = parseCharacterMeta(event.data.meta);
				if (meta === void 0) return {
					...withSurface,
					calls
				};
				const card = parseCharacterCardValue(meta.raw);
				const projected = cardProjection(withSurface.character, meta, card);
				const cardLorebook = cardLorebookSource(meta, card);
				const { cardLorebook: _previousLorebook, ...withoutCardLorebook } = withSurface;
				return {
					...withoutCardLorebook,
					calls,
					character: projected.character,
					cardWorldInfoCount: projected.lorebookEntries,
					...cardLorebook === void 0 ? {} : { cardLorebook },
					mvu: readCurrentMvuState(card, []),
					tavern: initializeTavernHelperState(card.frontend, meta.result.sourceAttachmentId, withSurface.tavern)
				};
			}
			if (kind === "preset") {
				const meta = parsePresetMeta(event.data.meta);
				return meta === void 0 ? {
					...withSurface,
					calls
				} : {
					...withSurface,
					calls,
					preset: presetProjection(meta.result.name, meta.preset, 0),
					presetState: {
						result: meta.result,
						importedPreset: meta.preset,
						preset: meta.preset,
						revision: 0
					},
					...withSurface.tavern === void 0 ? {} : { tavern: initializeTavernHelperPresetState(withSurface.tavern, presetTavernHelperScripts(meta.preset), meta.preset.tavernHelperVariables ?? {}, meta.result.sourceAttachmentId) }
				};
			}
			const meta = parseWorldInfoMeta(event.data.meta);
			return meta === void 0 ? {
				...withSurface,
				calls
			} : {
				...withSurface,
				calls,
				standaloneWorldInfos: {
					...withSurface.standaloneWorldInfos,
					[meta.result.sourceAttachmentId]: standaloneLorebookSource(meta)
				}
			};
		},
		view: (state) => {
			const worldInfo = worldInfoProjection(state, ejsTemplateEngine);
			const visibleTavernMessages = state.surface.flatMap(({ seq, text, role }) => text === void 0 || role === void 0 ? [] : [{
				seq,
				role,
				text,
				isHidden: false
			}]);
			const hiddenTavernMessages = state.tavern?.hiddenPrefix ?? [];
			return {
				...state.character,
				worldInfoCount: worldInfo.books.reduce((total, book) => total + book.entries.filter((entry) => !entry.deleted).length, 0),
				worldInfo,
				...state.mvu === void 0 ? {} : { mvu: state.mvu },
				...state.preset === void 0 ? {} : { preset: state.preset },
				presetLibrary: state.presetLibrary,
				...state.lastRequest === void 0 ? {} : { lastRequest: state.lastRequest },
				...state.promptRegex === void 0 ? {} : { promptRegex: state.promptRegex },
				generations: Object.values(state.generations).map((group) => ({
					groupId: group.groupId,
					anchorSeq: group.anchorSeq,
					selectedVersionSeq: group.selectedVersionSeq,
					assistantSeqs: group.assistantSeqs,
					versions: group.versions
				})),
				...state.currentReplySeq === void 0 ? {} : { currentReplySeq: state.currentReplySeq },
				...state.tavern === void 0 ? {} : { tavern: {
					...state.tavern,
					messages: [...hiddenTavernMessages.map((message) => ({
						...message,
						isHidden: true
					})), ...visibleTavernMessages].map((message, messageId) => ({
						...message,
						messageId
					}))
				} }
			};
		},
		stateVersion: 9
	};
}
function textFromChunks(chunks) {
	return chunks.flatMap((chunk) => chunk.type === "text-delta" ? [chunk.text] : []).join("");
}
function lastUserText(options) {
	return options.messages.findLast((item) => item.role === "user")?.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n") ?? "";
}
function addUsage(left, right) {
	if (left === void 0) return right;
	if (right === void 0) return left;
	const optional = (key) => {
		const value = (left[key] ?? 0) + (right[key] ?? 0);
		return value === 0 ? {} : { [key]: value };
	};
	return {
		inputTokens: left.inputTokens + right.inputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		...optional("cacheReadTokens"),
		...optional("cacheWriteTokens"),
		...optional("reasoningTokens")
	};
}
async function requestSupplement(ctx, options, current, mvuRules, choiceRules, assistantReply) {
	const assembler = new BlockAssembler();
	const request = {
		provider: options.provider,
		model: options.model,
		reasoningEffort: ReasoningEffortId("off"),
		messages: [createUserMessage({
			source: {
				kind: "plugin",
				plugin: "dsh-agent-rp"
			},
			content: [{
				type: "text",
				text: [
					"<current_stat_data>",
					JSON.stringify(current),
					"</current_stat_data>",
					"<latest_user_message>",
					lastUserText(options),
					"</latest_user_message>",
					"<assistant_reply>",
					assistantReply,
					"</assistant_reply>",
					"<card_mvu_rules>",
					mvuRules ?? "Not requested.",
					"</card_mvu_rules>",
					"<card_choice_rules>",
					choiceRules ?? "Not requested.",
					"</card_choice_rules>",
					"Complete only the requested missing structures. If card_mvu_rules is requested, return one complete <UpdateVariable> block; use an empty JSONPatch array when no field changed. If card_choice_rules is requested, return exactly one complete set of <①> through <⑩> tags. Follow the corresponding card rules. Do not continue, summarize, or rewrite the story. Do not add headings or code fences."
				].join("\n")
			}]
		})],
		maxTokens: 8192,
		temperature: 0,
		...options.signal === void 0 ? {} : { signal: options.signal }
	};
	for await (const chunk of ctx.llm.stream(request)) assembler.push(chunk);
	if (assembler.finish.kind === "error" || assembler.finish.kind === "aborted") return {};
	return {
		text: assembler.blocks().flatMap((block) => block.type === "text" ? [block.text] : []).join("\n"),
		...assembler.usage === void 0 ? {} : { usage: assembler.usage }
	};
}
/** Install a stream wrapper that supplements only active MVU Character Card sessions. */
function installMvuStreamCompletion(ctx, agentForSession) {
	ctx.on("llm/stream", (options, next) => {
		const agent = options.sessionId === void 0 ? void 0 : agentForSession(String(options.sessionId));
		if (agent === void 0) return next();
		const active = readActiveSessionCharacter(agent.session.events);
		if (active === void 0) return next();
		const card = cardFromImportMeta(active.meta);
		const current = readCurrentMvuState(card, agent.session.events);
		if (current === void 0) return next();
		const mvuRules = renderMvuUpdateInstructions(card, current.statData);
		const choiceRules = renderChoiceInstructions(card);
		if (mvuRules === void 0 && choiceRules === void 0) return next();
		return (async function* () {
			const observed = [];
			let usage;
			let finish;
			let maxIndex = -1;
			for await (const chunk of next()) {
				observed.push(chunk);
				if ("index" in chunk) maxIndex = Math.max(maxIndex, chunk.index);
				if (chunk.type === "usage") usage = chunk.usage;
				else if (chunk.type === "finish") finish = chunk;
				else yield chunk;
			}
			const reply = textFromChunks(observed);
			const missingMvu = mvuRules !== void 0 && !/<UpdateVariable(?:variable)?>/iu.test(reply);
			const missingChoices = choiceRules !== void 0 && normalizeChoiceSupplement(reply) === void 0;
			if (finish?.reason.kind !== "stop" || !missingMvu && !missingChoices) {
				if (usage !== void 0) yield {
					type: "usage",
					usage
				};
				if (finish !== void 0) yield finish;
				return;
			}
			try {
				const supplemental = await requestSupplement(ctx, options, current.statData, missingMvu ? mvuRules : void 0, missingChoices ? choiceRules : void 0, reply);
				const additions = supplemental.text === void 0 ? [] : [...missingMvu ? [normalizeMvuSupplement(current.statData, supplemental.text)] : [], ...missingChoices ? [normalizeChoiceSupplement(supplemental.text)] : []].filter((value) => value !== void 0);
				if (additions.length > 0) {
					const index = maxIndex + 1;
					const text = `\n\n${additions.join("\n\n")}`;
					yield {
						type: "block-start",
						index,
						blockType: "text"
					};
					yield {
						type: "text-delta",
						index,
						text
					};
					yield {
						type: "block-end",
						index,
						block: {
							type: "text",
							text
						}
					};
					usage = addUsage(usage, supplemental.usage);
					finish = {
						type: "finish",
						reason: finish.reason
					};
				}
			} catch (error) {
				ctx.logger.warn(`agent-rp: MVU supplement failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			if (usage !== void 0) yield {
				type: "usage",
				usage
			};
			if (finish !== void 0) yield finish;
		})();
	}, { global: true });
}
/** Prompt Manager assembly for imported SillyTavern Chat Completion presets. */
function macroMessages(session, pending) {
	return [...session.deriveMessages(), ...pending].flatMap((message) => {
		if (message.source.kind !== "user" && message.source.kind !== "model" || message.role !== "user" && message.role !== "assistant") return [];
		return [{
			role: message.role,
			content: message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
		}];
	});
}
function expandMacros(value, state) {
	const result = resolveMacros(value, {
		card: state.card,
		userName: state.userName,
		messages: state.messages,
		variables: state.variables
	}, { dropUnknown: true });
	state.unsupported += result.unsupported;
	return result.text.trim();
}
function applyFormat(format, variable, value, state) {
	if (value.trim() === "") return "";
	return expandMacros(format.replaceAll(`{{${variable}}}`, value).replaceAll("{0}", value), state);
}
function markerText(prompt, preset, inputs, state) {
	const card = inputs.card;
	switch (prompt.identifier) {
		case "worldInfoBefore": return inputs.worldInfoBefore.map((value) => applyFormat(preset.formats.worldInfo, "worldInfo", value, state)).filter(Boolean).join("\n\n");
		case "worldInfoAfter": return inputs.worldInfoAfter.map((value) => applyFormat(preset.formats.worldInfo, "worldInfo", value, state)).filter(Boolean).join("\n\n");
		case "charDescription": return card.description;
		case "charPersonality": return applyFormat(preset.formats.personality, "personality", card.personality, state);
		case "scenario": return applyFormat(preset.formats.scenario, "scenario", card.scenario, state);
		case "personaDescription": return inputs.userPersona ?? "";
		case "dialogueExamples": return card.messageExample;
		case "chatHistory": return;
		default: return prompt.content;
	}
}
function promptText(prompt, preset, inputs, state) {
	const marker = prompt.marker ? markerText(prompt, preset, inputs, state) : prompt.content;
	if (marker === void 0) return void 0;
	const card = inputs.card;
	let value = marker;
	if (prompt.identifier === "main" && card.systemPrompt.trim() !== "" && !prompt.forbidOverrides) value = card.systemPrompt.replaceAll("{{original}}", marker);
	if (prompt.identifier === "jailbreak" && card.postHistoryInstructions.trim() !== "" && !prompt.forbidOverrides) value = card.postHistoryInstructions.replaceAll("{{original}}", marker);
	const expanded = expandMacros(value, state);
	if (!/<%[=_-]?[\s\S]*?%>/imu.test(expanded)) return expanded;
	if (inputs.renderTemplate === void 0) {
		state.templateFailures += 1;
		return;
	}
	const rendered = inputs.renderTemplate(expanded);
	if (!rendered.ok) {
		state.templateFailures += 1;
		return;
	}
	return rendered.text;
}
function roleBoundary(role, name, text) {
	if (role === "system") return text;
	return `[SillyTavern ${role} prompt · ${name}]\n${text}`;
}
/** Insert expanded in-chat modules using SillyTavern's depth, priority, and role ordering. */
function injectSillyTavernInChatPrompts(messages, prompts) {
	if (prompts.length === 0) return [...messages];
	const result = [...messages];
	const baseLength = messages.length;
	const depths = [...new Set(prompts.map((prompt) => prompt.depth))].sort((left, right) => left - right);
	for (const depth of depths) {
		const atDepth = prompts.filter((prompt) => prompt.depth === depth);
		const orders = [...new Set(atDepth.map((prompt) => prompt.order))].sort((left, right) => right - left);
		const injected = [];
		for (const order of orders) for (const role of [
			"system",
			"user",
			"assistant"
		]) {
			const content = atDepth.filter((prompt) => prompt.order === order && prompt.role === role).map((prompt) => prompt.content.trim()).filter(Boolean).join("\n");
			if (content === "") continue;
			injected.push(createMessage({
				role,
				source: {
					kind: "plugin",
					plugin: "dsh-agent-rp-preset-in-chat"
				},
				content: [{
					type: "text",
					text: content
				}]
			}));
		}
		result.splice(Math.max(0, baseLength - depth), 0, ...injected);
	}
	return result;
}
/** Assemble every ordered module, splitting post-history instructions into a runtime context. */
function assembleSillyTavernPreset(preset, inputs) {
	const byId = new Map(preset.prompts.map((prompt) => [prompt.identifier, prompt]));
	const state = {
		card: inputs.card,
		variables: /* @__PURE__ */ new Map(),
		userName: inputs.userName?.trim() || "用户",
		messages: macroMessages(inputs.session, inputs.pendingMessages ?? []),
		unsupported: 0,
		templateFailures: 0
	};
	const before = [];
	const after = [];
	const inChat = [];
	let pastHistory = false;
	let enabledPromptCount = 0;
	let degradedRoleCount = 0;
	for (const entry of preset.order) {
		if (!entry.enabled) continue;
		const prompt = byId.get(entry.identifier);
		if (prompt === void 0) continue;
		enabledPromptCount += 1;
		if (prompt.identifier === "chatHistory" && prompt.marker) {
			pastHistory = true;
			continue;
		}
		const value = promptText(prompt, preset, inputs, state);
		if (value === void 0 || value.trim() === "") continue;
		if (prompt.injectionPosition === 1) {
			inChat.push({
				role: prompt.role,
				content: value,
				depth: Number.isSafeInteger(prompt.injectionDepth) && (prompt.injectionDepth ?? -1) >= 0 ? prompt.injectionDepth : 4,
				order: typeof prompt.injectionOrder === "number" && Number.isFinite(prompt.injectionOrder) ? prompt.injectionOrder : 100
			});
			continue;
		}
		if (prompt.role !== "system") degradedRoleCount += 1;
		(pastHistory ? after : before).push(roleBoundary(prompt.role, prompt.name, value));
	}
	if (inputs.mvuEnabled === true) after.push("每次回复都必须在正文末尾完整输出一个 <UpdateVariable><Analysis>…</Analysis><JSONPatch>[…]</JSONPatch></UpdateVariable>；没有变量变化时 JSONPatch 也输出空数组。");
	return {
		system: before.join("\n\n"),
		afterHistory: after.join("\n\n"),
		inChat,
		enabledPromptCount,
		degradedRoleCount,
		unsupportedMacroCount: state.unsupported,
		templateFailureCount: state.templateFailures
	};
}
function messageOf(event) {
	return event.type === "user/message" ? event.data : event.data.message;
}
function sourceMarker(source) {
	return readPromptRegexSourceMarker(source[PROMPT_REGEX_SOURCE_MARKER]);
}
function dialogueEvent(event) {
	if (event?.type === "user/message") return event.data.source.kind === "user";
	return event?.type === "assistant/message" && event.data.message.source.kind === "model";
}
function dialogueNodes(session) {
	return session.surface.nodes.flatMap((seq) => {
		const current = session.events[seq];
		if (!dialogueEvent(current)) return [];
		const marker = sourceMarker(messageOf(current).source);
		const candidate = marker === void 0 ? current : session.events[marker.originalSeq];
		return [{
			current,
			original: dialogueEvent(candidate) && candidate.type === current.type ? candidate : current,
			role: current.type === "user/message" ? "user" : "assistant"
		}];
	});
}
function openStep(events) {
	let current;
	for (const event of events) if (event.type === "step/start") current = {
		turn: event.data.turn,
		step: event.data.step
	};
	else if (event.type === "step/end") current = void 0;
	return current;
}
function transformedContent(content, card, placement, depth, userName, presetScripts) {
	const textBlocks = content.filter((block) => block.type === "text");
	const traces = (textBlocks.length === 0 ? [""] : textBlocks.map((block) => block.text)).map((text) => traceCharacterPromptView(text, card, placement, depth, userName, presetScripts));
	let traceIndex = 0;
	return {
		content: content.map((block) => {
			if (block.type !== "text") return block;
			const trace = traces[traceIndex++];
			return trace === void 0 ? block : {
				...block,
				text: trace.text
			};
		}),
		outcomes: traces[0]?.scripts.map((_script, index) => {
			return traces.map((trace) => trace.scripts[index]?.outcome ?? "no-match").reduce((best, value) => outcomeRank(value) > outcomeRank(best) ? value : best, "disabled");
		}) ?? []
	};
}
function sameContent(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
function sourceWithMarker(source, originalSeq, trace) {
	const { replayState: _replayState, ...stable } = source;
	return {
		...stable,
		[PROMPT_REGEX_SOURCE_MARKER]: {
			format: 0,
			originalSeq,
			...trace === void 0 ? {} : { trace }
		}
	};
}
function appendReplacement(session, node, content, position, trace) {
	const originalMessage = messageOf(node.original);
	const sourceEventSeqs = [.../* @__PURE__ */ new Set([node.current.seq, node.original.seq])];
	const surfaceOp = {
		op: "replace",
		start: node.current.seq,
		end: node.current.seq
	};
	if (node.role === "user") {
		session.append("user/message", createUserMessage({
			content,
			source: sourceWithMarker(originalMessage.source, node.original.seq, trace)
		}), {
			surfaceOp,
			sourceEventSeqs
		});
		return;
	}
	session.append("assistant/message", {
		...position,
		message: createMessage({
			role: "assistant",
			content,
			source: sourceWithMarker(originalMessage.source, node.original.seq, trace)
		})
	}, {
		surfaceOp,
		sourceEventSeqs
	});
}
function outcomeRank(value) {
	switch (value) {
		case "applied": return 7;
		case "invalid": return 6;
		case "display-only": return 5;
		case "no-match": return 4;
		case "depth": return 3;
		case "placement": return 2;
		case "disabled": return 1;
	}
}
/** Recognize frozen primary requests even when a linked plugin has a second dsh-llm module instance. */
function isAgentLoopDispatch(options) {
	return isAgentLoopRequest(options) || options.sessionId !== void 0 && options.purpose === void 0 && Object.isFrozen(options);
}
/** Resolve chat-state and identity macros in one request's outgoing messages. */
function resolveChatMacros(messages, card, userName, persona) {
	const macroMessages = messages.flatMap((message) => message.role === "user" || message.role === "assistant" ? [{
		role: message.role,
		content: message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
	}] : []);
	const pendingInput = messages.at(-1)?.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	return messages.map((message) => {
		if (!message.content.some((block) => block.type === "text")) return message;
		const content = message.content.map((block) => {
			if (block.type !== "text") return block;
			return {
				...block,
				text: resolveMacros(block.text, {
					card,
					...userName === void 0 ? {} : { userName },
					...persona === void 0 ? {} : { persona },
					messages: macroMessages,
					...pendingInput === void 0 ? {} : { pendingInput }
				}, { dropUnknown: false }).text
			};
		});
		return {
			...message,
			content
		};
	});
}
/** Apply one request's prompt view to the durable model surface. */
function applyPromptRegexSurface(session, card, userName, presetScripts = []) {
	const position = openStep(session.events);
	if (position === void 0) return void 0;
	const nodes = dialogueNodes(session);
	const scripts = [...presetScripts, ...card.frontend.regexScripts];
	const summaries = scripts.map((_script, index) => ({
		outcome: "disabled",
		affectedMessages: 0,
		index
	}));
	const replacements = [];
	for (const [index, node] of nodes.entries()) {
		const original = messageOf(node.original);
		const current = messageOf(node.current);
		const rendered = transformedContent(original.content, card, node.role === "user" ? 1 : 2, nodes.length - index - 1, userName, presetScripts);
		for (const [scriptIndex, outcome] of rendered.outcomes.entries()) {
			const summary = summaries[scriptIndex];
			if (summary === void 0) continue;
			if (outcomeRank(outcome) > outcomeRank(summary.outcome)) summary.outcome = outcome;
			if (outcome === "applied") summary.affectedMessages += 1;
		}
		if (sameContent(current.content, rendered.content)) continue;
		replacements.push({
			node,
			content: rendered.content
		});
	}
	const record = {
		format: 0,
		...position,
		messageCount: nodes.length,
		replacementCount: replacements.length,
		scripts: scripts.map((script, index) => ({
			source: index < presetScripts.length ? "preset" : "character",
			index: index < presetScripts.length ? index : index - presetScripts.length,
			scriptName: script.scriptName,
			outcome: summaries[index]?.outcome ?? "no-match",
			affectedMessages: summaries[index]?.affectedMessages ?? 0
		}))
	};
	if (replacements.length === 0) {
		const node = nodes.at(-1);
		if (node !== void 0) appendReplacement(session, node, [...messageOf(node.current).content], position, record);
	} else replacements.forEach((replacement, index) => {
		appendReplacement(session, replacement.node, replacement.content, position, index === replacements.length - 1 ? record : void 0);
	});
	return record;
}
/** Install the logged prompt-regex view before real Agent Loop provider calls. */
function installPromptRegexStream(ctx, agentForSession, inChatForAgent = () => []) {
	ctx.on("llm/stream", (options, next) => {
		if (!isAgentLoopDispatch(options) || options.sessionId === void 0) return next();
		const agent = agentForSession(String(options.sessionId));
		if (agent === void 0) return next();
		const active = readActiveSessionCharacter(agent.session.events);
		if (active === void 0) return next();
		const card = cardFromImportMeta(active.meta);
		const preset = readActiveSessionPreset(agent.session.events)?.preset;
		const scripts = preset === void 0 ? [] : presetRegexScripts(preset);
		const inChat = inChatForAgent(agent);
		const identity = resolveSessionPersonaIdentity(agent.session.events, active.result.userName, readSillyTavernChatIdentity(agent.session.events)?.userName);
		const hasManagedSurface = dialogueNodes(agent.session).some((node) => sourceMarker(messageOf(node.current).source) !== void 0);
		const hasPromptScripts = [...scripts, ...card.frontend.regexScripts].some((script) => !script.markdownOnly || script.promptOnly);
		let messages = options.messages;
		if (hasPromptScripts || hasManagedSurface) {
			const trace = applyPromptRegexSurface(agent.session, card, identity.userName, scripts);
			if (trace !== void 0 && trace.replacementCount > 0) messages = [...agent.session.deriveMessages()];
		}
		messages = resolveChatMacros(messages, card, identity.userName, identity.persona?.description);
		return ctx.llm.stream({
			...options,
			messages: injectSillyTavernInChatPrompts(messages, inChat)
		});
	}, {
		global: true,
		prepend: true
	});
}
function prompt$1(prompt) {
	return {
		identifier: prompt.identifier,
		name: prompt.name,
		role: prompt.role,
		content: prompt.content,
		marker: prompt.marker,
		system_prompt: prompt.systemPrompt,
		forbid_overrides: prompt.forbidOverrides,
		...prompt.injectionPosition === void 0 ? {} : { injection_position: prompt.injectionPosition },
		...prompt.injectionDepth === void 0 ? {} : { injection_depth: prompt.injectionDepth },
		...prompt.injectionOrder === void 0 ? {} : { injection_order: prompt.injectionOrder }
	};
}
function regex(script) {
	return {
		...script.id === void 0 ? {} : { id: script.id },
		scriptName: script.scriptName,
		findRegex: script.findRegex,
		replaceString: script.replaceString,
		trimStrings: [...script.trimStrings],
		placement: [...script.placement],
		disabled: script.disabled,
		markdownOnly: script.markdownOnly,
		promptOnly: script.promptOnly,
		runOnEdit: script.runOnEdit,
		substituteRegex: script.substituteRegex,
		minDepth: script.minDepth,
		maxDepth: script.maxDepth
	};
}
function helperScript(script) {
	return {
		type: "script",
		id: script.id,
		name: script.name,
		content: script.content,
		info: script.info,
		enabled: script.enabled,
		button: {
			enabled: script.buttonEnabled,
			buttons: script.buttons.map((button) => ({ ...button }))
		},
		data: structuredClone(script.data)
	};
}
/** Serialize the supported current configuration as a new SillyTavern preset JSON file. */
function exportSillyTavernPresetJson(preset) {
	const generation = preset.generation;
	const helperScripts = preset.tavernHelperScripts ?? [];
	const helperVariables = preset.tavernHelperVariables ?? {};
	const hasHelper = helperScripts.length > 0 || Object.keys(helperVariables).length > 0;
	return `${JSON.stringify({
		prompts: preset.prompts.map(prompt$1),
		prompt_order: [{
			character_id: 100001,
			order: preset.order.map((entry) => ({ ...entry }))
		}],
		...generation.temperature === void 0 ? {} : { temperature: generation.temperature },
		...generation.maxTokens === void 0 ? {} : { openai_max_tokens: generation.maxTokens },
		...generation.reasoningEffort === void 0 ? {} : { reasoning_effort: generation.reasoningEffort },
		...generation.topP === void 0 ? {} : { top_p: generation.topP },
		...generation.topK === void 0 ? {} : { top_k: generation.topK },
		...generation.topA === void 0 ? {} : { top_a: generation.topA },
		...generation.minP === void 0 ? {} : { min_p: generation.minP },
		...generation.frequencyPenalty === void 0 ? {} : { frequency_penalty: generation.frequencyPenalty },
		...generation.presencePenalty === void 0 ? {} : { presence_penalty: generation.presencePenalty },
		...generation.repetitionPenalty === void 0 ? {} : { repetition_penalty: generation.repetitionPenalty },
		wi_format: preset.formats.worldInfo,
		scenario_format: preset.formats.scenario,
		personality_format: preset.formats.personality,
		extensions: {
			regex_scripts: preset.regexScripts.map(regex),
			...hasHelper ? { tavern_helper: {
				scripts: helperScripts.map(helperScript),
				variables: structuredClone(helperVariables)
			} } : {}
		}
	}, null, 2)}\n`;
}
/** Host-owned reusable SillyTavern preset library. */
const FILE_SUFFIX = ".json";
function record$1(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function metadata(value) {
	const source = record$1(value, "preset library metadata");
	if (source.format !== 0 || typeof source.id !== "string" || !/^[a-z0-9-]{8,80}$/u.test(source.id) || typeof source.name !== "string" || source.name.trim() === "" || typeof source.createdAt !== "number" || !Number.isSafeInteger(source.createdAt) || source.createdAt < 0 || typeof source.updatedAt !== "number" || !Number.isSafeInteger(source.updatedAt) || source.updatedAt < 0 || typeof source.hasSPreset !== "boolean" || typeof source.hasTavernHelper !== "boolean") throw new Error("preset library metadata has invalid fields");
	if (source.extensionCompatibility !== void 0) validateExtensionCompatibility(source.extensionCompatibility);
	return source;
}
function validateExtensionCompatibility(value) {
	const compatibility = record$1(value, "preset extension compatibility");
	if ([
		"macroNestEnabled",
		"chatSquashEnabled",
		"regexBindingEnabled",
		"regexBindingMatchesPresetScripts"
	].some((key) => compatibility[key] !== void 0 && typeof compatibility[key] !== "boolean") || [
		"tavernHelperScriptCount",
		"enabledTavernHelperScriptCount",
		"tavernHelperVariableCount",
		"tavernHelperIgnoredFieldCount"
	].some((key) => compatibility[key] !== void 0 && (typeof compatibility[key] !== "number" || !Number.isSafeInteger(compatibility[key]) || compatibility[key] < 0)) || compatibility.tavernHelperFormat !== void 0 && compatibility.tavernHelperFormat !== "object" && compatibility.tavernHelperFormat !== "entries") throw new Error("preset extension compatibility has invalid fields");
}
function tavernHelperSummary(preset) {
	const compatibility = preset.extensionCompatibility;
	const scripts = preset.tavernHelperScripts ?? [];
	const expectedScriptCount = compatibility?.tavernHelperScriptCount;
	if (!preset.extensionSummary.hasTavernHelper && expectedScriptCount === void 0 && scripts.length === 0) return void 0;
	return {
		...compatibility?.tavernHelperFormat === void 0 ? {} : { format: compatibility.tavernHelperFormat },
		scriptCount: scripts.length,
		enabledScriptCount: scripts.filter((script) => script.enabled).length,
		...expectedScriptCount === void 0 ? {} : { expectedScriptCount },
		...compatibility?.tavernHelperVariableCount === void 0 ? {} : { variableCount: compatibility.tavernHelperVariableCount },
		...compatibility?.tavernHelperIgnoredFieldCount === void 0 ? {} : { ignoredFieldCount: compatibility.tavernHelperIgnoredFieldCount }
	};
}
function normalizedName(value) {
	const name = value.trim();
	if (name === "") throw new Error("预设名称不能为空");
	if (name.length > 160) throw new Error("预设名称不能超过 160 个字符");
	return name;
}
function summary$1(id, name, preset, updatedAt) {
	const enabled = new Set(preset.order.filter((item) => item.enabled).map((item) => item.identifier));
	const helper = tavernHelperSummary(preset);
	return {
		id,
		name,
		promptCount: preset.prompts.length,
		enabledCount: preset.prompts.filter((item) => enabled.has(item.identifier)).length,
		regexScriptCount: preset.regexScripts.length,
		...helper === void 0 ? {} : { tavernHelper: helper },
		updatedAt
	};
}
function importedId(preset) {
	return `import-${createHash("sha256").update(JSON.stringify({
		name: preset.name,
		prompts: preset.prompts,
		order: preset.order,
		generation: preset.generation,
		formats: preset.formats,
		regexScripts: preset.regexScripts,
		tavernHelperScripts: preset.tavernHelperScripts,
		tavernHelperVariables: preset.tavernHelperVariables,
		extensionSummary: preset.extensionSummary,
		extensionCompatibility: preset.extensionCompatibility
	})).digest("hex").slice(0, 24)}`;
}
function storedDocument(id, name, preset, createdAt, updatedAt) {
	const document = JSON.parse(exportSillyTavernPresetJson(preset));
	document.dsh_agent_rp_library = {
		format: 0,
		id,
		name,
		createdAt,
		updatedAt,
		hasSPreset: preset.extensionSummary.hasSPreset,
		hasTavernHelper: preset.extensionSummary.hasTavernHelper,
		...preset.extensionCompatibility === void 0 ? {} : { extensionCompatibility: preset.extensionCompatibility }
	};
	return `${JSON.stringify(document, null, 2)}\n`;
}
/** Small file-backed library; every returned preset is detached from stored state. */
var PresetLibrary = class {
	root;
	constructor(options = {}) {
		this.root = resolve(options.root ?? dshHomePath("agent-rp", "presets"));
	}
	/** List valid library entries, newest first. */
	list() {
		if (!existsSync(this.root)) return [];
		const entries = [];
		for (const filename of readdirSync(this.root)) {
			if (!filename.endsWith(FILE_SUFFIX)) continue;
			const entry = this.readFile(join(this.root, filename));
			entries.push(summary$1(entry.id, entry.name, entry.preset, entry.updatedAt));
		}
		return entries.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
	}
	/** Read one preset by its opaque library id. */
	get(id) {
		this.assertId(id);
		const path = join(this.root, `${id}${FILE_SUFFIX}`);
		if (!existsSync(path)) throw new Error(`预设库中没有 ${JSON.stringify(id)}`);
		return this.readFile(path);
	}
	/** Import one file-derived default, deduplicating byte-equivalent normalized behavior. */
	import(preset, name = preset.name) {
		const id = importedId(preset);
		const path = join(this.root, `${id}${FILE_SUFFIX}`);
		if (existsSync(path)) return this.readFile(path);
		return this.writeNew(id, normalizedName(name), preset);
	}
	/** Save current session configuration as a separately named reusable preset. */
	save(name, preset) {
		return this.writeNew(`saved-${randomUUID()}`, normalizedName(name), {
			...preset,
			name: normalizedName(name)
		});
	}
	/** Remove one reusable copy without touching any session snapshot. */
	delete(id) {
		this.assertId(id);
		const path = join(this.root, `${id}${FILE_SUFFIX}`);
		if (!existsSync(path)) throw new Error(`预设库中没有 ${JSON.stringify(id)}`);
		rmSync(path);
	}
	/** Change the library-facing name without altering any existing Session copy. */
	rename(id, name) {
		this.assertId(id);
		const path = join(this.root, `${id}${FILE_SUFFIX}`);
		if (!existsSync(path)) throw new Error(`预设库中没有 ${JSON.stringify(id)}`);
		const entry = this.readFile(path);
		const meta = metadata(record$1(JSON.parse(readFileSync(path, "utf8")), "preset library file").dsh_agent_rp_library);
		const nextName = normalizedName(name);
		const staging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.tmp`);
		try {
			writeFileSync(staging, storedDocument(id, nextName, entry.preset, meta.createdAt, Date.now()), {
				encoding: "utf8",
				mode: 384
			});
			renameSync(staging, path);
		} catch (error) {
			rmSync(staging, { force: true });
			throw error;
		}
		return this.readFile(path);
	}
	assertId(id) {
		if (!/^[a-z0-9-]{8,80}$/u.test(id)) throw new Error("预设库 id 无效");
	}
	readFile(path) {
		let value;
		try {
			value = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			throw new Error(`无法读取预设库文件 ${JSON.stringify(path)}`, { cause: error });
		}
		const document = record$1(value, "preset library file");
		const meta = metadata(document.dsh_agent_rp_library);
		const parsed = parseSillyTavernPresetJson(JSON.stringify(document), `${meta.name}.json`);
		const preset = {
			...parsed,
			extensionSummary: {
				...parsed.extensionSummary,
				hasSPreset: meta.hasSPreset,
				hasTavernHelper: meta.hasTavernHelper
			},
			...meta.extensionCompatibility === void 0 ? {} : { extensionCompatibility: meta.extensionCompatibility }
		};
		return {
			...summary$1(meta.id, meta.name, preset, meta.updatedAt),
			preset
		};
	}
	writeNew(id, name, preset) {
		this.assertId(id);
		mkdirSync(this.root, {
			recursive: true,
			mode: 448
		});
		const path = join(this.root, `${id}${FILE_SUFFIX}`);
		if (existsSync(path)) throw new Error(`预设库 id ${JSON.stringify(id)} 已存在`);
		const now = Date.now();
		const staging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.tmp`);
		try {
			writeFileSync(staging, storedDocument(id, name, preset, now, now), {
				encoding: "utf8",
				mode: 384
			});
			renameSync(staging, path);
		} catch (error) {
			rmSync(staging, { force: true });
			throw error;
		}
		return this.readFile(path);
	}
};
/** Same-origin endpoint served by the Agent RP Host plugin. */
const PRESET_LIBRARY_PATH = "/api/agent-rp/presets";
const MAX_PRESET_BYTES = 64 * 1024 * 1024;
function trustedBrowserRequest$10(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$10(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readUpload$3(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > MAX_PRESET_BYTES) throw new Error("预设文件过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > MAX_PRESET_BYTES) throw new Error("预设文件过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("预设文件为空");
	return new Uint8Array(Buffer.concat(chunks));
}
async function readRename(request) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > 8 * 1024) throw new Error("预设名称请求过大");
		chunks.push(data);
	}
	let value;
	try {
		value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw new Error("预设名称请求不是有效 JSON", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.name !== "string") throw new Error("预设名称请求缺少 name");
	return value.name;
}
/** Register model-free preset listing and upload routes for the Roleplay UI. */
function installPresetLibraryHttp(ctx, library, server) {
	ctx.effect(() => server.register({
		kind: "exact",
		path: PRESET_LIBRARY_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$10(request)) {
				json$10(response, 403, { error: "forbidden" });
				return;
			}
			try {
				if (request.method === "GET") {
					json$10(response, 200, {
						format: 0,
						entries: library.list()
					});
					return;
				}
				if (request.method === "PATCH") {
					const id = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("id");
					if (id === null) {
						json$10(response, 400, { error: "预设库 id 缺失" });
						return;
					}
					const { preset: _preset, ...entry } = library.rename(id, await readRename(request));
					json$10(response, 200, {
						format: 0,
						entry
					});
					return;
				}
				if (request.method !== "POST") {
					response.setHeader("allow", "GET, POST, PATCH");
					json$10(response, 405, { error: "method not allowed" });
					return;
				}
				const filename = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("filename")?.trim();
				if (filename === void 0 || filename === "" || !/\.json$/iu.test(filename)) {
					json$10(response, 400, { error: "请选择 SillyTavern 预设 JSON 文件" });
					return;
				}
				const preset = parseSillyTavernPresetBytes(await readUpload$3(request), filename);
				json$10(response, 200, {
					format: 0,
					entry: library.import(preset)
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json$10(response, /过大/u.test(message) ? 413 : 400, { error: message });
			}
		}
	}), "agent-rp: preset library HTTP");
}
function object$3(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("预设库请求必须是对象");
	return value;
}
/** Parse one private preset-library request from the browser UI. */
function parsePresetLibraryRequest(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("预设库请求不是有效 JSON", { cause: error });
	}
	const request = object$3(value);
	if (request.operation === "list") return { operation: "list" };
	if ((request.operation === "select" || request.operation === "delete") && typeof request.id === "string") return {
		operation: request.operation,
		id: request.id
	};
	if (request.operation === "save" && typeof request.name === "string") return {
		operation: "save",
		name: request.name
	};
	if (request.operation === "rename" && typeof request.id === "string" && typeof request.name === "string") return {
		operation: "rename",
		id: request.id,
		name: request.name
	};
	throw new Error("预设库请求包含未知操作或无效字段");
}
function publish(agent, library, operation) {
	const active = readActiveSessionPreset(agent.session.events);
	let linkedLibraryId;
	if (active !== void 0 && active.libraryId === void 0) linkedLibraryId = library.import(active.importedPreset, active.result.name).id;
	return {
		format: 0,
		operation,
		entries: library.list(),
		...linkedLibraryId === void 0 ? {} : { linkedLibraryId }
	};
}
/** Execute one library action and project its updated roster into the current Session. */
function executePresetLibraryCommand(library, invocation) {
	const request = parsePresetLibraryRequest(invocation.rawInput);
	let selected;
	if (request.operation === "select") {
		const entry = library.get(request.id);
		selected = {
			libraryId: entry.id,
			name: entry.name,
			preset: entry.preset
		};
	} else if (request.operation === "save") {
		const active = readActiveSessionPreset(invocation.agent.session.events);
		if (active === void 0) throw new Error("当前会话还没有可保存的预设");
		library.save(request.name, active.preset);
	} else if (request.operation === "delete") library.delete(request.id);
	else if (request.operation === "rename") library.rename(request.id, request.name);
	return {
		kind: "success",
		text: encodePresetLibraryResult({
			...publish(invocation.agent, library, request.operation),
			...selected === void 0 ? {} : { selected }
		})
	};
}
/** Host-owned reusable Character Card library retaining original transport bytes. */
const META_SUFFIX = ".meta.json";
const OVERLAY_SUFFIX = ".overlay.json";
const ID_PATTERN$3 = /^card-[a-f0-9]{32}$/u;
const DISPLAY_EXTENSION_ID_PATTERN = /^display-[a-f0-9]{32}$/u;
const MAX_DISPLAY_EXTENSION_BYTES = 256 * 1024;
function object$2(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function nonNegativeInteger(value, label) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
	return value;
}
function parseTavernHelperSummary(value) {
	if (value === void 0) return void 0;
	const summary = object$2(value, "character library index Tavern Helper summary");
	if (summary.format !== "object" && summary.format !== "entries") throw new Error("character library index Tavern Helper format is invalid");
	const expectedScriptCount = summary.expectedScriptCount === void 0 ? void 0 : nonNegativeInteger(summary.expectedScriptCount, "character library index expected script count");
	return {
		format: summary.format,
		scriptCount: nonNegativeInteger(summary.scriptCount, "character library index script count"),
		enabledScriptCount: nonNegativeInteger(summary.enabledScriptCount, "character library index enabled script count"),
		variableCount: nonNegativeInteger(summary.variableCount, "character library index variable count"),
		ignoredFieldCount: nonNegativeInteger(summary.ignoredFieldCount, "character library index ignored field count"),
		...expectedScriptCount === void 0 ? {} : { expectedScriptCount }
	};
}
function parseStoredIndex(value) {
	const index = object$2(value, "character library index");
	if (index.format !== 0 || typeof index.name !== "string" || typeof index.displayName !== "string" || index.cardVersion !== 1 && index.cardVersion !== 2 && index.cardVersion !== 3 || typeof index.avatarAvailable !== "boolean") throw new Error("character library index has invalid fields");
	const tavernHelper = parseTavernHelperSummary(index.tavernHelper);
	return {
		format: 0,
		name: index.name,
		displayName: index.displayName,
		cardVersion: index.cardVersion,
		greetingCount: nonNegativeInteger(index.greetingCount, "character library index greeting count"),
		worldInfoCount: nonNegativeInteger(index.worldInfoCount, "character library index World Info count"),
		regexScriptCount: nonNegativeInteger(index.regexScriptCount, "character library index regex count"),
		avatarAvailable: index.avatarAvailable,
		imageAssetCount: nonNegativeInteger(index.imageAssetCount, "character library index image count"),
		...tavernHelper === void 0 ? {} : { tavernHelper }
	};
}
function parseMetadata(value) {
	const meta = object$2(value, "character library metadata");
	const validTransport = meta.transport === "json" || meta.transport === "charx" ? meta.metadataKeyword === void 0 : meta.transport === "png" && (meta.metadataKeyword === "ccv3" || meta.metadataKeyword === "chara");
	if (meta.format !== 0 || typeof meta.id !== "string" || !ID_PATTERN$3.test(meta.id) || typeof meta.originalFilename !== "string" || meta.originalFilename.trim() === "" || typeof meta.mediaType !== "string" || meta.mediaType.trim() === "" || !validTransport || typeof meta.bytes !== "number" || !Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || typeof meta.createdAt !== "number" || !Number.isSafeInteger(meta.createdAt) || meta.createdAt < 0 || typeof meta.updatedAt !== "number" || !Number.isSafeInteger(meta.updatedAt) || meta.updatedAt < 0 || meta.archivedAt !== void 0 && (typeof meta.archivedAt !== "number" || !Number.isSafeInteger(meta.archivedAt) || meta.archivedAt < 0)) throw new Error("character library metadata has invalid fields");
	const index = meta.index === void 0 ? void 0 : parseStoredIndex(meta.index);
	return {
		...meta,
		...index === void 0 ? {} : { index }
	};
}
function safeHttpsOrigin(value, label) {
	let url;
	try {
		url = new URL(value);
	} catch (error) {
		throw new Error(`${label} must be an HTTPS origin`, { cause: error });
	}
	const hostname = url.hostname.toLocaleLowerCase();
	if (url.protocol !== "https:" || url.origin !== value || url.username !== "" || url.password !== "" || url.port !== "" && url.port !== "443" || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname)) throw new Error(`${label} must be a public HTTPS origin`);
	return url.origin;
}
function parseOverlay(value) {
	const record = object$2(value, "character library overlay");
	if (record.format !== 0 || !Array.isArray(record.textReplacements) || !Array.isArray(record.displayExtensions)) throw new Error("character library overlay has invalid fields");
	const textReplacements = record.textReplacements.map((item, index) => {
		const replacement = object$2(item, `character library overlay text replacement ${index + 1}`);
		if (typeof replacement.from !== "string" || replacement.from === "" || typeof replacement.to !== "string" || typeof replacement.expectedMatches !== "number" || !Number.isSafeInteger(replacement.expectedMatches) || replacement.expectedMatches < 1) throw new Error("character library overlay has an invalid text replacement");
		return replacement;
	});
	const displayExtensions = record.displayExtensions.map((item, index) => {
		const extension = object$2(item, `character library display extension ${index + 1}`);
		if (typeof extension.id !== "string" || !DISPLAY_EXTENSION_ID_PATTERN.test(extension.id) || typeof extension.originalFilename !== "string" || extension.originalFilename.trim() === "" || typeof extension.importedAt !== "number" || !Number.isSafeInteger(extension.importedAt) || extension.importedAt < 0 || typeof extension.enabled !== "boolean" || !Array.isArray(extension.remoteImageOrigins) || extension.remoteImageOrigins.some((origin) => typeof origin !== "string") || !Array.isArray(extension.replacedCardRegexIndices) || extension.replacedCardRegexIndices.some((candidate) => typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0)) throw new Error("character library overlay has an invalid display extension");
		const remoteImageOrigins = extension.remoteImageOrigins.map((origin, originIndex) => safeHttpsOrigin(origin, `display extension origin ${originIndex + 1}`));
		const script = parseRegexScript(extension.script, `displayExtensions[${index}].script`);
		return {
			id: extension.id,
			originalFilename: extension.originalFilename,
			importedAt: extension.importedAt,
			enabled: extension.enabled,
			remoteImageOrigins,
			replacedCardRegexIndices: [...extension.replacedCardRegexIndices],
			script
		};
	});
	if (record.approvedRemoteResourceOrigins !== void 0 && !Array.isArray(record.approvedRemoteResourceOrigins)) throw new Error("character library overlay has invalid resource origins");
	return {
		format: 0,
		textReplacements,
		displayExtensions,
		approvedRemoteResourceOrigins: (record.approvedRemoteResourceOrigins ?? []).map((origin, index) => {
			if (typeof origin !== "string") throw new Error("character library overlay has an invalid resource origin");
			return safeHttpsOrigin(origin, `approved card resource origin ${index + 1}`);
		})
	};
}
function emptyOverlay() {
	return {
		format: 0,
		textReplacements: [],
		displayExtensions: [],
		approvedRemoteResourceOrigins: []
	};
}
function remoteResourceOrigins(source) {
	const origins = /* @__PURE__ */ new Set();
	for (const pattern of [
		/<(?:img|script|source|video|audio)\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu,
		/<link\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu,
		/\bfetch\s*\(\s*(?:"([^"]+)"|'([^']+)')/giu
	]) for (const match of source.matchAll(pattern)) {
		const resource = match[1] ?? match[2] ?? match[3];
		if (resource === void 0 || !/^https:\/\//iu.test(resource)) continue;
		try {
			origins.add(safeHttpsOrigin(new URL(resource).origin, "card resource origin"));
		} catch {}
	}
	for (const match of source.matchAll(/https:\/\/[^\s"'<>`\\)]+/giu)) {
		const resource = match[0].replace(/[),.;]+$/u, "");
		try {
			origins.add(safeHttpsOrigin(new URL(resource).origin, "card resource origin"));
		} catch {}
	}
	return [...origins].sort();
}
function imageOrigins(script) {
	return remoteResourceOrigins(script.replaceString);
}
function cardRemoteResourceOrigins(card) {
	const greetings = [card.firstMessage, ...card.alternateGreetings].map((greeting) => renderCharacterDisplay(greeting, card, 2, 0));
	return [.../* @__PURE__ */ new Set([...card.frontend.regexScripts.flatMap((script) => remoteResourceOrigins(script.replaceString)), ...greetings.flatMap(remoteResourceOrigins)])].sort();
}
function sameMalformedPattern(left, right) {
	return !left.findRegex.startsWith("/") && right.findRegex === `/${left.findRegex}` && left.replaceString === right.replaceString && JSON.stringify(left.placement) === JSON.stringify(right.placement) && left.markdownOnly === right.markdownOnly && left.promptOnly === right.promptOnly;
}
function replaceStrings(value, replacement, state) {
	if (typeof value === "string") {
		const matches = value.split(replacement.from).length - 1;
		state.matches += matches;
		return matches === 0 ? value : value.replaceAll(replacement.from, replacement.to);
	}
	if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacement, state));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replacement, state)]));
}
function cardData(raw) {
	const root = object$2(raw, "character card overlay source");
	return root.spec === "chara_card_v2" || root.spec === "chara_card_v3" ? object$2(root.data, "character card overlay data") : root;
}
function scriptJson(script) {
	return {
		...script.id === void 0 ? {} : { id: script.id },
		scriptName: script.scriptName,
		findRegex: script.findRegex,
		replaceString: script.replaceString,
		trimStrings: [...script.trimStrings],
		placement: [...script.placement],
		disabled: script.disabled,
		markdownOnly: script.markdownOnly,
		promptOnly: script.promptOnly,
		runOnEdit: script.runOnEdit,
		substituteRegex: script.substituteRegex,
		minDepth: script.minDepth,
		maxDepth: script.maxDepth
	};
}
function applyOverlay(card, overlay) {
	const enabled = overlay.displayExtensions.filter((extension) => extension.enabled);
	if (overlay.textReplacements.length === 0 && enabled.length === 0) return card;
	let raw = structuredClone(card.raw);
	for (const replacement of overlay.textReplacements) {
		const state = { matches: 0 };
		raw = replaceStrings(raw, replacement, state);
		if (state.matches !== replacement.expectedMatches) throw new Error("character library local text correction no longer matches its source");
	}
	if (enabled.length > 0) {
		const data = cardData(raw);
		const extensions = data.extensions === void 0 ? {} : object$2(data.extensions, "character card overlay extensions");
		const stored = extensions.regex_scripts;
		const original = stored === void 0 ? [] : Array.isArray(stored) ? stored : (() => {
			throw new Error("character card overlay regex scripts must be an array");
		})();
		const replaced = new Set(enabled.flatMap((extension) => extension.replacedCardRegexIndices));
		extensions.regex_scripts = [...original.filter((_script, index) => !replaced.has(index)), ...enabled.map((extension) => scriptJson(extension.script))];
		data.extensions = extensions;
	}
	return parseCharacterCardValue(raw);
}
function safeFilename(value, transport) {
	const fallback = `character.${transport}`;
	const name = basename(value?.trim() || fallback).trim();
	return name === "" ? fallback : name.slice(0, 240);
}
function summary(meta, card, avatarAvailable, imageAssetCount) {
	return {
		id: meta.id,
		name: card.name,
		displayName: card.nickname?.trim() || card.name,
		originalFilename: meta.originalFilename,
		cardVersion: card.version,
		greetingCount: 1 + card.alternateGreetings.length,
		worldInfoCount: card.lorebook?.entries.length ?? 0,
		regexScriptCount: card.frontend.regexScripts.length,
		avatarAvailable,
		imageAssetCount,
		...card.frontend.tavernHelper === void 0 ? {} : { tavernHelper: card.frontend.tavernHelper },
		archived: meta.archivedAt !== void 0,
		transport: meta.transport,
		importedAt: meta.createdAt,
		updatedAt: meta.updatedAt
	};
}
function storedIndex(value) {
	return {
		format: 0,
		name: value.name,
		displayName: value.displayName,
		cardVersion: value.cardVersion,
		greetingCount: value.greetingCount,
		worldInfoCount: value.worldInfoCount,
		regexScriptCount: value.regexScriptCount,
		avatarAvailable: value.avatarAvailable,
		imageAssetCount: value.imageAssetCount,
		...value.tavernHelper === void 0 ? {} : { tavernHelper: value.tavernHelper }
	};
}
function indexedSummary(meta, index) {
	return {
		id: meta.id,
		name: index.name,
		displayName: index.displayName,
		originalFilename: meta.originalFilename,
		cardVersion: index.cardVersion,
		greetingCount: index.greetingCount,
		worldInfoCount: index.worldInfoCount,
		regexScriptCount: index.regexScriptCount,
		avatarAvailable: index.avatarAvailable,
		imageAssetCount: index.imageAssetCount,
		...index.tavernHelper === void 0 ? {} : { tavernHelper: index.tavernHelper },
		archived: meta.archivedAt !== void 0,
		transport: meta.transport,
		importedAt: meta.createdAt,
		updatedAt: meta.updatedAt
	};
}
function greetingDetail(card) {
	const greetings = [card.firstMessage, ...card.alternateGreetings];
	return {
		greetings,
		renderedGreetings: greetings.map((greeting) => renderCharacterDisplay(greeting, card, 2, 0))
	};
}
function regexScriptDetail(card) {
	return card.frontend.regexScripts.map((script, index) => ({
		index,
		...summarizeCharacterRegexScript(script)
	}));
}
function worldInfoEntryDetail(entry) {
	return {
		sourceId: entry.sourceId,
		...entry.name === void 0 ? {} : { name: entry.name },
		...entry.comment === void 0 ? {} : { comment: entry.comment },
		keys: entry.keys,
		secondaryKeys: entry.secondaryKeys,
		content: entry.content,
		enabled: entry.enabled,
		constant: entry.constant,
		selective: entry.selective,
		useRegex: entry.useRegex
	};
}
function worldInfoDetail(card) {
	if (card.lorebook === void 0) return void 0;
	return {
		...card.lorebook.name === void 0 ? {} : { name: card.lorebook.name },
		entries: card.lorebook.entries.map(worldInfoEntryDetail)
	};
}
function displayExtensionDetail(overlay, sourceCard) {
	return overlay.displayExtensions.map((extension) => ({
		id: extension.id,
		scriptName: extension.script.scriptName,
		originalFilename: extension.originalFilename,
		enabled: extension.enabled,
		remoteImageOrigins: extension.remoteImageOrigins,
		replacedCardRegexNames: extension.replacedCardRegexIndices.flatMap((index) => {
			const name = sourceCard.frontend.regexScripts[index]?.scriptName;
			return name === void 0 ? [] : [name];
		})
	}));
}
function characterDetail(meta, parsed, includeWorldInfo) {
	const worldInfo = includeWorldInfo ? worldInfoDetail(parsed.card) : void 0;
	const declaredRemoteOrigins = cardRemoteResourceOrigins(parsed.card);
	return {
		...summary(meta, parsed.card, parsed.avatarAvailable, parsed.images.length),
		mediaType: meta.mediaType,
		...greetingDetail(parsed.card),
		imageAssets: parsed.images,
		remoteResourceOrigins: declaredRemoteOrigins,
		approvedRemoteResourceOrigins: parsed.overlay.approvedRemoteResourceOrigins.filter((origin) => declaredRemoteOrigins.includes(origin)),
		...worldInfo === void 0 ? {} : { worldInfo },
		degradations: parsed.card.degradations,
		regexScripts: regexScriptDetail(parsed.card),
		displayExtensions: displayExtensionDetail(parsed.overlay, parsed.sourceCard),
		localCorrectionCount: parsed.overlay.textReplacements.reduce((total, replacement) => total + replacement.expectedMatches, 0)
	};
}
/** Small content-addressed card library; the original PNG, JSON, or CHARX remains exportable. */
var CharacterLibrary = class {
	root;
	constructor(options = {}) {
		this.root = resolve(options.root ?? dshHomePath("agent-rp", "characters"));
	}
	/** List active or archived cards newest first without returning greeting bodies or file bytes. */
	list(collection = "active") {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root).filter((filename) => filename.endsWith(META_SUFFIX)).map((filename) => this.readEntry(join(this.root, filename)).summary).filter((entry) => entry.archived === (collection === "archived")).sort((left, right) => right.importedAt - left.importedAt || left.displayName.localeCompare(right.displayName));
	}
	/** Load card metadata and selectable greetings by opaque id. */
	get(id) {
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		const detail = characterDetail(entry.meta, parsed, true);
		this.rememberIndex(entry.meta, detail);
		return detail;
	}
	/** Load greetings and frontend metadata without materializing World Info entry bodies. */
	overview(id) {
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		const detail = characterDetail(entry.meta, parsed, false);
		this.rememberIndex(entry.meta, detail);
		return detail;
	}
	/** Load one bounded read-only World Info page without returning the rest to the browser. */
	worldInfoPage(id, offset, limit) {
		if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid World Info offset");
		if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid World Info limit");
		const entry = this.readId(id);
		const card = this.parseStored(entry.meta, entry.data).card;
		if (card.lorebook === void 0) return void 0;
		return {
			...card.lorebook.name === void 0 ? {} : { name: card.lorebook.name },
			offset,
			total: card.lorebook.entries.length,
			entries: card.lorebook.entries.slice(offset, offset + limit).map(worldInfoEntryDetail)
		};
	}
	/** Resolve one reusable card for a model-free Session launch. */
	resolve(id) {
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		return {
			detail: characterDetail(entry.meta, parsed, true),
			card: parsed.card,
			transport: entry.meta.transport === "png" ? {
				transport: "png",
				metadataKeyword: entry.meta.metadataKeyword
			} : { transport: entry.meta.transport },
			source: {
				bytes: entry.data.byteLength,
				originalFilename: entry.meta.originalFilename,
				mediaType: entry.meta.mediaType
			}
		};
	}
	/** Load the original immutable asset by opaque id. */
	asset(id) {
		const entry = this.readId(id);
		let cardSummary = entry.meta.index === void 0 ? void 0 : indexedSummary(entry.meta, entry.meta.index);
		if (cardSummary === void 0) {
			const parsed = this.parseStored(entry.meta, entry.data);
			cardSummary = summary(entry.meta, parsed.card, parsed.avatarAvailable, parsed.images.length);
			this.rememberIndex(entry.meta, cardSummary);
		}
		return {
			summary: cardSummary,
			originalFilename: entry.meta.originalFilename,
			mediaType: entry.meta.mediaType,
			data: entry.data
		};
	}
	/** Load the primary inert avatar image without exposing the enclosing CHARX archive. */
	avatar(id) {
		const entry = this.readId(id);
		if (entry.meta.transport === "json") return void 0;
		if (entry.meta.transport === "charx") {
			const charx = parseCharx(entry.data);
			const avatar = charxAvatar(charx);
			return avatar === void 0 ? void 0 : {
				mediaType: avatar.mediaType,
				data: readCharxImageAsset(charx, avatar)
			};
		}
		return this.parseStored(entry.meta, entry.data).avatar;
	}
	/** Load one card-declared embedded image by its stable V3 asset index. */
	image(id, index) {
		if (!Number.isSafeInteger(index) || index < 0) return void 0;
		const entry = this.readId(id);
		if (entry.meta.transport !== "charx") return void 0;
		const charx = parseCharx(entry.data);
		const asset = charxImageAssets(charx).find((image) => image.index === index);
		return asset === void 0 ? void 0 : {
			index: asset.index,
			type: asset.type,
			name: asset.name,
			mediaType: asset.mediaType,
			sourceUri: charx.card.assets?.[asset.index]?.uri ?? "",
			data: readCharxImageAsset(charx, asset)
		};
	}
	/** Save one already validated card, deduplicating exact original bytes. */
	import(input) {
		return this.importWithOutcome(input).entry;
	}
	/** Save one validated card and report whether it was added, reused, or restored. */
	importWithOutcome(input) {
		const id = `card-${createHash("sha256").update(input.data).digest("hex").slice(0, 32)}`;
		const existingMeta = this.metaPath(id);
		if (existsSync(existingMeta)) {
			const existing = this.get(id);
			return existing.archived ? {
				entry: this.restore(id),
				outcome: "restored"
			} : {
				entry: existing,
				outcome: "existing"
			};
		}
		mkdirSync(this.root, {
			recursive: true,
			mode: 448
		});
		const now = Date.now();
		const transport = input.transport.transport;
		const meta = {
			format: 0,
			id,
			originalFilename: safeFilename(input.filename, transport),
			mediaType: input.mediaType?.trim() || (transport === "png" ? "image/png" : transport === "charx" ? "application/zip" : "application/json"),
			transport,
			...input.transport.transport === "png" ? { metadataKeyword: input.transport.metadataKeyword } : {},
			bytes: input.data.byteLength,
			createdAt: now,
			updatedAt: now
		};
		const assetPath = this.assetPath(meta);
		const assetStaging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.${transport}.tmp`);
		const metaStaging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.meta.tmp`);
		try {
			writeFileSync(assetStaging, input.data, { mode: 384 });
			writeFileSync(metaStaging, `${JSON.stringify(meta, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			renameSync(assetStaging, assetPath);
			renameSync(metaStaging, existingMeta);
		} catch (error) {
			rmSync(assetStaging, { force: true });
			rmSync(metaStaging, { force: true });
			if (existsSync(existingMeta)) {
				const existing = this.get(id);
				return existing.archived ? {
					entry: this.restore(id),
					outcome: "restored"
				} : {
					entry: existing,
					outcome: "existing"
				};
			}
			rmSync(assetPath, { force: true });
			throw error;
		}
		const detail = this.get(id);
		if (detail.name !== input.card.name || detail.cardVersion !== input.card.version) throw new Error("stored character card does not match the validated import");
		return {
			entry: detail,
			outcome: "created"
		};
	}
	/** Parse and save one supported Character Card file selected from the local browser. */
	importFile(input) {
		return this.importFileWithOutcome(input).entry;
	}
	/** Parse one browser-selected card file and report its library import outcome. */
	importFileWithOutcome(input) {
		const filename = input.filename.trim();
		const mediaType = input.mediaType?.split(";", 1)[0]?.trim().toLocaleLowerCase();
		if (/\.charx$/iu.test(filename) || mediaType === "application/zip") {
			const card = parseCharx(input.data).card;
			return this.importWithOutcome({
				...input,
				card,
				transport: { transport: "charx" }
			});
		}
		if (/\.json$/iu.test(filename) || mediaType === "application/json") {
			const card = parseCharacterCardJsonBytes(input.data);
			return this.importWithOutcome({
				...input,
				card,
				transport: { transport: "json" }
			});
		}
		if (/\.png$/iu.test(filename) || mediaType === "image/png") {
			const payload = readCharacterCardPng(input.data);
			const card = parseCharacterCardJson(payload.json);
			return this.importWithOutcome({
				...input,
				card,
				transport: {
					transport: "png",
					metadataKeyword: payload.keyword
				}
			});
		}
		throw new Error("请选择 PNG、JSON 或 CHARX 角色卡");
	}
	/** Attach one display-only SillyTavern regex without modifying the original card bytes. */
	importDisplayExtension(id, input) {
		if (input.data.byteLength === 0 || input.data.byteLength > MAX_DISPLAY_EXTENSION_BYTES) throw new Error("显示扩展文件为空或过大");
		let json;
		try {
			json = new TextDecoder("utf-8", { fatal: true }).decode(input.data).replace(/^\uFEFF/u, "");
		} catch (error) {
			throw new Error("显示扩展必须是 UTF-8 JSON", { cause: error });
		}
		let value;
		try {
			value = JSON.parse(json);
		} catch (error) {
			throw new Error("显示扩展不是有效 JSON", { cause: error });
		}
		const script = parseRegexScript(value, "display extension");
		if (!script.markdownOnly || script.promptOnly || !script.placement.includes(2)) throw new Error("这里只接受作用于 AI 消息的纯显示正则");
		const requiredOrigins = imageOrigins(script);
		const approvedOrigins = [...new Set(input.approvedImageOrigins.map((origin, index) => safeHttpsOrigin(origin, `approved image origin ${index + 1}`)))].sort();
		if (JSON.stringify(requiredOrigins) !== JSON.stringify(approvedOrigins)) throw new Error(requiredOrigins.length === 0 ? "显示扩展不需要外部图片授权" : "请先确认显示扩展使用的外部图片域名");
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		const extensionId = `display-${createHash("sha256").update(input.data).digest("hex").slice(0, 32)}`;
		const existing = parsed.overlay.displayExtensions.find((extension) => extension.id === extensionId);
		if (existing !== void 0) {
			if (!existing.enabled) this.setDisplayExtensionEnabled(id, extensionId, true);
			return this.get(id);
		}
		const replacedCardRegexIndices = parsed.sourceCard.frontend.regexScripts.flatMap((candidate, index) => sameMalformedPattern(candidate, script) ? [index] : []);
		this.writeOverlay(id, {
			...parsed.overlay,
			displayExtensions: [...parsed.overlay.displayExtensions, {
				id: extensionId,
				originalFilename: safeFilename(input.filename, "json"),
				importedAt: Date.now(),
				enabled: true,
				remoteImageOrigins: requiredOrigins,
				replacedCardRegexIndices,
				script
			}]
		});
		return this.get(id);
	}
	/** Enable or pause one local display extension. */
	setDisplayExtensionEnabled(id, extensionId, enabled) {
		if (!DISPLAY_EXTENSION_ID_PATTERN.test(extensionId)) throw new Error("显示扩展 id 无效");
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		if (!parsed.overlay.displayExtensions.some((extension) => extension.id === extensionId)) throw new Error("角色卡没有这个显示扩展");
		this.writeOverlay(id, {
			...parsed.overlay,
			displayExtensions: parsed.overlay.displayExtensions.map((extension) => extension.id === extensionId ? {
				...extension,
				enabled
			} : extension)
		});
		return this.get(id);
	}
	/** Remove one local display extension while keeping the original card unchanged. */
	removeDisplayExtension(id, extensionId) {
		if (!DISPLAY_EXTENSION_ID_PATTERN.test(extensionId)) throw new Error("显示扩展 id 无效");
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		const displayExtensions = parsed.overlay.displayExtensions.filter((extension) => extension.id !== extensionId);
		if (displayExtensions.length === parsed.overlay.displayExtensions.length) throw new Error("角色卡没有这个显示扩展");
		this.writeOverlay(id, {
			...parsed.overlay,
			displayExtensions
		});
		return this.get(id);
	}
	/** Allow or revoke one card-declared public HTTPS resource origin. */
	setRemoteResourceOriginApproved(id, origin, approved) {
		const normalized = safeHttpsOrigin(origin, "card resource origin");
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		if (!cardRemoteResourceOrigins(parsed.card).includes(normalized)) throw new Error("角色卡没有引用这个外部资源来源");
		const origins = new Set(parsed.overlay.approvedRemoteResourceOrigins);
		if (approved) origins.add(normalized);
		else origins.delete(normalized);
		this.writeOverlay(id, {
			...parsed.overlay,
			approvedRemoteResourceOrigins: [...origins].sort()
		});
		return this.get(id);
	}
	/** Apply one exact local wording correction without rewriting the imported card asset. */
	replaceText(id, from, to) {
		if (from === "" || from === to || from.length > 2e3 || to.length > 2e3) throw new Error("本地文字修正无效");
		const entry = this.readId(id);
		const parsed = this.parseStored(entry.meta, entry.data);
		const state = { matches: 0 };
		replaceStrings(parsed.card.raw, {
			from,
			to,
			expectedMatches: 1
		}, state);
		if (state.matches < 1) throw new Error("没有找到需要修正的文字");
		this.writeOverlay(id, {
			...parsed.overlay,
			textReplacements: [...parsed.overlay.textReplacements, {
				from,
				to,
				expectedMatches: state.matches
			}]
		});
		return this.get(id);
	}
	/** Hide one reusable card from the everyday collection without touching its original asset. */
	archive(id) {
		const entry = this.readId(id);
		if (entry.meta.archivedAt !== void 0) return this.get(id);
		const now = Date.now();
		this.writeMetadata({
			...entry.meta,
			archivedAt: now,
			updatedAt: now
		});
		return this.get(id);
	}
	/** Return one archived card to the everyday collection without changing its original asset. */
	restore(id) {
		const entry = this.readId(id);
		if (entry.meta.archivedAt === void 0) return this.get(id);
		const { archivedAt: _archivedAt, ...active } = entry.meta;
		this.writeMetadata({
			...active,
			updatedAt: Date.now()
		});
		return this.get(id);
	}
	assertId(id) {
		if (!ID_PATTERN$3.test(id)) throw new Error("角色库 id 无效");
	}
	metaPath(id) {
		this.assertId(id);
		return join(this.root, `${id}${META_SUFFIX}`);
	}
	overlayPath(id) {
		this.assertId(id);
		return join(this.root, `${id}${OVERLAY_SUFFIX}`);
	}
	assetPath(meta) {
		return join(this.root, `${meta.id}.${meta.transport}`);
	}
	writeMetadata(meta) {
		const staging = join(this.root, `.${meta.id}.${process.pid}.${randomUUID()}.meta.tmp`);
		try {
			writeFileSync(staging, `${JSON.stringify(meta, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			renameSync(staging, this.metaPath(meta.id));
		} finally {
			rmSync(staging, { force: true });
		}
	}
	rememberIndex(meta, value) {
		const index = storedIndex(value);
		if (JSON.stringify(meta.index) === JSON.stringify(index)) return;
		this.writeMetadata({
			...meta,
			index
		});
	}
	readOverlay(id) {
		const path = this.overlayPath(id);
		if (!existsSync(path)) return emptyOverlay();
		try {
			return parseOverlay(JSON.parse(readFileSync(path, "utf8")));
		} catch (error) {
			throw new Error(`无法读取角色库本地调整 ${JSON.stringify(path)}`, { cause: error });
		}
	}
	writeOverlay(id, overlay) {
		mkdirSync(this.root, {
			recursive: true,
			mode: 448
		});
		const path = this.overlayPath(id);
		const staging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.overlay.tmp`);
		try {
			writeFileSync(staging, `${JSON.stringify(overlay, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			renameSync(staging, path);
		} finally {
			rmSync(staging, { force: true });
		}
	}
	parseStored(meta, data) {
		const overlay = this.readOverlay(meta.id);
		if (meta.transport === "json") {
			const sourceCard = parseCharacterCardJsonBytes(data);
			return {
				card: applyOverlay(sourceCard, overlay),
				sourceCard,
				overlay,
				avatarAvailable: false,
				images: []
			};
		}
		if (meta.transport === "charx") {
			const charx = parseCharx(data);
			const images = charxImageAssets(charx).map((image) => ({
				index: image.index,
				type: image.type,
				name: image.name,
				mediaType: image.mediaType,
				sourceUri: charx.card.assets?.[image.index]?.uri ?? ""
			}));
			return {
				card: applyOverlay(charx.card, overlay),
				sourceCard: charx.card,
				overlay,
				avatarAvailable: charxAvatar(charx) !== void 0,
				images
			};
		}
		const payload = readCharacterCardPng(data);
		if (payload.keyword !== meta.metadataKeyword) throw new Error("character library PNG metadata keyword changed");
		const sourceCard = parseCharacterCardJson(payload.json);
		return {
			card: applyOverlay(sourceCard, overlay),
			sourceCard,
			overlay,
			avatarAvailable: true,
			avatar: {
				mediaType: "image/png",
				data
			},
			images: []
		};
	}
	readId(id) {
		const metaPath = this.metaPath(id);
		if (!existsSync(metaPath)) throw new Error(`角色库中没有 ${JSON.stringify(id)}`);
		let meta;
		try {
			meta = parseMetadata(JSON.parse(readFileSync(metaPath, "utf8")));
		} catch (error) {
			throw new Error(`无法读取角色库文件 ${JSON.stringify(metaPath)}`, { cause: error });
		}
		if (meta.id !== id) throw new Error("character library filename and metadata id differ");
		const assetPath = this.assetPath(meta);
		const data = new Uint8Array(readFileSync(assetPath));
		if (data.byteLength !== meta.bytes) throw new Error("character library asset byte count changed");
		return {
			meta,
			data
		};
	}
	readEntry(metaPath) {
		let meta;
		try {
			meta = parseMetadata(JSON.parse(readFileSync(metaPath, "utf8")));
		} catch (error) {
			throw new Error(`无法读取角色库文件 ${JSON.stringify(metaPath)}`, { cause: error });
		}
		const asset = statSync(this.assetPath(meta));
		if (!asset.isFile() || asset.size !== meta.bytes) throw new Error("character library asset byte count changed");
		return { summary: meta.index === void 0 ? this.get(meta.id) : indexedSummary(meta, meta.index) };
	}
};
/** Activate one local card and append its selected opening without invoking a model. */
function executeCharacterLibraryCommand(_library, invocation) {
	throw new Error("这个版本的旧角色启动入口已停用，请刷新页面后从角色库重新开始");
}
/** Same-origin endpoint served by the Agent RP Host plugin. */
const CHARACTER_LIBRARY_PATH = "/api/agent-rp/characters";
function trustedBrowserRequest$9(request, sandboxedImage) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return sandboxedImage && request.headers["sec-fetch-dest"] === "image" && request.headers["sec-fetch-mode"] === "no-cors" && request.headers.origin === void 0;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$9(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
function fail(response, status, message) {
	json$9(response, status, { error: message });
}
function browserDetail(entry) {
	const { worldInfo, ...overview } = entry;
	return overview;
}
async function readUpload$2(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > 67108864) throw new Error("角色卡文件过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > 67108864) throw new Error("角色卡文件过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("角色卡文件为空");
	return new Uint8Array(Buffer.concat(chunks));
}
function pathParts(request) {
	const pathname = new URL(request.url ?? "/", "http://agent-rp.local").pathname;
	if (pathname === "/api/agent-rp/characters") return [];
	if (!pathname.startsWith(`/api/agent-rp/characters/`)) return ["invalid"];
	return pathname.slice(25).split("/").map(decodeURIComponent);
}
/** Register local library reads plus reversible archive operations for the Roleplay UI. */
function installCharacterLibraryHttp(ctx, library, server) {
	ctx.effect(() => server.register({
		kind: "prefix",
		path: CHARACTER_LIBRARY_PATH,
		async handler(request, response) {
			const parts = pathParts(request);
			if (!trustedBrowserRequest$9(request, parts.length === 3 && parts[0] !== void 0 && parts[1] === "images" && parts[2] !== void 0 && /^\d+$/u.test(parts[2]))) {
				fail(response, 403, "forbidden");
				return;
			}
			try {
				if (request.method === "GET" && parts.length === 0) {
					const collection = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("collection");
					if (collection !== null && collection !== "active" && collection !== "archived") {
						fail(response, 400, "invalid character collection");
						return;
					}
					json$9(response, 200, {
						format: 0,
						entries: library.list(collection ?? "active")
					});
					return;
				}
				if (request.method === "GET" && parts.length === 1 && parts[0] !== void 0) {
					json$9(response, 200, {
						format: 0,
						entry: library.overview(parts[0])
					});
					return;
				}
				if (request.method === "POST" && parts.length === 1 && parts[0] === "import") {
					const filename = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("filename")?.trim();
					if (filename === void 0 || filename === "") {
						fail(response, 400, "角色卡文件名缺失");
						return;
					}
					const result = library.importFileWithOutcome({
						data: await readUpload$2(request),
						filename,
						...request.headers["content-type"] === void 0 ? {} : { mediaType: request.headers["content-type"] }
					});
					json$9(response, 200, {
						format: 0,
						...result,
						entry: browserDetail(result.entry)
					});
					return;
				}
				if (request.method === "POST" && parts.length === 3 && parts[0] !== void 0 && parts[1] === "display-extensions" && parts[2] === "import") {
					const url = new URL(request.url ?? "/", "http://agent-rp.local");
					const filename = url.searchParams.get("filename")?.trim();
					if (filename === void 0 || filename === "") {
						fail(response, 400, "显示扩展文件名缺失");
						return;
					}
					let approvedImageOrigins;
					try {
						approvedImageOrigins = JSON.parse(url.searchParams.get("approvedOrigins") ?? "[]");
					} catch {
						fail(response, 400, "外部图片授权无效");
						return;
					}
					if (!Array.isArray(approvedImageOrigins) || approvedImageOrigins.some((origin) => typeof origin !== "string")) {
						fail(response, 400, "外部图片授权无效");
						return;
					}
					json$9(response, 200, {
						format: 0,
						entry: browserDetail(library.importDisplayExtension(parts[0], {
							data: await readUpload$2(request),
							filename,
							approvedImageOrigins
						}))
					});
					return;
				}
				if (request.method === "POST" && parts.length === 4 && parts[0] !== void 0 && parts[1] === "display-extensions" && parts[2] !== void 0 && (parts[3] === "enable" || parts[3] === "disable" || parts[3] === "remove")) {
					json$9(response, 200, {
						format: 0,
						entry: browserDetail(parts[3] === "remove" ? library.removeDisplayExtension(parts[0], parts[2]) : library.setDisplayExtensionEnabled(parts[0], parts[2], parts[3] === "enable"))
					});
					return;
				}
				if (request.method === "POST" && parts.length === 2 && parts[0] !== void 0 && parts[1] === "text-replacements") {
					const body = await readUpload$2(request);
					let value;
					try {
						value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
					} catch {
						fail(response, 400, "本地文字修正不是有效 JSON");
						return;
					}
					if (typeof value !== "object" || value === null || Array.isArray(value) || typeof value.from !== "string" || typeof value.to !== "string") {
						fail(response, 400, "本地文字修正字段无效");
						return;
					}
					const replacement = value;
					json$9(response, 200, {
						format: 0,
						entry: browserDetail(library.replaceText(parts[0], replacement.from, replacement.to))
					});
					return;
				}
				if (request.method === "POST" && parts.length === 2 && parts[0] !== void 0 && (parts[1] === "archive" || parts[1] === "restore")) {
					json$9(response, 200, {
						format: 0,
						entry: browserDetail(parts[1] === "archive" ? library.archive(parts[0]) : library.restore(parts[0]))
					});
					return;
				}
				if (request.method === "POST" && parts.length === 3 && parts[0] !== void 0 && parts[1] === "remote-resources" && (parts[2] === "approve" || parts[2] === "revoke")) {
					const origin = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("origin");
					if (origin === null) {
						fail(response, 400, "外部资源来源缺失");
						return;
					}
					json$9(response, 200, {
						format: 0,
						entry: browserDetail(library.setRemoteResourceOriginApproved(parts[0], origin, parts[2] === "approve"))
					});
					return;
				}
				if (request.method === "GET" && parts.length === 2 && parts[0] !== void 0 && parts[1] === "world-info") {
					const url = new URL(request.url ?? "/", "http://agent-rp.local");
					const offset = Number(url.searchParams.get("offset") ?? "0");
					const limit = Number(url.searchParams.get("limit") ?? "40");
					if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
						fail(response, 400, "invalid World Info page");
						return;
					}
					const page = library.worldInfoPage(parts[0], offset, limit);
					if (page === void 0) {
						fail(response, 404, "World Info not found");
						return;
					}
					json$9(response, 200, {
						format: 0,
						page
					});
					return;
				}
				if (request.method === "GET" && parts.length === 2 && parts[0] !== void 0 && parts[1] === "asset") {
					const asset = library.asset(parts[0]);
					response.writeHead(200, {
						"cache-control": "private, max-age=31536000, immutable",
						"content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.originalFilename)}`,
						"content-length": String(asset.data.byteLength),
						"content-type": asset.mediaType,
						"x-content-type-options": "nosniff"
					});
					response.end(asset.data);
					return;
				}
				if (request.method === "GET" && parts.length === 2 && parts[0] !== void 0 && parts[1] === "avatar") {
					const avatar = library.avatar(parts[0]);
					if (avatar === void 0) {
						fail(response, 404, "avatar not found");
						return;
					}
					response.writeHead(200, {
						"cache-control": "private, max-age=31536000, immutable",
						"content-length": String(avatar.data.byteLength),
						"content-type": avatar.mediaType,
						"content-security-policy": "default-src 'none'; sandbox",
						"x-content-type-options": "nosniff"
					});
					response.end(avatar.data);
					return;
				}
				if (request.method === "GET" && parts.length === 3 && parts[0] !== void 0 && parts[1] === "images" && parts[2] !== void 0) {
					const index = /^\d+$/u.test(parts[2]) ? Number(parts[2]) : NaN;
					const image = library.image(parts[0], index);
					if (image === void 0) {
						fail(response, 404, "image not found");
						return;
					}
					response.writeHead(200, {
						"cache-control": "private, max-age=31536000, immutable",
						"content-length": String(image.data.byteLength),
						"content-type": image.mediaType,
						"content-security-policy": "default-src 'none'; sandbox",
						"x-content-type-options": "nosniff"
					});
					response.end(image.data);
					return;
				}
				if (request.method !== "GET" && request.method !== "POST") {
					response.setHeader("allow", "GET, POST");
					fail(response, 405, "method not allowed");
					return;
				}
				fail(response, 404, "not found");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				fail(response, /角色库中没有/u.test(message) ? 404 : /过大/u.test(message) ? 413 : 400, message);
			}
		}
	}), "agent-rp: character library HTTP");
}
function trustedBrowserRequest$8(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$8(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJson$4(request) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > 16384) throw new Error("Persona 请求过大");
		chunks.push(data);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function parseSaveRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Persona 请求不是对象");
	const record = value;
	const keys = Object.keys(record);
	if (record.format !== 0 || typeof record.name !== "string" || typeof record.description !== "string" || record.id !== void 0 && typeof record.id !== "string" || keys.some((key) => key !== "format" && key !== "id" && key !== "name" && key !== "description")) throw new Error("Persona 请求字段无效");
	return record;
}
/** Register local Persona list, read, create, update, and delete operations. */
function installPersonaLibraryHttp(ctx, library, server) {
	ctx.effect(() => server.register({
		kind: "prefix",
		path: PERSONA_LIBRARY_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$8(request)) {
				json$8(response, 403, { error: "forbidden" });
				return;
			}
			const pathname = new URL(request.url ?? "/", "http://agent-rp.local").pathname;
			const suffix = pathname === "/api/agent-rp/personas" ? "" : pathname.slice(23);
			try {
				if (request.method === "GET" && suffix === "") {
					json$8(response, 200, {
						format: 0,
						entries: library.list()
					});
					return;
				}
				if (request.method === "GET" && suffix !== "" && !suffix.includes("/")) {
					json$8(response, 200, {
						format: 0,
						entry: library.get(decodeURIComponent(suffix))
					});
					return;
				}
				if (request.method === "POST" && suffix === "") {
					json$8(response, 200, {
						format: 0,
						entry: library.save(parseSaveRequest(await readJson$4(request)))
					});
					return;
				}
				if (request.method === "DELETE" && suffix !== "" && !suffix.includes("/")) {
					json$8(response, 200, {
						format: 0,
						entry: library.remove(decodeURIComponent(suffix))
					});
					return;
				}
				response.setHeader("allow", "GET, POST, DELETE");
				json$8(response, request.method === "GET" || request.method === "POST" || request.method === "DELETE" ? 404 : 405, { error: "not found" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json$8(response, /库中没有/u.test(message) ? 404 : 400, { error: message });
			}
		}
	}), "agent-rp: Persona library HTTP");
}
/** File-backed reusable player Persona library. */
const ID_PATTERN$2 = /^persona-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function cleanName(value) {
	const result = value.trim();
	if (result === "" || result.length > 120) throw new Error("Persona 名称应为 1 至 120 个字符");
	return result;
}
function cleanDescription(value) {
	const result = value.trim();
	if (result.length > 12e3) throw new Error("Persona 描述不能超过 12000 个字符");
	return result;
}
function parseStored(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Persona 文件不是对象");
	const record = value;
	if (record.format !== 0 || typeof record.id !== "string" || !ID_PATTERN$2.test(record.id) || typeof record.name !== "string" || cleanName(record.name) !== record.name || typeof record.description !== "string" || cleanDescription(record.description) !== record.description || typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || typeof record.updatedAt !== "number" || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.createdAt) throw new Error("Persona 文件字段无效");
	return record;
}
/** Small local library whose entries can be snapshotted into independent Sessions. */
var PersonaLibrary = class {
	root;
	constructor(options = {}) {
		this.root = resolve(options.root ?? dshHomePath("agent-rp", "personas"));
	}
	/** List valid Persona entries newest first. */
	list() {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root).filter((filename) => filename.endsWith(".json")).map((filename) => this.readFile(join(this.root, filename))).sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)).map(({ id, name, description, updatedAt }) => ({
			id,
			name,
			description,
			updatedAt
		}));
	}
	/** Read one Persona by opaque id. */
	get(id) {
		const stored = this.readFile(this.path(id));
		return {
			id: stored.id,
			name: stored.name,
			description: stored.description,
			updatedAt: stored.updatedAt
		};
	}
	/** Create or update one Persona and return its normalized value. */
	save(request) {
		const name = cleanName(request.name);
		const description = cleanDescription(request.description);
		const id = request.id ?? `persona-${randomUUID()}`;
		const path = this.path(id);
		const existing = existsSync(path) ? this.readFile(path) : void 0;
		if (request.id !== void 0 && existing === void 0) throw new Error(`Persona 库中没有 ${JSON.stringify(id)}`);
		mkdirSync(this.root, {
			recursive: true,
			mode: 448
		});
		const now = Date.now();
		const stored = {
			format: 0,
			id,
			name,
			description,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		};
		const staging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.tmp`);
		try {
			writeFileSync(staging, `${JSON.stringify(stored, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			renameSync(staging, path);
		} catch (error) {
			rmSync(staging, { force: true });
			throw error;
		}
		return this.get(id);
	}
	/** Remove one reusable Persona without changing Sessions that already copied it. */
	remove(id) {
		const entry = this.get(id);
		rmSync(this.path(id));
		return entry;
	}
	path(id) {
		if (!ID_PATTERN$2.test(id)) throw new Error("Persona id 无效");
		return join(this.root, `${id}.json`);
	}
	readFile(path) {
		try {
			return parseStored(JSON.parse(readFileSync(path, "utf8")));
		} catch (error) {
			throw new Error(`无法读取 Persona 文件 ${JSON.stringify(path)}`, { cause: error });
		}
	}
};
function launchPersonaName(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== "command/done" || event.data.kind !== "success") continue;
		const launch = decodeCharacterLibraryLaunch(event.data.text);
		if (launch !== void 0) return launch.persona?.name;
	}
	for (const event of events) if (event.type === "agent-rp/persona-seed") return readSessionPersona([event])?.name;
}
function fallbackUserName(agent) {
	const events = agent.session.events;
	const originalPersonaName = launchPersonaName(events);
	const characterName = readActiveSessionCharacter(events)?.result.userName;
	const chatName = readSillyTavernChatIdentity(events)?.userName;
	if (chatName !== void 0 && chatName !== originalPersonaName) return chatName;
	if (characterName !== void 0 && characterName !== originalPersonaName) return characterName;
}
/** Apply or clear one Session-owned Persona without invoking a model. */
function executePersonaCommand(invocation) {
	const request = parsePersonaCommandRequest(invocation.rawInput);
	const source = invocation.agent.session.events.at(-1);
	if (source?.type !== "command/run" || source.data.name !== "rp-persona" || String(source.data.commandId) !== String(invocation.commandId)) throw new Error("Persona 命令不是当前 Session 事件");
	const fallback = request.persona === void 0 ? fallbackUserName(invocation.agent) : void 0;
	return {
		kind: "success",
		text: encodePersonaCommandRecord({
			format: 0,
			sourceEventSeq: source.seq,
			...request.persona === void 0 ? {} : { persona: request.persona },
			...fallback === void 0 ? {} : { fallbackUserName: fallback }
		})
	};
}
/** Append imported history and optionally activate a Character Card without invoking a model. */
function executeSillyTavernChatCommand(_chats, _characters, invocation) {
	throw new Error("这个版本的旧聊天迁移入口已停用，请刷新页面后重新选择 JSONL 文件");
}
/** Host-owned SillyTavern chat sources used by model-free migration. */
const ID_PATTERN$1 = /^chat-[a-f0-9]{32}$/u;
/** Content-addressed store for original JSONL bytes. */
var SillyTavernChatLibrary = class {
	root;
	constructor(options = {}) {
		this.root = resolve(options.root ?? dshHomePath("agent-rp", "chat-imports"));
	}
	/** Validate and retain one browser-selected JSONL file. */
	importFile(input) {
		const name = basename(input.filename.trim()).slice(0, 240);
		if (name === "" || !/\.jsonl$/iu.test(name)) throw new Error("请选择 SillyTavern 导出的 JSONL 聊天记录");
		if (input.data.byteLength === 0) throw new Error("聊天记录文件为空");
		if (input.data.byteLength > 67108864) throw new Error("聊天记录文件过大");
		const chat = parseSillyTavernChatBytes(input.data);
		const id = `chat-${createHash("sha256").update(input.data).digest("hex").slice(0, 32)}`;
		mkdirSync(this.root, { recursive: true });
		const dataPath = join(this.root, `${id}.jsonl`);
		const namePath = join(this.root, `${id}.name`);
		if (!existsSync(dataPath)) writeFileSync(dataPath, input.data, { flag: "wx" });
		if (!existsSync(namePath)) writeFileSync(namePath, name, {
			encoding: "utf8",
			flag: "wx"
		});
		return this.describe(id, name, input.data.byteLength, chat);
	}
	/** Resolve one validated source without accepting paths from the browser. */
	resolve(id) {
		if (!ID_PATTERN$1.test(id)) throw new Error("聊天迁移编号无效");
		const dataPath = join(this.root, `${id}.jsonl`);
		const namePath = join(this.root, `${id}.name`);
		if (!existsSync(dataPath) || !existsSync(namePath)) throw new Error("这份聊天记录已不可用，请重新选择 JSONL 文件");
		const data = new Uint8Array(readFileSync(dataPath));
		const name = readFileSync(namePath, "utf8").trim();
		if (name === "" || !/\.jsonl$/iu.test(name) || data.byteLength > 67108864) throw new Error("已保存的聊天记录来源无效");
		const chat = parseSillyTavernChatBytes(data);
		return {
			upload: this.describe(id, name, data.byteLength, chat),
			chat,
			attachment: {
				kind: "file",
				attachmentId: AttachmentId(`agent-rp:${id}`),
				bytes: data.byteLength,
				name,
				mediaType: "application/x-ndjson"
			}
		};
	}
	describe(id, name, bytes, chat) {
		const identity = resolveSillyTavernChatIdentity(chat);
		return {
			id,
			name,
			bytes,
			messageCount: chat.messages.length,
			...identity.characterName === void 0 ? {} : { characterName: identity.characterName },
			...identity.userName === void 0 ? {} : { userName: identity.userName }
		};
	}
};
function trustedBrowserRequest$7(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$7(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readUpload$1(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > 67108864) throw new Error("聊天记录文件过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > 67108864) throw new Error("聊天记录文件过大");
		chunks.push(data);
	}
	return new Uint8Array(Buffer.concat(chunks));
}
/** Register the one-shot browser upload used by the private migration command. */
function installSillyTavernChatHttp(ctx, library, server) {
	ctx.effect(() => server.register({
		kind: "prefix",
		path: SILLYTAVERN_CHAT_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$7(request)) {
				json$7(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method !== "POST") {
				response.setHeader("allow", "POST");
				json$7(response, 405, { error: "method not allowed" });
				return;
			}
			try {
				const filename = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("filename")?.trim();
				if (filename === void 0 || filename === "") throw new Error("聊天记录文件名缺失");
				json$7(response, 200, {
					format: 0,
					upload: library.importFile({
						data: await readUpload$1(request),
						filename
					})
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json$7(response, /过大/u.test(message) ? 413 : 400, { error: message });
			}
		}
	}), "agent-rp: SillyTavern chat upload HTTP");
}
function text(event) {
	if (event.type === "user/message") {
		if (event.data.source.kind !== "user" && event.data.source.kind !== "model") return void 0;
		return event.data.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	}
	if (event.type !== "assistant/message" || event.data.message.source.kind !== "model") return void 0;
	return event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
}
function sendDate(time) {
	const date = new Date(time);
	return Number.isNaN(date.getTime()) ? (/* @__PURE__ */ new Date(0)).toISOString() : date.toISOString();
}
function filename(characterName, exportedAt = /* @__PURE__ */ new Date()) {
	const part = (value) => String(value).padStart(2, "0");
	const timestamp = `${part(exportedAt.getMonth() + 1)}${part(exportedAt.getDate())}-${part(exportedAt.getHours())}${part(exportedAt.getMinutes())}`;
	return `${characterName.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/gu, "").slice(0, 210) || "Agent-RP-对话"}-${timestamp}.jsonl`;
}
/** Export the current visible transcript and persistent reply alternatives without invoking a model. */
function exportSillyTavernSessionChat(session, options) {
	const generations = readGenerationGroups(session.events);
	const rows = [{
		user_name: options.userName,
		character_name: options.characterName,
		create_date: sendDate(session.events[0]?.time ?? Date.now()),
		chat_metadata: {
			exported_from: "dsh-agent-rp",
			source_session_id: options.sessionId
		}
	}];
	for (const seq of session.surface.nodes) {
		const event = session.events[seq];
		if (event === void 0) continue;
		const message = text(event);
		if (message === void 0 || message.trim() === "") continue;
		const user = event.type === "user/message";
		const row = {
			name: user ? options.userName : options.characterName,
			is_user: user,
			is_system: false,
			mes: message,
			send_date: sendDate(event.time),
			extra: {
				exported_from: "dsh-agent-rp",
				dsh_event_seq: event.seq
			}
		};
		if (!user) {
			const group = generations.find((candidate) => candidate.surfaceSeq === event.seq);
			const swipes = group?.versions.map((version) => version.text) ?? [message];
			const selected = group?.versions.findIndex((version) => version.seq === group.selectedVersionSeq) ?? 0;
			row.swipes = swipes;
			row.swipe_id = selected < 0 ? 0 : selected;
		}
		rows.push(row);
	}
	return {
		filename: filename(options.characterName),
		source: `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
		messageCount: rows.length - 1
	};
}
/** Same-origin download endpoint for the active Roleplay transcript. */
const SILLYTAVERN_CHAT_EXPORT_PATH = "/api/agent-rp/sillytavern-chat-export";
function trustedBrowserRequest$6(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$6(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
/** Register a Host-owned SillyTavern JSONL export for active Agent RP Sessions. */
function installSillyTavernChatExportHttp(routeCtx, hostCtx, server) {
	routeCtx.effect(() => server.register({
		kind: "exact",
		path: SILLYTAVERN_CHAT_EXPORT_PATH,
		handler(request, response) {
			if (!trustedBrowserRequest$6(request)) {
				json$6(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method !== "GET") {
				response.setHeader("allow", "GET");
				json$6(response, 405, { error: "method not allowed" });
				return;
			}
			try {
				const sourceSessionId = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("sessionId")?.trim();
				if (sourceSessionId === void 0 || sourceSessionId === "" || sourceSessionId.length > 512) throw new Error("角色会话编号无效");
				const agent = hostCtx.get("agents")?.get(SessionId(sourceSessionId));
				if (agent === void 0 || agent.session.header.agentPreset !== "agent-rp") throw new Error("角色会话当前不可用");
				if (agent.status !== "idle" || agent.inbox.hasPending) throw new Error("请等待当前回复完成后再导出");
				const events = agent.session.events;
				const activeCharacter = readActiveSessionCharacter(events);
				const card = activeCharacter === void 0 ? void 0 : cardFromImportMeta(activeCharacter.meta);
				const importedIdentity = readSillyTavernChatIdentity(events);
				const persona = resolveSessionPersonaIdentity(events, activeCharacter?.result.userName, importedIdentity?.userName);
				const title = hostCtx.get("sessionTitle")?.get(agent.session)?.title.trim();
				const characterName = card?.nickname?.trim() || card?.name.trim() || importedIdentity?.characterName.trim() || title || "角色";
				const exported = exportSillyTavernSessionChat(agent.session, {
					sessionId: sourceSessionId,
					characterName,
					userName: persona.userName?.trim() || "User"
				});
				const body = Buffer.from(exported.source, "utf8");
				response.writeHead(200, {
					"cache-control": "no-store",
					"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`,
					"content-length": String(body.byteLength),
					"content-type": "application/x-ndjson; charset=utf-8",
					"x-agent-rp-filename": encodeURIComponent(exported.filename),
					"x-agent-rp-message-count": String(exported.messageCount)
				});
				response.end(body);
			} catch (error) {
				json$6(response, 400, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "agent-rp: SillyTavern chat export HTTP");
}
/** Build complete Session seeds from Host-owned roleplay libraries. */
function object$1(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}不是对象`);
	return value;
}
/** Validate one same-origin browser request without accepting filesystem paths. */
function parseAgentRpSessionLaunchRequest(value) {
	const record = object$1(value, "角色会话启动请求");
	if (!(record.format === 0 && typeof record.sourceSessionId === "string" && record.sourceSessionId.trim() !== "" && record.sourceSessionId.length <= 512)) throw new Error("角色会话启动请求字段无效");
	if (record.kind === "character") {
		if (typeof record.characterId !== "string" || !/^card-[a-f0-9]{32}$/u.test(record.characterId) || typeof record.greetingIndex !== "number" || !Number.isSafeInteger(record.greetingIndex) || record.greetingIndex < 0 || record.presetId !== void 0 && (typeof record.presetId !== "string" || !/^[a-z0-9-]{8,80}$/u.test(record.presetId)) || record.memory !== void 0 && record.memory !== "copy-active" || Object.keys(record).some((key) => ![
			"format",
			"sourceSessionId",
			"kind",
			"characterId",
			"greetingIndex",
			"persona",
			"presetId",
			"memory"
		].includes(key))) throw new Error("角色会话启动请求字段无效");
		const persona = record.persona === void 0 ? void 0 : parseSessionPersona(record.persona);
		return {
			format: 0,
			sourceSessionId: record.sourceSessionId,
			kind: "character",
			characterId: record.characterId,
			greetingIndex: record.greetingIndex,
			...persona === void 0 ? {} : { persona },
			...typeof record.presetId === "string" ? { presetId: record.presetId } : {},
			...record.memory === "copy-active" ? { memory: "copy-active" } : {}
		};
	}
	if (record.kind === "chat") {
		if (typeof record.importId !== "string" || !/^chat-[a-f0-9]{32}$/u.test(record.importId) || record.characterId !== void 0 && (typeof record.characterId !== "string" || !/^card-[a-f0-9]{32}$/u.test(record.characterId)) || record.presetId !== void 0 && (typeof record.presetId !== "string" || !/^[a-z0-9-]{8,80}$/u.test(record.presetId)) || Object.keys(record).some((key) => ![
			"format",
			"sourceSessionId",
			"kind",
			"importId",
			"characterId",
			"presetId"
		].includes(key))) throw new Error("聊天迁移启动请求字段无效");
		return {
			format: 0,
			sourceSessionId: record.sourceSessionId,
			kind: "chat",
			importId: record.importId,
			...typeof record.characterId === "string" ? { characterId: record.characterId } : {},
			...typeof record.presetId === "string" ? { presetId: record.presetId } : {}
		};
	}
	if (record.kind === "rewrite") {
		if (typeof record.turn !== "number" || !Number.isSafeInteger(record.turn) || record.turn < 1 || typeof record.text !== "string" || record.text.trim() === "" || record.text.length > 8e3 || Object.keys(record).some((key) => ![
			"format",
			"sourceSessionId",
			"kind",
			"turn",
			"text"
		].includes(key))) throw new Error("改写会话请求字段无效");
		return {
			format: 0,
			sourceSessionId: record.sourceSessionId,
			kind: "rewrite",
			turn: record.turn,
			text: record.text
		};
	}
	throw new Error("角色会话启动类型无效");
}
function presetAttachment(entry) {
	return {
		kind: "file",
		attachmentId: AttachmentId(`library:${entry.id}`),
		bytes: Buffer.byteLength(JSON.stringify(entry.preset), "utf8"),
		name: "preset.json",
		mediaType: "application/json"
	};
}
function seedWithPreset(seed, presets, presetId) {
	if (presetId === void 0) return seed;
	const entry = presets.get(presetId);
	return createPresetSessionSeed(seed, entry.preset, presetAttachment(entry), entry.id);
}
function libraryAttachment(characterId, transport, bytes, originalFilename, mediaType) {
	const extension = transport === "png" ? "png" : transport === "charx" ? "charx" : "json";
	const name = new RegExp(`\\.${extension}$`, "iu").test(originalFilename) ? originalFilename : `character.${extension}`;
	return {
		kind: "file",
		attachmentId: AttachmentId(`library:${characterId}`),
		bytes,
		name,
		mediaType
	};
}
/** Resolve one validated launch into a balanced seed before any Agent exists. */
function prepareAgentRpSession(characters, chats, presets, request) {
	if (request.kind === "character") {
		const resolved = characters.resolve(request.characterId);
		if (resolved.detail.archived) throw new Error("请先恢复这个角色，再开始对话");
		const selectedGreeting = resolved.detail.greetings[request.greetingIndex];
		if (selectedGreeting === void 0) throw new Error(`角色卡没有第 ${request.greetingIndex + 1} 条开场白`);
		const source = libraryAttachment(request.characterId, resolved.transport.transport, resolved.source.bytes, resolved.source.originalFilename, resolved.source.mediaType);
		const userName = request.persona?.name;
		return {
			seed: seedWithPreset(createCharacterCardSessionSeed(resolved.card, source, request.greetingIndex, substituteCardMacros$1(selectedGreeting, resolved.card, userName).trim(), resolved.transport, userName, request.persona, request.characterId), presets, request.presetId),
			title: resolved.detail.displayName
		};
	}
	const chat = chats.resolve(request.importId);
	if (request.characterId === void 0) {
		const identity = resolveSillyTavernChatIdentity(chat.chat);
		return {
			seed: seedWithPreset(createSillyTavernChatSeed(chat.chat, chat.attachment), presets, request.presetId),
			title: identity.characterName?.trim() || chat.upload.name.replace(/\.jsonl$/iu, "")
		};
	}
	const character = characters.resolve(request.characterId);
	if (character.detail.archived) throw new Error("请先恢复这个角色，再迁移聊天记录");
	const source = libraryAttachment(request.characterId, character.transport.transport, character.source.bytes, character.source.originalFilename, character.source.mediaType);
	return {
		seed: seedWithPreset(createSillyTavernMigrationSeed(character.card, source, character.transport, chat.chat, chat.attachment, request.characterId), presets, request.presetId),
		title: character.detail.displayName
	};
}
/** Cut one completed user turn from an Agent RP transcript without changing its source. */
function prepareAgentRpRewriteSession(session, turn, sourceTitle) {
	if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("改写轮次无效");
	const start = session.events.find((event) => event.type === "turn/start" && event.data.turn === turn);
	if (start === void 0) throw new Error(`第 ${turn} 轮不存在`);
	const end = session.events.find((event) => event.seq > start.seq && event.type === "turn/end" && event.data.turn === turn);
	if (end === void 0) throw new Error(`第 ${turn} 轮尚未完成，请等待回复结束`);
	if (session.events.find((event) => event.seq > start.seq && event.seq < end.seq && event.type === "user/message") === void 0) throw new Error("这一轮没有可改写的用户消息");
	const seed = session.events.slice(0, start.seq);
	const characterName = readActiveSessionCharacter(seed)?.result.name;
	return {
		seed,
		title: `${sourceTitle?.trim() || characterName?.trim() || "角色对话"} · 改写`
	};
}
/** Same-origin endpoint that creates one complete roleplay Session. */
const AGENT_RP_SESSION_PATH = "/api/agent-rp/sessions";
/** Same-origin creation of complete seeded Agent RP Sessions on public DSH. */
const MAX_REQUEST_BYTES$3 = 32 * 1024;
function trustedBrowserRequest$5(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$5(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJson$3(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES$3) throw new Error("角色会话启动请求过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > MAX_REQUEST_BYTES$3) throw new Error("角色会话启动请求过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("角色会话启动请求为空");
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw new Error("角色会话启动请求不是有效 JSON", { cause: error });
	}
}
/** Create an Agent whose constructor sees the complete imported history. */
async function launchAgentRpSession(ctx, characters, chats, presetLibrary, input) {
	const request = parseAgentRpSessionLaunchRequest(input);
	const sourceId = SessionId(request.sourceSessionId);
	const agents = ctx.get("agents");
	if (agents === void 0) throw new Error("当前 Host 无法创建角色会话");
	const apiProxy = ctx.get("apiProxy");
	if (apiProxy === void 0) throw new Error("当前 Host 无法读取来源会话");
	const models = await apiProxy.sessions.models({
		rpcId: `agent-rp-launch-${randomUUID()}`,
		payload: { sessionId: sourceId }
	});
	if (!models.result.ok) throw new Error(models.result.error.message);
	const source = agents.get(sourceId);
	if (source === void 0) throw new Error("来源会话当前不可用");
	const agentPresets = ctx.get("agentPresets");
	if (agentPresets === void 0) throw new Error("当前 Host 无法挂载角色会话预设");
	const preset = await agentPresets.resolve("agent-rp");
	const titles = ctx.get("sessionTitle");
	if (request.kind === "rewrite") {
		if (source.session.header.agentPreset !== "agent-rp") throw new Error("只能改写 Agent RP 角色会话");
		if (source.status !== "idle" || source.inbox.hasPending) throw new Error("请等待当前回复完成后再改写");
	}
	let prepared = request.kind === "rewrite" ? prepareAgentRpRewriteSession(source.session, request.turn, titles?.get(source.session)?.title) : prepareAgentRpSession(characters, chats, presetLibrary, request);
	if (request.kind === "character" && request.memory === "copy-active") {
		if (source.session.header.agentPreset !== "agent-rp") throw new Error("只能从角色会话继承记忆");
		if (source.status !== "idle" || source.inbox.hasPending) throw new Error("请等待当前回复完成后再继承记忆");
		if (readActiveSessionCharacter(source.session.events)?.result.libraryId !== request.characterId) throw new Error("只能把记忆带给同一个角色");
		const memory = readAgentRpMemoryHistory(source.session.events).active;
		prepared = {
			...prepared,
			seed: appendAgentRpMemorySeed(prepared.seed, memory, String(source.id))
		};
	}
	const sessionId = SessionId(`session-${randomUUID()}`);
	const agentOptions = {
		provider: models.result.value.current.provider,
		model: models.result.value.current.model
	};
	const handle = await agents.create({
		sessionId,
		seed: prepared.seed,
		agentOptions,
		meta: {
			...source.session.header.cwd === void 0 ? {} : { cwd: source.session.header.cwd },
			...request.kind === "rewrite" ? {
				parentSession: source.id,
				seedLength: prepared.seed.length
			} : {},
			agentPreset: preset.id
		},
		setup: async (agentCtx) => {
			await agentPresets.mount(agentCtx, preset.id);
		}
	});
	const selected = await apiProxy.sessions.selectModel({
		rpcId: `agent-rp-select-${randomUUID()}`,
		payload: {
			sessionId,
			provider: models.result.value.current.provider,
			model: models.result.value.current.model,
			...models.result.value.current.reasoningEffort === void 0 ? {} : { reasoningEffort: models.result.value.current.reasoningEffort }
		}
	});
	if (!selected.result.ok) {
		await handle.dispose();
		throw new Error(selected.result.error.message);
	}
	if (titles !== void 0) try {
		titles.rename(handle.agent.session, prepared.title);
	} catch (error) {
		ctx.logger.warn(`agent-rp: Session ${JSON.stringify(sessionId)} title was not applied: ${String(error)}`);
	}
	const workspace = ctx.get("workspaceRegistry")?.list().find((item) => item.sessionIds.includes(sourceId));
	if (workspace !== void 0) try {
		await workspace.attachSession(sessionId);
	} catch (error) {
		ctx.logger.warn(`agent-rp: Session ${JSON.stringify(sessionId)} remains ungrouped: ${String(error)}`);
	}
	if (request.kind === "rewrite") handle.agent.followup(createUserMessage({
		content: [{
			type: "text",
			text: request.text
		}],
		source: { kind: "user" }
	}));
	return {
		sessionId,
		title: prepared.title,
		seed: prepared.seed
	};
}
/** Register the current-public-DSH bridge for seeded Session creation. */
function installSessionLaunchHttp(routeCtx, hostCtx, characters, chats, presets, server) {
	routeCtx.effect(() => server.register({
		kind: "exact",
		path: AGENT_RP_SESSION_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$5(request)) {
				json$5(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method !== "POST") {
				response.setHeader("allow", "POST");
				json$5(response, 405, { error: "method not allowed" });
				return;
			}
			try {
				const result = await launchAgentRpSession(hostCtx, characters, chats, presets, await readJson$3(request));
				json$5(response, 200, {
					format: 0,
					sessionId: result.sessionId,
					title: result.title
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json$5(response, /过大/u.test(message) ? 413 : 400, { error: message });
			}
		}
	}), "agent-rp: seeded Session launch HTTP");
}
/** Resolve all imported books in their prompt order. */
function readSessionLorebookSources(agent) {
	const active = readActiveSessionCharacter(agent.session.events);
	const card = active === void 0 ? void 0 : cardFromImportMeta(active.meta);
	return withTavernWorldbooks([...card?.lorebook === void 0 || active === void 0 ? [] : [{
		id: `character:${active.result.sourceAttachmentId}`,
		name: card.lorebook.name?.trim() || `${card.nickname?.trim() || card.name}的世界书`,
		source: "character",
		lorebook: card.lorebook,
		degradations: card.degradations.filter((value) => value.startsWith("lorebook-"))
	}], ...readActiveSessionWorldInfos(agent.session.events).map((value) => ({
		id: `standalone:${value.result.sourceAttachmentId}`,
		name: value.result.name,
		source: "standalone",
		lorebook: value.worldInfo.lorebook,
		degradations: value.result.degradations
	}))], readTavernHelperState(agent.session.events));
}
/** Resolve only the books that should participate in the next model request. */
function readActiveSessionLorebookSources(agent) {
	return activeTavernWorldbooks(readSessionLorebookSources(agent), readTavernHelperState(agent.session.events));
}
/** Execute one World Info manager mutation and persist its complete overlay snapshot. */
function executeWorldInfoConfiguration(invocation) {
	return {
		kind: "success",
		text: encodeWorldInfoConfiguration(configureWorldInfo(readWorldInfoConfiguration(invocation.agent.session.events), parseWorldInfoConfigurationRequest(invocation.rawInput), readSessionLorebookSources(invocation.agent)))
	};
}
/** Host-owned standalone World Info sources used by direct imports. */
const ID_PATTERN = /^world-info-[a-f0-9]{32}$/u;
/** Content-addressed store for original World Info JSON bytes. */
var WorldInfoLibrary = class {
	root;
	constructor(options = {}) {
		this.root = resolve(options.root ?? dshHomePath("agent-rp", "world-info-imports"));
	}
	/** Validate and retain one browser-selected World Info JSON file. */
	importFile(input) {
		const name = basename(input.filename.trim()).slice(0, 240);
		if (name === "" || !/\.json$/iu.test(name)) throw new Error("请选择 SillyTavern World Info JSON 文件");
		if (input.data.byteLength === 0) throw new Error("世界书文件为空");
		if (input.data.byteLength > 2097152) throw new Error("世界书文件过大");
		const worldInfo = parseWorldInfoJsonBytes(input.data);
		const id = `world-info-${createHash("sha256").update(input.data).digest("hex").slice(0, 32)}`;
		mkdirSync(this.root, { recursive: true });
		const dataPath = join(this.root, `${id}.json`);
		const namePath = join(this.root, `${id}.name`);
		if (!existsSync(dataPath)) writeFileSync(dataPath, input.data, { flag: "wx" });
		if (!existsSync(namePath)) writeFileSync(namePath, name, {
			encoding: "utf8",
			flag: "wx"
		});
		return this.describe(id, name, worldInfo);
	}
	/** List retained World Info sources by display name. */
	list() {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root).filter((filename) => /^world-info-[a-f0-9]{32}\.json$/u.test(filename)).map((filename) => this.resolve(filename.slice(0, -5)).upload).sort((left, right) => left.name.localeCompare(right.name));
	}
	/** Load the exact original source bytes retained for one import. */
	asset(id) {
		const source = this.readSource(id);
		const worldInfo = parseWorldInfoJsonBytes(source.data);
		return {
			upload: this.describe(id, source.filename, worldInfo),
			worldInfo,
			filename: source.filename,
			data: source.data
		};
	}
	/** Resolve one validated source without accepting a filesystem path from the browser. */
	resolve(id) {
		const { upload, worldInfo } = this.asset(id);
		return {
			upload,
			worldInfo
		};
	}
	readSource(id) {
		if (!ID_PATTERN.test(id)) throw new Error("世界书导入编号无效");
		const dataPath = join(this.root, `${id}.json`);
		const namePath = join(this.root, `${id}.name`);
		if (!existsSync(dataPath) || !existsSync(namePath)) throw new Error("这本世界书已不可用，请重新选择 JSON 文件");
		const data = new Uint8Array(readFileSync(dataPath));
		const filename = readFileSync(namePath, "utf8").trim();
		if (filename === "" || !/\.json$/iu.test(filename) || data.byteLength > 2097152) throw new Error("已保存的世界书来源无效");
		return {
			filename,
			data
		};
	}
	describe(id, filename, worldInfo) {
		return {
			id,
			name: worldInfo.name?.trim() || filename.replace(/\.json$/iu, ""),
			entryCount: worldInfo.lorebook.entries.length,
			degradations: [...worldInfo.degradations]
		};
	}
};
/** Validate a private browser-owned World Info import request. */
function parseWorldInfoLibraryLaunchRequest(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("世界书导入请求不是有效 JSON", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("世界书导入请求不是对象");
	const record = value;
	if (record.format !== 0 || typeof record.importId !== "string" || !/^world-info-[a-f0-9]{32}$/u.test(record.importId) || Object.keys(record).some((key) => key !== "format" && key !== "importId")) throw new Error("世界书导入请求字段无效");
	return {
		format: 0,
		importId: record.importId
	};
}
/** Activate one Host-owned World Info source without invoking a model. */
function executeWorldInfoLibraryCommand(library, invocation) {
	const request = parseWorldInfoLibraryLaunchRequest(invocation.rawInput);
	const source = invocation.agent.session.events.at(-1);
	if (source?.type !== "command/run" || source.data.name !== "rp-world-info-import" || String(source.data.commandId) !== String(invocation.commandId)) throw new Error("世界书导入命令不是当前 Session 事件");
	const resolved = library.resolve(request.importId);
	const attachment = {
		kind: "file",
		attachmentId: AttachmentId(`library:${request.importId}`),
		bytes: 1,
		name: `${resolved.upload.name}.json`,
		mediaType: "application/json"
	};
	const { raw, ...result } = prepareWorldInfoImportResult(resolved.worldInfo, source.seq, attachment);
	const meta = {
		format: 0,
		result,
		raw
	};
	return {
		kind: "success",
		text: encodeWorldInfoLibraryImport({
			format: 0,
			importId: request.importId,
			meta
		})
	};
}
function trustedBrowserRequest$4(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$4(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readUpload(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > 2097152) throw new Error("世界书文件过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > 2097152) throw new Error("世界书文件过大");
		chunks.push(data);
	}
	return new Uint8Array(Buffer.concat(chunks));
}
/** Register the browser upload used by the private World Info import command. */
function installWorldInfoLibraryHttp(ctx, library, server) {
	ctx.effect(() => server.register({
		kind: "exact",
		path: WORLD_INFO_LIBRARY_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$4(request)) {
				json$4(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method === "GET") {
				json$4(response, 200, {
					format: 0,
					entries: library.list()
				});
				return;
			}
			if (request.method !== "POST") {
				response.setHeader("allow", "GET, POST");
				json$4(response, 405, { error: "method not allowed" });
				return;
			}
			try {
				const filename = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("filename")?.trim();
				if (filename === void 0 || filename === "") throw new Error("世界书文件名缺失");
				json$4(response, 200, {
					format: 0,
					upload: library.importFile({
						data: await readUpload(request),
						filename
					})
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json$4(response, /过大/u.test(message) ? 413 : 400, { error: message });
			}
		}
	}), "agent-rp: World Info upload HTTP");
}
/** Browser-safe protocol for local roleplay image generation. */
/** Same-origin route serving image jobs, assets, and credential state. */
const AGENT_RP_IMAGE_PATH = "/api/agent-rp/images";
/** Provider-specific credential references keep unrelated image services isolated. */
const AGENT_RP_IMAGE_CREDENTIAL_REFS = {
	openai: "DSH_AGENT_RP_IMAGE_API_KEY",
	novelai: "DSH_AGENT_RP_NOVELAI_API_KEY",
	a1111: "DSH_AGENT_RP_A1111_API_KEY",
	comfyui: "DSH_AGENT_RP_COMFYUI_API_KEY"
};
/** Resolve the credential slot owned by one image provider. */
function imageCredentialRefName(provider) {
	return AGENT_RP_IMAGE_CREDENTIAL_REFS[provider];
}
/** Supported image generation intents. */
const IMAGE_GENERATION_MODES = [
	"scene",
	"portrait",
	"avatar",
	"custom"
];
const JOB_ID_PATTERN = /^image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMAND_RECORD_PREFIX = "dsh-agent-rp:image:v0:";
/** Validate one opaque browser-minted image job id. */
function isImageJobId(value) {
	return JOB_ID_PATTERN.test(value);
}
/** Parse and validate one command request. */
function parseImageGenerationRequest(value) {
	const parsed = typeof value === "string" ? JSON.parse(value.trim()) : value;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("图片生成请求不是对象");
	const record = parsed;
	const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
	if (record.format !== 0 || typeof record.jobId !== "string" || !isImageJobId(record.jobId) || typeof record.mode !== "string" || !IMAGE_GENERATION_MODES.includes(record.mode) || prompt.length < 1 || prompt.length > 8e3) throw new Error("图片生成请求字段无效");
	return {
		format: 0,
		jobId: record.jobId,
		mode: record.mode,
		prompt
	};
}
/** Encode the compact success record stored by `/rp-draw`. */
function encodeImageGenerationRecord(job) {
	return `${COMMAND_RECORD_PREFIX}${JSON.stringify({
		format: 0,
		jobId: job.id
	})}`;
}
/** File-backed image job metadata and generated assets. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
function parseJob(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("图片任务元数据不是对象");
	const record = value;
	const request = parseImageGenerationRequest(record.request);
	const statuses = [
		"queued",
		"running",
		"completed",
		"failed",
		"cancelled"
	];
	const validImage = record.image === void 0 || typeof record.image === "object" && record.image !== null && !Array.isArray(record.image) && [
		"image/png",
		"image/jpeg",
		"image/webp"
	].includes(String(record.image.mediaType)) && Number.isSafeInteger(record.image.bytes) && Number(record.image.bytes) > 0;
	if (record.format !== 0 || typeof record.id !== "string" || !isImageJobId(record.id) || record.id !== request.jobId || record.provider !== "openai" && record.provider !== "novelai" && record.provider !== "a1111" && record.provider !== "comfyui" || typeof record.status !== "string" || !statuses.includes(record.status) || typeof record.progress !== "number" || !Number.isFinite(record.progress) || record.progress < 0 || record.progress > 1 || typeof record.phase !== "string" || record.phase.length > 200 || !Number.isSafeInteger(record.createdAt) || Number(record.createdAt) < 0 || !Number.isSafeInteger(record.updatedAt) || Number(record.updatedAt) < 0 || !validImage || record.error !== void 0 && (typeof record.error !== "string" || record.error.length > 4e3)) throw new Error("图片任务元数据字段无效");
	return record;
}
/** Small atomic store for generated images and their progress. */
var GeneratedImageLibrary = class {
	root;
	constructor(options = {}) {
		this.root = resolve(options.root ?? dshHomePath("agent-rp", "generated-images"));
	}
	/** Create one queued job without overwriting an earlier conversation record. */
	begin(request, provider) {
		const normalized = parseImageGenerationRequest(request);
		if (existsSync(this.metaPath(normalized.jobId))) throw new Error("图片任务已经存在");
		const now = Date.now();
		const job = {
			format: 0,
			id: normalized.jobId,
			request: normalized,
			provider,
			status: "queued",
			progress: 0,
			phase: "等待图片服务",
			createdAt: now,
			updatedAt: now
		};
		this.write(job, true);
		return job;
	}
	/** Read one job by opaque id. */
	get(id) {
		const path = this.metaPath(id);
		if (!existsSync(path)) throw new Error(`没有找到图片任务 ${JSON.stringify(id)}`);
		try {
			return parseJob(JSON.parse(readFileSync(path, "utf8")));
		} catch (error) {
			throw new Error(`无法读取图片任务 ${JSON.stringify(path)}`, { cause: error });
		}
	}
	/** Persist an in-flight stage and monotonic progress. */
	progress(id, progress, phase) {
		const current = this.get(id);
		if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") return current;
		const next = {
			...current,
			status: "running",
			progress: Math.max(current.progress, Math.min(.98, Math.max(0, progress))),
			phase: phase.trim().slice(0, 200),
			updatedAt: Date.now()
		};
		this.write(next);
		return next;
	}
	/** Atomically save the final image before marking its job complete. */
	complete(id, asset) {
		if (asset.data.byteLength < 1 || asset.data.byteLength > MAX_IMAGE_BYTES) throw new Error("生成图片大小无效");
		const current = this.get(id);
		mkdirSync(this.root, {
			recursive: true,
			mode: 448
		});
		const path = this.assetPath(id);
		const staging = join(this.root, `.${id}.${process.pid}.${randomUUID()}.image.tmp`);
		try {
			writeFileSync(staging, asset.data, { mode: 384 });
			renameSync(staging, path);
		} finally {
			rmSync(staging, { force: true });
		}
		const job = {
			...current,
			status: "completed",
			progress: 1,
			phase: "图片已完成",
			updatedAt: Date.now(),
			image: {
				mediaType: asset.mediaType,
				bytes: asset.data.byteLength
			}
		};
		this.write(job);
		return job;
	}
	/** Persist a provider failure without retaining response bodies or credentials. */
	fail(id, error) {
		const job = {
			...this.get(id),
			status: "failed",
			phase: "生成失败",
			updatedAt: Date.now(),
			error: error.trim().slice(0, 4e3)
		};
		this.write(job);
		return job;
	}
	/** Persist a user cancellation. */
	cancelled(id) {
		const job = {
			...this.get(id),
			status: "cancelled",
			phase: "已取消",
			updatedAt: Date.now()
		};
		this.write(job);
		return job;
	}
	/** Read the immutable bytes for one completed job. */
	asset(id) {
		const job = this.get(id);
		if (job.status !== "completed" || job.image === void 0) throw new Error("图片任务尚未完成");
		const data = new Uint8Array(readFileSync(this.assetPath(id)));
		if (data.byteLength !== job.image.bytes) throw new Error("生成图片字节数发生变化");
		return {
			data,
			mediaType: job.image.mediaType
		};
	}
	metaPath(id) {
		if (!isImageJobId(id)) throw new Error("图片任务 id 无效");
		return join(this.root, `${id}.json`);
	}
	assetPath(id) {
		if (!isImageJobId(id)) throw new Error("图片任务 id 无效");
		return join(this.root, `${id}.image`);
	}
	write(job, exclusive = false) {
		const path = this.metaPath(job.id);
		if (exclusive && existsSync(path)) throw new Error("图片任务已经存在");
		mkdirSync(dirname(path), {
			recursive: true,
			mode: 448
		});
		const staging = join(this.root, `.${job.id}.${process.pid}.${randomUUID()}.meta.tmp`);
		try {
			writeFileSync(staging, `${JSON.stringify(job, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			if (exclusive && existsSync(path)) throw new Error("图片任务已经存在");
			renameSync(staging, path);
		} finally {
			rmSync(staging, { force: true });
		}
	}
};
/** Provider adapters for user-triggered roleplay image generation. */
const MAX_PROVIDER_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_NOVELAI_ARCHIVE_BYTES = 40 * 1024 * 1024;
function endpoint(value, suffix) {
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("图片服务地址必须使用 http 或 https");
	if (parsed.username !== "" || parsed.password !== "") throw new Error("图片服务地址不能包含用户名或密码");
	if (parsed.hash !== "") throw new Error("图片服务地址不能包含片段");
	if (parsed.pathname === "/" || parsed.pathname === "") parsed.pathname = suffix;
	return parsed;
}
function serviceEndpoint(value, suffix) {
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("图片服务地址必须使用 http 或 https");
	if (parsed.username !== "" || parsed.password !== "") throw new Error("图片服务地址不能包含用户名或密码");
	if (parsed.hash !== "" || parsed.search !== "") throw new Error("图片服务地址不能包含查询参数或片段");
	parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}${suffix}`;
	return parsed;
}
function providerError(provider, status, body) {
	let detail = body.trim().slice(0, 800);
	try {
		const parsed = JSON.parse(body);
		const message = typeof parsed.error === "string" ? parsed.error : typeof parsed.error?.message === "string" ? parsed.error.message : typeof parsed.detail === "string" ? parsed.detail : typeof parsed.message === "string" ? parsed.message : void 0;
		if (message !== void 0) detail = message.slice(0, 800);
	} catch {}
	return /* @__PURE__ */ new Error(`${provider} 请求失败（${status}）${detail === "" ? "" : `：${detail}`}`);
}
function novelAiError(status, body) {
	if (status === 401) return /* @__PURE__ */ new Error("NovelAI Access Token 无效或已失效");
	if (status === 402) return /* @__PURE__ */ new Error("NovelAI 订阅或 Anlas 额度不足");
	if (status === 429) return /* @__PURE__ */ new Error("NovelAI 请求过于频繁，请稍后再试");
	return providerError("NovelAI", status, body);
}
async function discard(response) {
	try {
		await response.body?.cancel();
	} catch {}
}
function openAiModelsEndpoint(value) {
	const url = endpoint(value, "/v1/images/generations");
	if (/\/images\/generations\/?$/u.test(url.pathname)) url.pathname = url.pathname.replace(/\/images\/generations\/?$/u, "/models");
	else url.pathname = `${url.pathname.replace(/\/$/u, "")}/models`;
	url.search = "";
	return url;
}
async function fetchConnection(provider, url, init) {
	try {
		return await fetch(url, init);
	} catch (reason) {
		if (init.signal?.aborted === true) throw new Error(`${provider} 连接超时（12 秒）`, { cause: reason });
		throw new Error(`${provider} 无法连接；请检查接口地址、网络或服务状态`, { cause: reason });
	}
}
/** Check one configured provider without submitting an image generation job. */
async function testImageProvider(settings, apiKey, signal) {
	if (settings.provider === "openai") {
		if (apiKey === void 0) throw new Error("请先保存图片服务密钥");
		const response = await fetchConnection("图片服务", openAiModelsEndpoint(settings.openai.endpoint), {
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: "application/json"
			},
			signal
		});
		if (response.status === 404 || response.status === 405) {
			await discard(response);
			return {
				status: "reachable",
				detail: "图片服务可以连接，但没有提供模型列表；密钥权限尚未验证"
			};
		}
		if (!response.ok) throw providerError("图片服务连接测试", response.status, await response.text());
		await discard(response);
		return {
			status: "verified",
			detail: "图片服务和密钥均可用；测试没有生成图片"
		};
	}
	if (settings.provider === "novelai") {
		if (apiKey === void 0) throw new Error("请先保存 NovelAI Access Token");
		const generateUrl = endpoint(settings.novelai.endpoint, "/ai/generate-image");
		const headers = {
			authorization: `Bearer ${apiKey}`,
			accept: "application/json"
		};
		if (generateUrl.hostname.toLowerCase() === "image.novelai.net") {
			const response = await fetchConnection("NovelAI", new URL("https://api.novelai.net/user/subscription"), {
				headers,
				signal
			});
			if (!response.ok) throw novelAiError(response.status, await response.text());
			await discard(response);
			return {
				status: "verified",
				detail: "NovelAI Access Token 和订阅均可用；测试没有消耗 Anlas"
			};
		}
		await discard(await fetchConnection("NovelAI", new URL("/", generateUrl), {
			headers,
			signal
		}));
		return {
			status: "reachable",
			detail: "自定义 NovelAI 服务可以连接；订阅与 Token 权限尚未验证"
		};
	}
	const headers = { accept: "application/json" };
	if (apiKey !== void 0) headers.authorization = `Bearer ${apiKey}`;
	if (settings.provider === "comfyui") {
		const response = await fetchConnection("ComfyUI", serviceEndpoint(settings.comfyui.endpoint, "/system_stats"), {
			headers,
			signal
		});
		if (!response.ok) throw providerError("ComfyUI 连接测试", response.status, await response.text());
		await discard(response);
		if (settings.comfyui.workflow.trim() === "") return {
			status: "reachable",
			detail: "ComfyUI 已连接；还需要粘贴“API 格式”的工作流"
		};
		renderComfyWorkflow(settings, "连接测试");
		return {
			status: "verified",
			detail: "ComfyUI 和 API 工作流均可用；测试没有提交绘图任务"
		};
	}
	const url = endpoint(settings.a1111.endpoint, "/sdapi/v1/samplers");
	url.pathname = url.pathname.replace(/\/sdapi\/v1\/txt2img$/u, "/sdapi/v1/samplers");
	const response = await fetchConnection("A1111 / Forge", url, {
		headers,
		signal
	});
	if (!response.ok) throw providerError("A1111 / Forge 连接测试", response.status, await response.text());
	await discard(response);
	return {
		status: "verified",
		detail: "A1111 / Forge 已连接；测试没有生成图片"
	};
}
function decodeImageBytes(data) {
	if (data.byteLength < 8 || data.byteLength > MAX_PROVIDER_IMAGE_BYTES) throw new Error("图片服务返回了无效大小的图片");
	let mediaType;
	if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) mediaType = "image/png";
	else if (data[0] === 255 && data[1] === 216) mediaType = "image/jpeg";
	else if (String.fromCharCode(...data.slice(0, 4)) === "RIFF" && String.fromCharCode(...data.slice(8, 12)) === "WEBP") mediaType = "image/webp";
	else throw new Error("图片服务返回了不支持的图片格式");
	return {
		data,
		mediaType
	};
}
function decodeBase64Image(value) {
	const payload = value.replace(/^data:image\/(?:png|jpeg|webp);base64,/iu, "");
	return decodeImageBytes(new Uint8Array(Buffer.from(payload, "base64")));
}
function extractNovelAiImage(archive) {
	let selected = false;
	let files;
	try {
		files = unzipSync(archive, { filter: (file) => {
			if (selected || !/\.(?:png|jpe?g|webp)$/iu.test(file.name)) return false;
			if (file.originalSize < 8 || file.originalSize > MAX_PROVIDER_IMAGE_BYTES) throw new Error("NovelAI 返回的图片大小无效");
			selected = true;
			return true;
		} });
	} catch (error) {
		if (error instanceof Error && /NovelAI/u.test(error.message)) throw error;
		throw new Error("NovelAI 返回的 ZIP 无法解压", { cause: error });
	}
	const image = Object.values(files)[0];
	if (image === void 0) throw new Error("NovelAI 返回的 ZIP 中没有可用图片");
	return decodeImageBytes(image);
}
async function readRemoteImage(url, signal) {
	const parsed = new URL(url);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("图片服务返回了不支持的下载地址");
	const response = await fetch(parsed, { signal });
	if (!response.ok) throw providerError("图片下载", response.status, await response.text());
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_PROVIDER_IMAGE_BYTES) throw new Error("图片服务返回的图片过大");
	return decodeBase64Image(Buffer.from(await response.arrayBuffer()).toString("base64"));
}
async function generateOpenAi(settings, apiKey, prompt, signal, progress) {
	if (apiKey === void 0) throw new Error("请先在 Agent RP 设置中填写图片服务密钥");
	progress(.08, "正在连接 OpenAI Images");
	const response = await fetch(endpoint(settings.openai.endpoint, "/v1/images/generations"), {
		method: "POST",
		signal,
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			model: settings.openai.model,
			prompt,
			n: 1,
			size: settings.openai.size
		})
	});
	const body = await response.text();
	if (!response.ok) throw providerError("OpenAI Images", response.status, body);
	progress(.9, "正在接收图片");
	let value;
	try {
		value = JSON.parse(body);
	} catch {
		throw new Error("OpenAI Images 返回了无法识别的结果");
	}
	const image = value.data?.[0];
	if (typeof image?.b64_json === "string") return decodeBase64Image(image.b64_json);
	if (typeof image?.url === "string") return readRemoteImage(image.url, signal);
	throw new Error("OpenAI Images 没有返回图片");
}
async function generateNovelAi(settings, apiKey, prompt, signal, progress) {
	if (apiKey === void 0) throw new Error("请先在 Agent RP 设置中填写 NovelAI Access Token");
	const value = settings.novelai;
	const seed = Math.floor(Math.random() * 4294967296);
	const parameters = {
		params_version: 3,
		width: value.width,
		height: value.height,
		scale: value.scale,
		sampler: value.sampler,
		steps: value.steps,
		n_samples: 1,
		ucPreset: 3,
		qualityToggle: value.quality,
		sm: value.smea,
		sm_dyn: value.smea && value.smeaDyn,
		dynamic_thresholding: false,
		controlnet_strength: 1,
		legacy: false,
		legacy_uc: false,
		add_original_image: false,
		cfg_rescale: value.cfgRescale,
		noise_schedule: value.noiseSchedule,
		legacy_v3_extend: false,
		prefer_brownian: true,
		deliberate_euler_ancestral_bug: false,
		negative_prompt: value.negativePrompt,
		seed,
		characterPrompts: [],
		reference_image_multiple: [],
		reference_information_extracted_multiple: [],
		reference_strength_multiple: [],
		v4_prompt: {
			caption: {
				base_caption: prompt,
				char_captions: []
			},
			use_coords: false,
			use_order: true
		},
		v4_negative_prompt: {
			caption: {
				base_caption: value.negativePrompt,
				char_captions: []
			},
			legacy_uc: false
		}
	};
	progress(.08, "正在提交 NovelAI V4.5 任务");
	const response = await fetchConnection("NovelAI", endpoint(value.endpoint, "/ai/generate-image"), {
		method: "POST",
		signal,
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: "application/zip",
			"content-type": "application/json"
		},
		body: JSON.stringify({
			input: prompt,
			model: value.model,
			action: "generate",
			parameters,
			use_new_shared_trial: true
		})
	});
	if (!response.ok) throw novelAiError(response.status, await response.text());
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_NOVELAI_ARCHIVE_BYTES) throw new Error("NovelAI 返回的 ZIP 过大");
	progress(.9, "正在解压 NovelAI 图片");
	const archive = new Uint8Array(await response.arrayBuffer());
	if (archive.byteLength < 22 || archive.byteLength > MAX_NOVELAI_ARCHIVE_BYTES) throw new Error("NovelAI 返回了无效大小的 ZIP");
	return extractNovelAiImage(archive);
}
async function pollA1111Progress(base, headers, signal, progress, settled) {
	const url = endpoint(base, "/sdapi/v1/progress");
	url.pathname = url.pathname.replace(/\/sdapi\/v1\/txt2img$/u, "/sdapi/v1/progress");
	while (!settled() && !signal.aborted) {
		await new Promise((resolve) => {
			setTimeout(resolve, 1200).unref();
		});
		if (settled() || signal.aborted) return;
		try {
			const response = await fetch(url, {
				headers,
				signal
			});
			if (!response.ok) continue;
			const value = await response.json();
			if (typeof value.progress === "number" && Number.isFinite(value.progress)) progress(.08 + Math.max(0, Math.min(1, value.progress)) * .84, "Stable Diffusion 正在绘制");
		} catch (error) {
			if (signal.aborted) return;
		}
	}
}
async function interruptA1111(base, headers) {
	try {
		const url = endpoint(base, "/sdapi/v1/interrupt");
		url.pathname = url.pathname.replace(/\/sdapi\/v1\/txt2img$/u, "/sdapi/v1/interrupt");
		await fetch(url, {
			method: "POST",
			headers
		});
	} catch {}
}
async function generateA1111(settings, apiKey, prompt, signal, progress) {
	const headers = { "content-type": "application/json" };
	if (apiKey !== void 0) headers.authorization = `Bearer ${apiKey}`;
	const url = endpoint(settings.a1111.endpoint, "/sdapi/v1/txt2img");
	const body = {
		prompt,
		negative_prompt: settings.a1111.negativePrompt,
		width: settings.a1111.width,
		height: settings.a1111.height,
		steps: settings.a1111.steps,
		cfg_scale: settings.a1111.cfgScale,
		...settings.a1111.sampler.trim() === "" ? {} : { sampler_name: settings.a1111.sampler },
		...settings.a1111.model.trim() === "" ? {} : {
			override_settings: { sd_model_checkpoint: settings.a1111.model },
			override_settings_restore_afterwards: true
		}
	};
	progress(.06, "正在提交 Stable Diffusion 任务");
	let settled = false;
	pollA1111Progress(settings.a1111.endpoint, headers, signal, progress, () => settled);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal
		});
		const text = await response.text();
		if (!response.ok) throw providerError("A1111 / Forge", response.status, text);
		let value;
		try {
			value = JSON.parse(text);
		} catch {
			throw new Error("A1111 / Forge 返回了无法识别的结果");
		}
		const image = value.images?.[0];
		if (typeof image !== "string") throw new Error("A1111 / Forge 没有返回图片");
		progress(.94, "正在保存图片");
		return decodeBase64Image(image);
	} catch (error) {
		if (signal.aborted) await interruptA1111(settings.a1111.endpoint, headers);
		throw error;
	} finally {
		settled = true;
	}
}
function renderComfyWorkflow(settings, prompt) {
	let parsed;
	try {
		parsed = JSON.parse(settings.comfyui.workflow);
	} catch (error) {
		throw new Error("ComfyUI API 工作流不是有效的 JSON", { cause: error });
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("ComfyUI API 工作流必须是节点对象");
	const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
	const replacements = /* @__PURE__ */ new Map([
		["{{prompt}}", prompt],
		["{{negative_prompt}}", settings.comfyui.negativePrompt],
		["{{width}}", settings.comfyui.width],
		["{{height}}", settings.comfyui.height],
		["{{seed}}", seed]
	]);
	let promptUses = 0;
	const replace = (value) => {
		if (typeof value === "string") {
			const exact = replacements.get(value);
			if (exact !== void 0) {
				if (value === "{{prompt}}") promptUses += 1;
				return exact;
			}
			let result = value;
			for (const [token, replacement] of replacements) if (result.includes(token)) {
				if (token === "{{prompt}}") promptUses += 1;
				result = result.replaceAll(token, () => String(replacement));
			}
			return result;
		}
		if (Array.isArray(value)) return value.map(replace);
		if (typeof value !== "object" || value === null) return value;
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
	};
	const workflow = replace(parsed);
	if (promptUses === 0) throw new Error("ComfyUI API 工作流中没有 {{prompt}} 占位符");
	return workflow;
}
function comfyOutput(record) {
	if (typeof record !== "object" || record === null || Array.isArray(record)) return void 0;
	const outputs = record.outputs;
	if (typeof outputs !== "object" || outputs === null || Array.isArray(outputs)) return void 0;
	for (const output of Object.values(outputs)) {
		if (typeof output !== "object" || output === null || Array.isArray(output)) continue;
		const images = output.images;
		if (!Array.isArray(images)) continue;
		for (const image of images) {
			if (typeof image !== "object" || image === null || Array.isArray(image)) continue;
			const value = image;
			if (typeof value.filename === "string" && typeof value.subfolder === "string" && typeof value.type === "string") return {
				filename: value.filename,
				subfolder: value.subfolder,
				type: value.type
			};
		}
	}
}
function comfyFailure(record) {
	if (typeof record !== "object" || record === null || Array.isArray(record)) return void 0;
	const status = record.status;
	if (typeof status !== "object" || status === null || Array.isArray(status)) return void 0;
	const value = status;
	if (value.status_str !== "error" && value.completed !== false) return void 0;
	const detail = JSON.stringify(value.messages ?? value.status_str).slice(0, 800);
	return detail === "" ? "工作流执行失败" : detail;
}
async function wait(ms, signal) {
	await new Promise((resolve, reject) => {
		const completed = () => {
			signal.removeEventListener("abort", aborted);
			resolve();
		};
		const timer = setTimeout(completed, ms);
		timer.unref();
		const aborted = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", aborted);
			reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
		};
		if (signal.aborted) aborted();
		else signal.addEventListener("abort", aborted, { once: true });
	});
}
async function cancelComfyJob(endpointValue, headers, promptId) {
	try {
		const response = await fetch(serviceEndpoint(endpointValue, `/api/jobs/${encodeURIComponent(promptId)}/cancel`), {
			method: "POST",
			headers
		});
		if (response.ok) return;
		await discard(response);
	} catch {}
	try {
		await fetch(serviceEndpoint(endpointValue, "/queue"), {
			method: "POST",
			headers: {
				...headers,
				"content-type": "application/json"
			},
			body: JSON.stringify({ delete: [promptId] })
		});
	} catch {}
}
async function generateComfyUi(settings, apiKey, prompt, signal, progress) {
	const workflow = renderComfyWorkflow(settings, prompt);
	const headers = { accept: "application/json" };
	if (apiKey !== void 0) headers.authorization = `Bearer ${apiKey}`;
	progress(.05, "正在提交 ComfyUI 工作流");
	const response = await fetchConnection("ComfyUI", serviceEndpoint(settings.comfyui.endpoint, "/prompt"), {
		method: "POST",
		signal,
		headers: {
			...headers,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			prompt: workflow,
			client_id: crypto.randomUUID()
		})
	});
	const body = await response.text();
	if (!response.ok) throw providerError("ComfyUI", response.status, body);
	let submitted;
	try {
		submitted = JSON.parse(body);
	} catch {
		throw new Error("ComfyUI 返回了无法识别的任务结果");
	}
	if (typeof submitted.prompt_id !== "string" || submitted.prompt_id === "") throw new Error("ComfyUI 没有返回 prompt_id");
	const promptId = submitted.prompt_id;
	progress(.12, "ComfyUI 已接受任务");
	try {
		for (let attempt = 0;; attempt += 1) {
			const historyResponse = await fetchConnection("ComfyUI", serviceEndpoint(settings.comfyui.endpoint, `/history/${encodeURIComponent(promptId)}`), {
				headers,
				signal
			});
			if (!historyResponse.ok) throw providerError("ComfyUI 历史查询", historyResponse.status, await historyResponse.text());
			const record = (await historyResponse.json())[promptId];
			if (record !== void 0) {
				const failure = comfyFailure(record);
				if (failure !== void 0) throw new Error(`ComfyUI 工作流执行失败：${failure}`);
				const output = comfyOutput(record);
				if (output === void 0) throw new Error("ComfyUI 工作流已结束，但没有返回图片输出");
				progress(.94, "正在保存 ComfyUI 图片");
				const url = serviceEndpoint(settings.comfyui.endpoint, "/view");
				url.searchParams.set("filename", output.filename);
				url.searchParams.set("subfolder", output.subfolder);
				url.searchParams.set("type", output.type);
				const imageResponse = await fetchConnection("ComfyUI 图片", url, {
					headers,
					signal
				});
				if (!imageResponse.ok) throw providerError("ComfyUI 图片下载", imageResponse.status, await imageResponse.text());
				const declared = Number(imageResponse.headers.get("content-length"));
				if (Number.isFinite(declared) && declared > MAX_PROVIDER_IMAGE_BYTES) throw new Error("ComfyUI 返回的图片过大");
				return decodeBase64Image(Buffer.from(await imageResponse.arrayBuffer()).toString("base64"));
			}
			progress(Math.min(.88, .15 + attempt * .025), "ComfyUI 正在绘制");
			await wait(1e3, signal);
		}
	} catch (error) {
		if (signal.aborted) await cancelComfyJob(settings.comfyui.endpoint, headers, promptId);
		throw error;
	}
}
/** Generate one image through the configured provider. */
function generateImage(settings, apiKey, prompt, signal, progress) {
	if (settings.provider === "openai") return generateOpenAi(settings, apiKey, prompt, signal, progress);
	if (settings.provider === "novelai") return generateNovelAi(settings, apiKey, prompt, signal, progress);
	if (settings.provider === "comfyui") return generateComfyUi(settings, apiKey, prompt, signal, progress);
	return generateA1111(settings, apiKey, prompt, signal, progress);
}
const activeJobs = /* @__PURE__ */ new Map();
function abortError(error, signal) {
	return signal.aborted || error instanceof DOMException && error.name === "AbortError" || error instanceof Error && error.name === "AbortError";
}
/** Abort one currently running image job in this Host process. */
function cancelGeneratedImageJob(jobId) {
	const controller = activeJobs.get(jobId);
	if (controller === void 0) return false;
	controller.abort(/* @__PURE__ */ new Error("图片生成已取消"));
	return true;
}
/** Execute a user-requested image command without adding image bytes to model history. */
async function executeImageGenerationCommand(library, settingsStore, credentials, invocation) {
	const request = parseImageGenerationRequest(invocation.rawInput);
	const source = invocation.agent.session.events.at(-1);
	if (source?.type !== "command/run" || source.data.name !== "rp-draw" || String(source.data.commandId) !== String(invocation.commandId)) throw new Error("图片生成命令不是当前 Session 事件");
	const settings = settingsStore.get().imageGeneration;
	library.begin(request, settings.provider);
	const controller = new AbortController();
	const relayAbort = () => {
		controller.abort(invocation.signal.reason);
	};
	invocation.signal.addEventListener("abort", relayAbort, { once: true });
	activeJobs.set(request.jobId, controller);
	try {
		const asset = await generateImage(settings, (await credentials.resolve(credentialRef(imageCredentialRefName(settings.provider))))?.value, request.prompt, controller.signal, (progress, phase) => {
			library.progress(request.jobId, progress, phase);
		});
		return {
			kind: "success",
			text: encodeImageGenerationRecord(library.complete(request.jobId, asset))
		};
	} catch (error) {
		if (abortError(error, controller.signal)) {
			library.cancelled(request.jobId);
			throw new Error("图片生成已取消");
		}
		const message = error instanceof Error ? error.message : String(error);
		library.fail(request.jobId, message);
		throw new Error(message);
	} finally {
		invocation.signal.removeEventListener("abort", relayAbort);
		activeJobs.delete(request.jobId);
	}
}
const MAX_CREDENTIAL_REQUEST_BYTES = 16 * 1024;
const MAX_TEST_REQUEST_BYTES = 512 * 1024;
function requestProvider(request) {
	const value = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("provider") ?? "openai";
	if (!AGENT_RP_IMAGE_PROVIDERS.includes(value)) throw new Error("图片提供方无效");
	return value;
}
function trustedBrowserRequest$3(request, sandboxedImage) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return sandboxedImage && request.headers["sec-fetch-dest"] === "image" && request.headers["sec-fetch-mode"] === "no-cors" && request.headers.origin === void 0;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$3(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJsonRequest(request, limit) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > limit) throw new Error("图片服务请求过大");
		chunks.push(data);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function readCredentialRequest(request) {
	const value = await readJsonRequest(request, MAX_CREDENTIAL_REQUEST_BYTES);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("图片密钥请求无效");
	const record = value;
	if (record.clear === true && record.value === void 0) return { clear: true };
	if (typeof record.value !== "string" || record.value.trim() === "" || record.value.length > 8e3) throw new Error("图片密钥不能为空");
	return { value: record.value.trim() };
}
function parts(request) {
	const pathname = new URL(request.url ?? "/", "http://agent-rp.local").pathname;
	if (pathname === "/api/agent-rp/images") return [];
	if (!pathname.startsWith(`/api/agent-rp/images/`)) return ["invalid"];
	return pathname.slice(21).split("/").map(decodeURIComponent);
}
/** Register job metadata, cancellation, image reads, and write-only credential management. */
function installImageGenerationHttp(ctx, library, credentials, server) {
	ctx.effect(() => server.register({
		kind: "prefix",
		path: AGENT_RP_IMAGE_PATH,
		async handler(request, response) {
			const path = parts(request);
			if (!trustedBrowserRequest$3(request, path.length === 3 && path[0] === "jobs" && path[2] === "asset")) {
				json$3(response, 403, { error: "forbidden" });
				return;
			}
			try {
				if (request.method === "GET" && path.length === 1 && path[0] === "credential") {
					const ref = credentialRef(imageCredentialRefName(requestProvider(request)));
					json$3(response, 200, {
						format: 0,
						credential: await credentials.describe(ref)
					});
					return;
				}
				if (request.method === "PUT" && path.length === 1 && path[0] === "credential") {
					const ref = credentialRef(imageCredentialRefName(requestProvider(request)));
					const change = await readCredentialRequest(request);
					if (change.clear === true) await credentials.unset(ref);
					else await credentials.set(ref, change.value);
					json$3(response, 200, {
						format: 0,
						credential: await credentials.describe(ref)
					});
					return;
				}
				if (request.method === "POST" && path.length === 1 && path[0] === "test") {
					const settings = normalizeImageGenerationSettings(await readJsonRequest(request, MAX_TEST_REQUEST_BYTES));
					const credential = await credentials.resolve(credentialRef(imageCredentialRefName(settings.provider)));
					const timeout = AbortSignal.timeout(12e3);
					json$3(response, 200, {
						format: 0,
						test: await testImageProvider(settings, credential?.value, timeout)
					});
					return;
				}
				if (path.length >= 2 && path[0] === "jobs" && path[1] !== void 0 && !isImageJobId(path[1])) {
					json$3(response, 400, { error: "图片任务 id 无效" });
					return;
				}
				if (request.method === "GET" && path.length === 2 && path[0] === "jobs" && path[1] !== void 0) {
					json$3(response, 200, {
						format: 0,
						job: library.get(path[1])
					});
					return;
				}
				if (request.method === "POST" && path.length === 3 && path[0] === "jobs" && path[1] !== void 0 && path[2] === "cancel") {
					const job = library.get(path[1]);
					const cancelled = cancelGeneratedImageJob(path[1]);
					json$3(response, cancelled ? 202 : 200, {
						format: 0,
						job,
						cancelled
					});
					return;
				}
				if (request.method === "GET" && path.length === 3 && path[0] === "jobs" && path[1] !== void 0 && path[2] === "asset") {
					const asset = library.asset(path[1]);
					const url = new URL(request.url ?? "/", "http://agent-rp.local");
					const extension = asset.mediaType === "image/jpeg" ? "jpg" : asset.mediaType.slice(6);
					const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
					response.writeHead(200, {
						"cache-control": "private, max-age=31536000, immutable",
						"content-disposition": `${disposition}; filename="roleplay-${path[1]}.${extension}"`,
						"content-length": String(asset.data.byteLength),
						"content-security-policy": "default-src 'none'; sandbox",
						"content-type": asset.mediaType,
						"x-content-type-options": "nosniff"
					});
					response.end(asset.data);
					return;
				}
				if (![
					"GET",
					"POST",
					"PUT"
				].includes(request.method ?? "")) {
					response.setHeader("allow", "GET, POST, PUT");
					json$3(response, 405, { error: "method not allowed" });
					return;
				}
				json$3(response, 404, { error: "not found" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json$3(response, /没有找到图片任务/u.test(message) ? 404 : /过大/u.test(message) ? 413 : 400, { error: message });
			}
		}
	}), "agent-rp: image generation HTTP");
}
function textContent(event) {
	if (event.type === "user/message") {
		if (event.data.source.kind !== "user" && event.data.source.kind !== "model") return void 0;
		return event.data.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	}
	if (event.type === "assistant/message") {
		if (event.data.message.source.kind !== "model") return void 0;
		return event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	}
}
function surfaceEntries(agent) {
	return agent.session.surface.nodes.map((seq) => {
		const event = agent.session.events[seq];
		if (event === void 0 || !isSurfaceEvent(event)) throw new Error("current Session surface contains an invalid node");
		return {
			kind: "existing",
			event
		};
	});
}
function visibleMessages(entries) {
	return entries.flatMap((entry, rawIndex) => {
		if (entry.kind !== "existing") return [];
		const text = textContent(entry.event);
		if (text === void 0) return [];
		const role = entry.event.type === "assistant/message" ? "assistant" : "user";
		return [{
			messageId: 0,
			rawIndex,
			event: entry.event,
			role,
			text
		}];
	}).map((message, messageId) => ({
		...message,
		messageId
	}));
}
function assistantCoordinates(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "assistant/message") return {
			turn: event.data.turn,
			step: event.data.step
		};
	}
	return {
		turn: 1,
		step: 1
	};
}
function requireSurfaceEvent(event) {
	if (!isSurfaceEvent(event)) throw new Error("Session did not append the requested surface event");
	return event;
}
function appendEntry(agent, entry, intent) {
	if (entry.kind === "existing") {
		const event = entry.event;
		if (event.type === "user/message") return requireSurfaceEvent(agent.session.append(event.type, event.data, intent));
		if (event.type === "assistant/message") return requireSurfaceEvent(agent.session.append(event.type, event.data, intent));
		return requireSurfaceEvent(agent.session.append(event.type, event.data, intent));
	}
	if (entry.role === "user") return requireSurfaceEvent(agent.session.append("user/message", createUserMessage({
		content: [{
			type: "text",
			text: entry.text
		}],
		source: { kind: "user" }
	}), intent));
	const coordinates = assistantCoordinates(agent.session.events);
	return requireSurfaceEvent(agent.session.append("assistant/message", {
		...coordinates,
		message: createAssistantMessage({
			content: [{
				type: "text",
				text: entry.text
			}],
			source: {
				provider: "dsh-agent-rp",
				model: "tavern-script"
			}
		})
	}, intent));
}
function rewriteSurface(agent, before, after) {
	if (after.length === 0) throw new Error("脚本暂时不能删除角色会话的全部聊天楼层");
	if (before.length === 0) {
		for (const entry of after) appendEntry(agent, entry, { surfaceOp: "append" });
		return;
	}
	const sourceEventSeqs = before.map((entry) => entry.kind === "existing" ? entry.event.seq : -1).filter((seq) => seq >= 0);
	const start = sourceEventSeqs[0];
	const end = sourceEventSeqs.at(-1);
	if (start === void 0 || end === void 0) throw new Error("当前角色会话没有可重写的聊天楼层");
	after.forEach((entry, index) => {
		if (index === 0) {
			appendEntry(agent, entry, {
				surfaceOp: {
					op: "replace",
					start,
					end
				},
				sourceEventSeqs
			});
			return;
		}
		appendEntry(agent, entry, {
			surfaceOp: "append",
			...entry.kind === "existing" ? { sourceEventSeqs: [entry.event.seq] } : {}
		});
	});
}
function empty(record) {
	return record === void 0 || Object.keys(record).length === 0;
}
function selectedText(message, fallback) {
	if (message.swipe_id !== void 0 && message.swipe_id !== 0) throw new Error("当前角色会话还没有酒馆式多回复页，swipe_id 只能是 0");
	if (message.swipes !== void 0) {
		if (message.swipes.length !== 1) throw new Error("当前角色会话还不能由脚本创建多个回复页");
		return message.swipes[0] ?? "";
	}
	return message.message ?? fallback;
}
function selectedData(message) {
	if (message.swipes_data !== void 0) {
		if (message.swipes_data.length !== 1) throw new Error("当前角色会话还不能保存多个回复页的变量");
		return message.data ?? message.swipes_data[0] ?? {};
	}
	return message.data;
}
function validateRepresentable(message) {
	if (message.role === "system") throw new Error("DSH 会话暂时没有可由卡片脚本创建的 system 聊天楼层");
	if (message.is_hidden === true) throw new Error("DSH 会话暂时不能保留但隐藏一条卡片脚本聊天楼层");
	if (!empty(message.extra) || message.swipes_info?.some((info) => !empty(info)) === true) throw new Error("当前角色会话还不能保存聊天楼层的 extra 数据");
	if (message.swipes_info !== void 0 && message.swipes_info.length > 1) throw new Error("当前角色会话还不能保存多个回复页的 extra 数据");
}
function mergeUpdates(messages) {
	const updates = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (message.message_id === void 0) continue;
		updates.set(message.message_id, {
			...updates.get(message.message_id),
			...message
		});
	}
	return [...updates.values()];
}
function setMessages(agent, request, hiddenPrefix) {
	const visible = visibleMessages(surfaceEntries(agent));
	let messageVariables;
	const planned = [];
	for (const update of mergeUpdates(request.messages)) {
		validateRepresentable(update);
		if (update.message_id < hiddenPrefix.length) throw new Error("隐藏楼层恢复后才能修改正文或变量");
		const target = visible[update.message_id - hiddenPrefix.length];
		if (target === void 0) continue;
		const data = selectedData(update);
		if (data !== void 0) {
			if (target.messageId !== visible.length - 1) throw new Error("当前仅支持保存最新楼层的 data 变量");
			messageVariables = data;
		}
		const role = update.role ?? target.role;
		if (role === "system") throw new Error("DSH 会话暂时没有可由卡片脚本创建的 system 聊天楼层");
		const text = selectedText(update, target.text);
		if (role !== target.role || text !== target.text) planned.push({
			target,
			role,
			text
		});
	}
	for (const update of planned) appendEntry(agent, {
		kind: "synthetic",
		role: update.role,
		text: update.text
	}, {
		surfaceOp: {
			op: "replace",
			start: update.target.event.seq,
			end: update.target.event.seq
		},
		sourceEventSeqs: [update.target.event.seq]
	});
	return {
		hiddenPrefix,
		...messageVariables === void 0 ? {} : { messageVariables }
	};
}
function messageEntry(message) {
	validateRepresentable(message);
	if (message.role !== "assistant" && message.role !== "user") throw new Error("新聊天楼层必须指定 user 或 assistant");
	return {
		kind: "synthetic",
		role: message.role,
		text: selectedText(message, "")
	};
}
function blocks(entries) {
	const prefix = [];
	const messages = [];
	for (const entry of entries) if (entry.kind === "synthetic" || textContent(entry.event) !== void 0) messages.push([entry]);
	else (messages.at(-1) ?? prefix).push(entry);
	return {
		prefix,
		messages
	};
}
function boundary(value, length) {
	if (value === "end") return length;
	const normalized = value < 0 ? length + value + 1 : value;
	return Math.min(length, Math.max(0, normalized));
}
function createMessages(agent, request, hiddenPrefix) {
	if (request.messages.length === 0) return { hiddenPrefix };
	const entries = surfaceEntries(agent);
	const current = blocks(entries);
	const canonicalLength = hiddenPrefix.length + current.messages.length;
	const canonicalInsertAt = boundary(request.insertAt, canonicalLength);
	if (canonicalInsertAt < hiddenPrefix.length) throw new Error("不能在隐藏的聊天前缀中间插入楼层");
	const insertAt = canonicalInsertAt - hiddenPrefix.length;
	const created = request.messages.map((message) => [messageEntry(message)]);
	const messageData = request.messages.map(selectedData);
	if (insertAt !== current.messages.length && messageData.some((data) => data !== void 0)) throw new Error("当前仅支持为追加到末尾的脚本聊天楼层保存 data 变量");
	if (insertAt === current.messages.length && messageData.slice(0, -1).some((data) => data !== void 0)) throw new Error("当前仅支持为新建的最新楼层保存 data 变量");
	const nextBlocks = [
		...current.messages.slice(0, insertAt),
		...created,
		...current.messages.slice(insertAt)
	];
	const next = [...current.prefix, ...nextBlocks.flat()];
	if (insertAt === current.messages.length && entries.length > 0) for (const entry of created.flat()) appendEntry(agent, entry, { surfaceOp: "append" });
	else rewriteSurface(agent, entries, next);
	const data = insertAt === current.messages.length ? messageData.at(-1) ?? {} : void 0;
	return {
		hiddenPrefix,
		...data === void 0 ? {} : { messageVariables: data }
	};
}
function deleteMessages(agent, request, hiddenPrefix) {
	const entries = surfaceEntries(agent);
	const current = blocks(entries);
	if (request.messageIds.some((id) => id >= 0 && id < hiddenPrefix.length)) throw new Error("隐藏楼层恢复后才能删除");
	const deleted = new Set(request.messageIds.map((id) => id - hiddenPrefix.length).filter((id) => id >= 0 && id < current.messages.length));
	if (deleted.size === 0) return { hiddenPrefix };
	const remaining = current.messages.filter((_message, index) => !deleted.has(index));
	if (remaining.length === 0) throw new Error("脚本暂时不能删除角色会话的全部聊天楼层");
	rewriteSurface(agent, entries, [...current.prefix, ...remaining.flat()]);
	return deleted.has(current.messages.length - 1) ? {
		hiddenPrefix,
		messageVariables: {}
	} : { hiddenPrefix };
}
function rotateMessages(agent, request, hiddenPrefix) {
	if (hiddenPrefix.length > 0) throw new Error("隐藏楼层恢复后才能调整楼层顺序");
	const entries = surfaceEntries(agent);
	const current = blocks(entries);
	const begin = boundary(request.begin, current.messages.length);
	const end = boundary(request.end, current.messages.length);
	const middle = Math.min(end, Math.max(begin, boundary(request.middle, current.messages.length)));
	if (begin === middle || middle === end) return { hiddenPrefix };
	const rotated = [
		...current.messages.slice(0, begin),
		...current.messages.slice(middle, end),
		...current.messages.slice(begin, middle),
		...current.messages.slice(end)
	];
	rewriteSurface(agent, entries, [...current.prefix, ...rotated.flat()]);
	return {
		hiddenPrefix,
		messageVariables: {}
	};
}
function setHidden(agent, request, hiddenPrefix) {
	const entries = surfaceEntries(agent);
	const current = blocks(entries);
	const visible = visibleMessages(entries);
	const total = hiddenPrefix.length + visible.length;
	if (request.start !== 0 || request.end >= total) throw new Error("当前仅支持从第 0 楼开始隐藏或恢复");
	if (request.hidden) {
		const targetLength = request.end + 1;
		if (targetLength <= hiddenPrefix.length) return { hiddenPrefix };
		const added = targetLength - hiddenPrefix.length;
		if (added >= current.messages.length) throw new Error("至少需要保留一条未隐藏楼层供角色继续对话");
		const nextHidden = [...hiddenPrefix, ...visible.slice(0, added).map((message) => ({
			seq: message.event.seq,
			role: message.role,
			text: message.text
		}))];
		rewriteSurface(agent, entries, [...current.prefix, ...current.messages.slice(added).flat()]);
		return { hiddenPrefix: nextHidden };
	}
	if (hiddenPrefix.length === 0) return { hiddenPrefix };
	if (request.end < hiddenPrefix.length - 1) throw new Error("当前需要一次恢复全部隐藏前缀");
	const restored = hiddenPrefix.map((message) => ({
		kind: "synthetic",
		role: message.role,
		text: message.text
	}));
	rewriteSurface(agent, entries, [
		...current.prefix,
		...restored,
		...current.messages.flat()
	]);
	return { hiddenPrefix: [] };
}
/** Apply one validated Tavern Helper transcript operation to the current Session surface. */
function executeTavernChatMutation(agent, request, hiddenPrefix = []) {
	if (request.operation === "set-chat-messages") return setMessages(agent, request, hiddenPrefix);
	if (request.operation === "create-chat-messages") return createMessages(agent, request, hiddenPrefix);
	if (request.operation === "delete-chat-messages") return deleteMessages(agent, request, hiddenPrefix);
	if (request.operation === "rotate-chat-messages") return rotateMessages(agent, request, hiddenPrefix);
	return setHidden(agent, request, hiddenPrefix);
}
/** Validate and persist one script-authored variable replacement. */
function executeTavernHelperMutation(invocation) {
	const events = invocation.agent.session.events;
	const active = readActiveSessionCharacter(events);
	if (active === void 0) throw new Error("this roleplay Session has no imported Character Card");
	const card = cardFromImportMeta(active.meta);
	const previous = readTavernHelperState(events);
	const characterState = initializeTavernHelperState(card.frontend, active.result.sourceAttachmentId, previous);
	const preset = readActiveSessionPreset(events);
	const initialized = preset === void 0 ? characterState : initializeTavernHelperPresetState(characterState, presetTavernHelperScripts(preset.preset), preset.preset.tavernHelperVariables ?? {}, preset.result.sourceAttachmentId);
	const request = parseTavernHelperMutationRequest(invocation.rawInput);
	const chat = "operation" in request && (request.operation === "set-chat-messages" || request.operation === "create-chat-messages" || request.operation === "delete-chat-messages" || request.operation === "rotate-chat-messages" || request.operation === "set-chat-hidden") ? executeTavernChatMutation(invocation.agent, request, initialized.hiddenPrefix) : void 0;
	const mutated = applyTavernHelperMutation(initialized, request);
	return {
		kind: "success",
		text: encodeTavernHelperState(chat === void 0 ? mutated : {
			...mutated,
			hiddenPrefix: chat.hiddenPrefix,
			...chat.messageVariables === void 0 ? {} : { scopes: {
				...mutated.scopes,
				message: chat.messageVariables
			} }
		})
	};
}
function visibleRole(event) {
	if (event?.type === "user/message" && (event.data.source.kind === "user" || event.data.source.kind === "model")) return "user";
	if (event?.type === "assistant/message" && event.data.message.source.kind === "model") return "assistant";
}
function latestVisibleRole(agent) {
	for (let index = agent.session.surface.nodes.length - 1; index >= 0; index -= 1) {
		const role = visibleRole(agent.session.events[agent.session.surface.nodes[index]]);
		if (role !== void 0) return role;
	}
}
/** Generate one normal character reply to the latest script-created user message. */
async function executeTavernTrigger(invocation) {
	if (invocation.rawInput.trim() !== "") throw new Error("/trigger 不接受额外参数");
	const agent = invocation.agent;
	if (agent.status !== "idle" || agent.inbox.hasPending) throw new Error("请等待当前回复完成后再操作");
	if (latestVisibleRole(agent) !== "user") throw new Error("/trigger 前需要先添加一条用户消息");
	const before = agent.session.seq;
	const onAbort = () => {
		agent.cancel({ kind: "user" });
	};
	invocation.signal.addEventListener("abort", onAbort, { once: true });
	try {
		agent.followup(createUserMessage({
			content: [{
				type: "text",
				text: "Respond to the latest user-authored roleplay message. Output only the in-character response."
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-agent-rp-tavern-trigger",
				form: "notice",
				summary: "正在继续角色回复"
			}
		}));
		await agent.whenIdle();
		invocation.signal.throwIfAborted();
	} finally {
		invocation.signal.removeEventListener("abort", onAbort);
	}
	const generated = agent.session.events.slice(before).findLast((event) => event.type === "assistant/message" && event.surfaceOp === "append");
	const text = generated?.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n").trim();
	if (generated === void 0 || text === "") throw new Error("模型没有生成可用的角色回复");
	return {
		kind: "success",
		text: JSON.stringify({
			format: 0,
			assistantSeq: generated.seq
		})
	};
}
/** Browser-safe request and response values for isolated Tavern Helper generation. */
/** Same-origin endpoint used by approved Tavern Helper scripts. */
const TAVERN_GENERATION_PATH = "/api/dsh-agent-rp/tavern/generate";
/** Same-origin endpoint used to inspect the prompts assembled for one script generation. */
const TAVERN_PROMPT_PREVIEW_PATH = "/api/dsh-agent-rp/tavern/prompt";
/** Same-origin endpoint used to query one user-approved OpenAI-compatible API. */
const TAVERN_MODEL_LIST_PATH = "/api/dsh-agent-rp/tavern/models";
const MAX_REQUEST_BYTES$2 = 512 * 1024;
const MAX_RESPONSE_BYTES$2 = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 256 * 1024;
const MAX_ORDERED_PROMPTS = 256;
const MAX_CUSTOM_FIELD_CHARS = 64 * 1024;
const MAX_CUSTOM_OBJECT_KEYS = 128;
const MAX_CUSTOM_HEADERS = 64;
const PROTECTED_CUSTOM_BODY_KEYS = /* @__PURE__ */ new Set([
	"messages",
	"model",
	"stream"
]);
const FORBIDDEN_CUSTOM_HEADERS = /* @__PURE__ */ new Set([
	"connection",
	"content-length",
	"host",
	"transfer-encoding"
]);
function trustedBrowserRequest$2(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$2(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJson$2(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES$2) throw new Error("酒馆脚本生成请求过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > MAX_REQUEST_BYTES$2) throw new Error("酒馆脚本生成请求过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("酒馆脚本生成请求为空");
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw new Error("酒馆脚本生成请求不是有效 JSON", { cause: error });
	}
}
function object(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`);
	return value;
}
function boundedText(value, label, fallback = "") {
	if (value === void 0) return fallback;
	if (typeof value !== "string") throw new Error(`${label}必须是文本`);
	if (value.length > MAX_TEXT_CHARS) throw new Error(`${label}过长`);
	return value;
}
function prompt(value, label) {
	const record = object(value, label);
	if (record.role !== "system" && record.role !== "user" && record.role !== "assistant") throw new Error(`${label}的 role 无效`);
	return {
		role: record.role,
		content: boundedText(record.content, `${label}的 content`)
	};
}
function promptList(value, label) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.length > MAX_ORDERED_PROMPTS) throw new Error(`${label}无效`);
	return value.map((item, index) => prompt(item, `${label}[${index}]`));
}
function optionalInteger(value, label, maximum) {
	if (value === void 0 || value === "all") return void 0;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label}无效`);
	return value;
}
function optionalNumber(value, label, minimum, maximum) {
	if (value === void 0 || value === "same_as_preset" || value === "unset") return void 0;
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label}无效`);
	return value;
}
function optionalText(value, label, maximum) {
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value.length > maximum) throw new Error(`${label}无效`);
	const result = value.trim();
	return result === "" ? void 0 : result;
}
function customYaml(value, label) {
	if (typeof value !== "string") return value;
	if (value.length > MAX_CUSTOM_FIELD_CHARS) throw new Error(`${label}过长`);
	try {
		return (0, import_dist.parse)(value, { maxAliasCount: 0 });
	} catch (error) {
		throw new Error(`${label}不是有效 JSON 或 YAML`, { cause: error });
	}
}
function safeCustomValue(value, label, depth = 0) {
	if (depth > 12) throw new Error(`${label}嵌套过深`);
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		if (value.length > MAX_CUSTOM_OBJECT_KEYS) throw new Error(`${label}项目过多`);
		return value.map((item, index) => safeCustomValue(item, `${label}[${index}]`, depth + 1));
	}
	if (typeof value !== "object") throw new Error(`${label}包含不支持的值`);
	const entries = Object.entries(value);
	if (entries.length > MAX_CUSTOM_OBJECT_KEYS) throw new Error(`${label}字段过多`);
	return Object.fromEntries(entries.map(([key, item]) => {
		if (key.length > 256 || key === "__proto__" || key === "constructor" || key === "prototype") throw new Error(`${label}包含不安全的字段名`);
		return [key, safeCustomValue(item, `${label}.${key}`, depth + 1)];
	}));
}
function customBody(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const parsed = safeCustomValue(customYaml(value, "custom_api.custom_include_body"), "custom_api.custom_include_body");
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("custom_api.custom_include_body 必须是对象");
	return parsed;
}
function customExclusions(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const parsed = customYaml(value, "custom_api.custom_exclude_body");
	if (!Array.isArray(parsed) || parsed.length > MAX_CUSTOM_OBJECT_KEYS || parsed.some((item) => typeof item !== "string" || item.length > 256)) throw new Error("custom_api.custom_exclude_body 必须是字符串数组");
	return [...new Set(parsed)];
}
function customHeaders(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const parsed = customYaml(value, "custom_api.custom_include_headers");
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("custom_api.custom_include_headers 必须是对象");
	const entries = Object.entries(parsed);
	if (entries.length > MAX_CUSTOM_HEADERS) throw new Error("custom_api.custom_include_headers 字段过多");
	return Object.fromEntries(entries.map(([name, item]) => {
		const normalized = name.toLowerCase();
		if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(name) || FORBIDDEN_CUSTOM_HEADERS.has(normalized)) throw new Error(`custom_api.custom_include_headers 不允许设置 ${JSON.stringify(name)}`);
		if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean" || typeof item === "number" && !Number.isFinite(item)) throw new Error(`custom_api.custom_include_headers.${name} 必须是标量`);
		const text = String(item);
		if (text.length > 8192 || /[\r\n]/u.test(text)) throw new Error(`custom_api.custom_include_headers.${name} 无效`);
		return [name, text];
	}));
}
function parseCustomApi(value) {
	const custom = object(value, "custom_api");
	if (optionalText(custom.proxy_preset, "custom_api.proxy_preset", 512) !== void 0) throw new Error("DSH 无法读取酒馆代理预设；请在脚本中填写 API 地址");
	const apiurl = optionalText(custom.apiurl, "custom_api.apiurl", 2048);
	if (apiurl === void 0) throw new Error("custom_api.apiurl 不能为空");
	tavernChatCompletionsEndpoint(apiurl);
	const key = optionalText(custom.key, "custom_api.key", 8192);
	const model = optionalText(custom.model, "custom_api.model", 512);
	const source = (optionalText(custom.source, "custom_api.source", 64) ?? "openai").toLowerCase();
	if (![
		"custom",
		"deepseek",
		"mistralai",
		"moonshot",
		"openai",
		"openrouter",
		"xai"
	].includes(source)) throw new Error(`custom_api.source ${JSON.stringify(source)} 不是 OpenAI-compatible 来源`);
	const includeBody = customBody(custom.custom_include_body);
	const excludeBody = customExclusions(custom.custom_exclude_body);
	const includeHeaders = customHeaders(custom.custom_include_headers);
	if (custom.top_k !== void 0 && custom.top_k !== "same_as_preset" && custom.top_k !== "unset") throw new Error("custom_api.top_k 尚未开放");
	const maxTokens = optionalNumber(custom.max_tokens, "custom_api.max_tokens", 1, 65536);
	const temperature = optionalNumber(custom.temperature, "custom_api.temperature", 0, 2);
	const topP = optionalNumber(custom.top_p, "custom_api.top_p", 0, 1);
	const frequencyPenalty = optionalNumber(custom.frequency_penalty, "custom_api.frequency_penalty", -2, 2);
	const presencePenalty = optionalNumber(custom.presence_penalty, "custom_api.presence_penalty", -2, 2);
	return {
		apiurl,
		...key === void 0 ? {} : { key },
		...model === void 0 ? {} : { model },
		...maxTokens === void 0 ? {} : { maxTokens },
		...temperature === void 0 ? {} : { temperature },
		...topP === void 0 ? {} : { topP },
		...frequencyPenalty === void 0 ? {} : { frequencyPenalty },
		...presencePenalty === void 0 ? {} : { presencePenalty },
		...includeBody === void 0 ? {} : { includeBody },
		...excludeBody === void 0 ? {} : { excludeBody },
		...includeHeaders === void 0 ? {} : { includeHeaders }
	};
}
function parseConfig(value) {
	const config = object(value, "酒馆脚本生成配置");
	if (config.tools !== void 0 || config.tool_choice !== void 0) throw new Error("酒馆脚本工具调用尚未开放");
	if (config.json_schema !== void 0) throw new Error("酒馆脚本结构化输出尚未开放");
	const orderedPrompts = config.ordered_prompts;
	let parsedOrder;
	if (orderedPrompts !== void 0) {
		if (!Array.isArray(orderedPrompts) || orderedPrompts.length > MAX_ORDERED_PROMPTS) throw new Error("ordered_prompts 无效");
		parsedOrder = orderedPrompts.map((item, index) => typeof item === "string" ? boundedText(item, `ordered_prompts[${index}]`, "") : prompt(item, `ordered_prompts[${index}]`));
	}
	const overrides = config.overrides === void 0 ? void 0 : object(config.overrides, "overrides");
	const overrideSystem = [];
	for (const key of [
		"world_info_before",
		"persona_description",
		"char_description",
		"char_personality",
		"scenario",
		"world_info_after",
		"dialogue_examples"
	]) {
		if (overrides?.[key] === void 0) continue;
		const text = boundedText(overrides[key], `overrides.${key}`);
		overrideSystem.push(`[Tavern Helper override: ${key}]\n${text === "" ? "(empty)" : text}`);
	}
	const overrideChat = overrides?.chat_history === void 0 ? void 0 : object(overrides.chat_history, "overrides.chat_history");
	const maxChatHistory = optionalInteger(config.max_chat_history, "max_chat_history", 2e4);
	const maxTokens = optionalNumber(config.max_tokens, "max_tokens", 1, 65536);
	const temperature = optionalNumber(config.temperature, "temperature", 0, 2);
	const customApi = config.custom_api === void 0 ? void 0 : parseCustomApi(config.custom_api);
	return {
		userInput: boundedText(config.user_input, "user_input"),
		shouldStream: config.should_stream === true,
		...maxChatHistory === void 0 ? {} : { maxChatHistory },
		...maxTokens === void 0 ? {} : { maxTokens },
		...temperature === void 0 ? {} : { temperature },
		...customApi === void 0 ? {} : { customApi },
		...parsedOrder === void 0 ? {} : { orderedPrompts: parsedOrder },
		injects: promptList(config.injects, "injects"),
		overrideSystem,
		...overrideChat?.prompts === void 0 ? {} : { overrideHistory: promptList(overrideChat.prompts, "overrides.chat_history.prompts") }
	};
}
/** Resolve a Tavern Helper API address to its OpenAI-compatible chat-completions endpoint. */
function tavernChatCompletionsEndpoint(value) {
	let result;
	try {
		result = new URL(value.trim());
	} catch (error) {
		throw new Error("API 地址无效", { cause: error });
	}
	if (result.protocol !== "http:" && result.protocol !== "https:") throw new Error("API 地址只支持 HTTP 或 HTTPS");
	if (result.username !== "" || result.password !== "") throw new Error("API 地址不能包含账号或密码");
	result.hash = "";
	result.search = "";
	if (/\/models\/?$/u.test(result.pathname)) result.pathname = result.pathname.replace(/\/models\/?$/u, "/chat/completions");
	else if (!/\/chat\/completions\/?$/u.test(result.pathname)) result.pathname = `${result.pathname.replace(/\/$/u, "")}/chat/completions`;
	return result;
}
function modelMessageText(message) {
	return message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
}
function openAiPrompts(input) {
	return [...input.system === void 0 ? [] : [{
		role: "system",
		content: input.system
	}], ...input.messages.flatMap((message) => message.role === "system" || message.role === "user" || message.role === "assistant" ? [{
		role: message.role,
		content: modelMessageText(message)
	}] : [])];
}
function responseError(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const error = value.error;
	if (typeof error === "string") return error.slice(0, 1024);
	if (typeof error !== "object" || error === null || Array.isArray(error)) return void 0;
	const message = error.message;
	return typeof message === "string" ? message.slice(0, 1024) : void 0;
}
function responseText(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("自定义模型返回了无法识别的结果");
	const choices = value.choices;
	if (!Array.isArray(choices) || choices.length === 0) throw new Error("自定义模型返回了无法识别的结果");
	const choice = choices[0];
	if (typeof choice !== "object" || choice === null || Array.isArray(choice)) throw new Error("自定义模型返回了无法识别的结果");
	const record = choice;
	const content = (typeof record.message === "object" && record.message !== null && !Array.isArray(record.message) ? record.message : void 0)?.content ?? record.text;
	if (typeof content === "string" && content !== "") return content;
	if (Array.isArray(content)) {
		const text = content.flatMap((item) => {
			if (typeof item === "string") return [item];
			if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
			const part = item;
			return typeof part.text === "string" ? [part.text] : [];
		}).join("");
		if (text !== "") return text;
	}
	throw new Error("自定义模型没有返回文本");
}
function mergeCustomBody(target, source, topLevel = true) {
	for (const [key, value] of Object.entries(source)) {
		if (topLevel && PROTECTED_CUSTOM_BODY_KEYS.has(key)) continue;
		const current = target[key];
		if (typeof current === "object" && current !== null && !Array.isArray(current) && typeof value === "object" && value !== null && !Array.isArray(value)) mergeCustomBody(current, value, false);
		else target[key] = value;
	}
}
async function customGeneration(input, custom, fallbackModel, signal) {
	const model = custom.model ?? fallbackModel;
	if (model === void 0 || model.trim() === "") throw new Error("custom_api.model 不能为空");
	const endpoint = tavernChatCompletionsEndpoint(custom.apiurl);
	const requestBody = {
		model,
		messages: openAiPrompts(input),
		stream: false,
		...custom.maxTokens === void 0 ? {} : { max_tokens: custom.maxTokens },
		...custom.temperature === void 0 ? {} : { temperature: custom.temperature },
		...custom.topP === void 0 ? {} : { top_p: custom.topP },
		...custom.frequencyPenalty === void 0 ? {} : { frequency_penalty: custom.frequencyPenalty },
		...custom.presencePenalty === void 0 ? {} : { presence_penalty: custom.presencePenalty }
	};
	if (custom.includeBody !== void 0) mergeCustomBody(requestBody, custom.includeBody);
	for (const key of custom.excludeBody ?? []) if (!PROTECTED_CUSTOM_BODY_KEYS.has(key)) delete requestBody[key];
	const body = JSON.stringify(requestBody);
	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/json",
		...custom.key === void 0 ? {} : { authorization: `Bearer ${custom.key}` }
	});
	for (const [name, value] of Object.entries(custom.includeHeaders ?? {})) headers.set(name, value);
	let response;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			headers,
			body,
			signal
		});
	} catch (error) {
		throw new Error(signal.aborted ? "自定义模型生成已取消或超时" : "无法连接自定义模型服务", { cause: error });
	}
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES$2) {
		await response.body?.cancel();
		throw new Error("自定义模型返回内容过大");
	}
	const responseBody = await response.text();
	if (Buffer.byteLength(responseBody, "utf8") > MAX_RESPONSE_BYTES$2) throw new Error("自定义模型返回内容过大");
	let value;
	try {
		value = JSON.parse(responseBody);
	} catch (error) {
		if (!response.ok) throw new Error(`自定义模型请求失败（${response.status}）`, { cause: error });
		throw new Error("自定义模型返回了无法识别的结果", { cause: error });
	}
	if (!response.ok) {
		const detail = responseError(value);
		throw new Error(`自定义模型请求失败（${response.status}）${detail === void 0 ? "" : `：${detail}`}`);
	}
	return responseText(value);
}
function parseRequest(value) {
	const request = object(value, "酒馆脚本生成请求");
	if (request.format !== 0 || typeof request.sessionId !== "string" || request.mode !== "preset" && request.mode !== "raw") throw new Error("酒馆脚本生成请求无效");
	return {
		sessionId: SessionId(request.sessionId),
		mode: request.mode,
		config: parseConfig(request.config)
	};
}
function scriptMessage(item) {
	return createMessage({
		role: item.role,
		source: {
			kind: "plugin",
			plugin: "dsh-agent-rp-tavern-helper"
		},
		content: [{
			type: "text",
			text: item.content
		}]
	});
}
function userInput(text) {
	return createUserMessage({
		source: {
			kind: "plugin",
			plugin: "dsh-agent-rp-tavern-helper"
		},
		content: [{
			type: "text",
			text
		}]
	});
}
function dialogueHistory(agent, config) {
	const history = config.overrideHistory?.map(scriptMessage) ?? agent.session.deriveMessages().filter((message) => (message.role === "user" || message.role === "assistant") && (message.source.kind === "user" || message.source.kind === "model"));
	if (config.maxChatHistory === void 0) return history;
	return config.maxChatHistory === 0 ? [] : history.slice(-config.maxChatHistory);
}
function orderedInput(mode, config, system, context, history) {
	const systemParts = [];
	const messages = [];
	const includeBase = () => {
		if (system !== "" && !systemParts.includes(system)) systemParts.push(system);
	};
	const includeContext = () => {
		if (context !== "") messages.push(userInput(context));
	};
	if (mode === "preset" || config.orderedPrompts === void 0) {
		includeBase();
		systemParts.push(...config.overrideSystem);
		messages.push(...history);
		includeContext();
		messages.push(...config.injects.filter((item) => item.role !== "system").map(scriptMessage));
		systemParts.push(...config.injects.filter((item) => item.role === "system").map((item) => item.content));
		if (config.userInput !== "") messages.push(userInput(config.userInput));
	} else {
		for (const item of config.orderedPrompts) if (typeof item !== "string") if (item.role === "system") systemParts.push(item.content);
		else messages.push(scriptMessage(item));
		else if (item.toLowerCase() === "chat_history") messages.push(...history);
		else if (item.toLowerCase() === "user_input") {
			if (config.userInput !== "") messages.push(userInput(config.userInput));
		} else includeBase();
		systemParts.push(...config.overrideSystem);
		systemParts.push(...config.injects.filter((item) => item.role === "system").map((item) => item.content));
		messages.push(...config.injects.filter((item) => item.role !== "system").map(scriptMessage));
		if (systemParts.includes(system)) includeContext();
	}
	const renderedSystem = systemParts.filter(Boolean).join("\n\n");
	return {
		...renderedSystem === "" ? {} : { system: renderedSystem },
		messages
	};
}
async function generationInput(ctx, agent, mode, config, signal) {
	const assembly = await ctx.systemPrompt.assemble({
		scope: agent,
		agent,
		signal
	});
	const input = orderedInput(mode, config, renderPrompt(assembly), renderContextSnapshot(assembly), dialogueHistory(agent, config));
	const messages = injectSillyTavernInChatPrompts(input.messages, tavernInjectedInChatPrompts(readTavernHelperState(agent.session.events)));
	if (messages.length === 0) throw new Error("酒馆脚本没有提供可生成的提示词");
	return {
		...input,
		messages
	};
}
async function generate(ctx, agent, mode, config, signal) {
	const input = await generationInput(ctx, agent, mode, config, signal);
	if (config.customApi !== void 0) return customGeneration(input, config.customApi, agent.options.model, signal);
	const provider = agent.options.provider;
	const model = agent.options.model;
	if (provider === void 0 || model === void 0) throw new Error("当前角色会话还没有可用模型");
	const presetGeneration = readActiveSessionPreset(agent.session.events)?.preset.generation;
	const temperature = config.temperature ?? presetGeneration?.temperature;
	const maxTokens = config.maxTokens ?? presetGeneration?.maxTokens ?? agent.options.maxTokens;
	const options = {
		provider,
		model,
		messages: [...input.messages],
		...input.system === void 0 ? {} : { system: input.system },
		...temperature === void 0 ? {} : { temperature },
		...maxTokens === void 0 ? {} : { maxTokens },
		signal
	};
	const assembler = new BlockAssembler();
	for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);
	if (assembler.finish.kind === "error") throw new Error(assembler.finish.failure.message);
	if (assembler.finish.kind === "aborted") throw new Error("酒馆脚本生成已取消");
	const text = assembler.blocks().flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
	if (text === "") throw new Error("模型没有返回文本");
	return text;
}
/** Run one script generation without mutating the visible roleplay transcript. */
async function runTavernGeneration(ctx, input, requestSignal) {
	const request = parseRequest(input);
	const agents = ctx.get("agents");
	if (agents === void 0) throw new Error("当前 Host 无法读取角色会话");
	const agent = agents.get(request.sessionId);
	if (agent === void 0) throw new Error("当前角色会话不可用");
	return {
		format: 0,
		text: await agent.runMaintenance(async (maintenanceSignal) => {
			const signal = AbortSignal.any([
				maintenanceSignal,
				AbortSignal.timeout(18e4),
				...requestSignal === void 0 ? [] : [requestSignal]
			]);
			return generate(ctx, agent, request.mode, request.config, signal);
		})
	};
}
/** Assemble one script generation request without contacting a model or mutating the transcript. */
async function runTavernPromptPreview(ctx, input, requestSignal) {
	const request = parseRequest(input);
	const agents = ctx.get("agents");
	if (agents === void 0) throw new Error("当前 Host 无法读取角色会话");
	const agent = agents.get(request.sessionId);
	if (agent === void 0) throw new Error("当前角色会话不可用");
	return {
		format: 0,
		prompts: await agent.runMaintenance(async (maintenanceSignal) => {
			const signal = AbortSignal.any([
				maintenanceSignal,
				AbortSignal.timeout(18e4),
				...requestSignal === void 0 ? [] : [requestSignal]
			]);
			return openAiPrompts(await generationInput(ctx, agent, request.mode, request.config, signal));
		})
	};
}
/** Register the current-public-DSH bridge for Tavern Helper generation. */
function installTavernGenerationHttp(ctx, server) {
	ctx.effect(() => server.register({
		kind: "exact",
		path: TAVERN_GENERATION_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$2(request)) {
				json$2(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method !== "POST") {
				response.setHeader("allow", "POST");
				json$2(response, 405, { error: "method not allowed" });
				return;
			}
			const controller = new AbortController();
			const abortRequest = () => {
				controller.abort();
			};
			const abortResponse = () => {
				if (!response.writableEnded) controller.abort();
			};
			request.once("aborted", abortRequest);
			response.once("close", abortResponse);
			try {
				json$2(response, 200, await runTavernGeneration(ctx, await readJson$2(request), controller.signal));
			} catch (error) {
				if (response.destroyed) return;
				const message = error instanceof Error ? error.message : String(error);
				json$2(response, /正在|idle|maintenance/iu.test(message) ? 409 : /过大|过长/iu.test(message) ? 413 : 400, { error: message });
			} finally {
				request.removeListener("aborted", abortRequest);
				response.removeListener("close", abortResponse);
			}
		}
	}), "agent-rp: Tavern Helper generation HTTP");
	ctx.effect(() => server.register({
		kind: "exact",
		path: TAVERN_PROMPT_PREVIEW_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest$2(request)) {
				json$2(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method !== "POST") {
				response.setHeader("allow", "POST");
				json$2(response, 405, { error: "method not allowed" });
				return;
			}
			const controller = new AbortController();
			const abortRequest = () => {
				controller.abort();
			};
			const abortResponse = () => {
				if (!response.writableEnded) controller.abort();
			};
			request.once("aborted", abortRequest);
			response.once("close", abortResponse);
			try {
				json$2(response, 200, await runTavernPromptPreview(ctx, await readJson$2(request), controller.signal));
			} catch (error) {
				if (response.destroyed) return;
				const message = error instanceof Error ? error.message : String(error);
				json$2(response, /正在|idle|maintenance/iu.test(message) ? 409 : /过大|过长/iu.test(message) ? 413 : 400, { error: message });
			} finally {
				request.removeListener("aborted", abortRequest);
				response.removeListener("close", abortResponse);
			}
		}
	}), "agent-rp: Tavern Helper prompt preview HTTP");
}
const MAX_REQUEST_BYTES$1 = 16 * 1024;
const MAX_RESPONSE_BYTES$1 = 2 * 1024 * 1024;
function trustedBrowserRequest$1(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function json$1(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJson$1(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES$1) throw new Error("模型列表请求过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > MAX_REQUEST_BYTES$1) throw new Error("模型列表请求过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("模型列表请求为空");
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw new Error("模型列表请求不是有效 JSON", { cause: error });
	}
}
function request(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("模型列表请求无效");
	const record = value;
	if (record.format !== 0 || typeof record.apiurl !== "string" || record.apiurl.trim() === "" || record.apiurl.length > 2048 || record.key !== void 0 && (typeof record.key !== "string" || record.key.length > 8192)) throw new Error("模型列表请求无效");
	return {
		format: 0,
		apiurl: record.apiurl.trim(),
		...record.key === void 0 ? {} : { key: record.key }
	};
}
/** Resolve the OpenAI-compatible model endpoint accepted by Tavern Helper. */
function tavernModelListEndpoint(value) {
	let result;
	try {
		result = new URL(value.trim());
	} catch (error) {
		throw new Error("API 地址无效", { cause: error });
	}
	if (result.protocol !== "http:" && result.protocol !== "https:") throw new Error("API 地址只支持 HTTP 或 HTTPS");
	if (result.username !== "" || result.password !== "") throw new Error("API 地址不能包含账号或密码");
	result.hash = "";
	result.search = "";
	if (/\/chat\/completions\/?$/u.test(result.pathname)) result.pathname = result.pathname.replace(/\/chat\/completions\/?$/u, "/models");
	else if (!/\/models\/?$/u.test(result.pathname)) result.pathname = `${result.pathname.replace(/\/$/u, "")}/models`;
	return result;
}
function modelNames(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("模型服务返回了无法识别的结果");
	const record = value;
	const candidates = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
	return [...new Set(candidates.flatMap((item) => {
		if (typeof item === "string") return item.trim() === "" ? [] : [item.trim()];
		if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
		const entry = item;
		const name = typeof entry.id === "string" ? entry.id : typeof entry.name === "string" ? entry.name : "";
		return name.trim() === "" ? [] : [name.trim()];
	}))].sort();
}
/** Query one approved model endpoint without retaining its API key. */
async function fetchTavernModelList(input, signal = AbortSignal.timeout(15e3)) {
	const parsed = request(input);
	const endpoint = tavernModelListEndpoint(parsed.apiurl);
	let response;
	try {
		response = await fetch(endpoint, {
			headers: {
				accept: "application/json",
				...parsed.key === void 0 || parsed.key === "" ? {} : { authorization: `Bearer ${parsed.key}` }
			},
			signal
		});
	} catch (error) {
		throw new Error(signal.aborted ? "模型服务连接超时" : "无法连接模型服务", { cause: error });
	}
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES$1) {
		await response.body?.cancel();
		throw new Error("模型服务返回内容过大");
	}
	const body = await response.text();
	if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES$1) throw new Error("模型服务返回内容过大");
	if (!response.ok) throw new Error(`模型服务请求失败（${response.status}）`);
	let value;
	try {
		value = JSON.parse(body);
	} catch (error) {
		throw new Error("模型服务返回了无法识别的结果", { cause: error });
	}
	return {
		format: 0,
		models: modelNames(value)
	};
}
/** Register the model-list bridge used after an explicit per-script origin approval. */
function installTavernModelListHttp(ctx, server) {
	ctx.effect(() => server.register({
		kind: "exact",
		path: TAVERN_MODEL_LIST_PATH,
		async handler(incoming, response) {
			if (!trustedBrowserRequest$1(incoming)) {
				json$1(response, 403, { error: "forbidden" });
				return;
			}
			if (incoming.method !== "POST") {
				response.setHeader("allow", "POST");
				json$1(response, 405, { error: "method not allowed" });
				return;
			}
			try {
				json$1(response, 200, await fetchTavernModelList(await readJson$1(incoming)));
			} catch (error) {
				json$1(response, 400, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "agent-rp: Tavern Helper model list HTTP");
}
/** Browser-to-Host protocol for copying Agent RP assets into a local modular RP distribution. */
/** Same-origin Agent RP endpoint that proxies only to a loopback RP distribution. */
const RP_DISTRIBUTION_BRIDGE_PATH = "/api/agent-rp/rp-distribution";
/** Agent RP library asset kinds supported by the first interoperability bridge. */
const RP_DISTRIBUTION_ASSET_KINDS = [
	"character",
	"preset",
	"persona",
	"world-info"
];
/** Narrow HTTP interoperability client for the community dsh-rp-distribution API. */
const RP_API_PATH = "/api/rp/v1";
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 3e4;
function record(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}响应不是对象`);
	return value;
}
function loopbackHostname(hostname) {
	const normalized = hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, "");
	if (normalized === "localhost" || normalized === "::1") return true;
	const octets = normalized.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
}
/** Normalize a target origin while preventing library data from being sent off-device. */
function normalizeRpDistributionTarget(value) {
	let target;
	try {
		target = new URL(value.trim());
	} catch {
		throw new Error("模块化 RP 地址无效");
	}
	if (target.protocol !== "http:" && target.protocol !== "https:" || !loopbackHostname(target.hostname) || target.username !== "" || target.password !== "" || target.search !== "" || target.hash !== "") throw new Error("模块化 RP 地址必须是这台电脑上的 localhost 或 127.0.0.1 HTTP 地址");
	target.pathname = target.pathname.replace(/\/+$/u, "");
	return target.toString().replace(/\/$/u, "");
}
function apiUrl(target, path) {
	return `${normalizeRpDistributionTarget(target)}${RP_API_PATH}${path}`;
}
async function responseJson(response, label) {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error(`${label}响应过大`);
	const source = await response.text();
	if (new TextEncoder().encode(source).byteLength > MAX_RESPONSE_BYTES) throw new Error(`${label}响应过大`);
	let value;
	try {
		value = JSON.parse(source);
	} catch {
		throw new Error(`${label}返回了无法识别的响应`);
	}
	if (!response.ok) {
		const result = record(value, label);
		const message = typeof result.error === "string" ? result.error : record(result.error ?? {}, label).message;
		throw new Error(typeof message === "string" && message.trim() !== "" ? message : `${label}失败（${response.status}）`);
	}
	return value;
}
async function requestJson(fetcher, target, path, label, body) {
	return responseJson(await fetcher(apiUrl(target, path), {
		method: body === void 0 ? "GET" : "POST",
		headers: body === void 0 ? { accept: "application/json" } : {
			accept: "application/json",
			"content-type": "application/json"
		},
		...body === void 0 ? {} : { body: JSON.stringify(body) },
		redirect: "error",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	}), label);
}
/** Verify that a loopback server exposes the modular RP catalog API. */
async function probeRpDistribution(target, fetcher = fetch) {
	const normalized = normalizeRpDistributionTarget(target);
	const [catalogValue, libraryValue, presetValue] = await Promise.all([
		requestJson(fetcher, normalized, "/catalog", "模块化 RP"),
		requestJson(fetcher, normalized, "/library", "模块化 RP 资产库"),
		requestJson(fetcher, normalized, "/presets", "模块化 RP 预设库")
	]);
	const catalog = record(catalogValue, "模块化 RP");
	const library = record(libraryValue, "模块化 RP 资产库");
	const presets = record(presetValue, "模块化 RP 预设库");
	if (catalog.schemaVersion !== 1 || typeof catalog.generatedAt !== "number" || !Array.isArray(catalog.experiences) || !Array.isArray(catalog.components) || !Array.isArray(catalog.capabilities)) throw new Error("目标没有返回兼容的模块化 RP catalog");
	if (library.schemaVersion !== 1 || presets.schemaVersion !== 1) throw new Error("目标没有返回兼容的模块化 RP 资产目录");
	return {
		target: normalized,
		generatedAt: catalog.generatedAt,
		experienceCount: catalog.experiences.length,
		componentCount: catalog.components.length,
		capabilityCount: catalog.capabilities.length,
		remoteAssets: {
			characters: assetSummaries(library.characters, "模块化 RP 角色卡"),
			presets: assetSummaries(presets.presets, "模块化 RP 预设"),
			personas: assetSummaries(library.personas, "模块化 RP Persona"),
			worldInfos: assetSummaries(library.lorebooks, "模块化 RP 世界书")
		}
	};
}
function compatibilityDifferenceCount(value) {
	const imported = record(value, "模块化 RP 导入");
	if (!Array.isArray(imported.lossReports)) throw new Error("模块化 RP 导入响应缺少兼容性报告");
	let count = 0;
	for (const entry of imported.lossReports) {
		const report = record(record(entry, "模块化 RP 兼容性报告").report, "模块化 RP 兼容性报告");
		if (!Array.isArray(report.items)) throw new Error("模块化 RP 兼容性报告字段无效");
		count += report.items.length;
	}
	return count;
}
function string(value, label) {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${label}字段无效`);
	return value;
}
function records(value, label) {
	if (!Array.isArray(value)) throw new Error(`${label}字段无效`);
	return value.map((entry, index) => record(entry, `${label}[${index}]`));
}
function assetSummaries(value, label) {
	return records(value, label).map((entry, index) => ({
		id: string(entry.id, `${label}[${index}].id`),
		name: string(entry.name, `${label}[${index}].name`)
	}));
}
function portableKind(kind) {
	if (kind === "character") return {
		queryKind: "character",
		sourceKind: "character-card-json"
	};
	if (kind === "world-info") return {
		queryKind: "lore",
		sourceKind: "world-info"
	};
	return {
		queryKind: kind,
		sourceKind: kind
	};
}
/** Read one exact retained JSON source from a compatible modular RP runtime. */
async function readRpDistributionSource(target, kind, id, fetcher = fetch) {
	const normalized = normalizeRpDistributionTarget(target);
	const sourceId = id.trim();
	if (sourceId === "" || sourceId.length > 512) throw new Error("模块化 RP 资产编号无效");
	const expected = portableKind(kind);
	const response = await fetcher(apiUrl(normalized, `/source?kind=${expected.queryKind}&id=${encodeURIComponent(sourceId)}`), {
		method: "GET",
		headers: { accept: "application/json" },
		redirect: "error",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (response.status === 404 || response.status === 405) throw new Error("目标版本尚未提供可移植来源接口；请更新 dsh-rp-distribution 后重试");
	const value = record(await responseJson(response, "模块化 RP 来源"), "模块化 RP 来源");
	if (value.schemaVersion !== 1 || value.kind !== expected.sourceKind || value.id !== sourceId || typeof value.source !== "string" || typeof value.sourceId !== "string" || value.sourceId.trim() === "") throw new Error("模块化 RP 返回了不兼容的可移植来源");
	return {
		target: normalized,
		kind: expected.sourceKind,
		id: sourceId,
		sourceId: value.sourceId,
		source: value.source
	};
}
function activeName(catalog, activeKey, collectionKey) {
	const ids = record(catalog.active, "模块化 RP 会话资产")[activeKey];
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("模块化 RP 会话资产字段无效");
	const selected = ids[0];
	if (selected === void 0) return void 0;
	const entry = records(catalog[collectionKey], `模块化 RP ${collectionKey}`).find((candidate) => candidate.id === selected);
	return entry === void 0 ? void 0 : string(entry.name, `模块化 RP ${collectionKey} 名称`);
}
function renderedInput(value) {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const text = value.text;
		if (typeof text === "string") return text;
	}
	const rendered = JSON.stringify(value);
	if (rendered === void 0) throw new Error("模块化 RP 会话包含无法迁移的输入");
	return rendered;
}
function portableFilename(characterName, sessionId) {
	return `${`${characterName}-${sessionId}`.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/gu, "").slice(0, 220) || "模块化-RP-会话"}.jsonl`;
}
/** Read one live modular RP timeline and serialize it without invoking either model runtime. */
async function exportRpDistributionChat(target, sessionId, fetcher = fetch) {
	const normalized = normalizeRpDistributionTarget(target);
	const sourceSessionId = sessionId.trim();
	if (sourceSessionId === "" || sourceSessionId.length > 512) throw new Error("模块化 RP 会话编号无效");
	const [timelineValue, libraryValue] = await Promise.all([requestJson(fetcher, normalized, "/timeline", "模块化 RP 会话", { sessionId: sourceSessionId }), requestJson(fetcher, normalized, `/library?sessionId=${encodeURIComponent(sourceSessionId)}`, "模块化 RP 会话资产")]);
	const timeline = record(timelineValue, "模块化 RP 会话");
	const library = record(libraryValue, "模块化 RP 会话资产");
	if (timeline.sessionId !== sourceSessionId || library.schemaVersion !== 1 || library.sessionId !== sourceSessionId) throw new Error("模块化 RP 返回了其他会话的数据");
	const history = records(record(timeline.projection, "模块化 RP 会话投影").history, "模块化 RP 会话历史");
	const characterName = activeName(library, "characterIds", "characters") ?? "模块化 RP";
	const userName = activeName(library, "personaIds", "personas") ?? "User";
	const rows = [{
		user_name: userName,
		character_name: characterName,
		create_date: (/* @__PURE__ */ new Date()).toISOString(),
		chat_metadata: {
			imported_from: "dsh-rp-distribution",
			source_session_id: sourceSessionId
		}
	}];
	for (const [index, value] of history.entries()) {
		const turnId = string(value.turnId, `模块化 RP 会话历史[${index}].turnId`);
		const assistantMessage = string(value.assistantMessage, `模块化 RP 会话历史[${index}].assistantMessage`);
		const committedAt = value.committedAt;
		if (typeof committedAt !== "number" || !Number.isFinite(committedAt) || committedAt < 0) throw new Error(`模块化 RP 会话历史[${index}].committedAt字段无效`);
		const committedDate = new Date(committedAt);
		if (Number.isNaN(committedDate.getTime())) throw new Error(`模块化 RP 会话历史[${index}].committedAt字段无效`);
		const sendDate = committedDate.toISOString();
		const extra = {
			dsh_rp_turn_id: turnId,
			imported_from: "dsh-rp-distribution"
		};
		rows.push({
			name: userName,
			is_user: true,
			is_system: false,
			mes: renderedInput(value.input),
			send_date: sendDate,
			extra
		});
		rows.push({
			name: characterName,
			is_user: false,
			is_system: false,
			mes: assistantMessage,
			send_date: sendDate,
			extra
		});
	}
	return {
		target: normalized,
		sourceSessionId,
		filename: portableFilename(characterName, sourceSessionId),
		source: `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
		messageCount: history.length * 2,
		characterName,
		userName
	};
}
/** Import one original asset, retain its loss report, and save it into the target library. */
async function transferToRpDistribution(target, payload, fetcher = fetch) {
	const normalized = normalizeRpDistributionTarget(target);
	const differenceCount = compatibilityDifferenceCount(await requestJson(fetcher, normalized, "/import", "模块化 RP 导入", payload));
	const saveRequest = payload.kind === "preset" ? {
		action: "save",
		source: payload.source,
		sourceId: payload.sourceId
	} : {
		action: "save",
		...payload
	};
	const saved = record(await requestJson(fetcher, normalized, payload.kind === "preset" ? "/presets" : "/library", "模块化 RP 保存", saveRequest), "模块化 RP 保存");
	const savedIds = payload.kind === "preset" ? typeof saved.presetId === "string" ? [saved.presetId] : [] : Array.isArray(saved.assetIds) && saved.assetIds.every((id) => typeof id === "string") ? saved.assetIds : [];
	if (savedIds.length === 0) throw new Error("模块化 RP 保存响应没有返回资产 id");
	return {
		target: normalized,
		savedIds,
		compatibilityDifferenceCount: differenceCount
	};
}
const MAX_REQUEST_BYTES = 16 * 1024;
function trustedBrowserRequest(request) {
	const host = request.headers.host;
	if (host === void 0 || host.trim() === "" || request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
function chatImportRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const request = value;
	if (request.operation !== "import-chat") return void 0;
	if (request.format !== 0 || typeof request.target !== "string" || typeof request.sessionId !== "string" || Object.keys(request).some((key) => ![
		"format",
		"operation",
		"target",
		"sessionId"
	].includes(key))) throw new Error("RP 会话迁移请求字段无效");
	return request;
}
function assetImportRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const request = value;
	if (request.operation !== "import-asset") return void 0;
	if (request.format !== 0 || typeof request.target !== "string" || typeof request.id !== "string" || !RP_DISTRIBUTION_ASSET_KINDS.includes(request.kind) || Object.keys(request).some((key) => ![
		"format",
		"operation",
		"target",
		"kind",
		"id"
	].includes(key))) throw new Error("RP 资产迁移请求字段无效");
	return request;
}
function json(response, status, value) {
	const body = Buffer.from(JSON.stringify(value), "utf8");
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": String(body.byteLength),
		"content-type": "application/json; charset=utf-8"
	});
	response.end(body);
}
async function readJson(request) {
	const declared = Number(request.headers["content-length"]);
	if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error("RP 互通请求过大");
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		const data = Buffer.from(chunk);
		bytes += data.byteLength;
		if (bytes > MAX_REQUEST_BYTES) throw new Error("RP 互通请求过大");
		chunks.push(data);
	}
	if (bytes === 0) throw new Error("RP 互通请求为空");
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function transferRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("RP 互通请求不是对象");
	const request = value;
	if (request.format !== 0 || typeof request.target !== "string" || typeof request.id !== "string" || !RP_DISTRIBUTION_ASSET_KINDS.includes(request.kind) || Object.keys(request).some((key) => ![
		"format",
		"target",
		"kind",
		"id"
	].includes(key))) throw new Error("RP 互通请求字段无效");
	return request;
}
function characterPayload(library, id) {
	const asset = library.asset(id);
	if (asset.summary.transport === "json") {
		let source;
		try {
			source = new TextDecoder("utf-8", { fatal: true }).decode(asset.data);
		} catch (error) {
			throw new Error("角色卡 JSON 不是 UTF-8 文本", { cause: error });
		}
		return {
			kind: "character-card-json",
			source,
			sourceId: asset.originalFilename
		};
	}
	return {
		kind: asset.summary.transport === "png" ? "character-card-png" : "character-card-charx",
		base64: Buffer.from(asset.data).toString("base64"),
		sourceId: asset.originalFilename
	};
}
function payloadFor(request, characterLibrary, presetLibrary, personaLibrary, worldInfoLibrary) {
	if (request.kind === "character") return characterPayload(characterLibrary, request.id);
	if (request.kind === "preset") {
		const entry = presetLibrary.get(request.id);
		return {
			kind: "preset",
			source: exportSillyTavernPresetJson(entry.preset),
			sourceId: `${entry.name}.json`
		};
	}
	if (request.kind === "world-info") {
		const asset = worldInfoLibrary.asset(request.id);
		let source;
		try {
			source = new TextDecoder("utf-8", { fatal: true }).decode(asset.data);
		} catch (error) {
			throw new Error("世界书 JSON 不是 UTF-8 文本", { cause: error });
		}
		return {
			kind: "world-info",
			source,
			sourceId: asset.filename
		};
	}
	const entry = personaLibrary.get(request.id);
	return {
		kind: "persona",
		source: JSON.stringify({
			name: entry.name,
			description: entry.description
		}),
		sourceId: `${entry.name}.json`
	};
}
function jsonFilename(sourceId, fallback) {
	const name = basename(sourceId.trim()).slice(0, 240);
	if (name === "") return fallback;
	return /\.json$/iu.test(name) ? name : `${name}.json`;
}
function personaSource(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error("模块化 RP Persona 来源不是 JSON", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("模块化 RP Persona 来源不是对象");
	const entry = value;
	if (typeof entry.name !== "string" || typeof entry.description !== "string") throw new Error("模块化 RP Persona 来源字段无效");
	return {
		format: 0,
		name: entry.name,
		description: entry.description
	};
}
/** Copy one retained remote JSON source through the receiving Agent RP library parser. */
async function receiveRpDistributionAsset(request, characterLibrary, presetLibrary, personaLibrary, worldInfoLibrary, fetcher = fetch) {
	const portable = await readRpDistributionSource(request.target, request.kind, request.id, fetcher);
	const data = new TextEncoder().encode(portable.source);
	if (request.kind === "character") {
		const entry = characterLibrary.importFile({
			data,
			filename: jsonFilename(portable.sourceId, "character.json"),
			mediaType: "application/json"
		});
		return {
			target: portable.target,
			savedId: entry.id,
			name: entry.displayName
		};
	}
	if (request.kind === "preset") {
		const preset = parseSillyTavernPresetBytes(data, jsonFilename(portable.sourceId, "preset.json"));
		const entry = presetLibrary.import(preset);
		return {
			target: portable.target,
			savedId: entry.id,
			name: entry.name
		};
	}
	if (request.kind === "persona") {
		const entry = personaLibrary.save(personaSource(portable.source));
		return {
			target: portable.target,
			savedId: entry.id,
			name: entry.name
		};
	}
	const upload = worldInfoLibrary.importFile({
		data,
		filename: jsonFilename(portable.sourceId, "world-info.json")
	});
	return {
		target: portable.target,
		savedId: upload.id,
		name: upload.name
	};
}
/** Register the loopback-only bridge used by the RP interoperability settings page. */
function installRpDistributionBridgeHttp(ctx, characterLibrary, presetLibrary, personaLibrary, worldInfoLibrary, chatLibrary, server) {
	ctx.effect(() => server.register({
		kind: "exact",
		path: RP_DISTRIBUTION_BRIDGE_PATH,
		async handler(request, response) {
			if (!trustedBrowserRequest(request)) {
				json(response, 403, { error: "forbidden" });
				return;
			}
			try {
				if (request.method === "GET") {
					const target = new URL(request.url ?? "/", "http://agent-rp.local").searchParams.get("target");
					if (target === null) throw new Error("缺少模块化 RP 地址");
					json(response, 200, {
						format: 0,
						...await probeRpDistribution(target)
					});
					return;
				}
				if (request.method === "POST") {
					const value = await readJson(request);
					const chat = chatImportRequest(value);
					if (chat !== void 0) {
						const exported = await exportRpDistributionChat(chat.target, chat.sessionId);
						const upload = chatLibrary.importFile({
							data: new TextEncoder().encode(exported.source),
							filename: exported.filename
						});
						json(response, 200, {
							format: 0,
							operation: "import-chat",
							target: exported.target,
							sourceSessionId: exported.sourceSessionId,
							importId: upload.id,
							filename: upload.name,
							messageCount: upload.messageCount,
							characterName: exported.characterName,
							userName: exported.userName
						});
						return;
					}
					const asset = assetImportRequest(value);
					if (asset !== void 0) {
						const imported = await receiveRpDistributionAsset(asset, characterLibrary, presetLibrary, personaLibrary, worldInfoLibrary);
						json(response, 200, {
							format: 0,
							operation: "import-asset",
							target: imported.target,
							kind: asset.kind,
							sourceId: asset.id,
							savedId: imported.savedId,
							name: imported.name
						});
						return;
					}
					const input = transferRequest(value);
					const result = await transferToRpDistribution(input.target, payloadFor(input, characterLibrary, presetLibrary, personaLibrary, worldInfoLibrary));
					json(response, 200, {
						format: 0,
						target: result.target,
						kind: input.kind,
						sourceId: input.id,
						savedIds: result.savedIds,
						compatibilityDifferenceCount: result.compatibilityDifferenceCount
					});
					return;
				}
				response.setHeader("allow", "GET, POST");
				json(response, 405, { error: "method not allowed" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				json(response, /过大/u.test(message) ? 413 : /中没有/u.test(message) ? 404 : 400, { error: message });
			}
		}
	}), "agent-rp: modular RP bridge HTTP");
}
/** Cordis plugin identity. */
const name = "dsh-agent-rp";
const inject = [
	"attachments",
	"commands",
	"credentials",
	"llm",
	"systemPrompt",
	"tools"
];
function decodeCharacterCardAttachment(attachment, data) {
	if (isCharxCharacterCardAttachment(attachment)) return {
		card: parseCharx(data).card,
		transport: { transport: "charx" }
	};
	if (isJsonCharacterCardAttachment(attachment)) return {
		card: parseCharacterCardJsonBytes(data),
		transport: { transport: "json" }
	};
	const payload = readCharacterCardPng(data);
	return {
		card: parseCharacterCardJson(payload.json),
		transport: {
			transport: "png",
			metadataKeyword: payload.keyword
		}
	};
}
function isCharacterCardOffer(part) {
	return part.type === "image" ? part.mediaType === "image/png" : part.type === "file" && /\.(?:json|charx)$/iu.test(part.name);
}
function isWorldInfoRequest(text) {
	return /(?:世界书|世界信息|world\s*info|lorebook)/iu.test(text) && /(?:导入|加载|使用|接入)/u.test(text);
}
function isPresetRequest(text) {
	return /(?:预设|preset)/iu.test(text) && /(?:导入|加载|使用|接入)/u.test(text);
}
/** Recognize one preset attachment before opening a model turn. */
function isSillyTavernPresetOffer(agentRpActive, content) {
	if (!agentRpActive) return false;
	const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	const attachments = content.filter((part) => part.type !== "text");
	return isPresetRequest(text) && attachments.length === 1 && attachments[0]?.type === "file" && /\.json$/iu.test(attachments[0].name);
}
/** Recognize one explicit Character Card import without exposing attachment bytes to the model. */
function claimAgentRpPrompt(agentRpActive, content) {
	if (!agentRpActive) return void 0;
	const attachments = content.filter((part) => part.type !== "text");
	const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	if (isWorldInfoRequest(text)) return attachments.filter((part) => part.type === "file" && /\.json$/iu.test(part.name)).length === 1 ? { text } : void 0;
	if (isPresetRequest(text)) return attachments.filter((part) => part.type === "file" && /\.json$/iu.test(part.name)).length === 1 ? { text } : void 0;
	if (attachments.filter(isCharacterCardOffer).length !== 1 || !/(?:角色卡|character\s*card|导入|接管|切换角色)/iu.test(text)) return void 0;
	return { text };
}
/** Recognize one standalone SillyTavern JSONL chat upload. */
function isSillyTavernChatOffer(agentRpActive, content) {
	if (!agentRpActive) return false;
	const attachments = content.filter((part) => part.type !== "text");
	return attachments.length === 1 && attachments[0]?.type === "file" && /\.jsonl$/iu.test(attachments[0].name);
}
/** Recognize one Character Card and one JSONL chat submitted together. */
function isSillyTavernMigrationOffer(agentRpActive, content) {
	if (!agentRpActive) return false;
	const attachments = content.filter((part) => part.type !== "text");
	return attachments.length === 2 && attachments.filter(isCharacterCardOffer).length === 1 && attachments.filter((part) => part.type === "file" && /\.jsonl$/iu.test(part.name)).length === 1;
}
/** Recognize one explicitly selected standalone Character Card import. */
function isCharacterCardSessionOffer(agentRpActive, content) {
	if (!agentRpActive) return false;
	const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	const attachments = content.filter((part) => part.type !== "text");
	return parseCharacterCardSessionRequest(text) !== void 0 && attachments.length === 1 && attachments[0] !== void 0 && isCharacterCardOffer(attachments[0]);
}
/** Parse a legacy direct import or an explicit character-library launch. */
function parseCharacterCardSessionRequest(text) {
	const source = text.trim();
	if (source === "请导入这张角色卡") return {
		format: 0,
		greetingIndex: 0
	};
	if (!source.startsWith(`请从角色库开始新会话\n`)) return void 0;
	let value;
	try {
		value = JSON.parse(source.slice(11));
	} catch {
		return;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	const keys = Object.keys(record);
	if (record.format !== 0 || typeof record.greetingIndex !== "number" || !Number.isSafeInteger(record.greetingIndex) || record.greetingIndex < 0 || record.userName !== void 0 && (typeof record.userName !== "string" || record.userName.trim() === "" || record.userName.trim().length > 120) || keys.some((key) => key !== "format" && key !== "greetingIndex" && key !== "userName" && key !== "persona")) return void 0;
	let persona;
	try {
		persona = record.persona === void 0 ? void 0 : parseSessionPersona(record.persona);
	} catch {
		return;
	}
	if (persona !== void 0 && typeof record.userName === "string" && record.userName.trim() !== persona.name) return void 0;
	return {
		format: 0,
		greetingIndex: record.greetingIndex,
		...persona === void 0 && typeof record.userName === "string" ? { userName: record.userName.trim() } : {},
		...persona === void 0 ? {} : { persona }
	};
}
/** Canonical output schema for one accepted `remember` call. */
const MEMORY_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "integer",
			required: true,
			const: 0
		},
		id: {
			type: "string",
			required: true
		},
		kind: {
			type: "string",
			required: true,
			enum: AGENT_RP_MEMORY_KINDS
		},
		subject: {
			type: "string",
			required: true
		},
		text: {
			type: "string",
			required: true
		},
		sourceEventSeq: {
			type: "integer",
			required: true
		},
		supersedes: { type: "string" }
	}
};
/** Canonical output schema for one accepted Character Card import. */
const CHARACTER_IMPORT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "integer",
			required: true,
			const: 0
		},
		name: {
			type: "string",
			required: true
		},
		cardVersion: {
			type: "integer",
			required: true,
			enum: [
				1,
				2,
				3
			]
		},
		sourceEventSeq: {
			type: "integer",
			required: true
		},
		sourceAttachmentId: {
			type: "string",
			required: true
		},
		transport: {
			type: "string",
			required: true,
			enum: [
				"png",
				"json",
				"charx"
			]
		},
		metadataKeyword: {
			type: "string",
			enum: ["ccv3", "chara"]
		},
		greetingIndex: {
			type: "integer",
			required: true
		},
		selectedGreeting: {
			type: "string",
			required: true
		},
		userName: { type: "string" },
		libraryId: { type: "string" },
		degradations: {
			type: "array",
			required: true,
			items: {
				type: "string",
				enum: CHARACTER_IMPORT_DEGRADATIONS
			}
		},
		raw: {
			type: "json",
			required: true
		}
	}
};
/** Canonical output schema for one accepted standalone World Info import. */
const WORLD_INFO_IMPORT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "integer",
			required: true,
			const: 0
		},
		name: {
			type: "string",
			required: true
		},
		sourceEventSeq: {
			type: "integer",
			required: true
		},
		sourceAttachmentId: {
			type: "string",
			required: true
		},
		entryCount: {
			type: "integer",
			required: true
		},
		degradations: {
			type: "array",
			required: true,
			items: {
				type: "string",
				enum: WORLD_INFO_IMPORT_DEGRADATIONS
			}
		},
		raw: {
			type: "json",
			required: true
		}
	}
};
/** Canonical output schema for one accepted SillyTavern preset import. */
const PRESET_IMPORT_VALUE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		version: {
			type: "integer",
			required: true,
			const: 0
		},
		name: {
			type: "string",
			required: true
		},
		sourceEventSeq: {
			type: "integer",
			required: true
		},
		sourceAttachmentId: {
			type: "string",
			required: true
		},
		promptCount: {
			type: "integer",
			required: true
		},
		enabledCount: {
			type: "integer",
			required: true
		},
		regexScriptCount: {
			type: "integer",
			required: true
		},
		preset: {
			type: "json",
			required: true
		}
	}
};
function rememberCall(subject, text) {
	return {
		card: "generic",
		title: `记住：${subject}`,
		kind: "other",
		rawInput: text
	};
}
function isCharacterCardAttachment(value) {
	return isPngCharacterCardAttachment(value) || isJsonCharacterCardAttachment(value) || isCharxCharacterCardAttachment(value);
}
function latestConsumedAttachments(agent) {
	for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
		const event = agent.session.events[index];
		if (event?.type !== "user/message" || event.data.source.kind !== "user") continue;
		const source = event.data.source;
		const attachments = source.attachmentConsumer === "dsh-agent-rp" && Array.isArray(source.attachments) ? source.attachments.filter(isJsonWorldInfoAttachment) : [];
		if (attachments.length === 0) throw new Error("当前消息没有可导入的 JSON 文件");
		return {
			eventSeq: event.seq,
			attachments
		};
	}
	throw new Error("没有找到导入请求；请在同一条消息中附上 JSON 文件");
}
function latestUserAttachments(agent) {
	for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
		const event = agent.session.events[index];
		if (event?.type !== "user/message" || event.data.source.kind !== "user") continue;
		const direct = event.data.content.flatMap((block) => block.type === "image" ? [block.attachment] : []);
		const source = event.data.source;
		const consumed = source.attachmentConsumer === "dsh-agent-rp" && Array.isArray(source.attachments) ? source.attachments.filter(isCharacterCardAttachment) : [];
		const attachments = [...direct.filter(isCharacterCardAttachment), ...consumed];
		if (attachments.length === 0) throw new Error("当前消息没有可导入的角色卡；请附上 Character Card PNG、JSON 或 CHARX");
		return {
			eventSeq: event.seq,
			attachments
		};
	}
	throw new Error("没有找到导入请求；请在同一条消息中附上 Character Card PNG、JSON 或 CHARX");
}
function importedCharacter(agentsByScope, scope) {
	if (scope === void 0) return void 0;
	const agent = agentsByScope.get(scope);
	return agent === void 0 ? void 0 : readActiveSessionCharacter(agent.session.events);
}
function ejsVariableScopes(state) {
	return state?.scopes ?? {};
}
function ejsLorebookOptions(engine, context) {
	return engine === void 0 ? {} : {
		regexEngine: engine,
		renderTemplate: engine.createRenderer(context)
	};
}
/**
* Attach one persistent character identity and memory tool to a top-level Agent.
* @param agent - published top-level Agent whose scope owns every registration.
* @param config - normalized character configuration.
*/
function installAgentRp(ctx, config, options = {}) {
	const agentsByScope = /* @__PURE__ */ new WeakMap();
	const agentsBySession = /* @__PURE__ */ new Map();
	const pendingMessagesByAgent = /* @__PURE__ */ new WeakMap();
	const presetAfterHistoryByAgent = /* @__PURE__ */ new WeakMap();
	const presetInChatByAgent = /* @__PURE__ */ new WeakMap();
	const gateway = ctx.get("apiProxy");
	const commands = ctx.commands;
	const presetLibrary = new PresetLibrary();
	const characterLibrary = new CharacterLibrary(options.characterLibraryRoot === void 0 ? {} : { root: options.characterLibraryRoot });
	const chatLibrary = new SillyTavernChatLibrary();
	const worldInfoLibrary = new WorldInfoLibrary();
	const generatedImageLibrary = new GeneratedImageLibrary();
	const workspaceSettings = new WorkspaceSettingsStore();
	commands.register({
		name: "rp-tavern-variables",
		description: "persist an isolated Tavern Helper variable namespace",
		input: { hint: "<private Tavern Helper variable payload>" },
		recordInput: false,
		handler: executeTavernHelperMutation
	});
	commands.register({
		name: "rp-tavern-trigger",
		description: "generate a roleplay reply after a Tavern script appends a user message",
		recordInput: false,
		handler: executeTavernTrigger
	});
	commands.register({
		name: "rp-character-library",
		description: "start a roleplay Session from one local Character Card",
		input: { hint: "<private character-library payload>" },
		recordInput: false,
		handler: (invocation) => executeCharacterLibraryCommand(characterLibrary, invocation)
	});
	commands.register({
		name: "rp-chat-import",
		description: "migrate one Host-owned SillyTavern chat into this Session",
		input: { hint: "<private SillyTavern chat payload>" },
		recordInput: false,
		handler: (invocation) => executeSillyTavernChatCommand(chatLibrary, characterLibrary, invocation)
	});
	commands.register({
		name: "rp-persona",
		description: "change this roleplay Session Persona",
		input: { hint: "<private Persona payload>" },
		recordInput: false,
		handler: executePersonaCommand
	});
	commands.register({
		name: "rp-memory",
		description: "correct or forget one active roleplay memory",
		input: { hint: "<private memory-manager payload>" },
		recordInput: false,
		handler: executeAgentRpMemoryCommand
	});
	commands.register({
		name: "rp-preset-configure",
		description: "update this roleplay Session preset",
		input: { hint: "<private preset-manager payload>" },
		handler: configurePresetFromCommand
	});
	commands.register({
		name: "rp-preset-library",
		description: "manage reusable roleplay presets",
		input: { hint: "<private preset-library payload>" },
		handler: (invocation) => executePresetLibraryCommand(presetLibrary, invocation)
	});
	commands.register({
		name: "rp-generation",
		description: "manage persistent roleplay reply versions",
		input: { hint: "<private reply-version payload>" },
		recordInput: false,
		handler: executeGenerationCommand
	});
	commands.register({
		name: "rp-draw",
		description: "generate one roleplay image through the configured local provider",
		input: { hint: "<private image-generation payload>" },
		handler: (invocation) => executeImageGenerationCommand(generatedImageLibrary, workspaceSettings, ctx.credentials, invocation)
	});
	commands.register({
		name: "rp-world-info",
		description: "manage this roleplay Session world info",
		input: { hint: "<private world-info-manager payload>" },
		recordInput: false,
		handler: executeWorldInfoConfiguration
	});
	commands.register({
		name: "rp-world-info-import",
		description: "import one Host-owned World Info source into this roleplay Session",
		input: { hint: "<private world-info import payload>" },
		recordInput: false,
		handler: (invocation) => executeWorldInfoLibraryCommand(worldInfoLibrary, invocation)
	});
	const registerAttachmentConsumer = gateway?.registerPromptAttachmentConsumer?.bind(gateway);
	if (registerAttachmentConsumer !== void 0) ctx.effect(() => registerAttachmentConsumer("dsh-agent-rp", ({ agent, content }) => claimAgentRpPrompt(agentsByScope.get(agent) === agent, content)), "agent-rp: prompt attachment consumer");
	const registerSessionImporter = gateway?.registerPromptSessionImporter?.bind(gateway);
	if (registerSessionImporter !== void 0) ctx.effect(() => registerSessionImporter("dsh-agent-rp:sillytavern-migration", {
		recognize: ({ agent, content }) => isSillyTavernMigrationOffer(agentsByScope.get(agent) === agent, content),
		async import(input, signal) {
			const cardAttachment = input.attachments.find((attachment) => isJsonCharacterCardAttachment(attachment) || isPngCharacterCardAttachment(attachment) || isCharxCharacterCardAttachment(attachment));
			const chatAttachment = input.attachments.find((attachment) => "kind" in attachment && attachment.kind === "file" && /\.jsonl$/iu.test(attachment.name));
			if (cardAttachment === void 0 || chatAttachment === void 0) throw new Error("SillyTavern migration requires one Character Card PNG, JSON, or CHARX and one chat JSONL");
			const reader = ctx.attachments;
			const [storedCard, chatBytes] = await Promise.all([isJsonCharacterCardAttachment(cardAttachment) || isCharxCharacterCardAttachment(cardAttachment) ? input.readFile(cardAttachment, signal).then((data) => ({
				ref: cardAttachment,
				data
			})) : reader.readImage(cardAttachment, signal), input.readFile(chatAttachment, signal)]);
			const { card, transport } = decodeCharacterCardAttachment(storedCard.ref, storedCard.data);
			const libraryEntry = characterLibrary.import({
				data: storedCard.data,
				...storedCard.ref.name === void 0 ? {} : { filename: storedCard.ref.name },
				...storedCard.ref.mediaType === void 0 ? {} : { mediaType: storedCard.ref.mediaType },
				card,
				transport
			});
			const chat = parseSillyTavernChatBytes(chatBytes);
			return {
				seed: createSillyTavernMigrationSeed(card, storedCard.ref, transport, chat, chatAttachment, libraryEntry.id),
				title: card.nickname?.trim() || card.name
			};
		}
	}), "agent-rp: SillyTavern migration importer");
	if (registerSessionImporter !== void 0) ctx.effect(() => registerSessionImporter("dsh-agent-rp:sillytavern-chat", {
		recognize: ({ agent, content }) => isSillyTavernChatOffer(agentsByScope.get(agent) === agent, content),
		async import(input, signal) {
			if (input.attachments.length !== 1) throw new Error("SillyTavern chat import requires exactly one file");
			const attachment = input.attachments[0];
			if (attachment === void 0 || !("kind" in attachment) || attachment.kind !== "file" || !/\.jsonl$/iu.test(attachment.name)) throw new Error("SillyTavern chat import requires one .jsonl file");
			const chat = parseSillyTavernChatBytes(await input.readFile(attachment, signal));
			const title = resolveSillyTavernChatIdentity(chat).characterName;
			return {
				seed: createSillyTavernChatSeed(chat, attachment),
				...title === void 0 || title === "" ? {} : { title }
			};
		}
	}), "agent-rp: SillyTavern chat importer");
	if (registerSessionImporter !== void 0) ctx.effect(() => registerSessionImporter("dsh-agent-rp:character-card", {
		recognize: ({ agent, content }) => isCharacterCardSessionOffer(agentsByScope.get(agent) === agent, content),
		async import(input, signal) {
			if (input.attachments.length !== 1) throw new Error("Character Card import requires exactly one file");
			const attachment = input.attachments[0];
			if (attachment === void 0 || !isJsonCharacterCardAttachment(attachment) && !isPngCharacterCardAttachment(attachment) && !isCharxCharacterCardAttachment(attachment)) throw new Error("Character Card import requires one PNG, JSON, or CHARX card");
			const reader = ctx.attachments;
			const stored = isJsonCharacterCardAttachment(attachment) || isCharxCharacterCardAttachment(attachment) ? {
				ref: attachment,
				data: await input.readFile(attachment, signal)
			} : await reader.readImage(attachment, signal);
			const { card, transport } = decodeCharacterCardAttachment(stored.ref, stored.data);
			const request = parseCharacterCardSessionRequest(input.text);
			if (request === void 0) throw new Error("Character Card import request is invalid");
			const selectedGreeting = [card.firstMessage, ...card.alternateGreetings][request.greetingIndex];
			if (selectedGreeting === void 0) throw new Error(`角色卡没有第 ${request.greetingIndex + 1} 条开场白`);
			const libraryEntry = characterLibrary.import({
				data: stored.data,
				...stored.ref.name === void 0 ? {} : { filename: stored.ref.name },
				...stored.ref.mediaType === void 0 ? {} : { mediaType: stored.ref.mediaType },
				card,
				transport
			});
			const userName = request.persona?.name ?? request.userName;
			const greeting = substituteCardMacros$1(selectedGreeting, card, userName);
			return {
				seed: createCharacterCardSessionSeed(card, stored.ref, request.greetingIndex, greeting, transport, userName, request.persona, libraryEntry.id),
				title: card.nickname?.trim() || card.name
			};
		}
	}), "agent-rp: Character Card importer");
	if (registerSessionImporter !== void 0) ctx.effect(() => registerSessionImporter("dsh-agent-rp:sillytavern-preset", {
		recognize: ({ agent, content }) => isSillyTavernPresetOffer(agentsByScope.get(agent) === agent, content),
		async import(input, signal) {
			if (input.attachments.length !== 1) throw new Error("SillyTavern preset import requires exactly one file");
			const attachment = input.attachments[0];
			if (attachment === void 0 || !("kind" in attachment) || attachment.kind !== "file" || !/\.json$/iu.test(attachment.name)) throw new Error("SillyTavern preset import requires one JSON file");
			const preset = parseSillyTavernPresetBytes(await input.readFile(attachment, signal), attachment.name);
			const libraryEntry = presetLibrary.import(preset);
			return {
				seed: createPresetSessionSeed(input.source.session.events, libraryEntry.preset, attachment, libraryEntry.id),
				title: readActiveSessionCharacter(input.source.session.events)?.result.name ?? preset.name
			};
		}
	}), "agent-rp: SillyTavern preset importer");
	ctx.systemPrompt.section({
		name: "deployment:persona",
		order: 0,
		text: ({ scope }) => {
			const agent = scope === void 0 ? void 0 : agentsByScope.get(scope);
			const pendingMessages = agent === void 0 ? [] : pendingMessagesByAgent.get(agent) ?? [];
			if (agent !== void 0) pendingMessagesByAgent.delete(agent);
			const active = importedCharacter(agentsByScope, scope);
			if (agent === void 0) return renderCharacterPrompt(config);
			const tavern = readTavernHelperState(agent.session.events);
			const injectedScanText = tavernInjectedScanText(tavern);
			const sources = readActiveSessionLorebookSources(agent);
			const worldInfoConfiguration = readWorldInfoConfiguration(agent.session.events);
			const configuredSources = sources.map((source) => ({
				source,
				configured: configuredLorebook(source, worldInfoConfiguration).lorebook
			}));
			const books = configuredSources.map(({ source, configured }) => ({
				id: source.id,
				name: source.name,
				lorebook: configured
			}));
			const splitLore = (rendered) => {
				const collect = (source) => {
					const selected = rendered.books.filter((_book, index) => configuredSources[index]?.source.source === source);
					return {
						beforeCharacter: selected.flatMap((book) => book.inspected.beforeCharacter),
						afterCharacter: selected.flatMap((book) => book.inspected.afterCharacter)
					};
				};
				return {
					character: collect("character"),
					standalone: collect("standalone")
				};
			};
			if (active === void 0) {
				const importedChat = readSillyTavernChatIdentity(agent.session.events);
				const identity = resolveSessionPersonaIdentity(agent.session.events, void 0, importedChat?.userName);
				const templateOptions = ejsLorebookOptions(options.ejsTemplateEngine, {
					characterName: importedChat?.characterName ?? config.characterName,
					userName: identity.userName ?? "用户",
					messages: [...roleplayVisibleDialogue(agent.session, pendingMessages), ...injectedScanText],
					transcript: roleplayVisibleTranscript(agent.session, pendingMessages),
					variableScopes: ejsVariableScopes(tavern),
					worldInfoBooks: createEjsWorldInfoBooks(books)
				});
				const { standalone: standaloneLore } = splitLore(renderSessionLorebooks({
					books,
					session: agent.session,
					pendingMessages,
					scanText: injectedScanText,
					templateOptions,
					tokenBudget: worldInfoTokenBudget(worldInfoConfiguration)
				}));
				if (importedChat !== void 0) return [
					...standaloneLore.beforeCharacter,
					renderImportedChatPrompt(importedChat.characterName, identity.userName, identity.persona?.description),
					...standaloneLore.afterCharacter
				].join("\n\n");
				return renderCharacterPrompt(config, standaloneLore.beforeCharacter, standaloneLore.afterCharacter);
			}
			const importedCard = cardFromImportMeta(active.meta);
			const cardLorebook = configuredSources.find((value) => value.source.source === "character")?.configured;
			const { lorebook: _importedLorebook, ...cardWithoutLorebook } = importedCard;
			const card = cardLorebook === void 0 ? cardWithoutLorebook : {
				...importedCard,
				lorebook: cardLorebook
			};
			const { persona, userName } = resolveSessionPersonaIdentity(agent.session.events, active.result.userName, readSillyTavernChatIdentity(agent.session.events)?.userName);
			const mvu = readCurrentMvuState(card, agent.session.events);
			const dialogueContext = {
				card,
				...userName === void 0 ? {} : { userName },
				...persona === void 0 ? {} : { persona: persona.description }
			};
			const templateOptions = ejsLorebookOptions(options.ejsTemplateEngine, {
				characterName: card.nickname?.trim() || card.name,
				userName: userName ?? "用户",
				messages: [...roleplayVisibleDialogue(agent.session, pendingMessages, dialogueContext), ...injectedScanText],
				transcript: roleplayVisibleTranscript(agent.session, pendingMessages, dialogueContext),
				variableScopes: ejsVariableScopes(tavern),
				...mvu === void 0 ? {} : { statData: mvu.statData },
				worldInfoBooks: createEjsWorldInfoBooks(books)
			});
			const { standalone: standaloneLore, character: characterLore } = splitLore(renderSessionLorebooks({
				books,
				session: agent.session,
				pendingMessages,
				scanText: injectedScanText,
				...mvu === void 0 ? {} : { statData: mvu.statData },
				context: dialogueContext,
				templateOptions,
				tokenBudget: worldInfoTokenBudget(worldInfoConfiguration)
			}));
			const preset = readActiveSessionPreset(agent.session.events)?.preset;
			if (preset !== void 0) {
				const assembled = assembleSillyTavernPreset(preset, {
					card,
					...userName === void 0 ? {} : { userName },
					...persona === void 0 ? {} : { userPersona: persona.description },
					worldInfoBefore: [...standaloneLore.beforeCharacter, ...characterLore.beforeCharacter],
					worldInfoAfter: [...characterLore.afterCharacter, ...standaloneLore.afterCharacter],
					session: agent.session,
					pendingMessages,
					mvuEnabled: mvu !== void 0,
					...templateOptions.renderTemplate === void 0 ? {} : { renderTemplate: templateOptions.renderTemplate }
				});
				presetAfterHistoryByAgent.set(agent, assembled.afterHistory);
				presetInChatByAgent.set(agent, assembled.inChat);
				return assembled.system;
			}
			presetAfterHistoryByAgent.delete(agent);
			presetInChatByAgent.delete(agent);
			return renderImportedCharacterPrompt(card, [...standaloneLore.beforeCharacter, ...characterLore.beforeCharacter], [...characterLore.afterCharacter, ...standaloneLore.afterCharacter], userName, mvu?.statData, persona?.description, templateOptions);
		},
		complete: true
	});
	ctx.on("agent/created", ({ agent }) => {
		agentsByScope.set(agent, agent);
		agentsBySession.set(String(agent.session.id), agent);
	});
	ctx.on("agent/disposed", ({ agent }) => {
		agentsByScope.delete(agent);
		agentsBySession.delete(String(agent.session.id));
		pendingMessagesByAgent.delete(agent);
		presetAfterHistoryByAgent.delete(agent);
		presetInChatByAgent.delete(agent);
	});
	installPromptRegexStream(ctx, (sessionId) => agentsBySession.get(sessionId), (agent) => [...presetInChatByAgent.get(agent) ?? [], ...tavernInjectedInChatPrompts(readTavernHelperState(agent.session.events))]);
	installMvuStreamCompletion(ctx, (sessionId) => agentsBySession.get(sessionId));
	ctx.on("agent/inbox/claimed", ({ agent, message }) => {
		if (agentsByScope.get(agent) !== agent) return;
		const pending = pendingMessagesByAgent.get(agent);
		if (pending === void 0) pendingMessagesByAgent.set(agent, [message]);
		else pending.push(message);
	});
	ctx.systemPrompt.context({
		name: "agent-rp:memory",
		order: 70,
		text: ({ scope }) => {
			if (scope === void 0) return "";
			const agent = agentsByScope.get(scope);
			return agent === void 0 ? "" : renderMemoryContext(agent.session.events);
		}
	});
	ctx.systemPrompt.context({
		name: "agent-rp:preset-after-history",
		order: 60,
		text: ({ scope }) => {
			if (scope === void 0) return "";
			const agent = agentsByScope.get(scope);
			if (agent === void 0) return "";
			const value = presetAfterHistoryByAgent.get(agent) ?? "";
			presetAfterHistoryByAgent.delete(agent);
			return value;
		}
	});
	ctx.on("agent/request", async ({ agent }, next) => {
		const config = await next();
		if (agentsByScope.get(agent) !== agent) return config;
		const generation = readActiveSessionPreset(agent.session.events)?.preset.generation;
		if (generation === void 0) return config;
		const requestedEffort = generation.reasoningEffort;
		const supportedEffort = (requestedEffort === void 0 || requestedEffort === "auto" ? void 0 : await ctx.llm.resolveModelInfo(config.provider, config.model))?.reasoning?.efforts.some((effort) => effort.id === requestedEffort) === true ? requestedEffort : void 0;
		return {
			...config,
			...generation.temperature === void 0 ? {} : { temperature: generation.temperature },
			...generation.maxTokens === void 0 ? {} : { maxTokens: Math.min(generation.maxTokens, config.maxTokens ?? generation.maxTokens) },
			...supportedEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(supportedEffort) }
		};
	});
	ctx.systemPrompt.context({
		name: "sandbox:policy",
		order: 0,
		text: ""
	});
	ctx.systemPrompt.context({
		name: "approval:policy",
		order: 0,
		text: ""
	});
	ctx.tools.register(defineTool({
		name: "remember",
		description: "Persist one confirmed fact, promise, preference, relationship change, or shared event for later turns in this Session. Do not repeat information already covered. When this topic already exists, use supersedes with its active memory id instead of adding another record.",
		parameters: {
			kind: {
				type: "string",
				enum: AGENT_RP_MEMORY_KINDS,
				required: true,
				description: "Why this information must remain available in later turns."
			},
			subject: {
				type: "string",
				required: true,
				description: "Short stable topic used to distinguish this memory from unrelated records."
			},
			text: {
				type: "string",
				required: true,
				description: "Concise confirmed information to remember without speculation or hidden reasoning."
			},
			supersedes: {
				type: "string",
				description: "Active memory id replaced by this corrected record."
			}
		},
		output: {
			schema: MEMORY_VALUE_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		execute(args, exec) {
			if (exec.agent === void 0) throw new Error("remember requires an Agent Session");
			if (exec.parent !== void 0) throw new Error("remember must be called directly by the character Agent");
			const record = prepareAgentRpMemory(exec.agent.session, String(exec.callId), args);
			return Promise.resolve(record);
		},
		presentCall: (args) => rememberCall(args.subject, args.text),
		isConcurrencySafe: () => false
	}));
	ctx.tools.register(defineTool({
		name: "import_sillytavern_preset",
		description: "Import one SillyTavern Chat Completion preset JSON attachment from the latest user message. The complete Prompt Manager module set and order become active for this roleplay Session; extension payloads remain preserved in the original attachment.",
		parameters: { attachmentIndex: {
			type: "integer",
			description: "Zero-based JSON attachment index in the latest user message. Omit when it contains exactly one file."
		} },
		output: {
			schema: PRESET_IMPORT_VALUE_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: `已启用预设 ${value.name}：${value.promptCount} 个提示模块，当前启用 ${value.enabledCount} 个。原始扩展数据已随附件保留。`
			}],
			presentationMeta: (_args, value) => {
				const { preset, ...result } = value;
				return {
					format: 0,
					result,
					preset
				};
			}
		},
		async execute(args, exec) {
			if (exec.agent === void 0) throw new Error("import_sillytavern_preset requires an Agent Session");
			if (exec.parent !== void 0) throw new Error("import_sillytavern_preset must be called directly by the character Agent");
			const direct = latestConsumedAttachments(exec.agent);
			const attachmentIndex = args.attachmentIndex ?? 0;
			if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= direct.attachments.length) throw new Error(`attachmentIndex ${attachmentIndex} is unavailable; the current import source contains ${direct.attachments.length} JSON attachment(s)`);
			const stored = await ctx.attachments.readFile(direct.attachments[attachmentIndex], exec.signal);
			const preset = parseSillyTavernPresetBytes(stored.data, stored.ref.name);
			return {
				...preparePresetImportResult(preset, direct.eventSeq, stored.ref),
				preset: presetJson(preset)
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "导入酒馆预设",
			kind: "read"
		}),
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "预设导入失败" : "预设已启用"
		}),
		isConcurrencySafe: () => false
	}));
	ctx.tools.register(defineTool({
		name: "import_character_card",
		description: "Import a SillyTavern Character Card V1, V2, or V3 from a PNG, JSON, or CHARX attachment in the latest user message, then make that character active for this Session. Omit attachmentIndex unless the message has multiple recognized cards. greetingIndex 0 selects first_mes; later indexes select alternate_greetings.",
		parameters: {
			attachmentIndex: {
				type: "integer",
				description: "Zero-based Character Card attachment index in the latest user message. Omit when it contains exactly one card."
			},
			greetingIndex: {
				type: "integer",
				description: "Zero selects first_mes; one and above select alternate_greetings. Defaults to zero."
			}
		},
		output: {
			schema: CHARACTER_IMPORT_VALUE_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: [
					`已导入 ${value.name}（Character Card V${value.cardVersion}）`,
					value.selectedGreeting.trim().length === 0 ? "角色卡没有开场白；直接以新角色自然回应。" : `立即以新角色发送这段开场白，不解释导入过程：\n${substituteCardMacros$1(value.selectedGreeting, parseCharacterCardValue(value.raw), value.userName)}`,
					value.degradations.length === 0 ? "未发现需要降级的能力。" : `未启用：${value.degradations.join("、")}`
				].join("\n")
			}],
			presentationMeta: (_args, value) => {
				const { raw, ...result } = value;
				return {
					format: 0,
					result,
					raw
				};
			}
		},
		async execute(args, exec) {
			if (exec.agent === void 0) throw new Error("import_character_card requires an Agent Session");
			if (exec.parent !== void 0) throw new Error("import_character_card must be called directly by the character Agent");
			const direct = latestUserAttachments(exec.agent);
			const attachmentIndex = args.attachmentIndex ?? 0;
			const attachments = direct.attachments;
			if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= attachments.length) throw new Error(`attachmentIndex ${attachmentIndex} is unavailable; the current import source contains ${attachments.length} Character Card attachment(s)`);
			const attachment = attachments[attachmentIndex];
			if (isJsonCharacterCardAttachment(attachment) || isCharxCharacterCardAttachment(attachment)) {
				const stored = await ctx.attachments.readFile(attachment, exec.signal);
				const { card, transport } = decodeCharacterCardAttachment(stored.ref, stored.data);
				const libraryEntry = characterLibrary.import({
					data: stored.data,
					filename: stored.ref.name,
					...stored.ref.mediaType === void 0 ? {} : { mediaType: stored.ref.mediaType },
					card,
					transport
				});
				return prepareCharacterImportResult(card, transport, direct.eventSeq, stored.ref, args.greetingIndex ?? 0, readSillyTavernChatIdentity(exec.agent.session.events)?.userName, libraryEntry.id);
			}
			const stored = await ctx.attachments.readImage(attachment, exec.signal);
			const payload = readCharacterCardPng(stored.data);
			const card = parseCharacterCardJson(payload.json);
			const libraryEntry = characterLibrary.import({
				data: stored.data,
				...stored.ref.name === void 0 ? {} : { filename: stored.ref.name },
				mediaType: stored.ref.mediaType,
				card,
				transport: {
					transport: "png",
					metadataKeyword: payload.keyword
				}
			});
			return prepareCharacterImportResult(card, {
				transport: "png",
				metadataKeyword: payload.keyword
			}, direct.eventSeq, stored.ref, args.greetingIndex ?? 0, readSillyTavernChatIdentity(exec.agent.session.events)?.userName, libraryEntry.id);
		},
		presentCall: () => ({
			card: "generic",
			title: "导入角色卡",
			kind: "read"
		}),
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "角色卡导入失败" : "角色卡已导入"
		}),
		isConcurrencySafe: () => false
	}));
	ctx.tools.register(defineTool({
		name: "import_world_info",
		description: "Import one standalone SillyTavern World Info / lorebook JSON attachment from the latest user message and keep it active in this Session. Omit attachmentIndex unless the message contains multiple JSON files.",
		parameters: { attachmentIndex: {
			type: "integer",
			description: "Zero-based JSON attachment index in the latest user message. Omit when it contains exactly one file."
		} },
		output: {
			schema: WORLD_INFO_IMPORT_VALUE_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: [
					`已导入世界书 ${value.name}（${value.entryCount} 个条目）`,
					value.degradations.length === 0 ? "未发现需要降级的能力。" : `未启用：${value.degradations.join("、")}`,
					"从下一次回应开始使用已激活的设定，不解释导入过程。"
				].join("\n")
			}],
			presentationMeta: (_args, value) => {
				const { raw, ...result } = value;
				return {
					format: 0,
					result,
					raw
				};
			}
		},
		async execute(args, exec) {
			if (exec.agent === void 0) throw new Error("import_world_info requires an Agent Session");
			if (exec.parent !== void 0) throw new Error("import_world_info must be called directly by the character Agent");
			const direct = latestConsumedAttachments(exec.agent);
			const attachmentIndex = args.attachmentIndex ?? 0;
			if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= direct.attachments.length) throw new Error(`attachmentIndex ${attachmentIndex} is unavailable; the current import source contains ${direct.attachments.length} JSON attachment(s)`);
			const stored = await ctx.attachments.readFile(direct.attachments[attachmentIndex], exec.signal);
			return prepareWorldInfoImportResult(parseWorldInfoJsonBytes(stored.data), direct.eventSeq, stored.ref);
		},
		presentCall: () => ({
			card: "generic",
			title: "导入世界书",
			kind: "read"
		}),
		presentResult: (_args, result) => ({
			card: "generic",
			title: result.isError ? "世界书导入失败" : "世界书已导入"
		}),
		isConcurrencySafe: () => false
	}));
}
async function loadEjsTemplateEngine(ctx) {
	try {
		return await EjsTemplateEngine.create();
	} catch (error) {
		const kind = error instanceof Error ? error.name : "UnknownError";
		ctx.logger.warn(`agent-rp: isolated EJS runtime unavailable (${kind}); templates remain preserved but inactive`);
		return;
	}
}
/**
* Install the Agent RP profile behavior for every top-level Agent.
* @param ctx - settled Web Host context.
* @param config - character configuration for this profile.
*/
async function apply(ctx, config) {
	const resolved = resolveConfig(config);
	if (resolved.mode === "host") {
		const ejsTemplateEngine = await loadEjsTemplateEngine(ctx);
		const characterLibrary = new CharacterLibrary();
		const personaLibrary = new PersonaLibrary();
		const presetLibrary = new PresetLibrary();
		const chatLibrary = new SillyTavernChatLibrary();
		const worldInfoLibrary = new WorldInfoLibrary();
		const workspaceSettings = new WorkspaceSettingsStore();
		const generatedImageLibrary = new GeneratedImageLibrary();
		let mountedServer;
		const mountHost = (serviceName) => {
			ctx.inject([
				serviceName,
				"credentials",
				"agents",
				"llm",
				"systemPrompt"
			], (webCtx) => {
				const server = webCtx.get(serviceName);
				if (mountedServer !== void 0) return;
				mountedServer = server;
				webCtx.effect(() => () => {
					if (mountedServer === server) mountedServer = void 0;
				}, `agent-rp: release ${serviceName}`);
				installCharacterLibraryHttp(webCtx, characterLibrary, server);
				installPersonaLibraryHttp(webCtx, personaLibrary, server);
				installPresetLibraryHttp(webCtx, presetLibrary, server);
				installSillyTavernChatHttp(webCtx, chatLibrary, server);
				installSillyTavernChatExportHttp(webCtx, ctx, server);
				installAgentRpMemoryHttp(webCtx, ctx, server);
				installSessionLaunchHttp(webCtx, ctx, characterLibrary, chatLibrary, presetLibrary, server);
				installWorldInfoLibraryHttp(webCtx, worldInfoLibrary, server);
				installWorkspaceSettingsHttp(webCtx, workspaceSettings, server);
				installImageGenerationHttp(webCtx, generatedImageLibrary, webCtx.credentials, server);
				installTavernGenerationHttp(webCtx, server);
				installTavernModelListHttp(webCtx, server);
				installRpDistributionBridgeHttp(webCtx, characterLibrary, presetLibrary, personaLibrary, worldInfoLibrary, chatLibrary, server);
			});
		};
		mountHost("httpServer");
		mountHost("webServer");
		ctx.inject(["sessionProjections"], (projectionCtx) => {
			projectionCtx.sessionProjections.register(createAgentRpProjectionDefinition(ejsTemplateEngine));
		});
		installBundledAgentRpPreset();
		return;
	}
	const ejsTemplateEngine = await loadEjsTemplateEngine(ctx);
	installAgentRp(ctx, resolved, ejsTemplateEngine === void 0 ? {} : { ejsTemplateEngine });
}
export { CHARACTER_IMPORT_VALUE_SCHEMA, Config, MEMORY_VALUE_SCHEMA, PRESET_IMPORT_VALUE_SCHEMA, WORLD_INFO_IMPORT_VALUE_SCHEMA, apply, claimAgentRpPrompt, inject, installAgentRp, isCharacterCardSessionOffer, isSillyTavernChatOffer, isSillyTavernMigrationOffer, isSillyTavernPresetOffer, name, parseCharacterCardSessionRequest };
