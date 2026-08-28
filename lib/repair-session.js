#!/usr/bin/env node
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
/** Complete private event vocabulary declaration-merged by Agent RP. */
const AGENT_RP_SESSION_EVENT_TYPES = [
	"agent-rp/act-model-request",
	"agent-rp/act-model-result",
	"agent-rp/character-card-seed",
	"agent-rp/experience-selection",
	"agent-rp/memory-seed",
	"agent-rp/mvu-state",
	"agent-rp/generation-state",
	"agent-rp/narrative-review-request",
	"agent-rp/narrative-review-result",
	"agent-rp/native-prompt-policy-seed",
	"agent-rp/persona-seed",
	"agent-rp/regex-pack-seed",
	"agent-rp/sillytavern-chat-import",
	"agent-rp/sillytavern-preset-seed",
	"agent-rp/story-workspace-selection",
	"agent-rp/story-stage-request",
	"agent-rp/story-stage-result",
	"agent-rp/story-turn-brief",
	"agent-rp/story-turn-materialized",
	"agent-rp/story-web-fetch-request",
	"agent-rp/story-web-fetch-result",
	"agent-rp/story-web-search-request",
	"agent-rp/story-web-search-result",
	"agent-rp/staged-state-request",
	"agent-rp/staged-state-result",
	"agent-rp/state",
	"agent-rp/tavern-generation-request",
	"agent-rp/tavern-generation-result",
	"agent-rp/tavern-message-annotation",
	"agent-rp/tavern-state",
	"agent-rp/tavern-state-attachment",
	"agent-rp/turn-mode",
	"agent-rp/turn-plan",
	"agent-rp/turn-presentation",
	"agent-rp/turn-settlement",
	"agent-rp/turn-worker-result",
	"agent-rp/world-info-library-seed"
];
/** Backup-first removal of legacy Agent RP envelope fields from one DSH JSONL artifact. */
const ZSTD_MAGIC = 4247762216;
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
/** Known private Agent RP event types whose legacy envelopes may be converted. */
const LEGACY_AGENT_RP_EVENT_TYPES = /* @__PURE__ */ new Set([...AGENT_RP_SESSION_EVENT_TYPES]);
function encodePathSegment(raw) {
	if (raw.length === 0) throw new Error("会话 ID 不能为空");
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let output = "";
	for (let index = 0; index < raw.length; index += 1) {
		const code = raw.charCodeAt(index);
		const character = String.fromCharCode(code);
		output += character !== "~" && /^[A-Za-z0-9._-]$/u.test(character) ? character : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
	}
	return output;
}
function isMissing(error) {
	return error?.code === "ENOENT";
}
/** Locate one unique default-JSONL artifact by exact Session id without reading unrelated logs. */
async function locateAgentRpSessionFile(sessionsRoot, sessionId) {
	const root = resolve(sessionsRoot);
	const rootInfo = await lstat(root);
	if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("sessions 根目录必须是普通目录，不能是符号链接");
	const encoded = encodePathSegment(sessionId);
	const projects = await readdir(root, { withFileTypes: true });
	const matches = [];
	for (const project of projects) {
		if (!project.isDirectory() || project.isSymbolicLink()) continue;
		const sessionDirectory = join(root, project.name, encoded);
		let directoryInfo;
		try {
			directoryInfo = await lstat(sessionDirectory);
		} catch (error) {
			if (isMissing(error)) continue;
			throw error;
		}
		if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error(`会话 ${JSON.stringify(sessionId)} 的候选目录不是普通目录`);
		for (const filename of ["session.jsonl.zstd", "session.jsonl"]) {
			const candidate = join(sessionDirectory, filename);
			let info;
			try {
				info = await lstat(candidate);
			} catch (error) {
				if (isMissing(error)) continue;
				throw error;
			}
			if (!info.isFile() || info.isSymbolicLink()) throw new Error(`会话 ${JSON.stringify(sessionId)} 的候选文件不是普通文件`);
			matches.push(candidate);
		}
	}
	if (matches.length === 0) throw new Error(`没有在 ${root} 找到会话 ${JSON.stringify(sessionId)}`);
	if (matches.length > 1) throw new Error(`会话 ${JSON.stringify(sessionId)} 在 sessions 根目录中存在多个候选文件，已拒绝选择`);
	return matches[0];
}
function completeZstdFrameEnd(source, start) {
	let cursor = start;
	const take = (bytes, label) => {
		if (source.length - cursor < bytes) throw new Error(`会话文件的 Zstandard ${label}不完整`);
		const position = cursor;
		cursor += bytes;
		return position;
	};
	const magicAt = take(4, "帧头");
	if (source.readUInt32LE(magicAt) !== ZSTD_MAGIC) throw new Error(`会话文件在字节 ${start} 处没有 Zstandard 帧`);
	const descriptorAt = take(1, "帧头");
	const descriptor = source.readUInt8(descriptorAt);
	if ((descriptor & 24) !== 0) throw new Error(`Zstandard 帧头损坏（字节 ${descriptorAt}）`);
	const singleSegment = (descriptor & 32) !== 0;
	const contentSizeFlag = descriptor >>> 6;
	const dictionaryFlag = descriptor & 3;
	const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
	const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 2 ** contentSizeFlag;
	take((singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes, "帧头");
	let finalBlock = false;
	while (!finalBlock) {
		const headerAt = take(3, "数据块头");
		const header = source.readUIntLE(headerAt, 3);
		finalBlock = (header & 1) === 1;
		const kind = header >>> 1 & 3;
		if (kind === 3) throw new Error(`Zstandard 数据块损坏（字节 ${headerAt}）`);
		const declaredSize = header >>> 3;
		take(kind === 1 ? 1 : declaredSize, "数据块");
	}
	if ((descriptor & 4) !== 0) take(4, "校验和");
	return cursor;
}
/** Locate complete frames in DSH's concatenated-Zstandard session container. */
function scanZstdFrames(buffer) {
	const frames = [];
	for (let start = 0; start < buffer.length;) {
		const end = completeZstdFrameEnd(buffer, start);
		frames.push({
			start,
			end
		});
		start = end;
	}
	if (frames.length === 0) throw new Error("会话文件不包含 Zstandard 帧");
	return frames;
}
function jsonRecord(line, lineNumber) {
	let value;
	try {
		value = JSON.parse(line.toString("utf8"));
	} catch (error) {
		throw new Error(`会话文件第 ${lineNumber} 行不是有效 JSON`, { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`会话文件第 ${lineNumber} 行不是记录对象`);
	return value;
}
function patchPlaintext(input) {
	if (input.length === 0 || input.at(-1) !== 10) throw new Error("会话记录缺少完整的换行结尾");
	const chunks = [];
	const unknown = /* @__PURE__ */ new Set();
	let repairedEvents = 0;
	let alreadySafeEvents = 0;
	let start = 0;
	let lineNumber = 0;
	while (start < input.length) {
		const newline = input.indexOf(10, start);
		if (newline < 0) throw new Error("会话记录末行不完整");
		lineNumber += 1;
		const line = input.subarray(start, newline);
		if (line.length === 0) throw new Error(`会话文件第 ${lineNumber} 行为空`);
		const record = jsonRecord(line, lineNumber);
		const type = record.type;
		if (typeof type === "string" && LEGACY_AGENT_RP_EVENT_TYPES.has(type)) {
			if (record.surfaceOp !== void 0) throw new Error(`拒绝修复带对话表面操作的事件 ${JSON.stringify(type)}`);
			if (record.ignorable === true) {
				repairedEvents += 1;
				const { ignorable: _legacyIgnorable, ...current } = record;
				chunks.push(Buffer.from(`${JSON.stringify(current)}\n`, "utf8"));
			} else {
				if (record.ignorable !== void 0) throw new Error(`事件 ${JSON.stringify(type)} 带有非法的 ignorable 标记`);
				alreadySafeEvents += 1;
				chunks.push(line, Buffer.from("\n"));
			}
		} else {
			if (typeof type === "string" && type.startsWith("agent-rp/")) unknown.add(type);
			chunks.push(line, Buffer.from("\n"));
		}
		start = newline + 1;
	}
	return {
		output: repairedEvents === 0 ? input : Buffer.concat(chunks),
		changed: repairedEvents > 0,
		repairedEvents,
		alreadySafeEvents,
		unknownAgentRpEventTypes: [...unknown].sort()
	};
}
function patchZstd(input) {
	const outputs = [];
	const unknown = /* @__PURE__ */ new Set();
	let repairedEvents = 0;
	let alreadySafeEvents = 0;
	for (const frame of scanZstdFrames(input)) {
		const encoded = input.subarray(frame.start, frame.end);
		const patched = patchPlaintext(zstdDecompressSync(encoded));
		repairedEvents += patched.repairedEvents;
		alreadySafeEvents += patched.alreadySafeEvents;
		for (const type of patched.unknownAgentRpEventTypes) unknown.add(type);
		outputs.push(patched.changed ? zstdCompressSync(patched.output, CHECKSUM_OPTIONS) : encoded);
	}
	return {
		output: repairedEvents === 0 ? input : Buffer.concat(outputs),
		changed: repairedEvents > 0,
		repairedEvents,
		alreadySafeEvents,
		unknownAgentRpEventTypes: [...unknown].sort()
	};
}
function artifactEncoding(path) {
	if (path.endsWith(".jsonl.zstd")) return "jsonl.zstd";
	if (path.endsWith(".jsonl")) return "jsonl";
	throw new Error("只能修复明确指定的 session.jsonl 或 session.jsonl.zstd 文件");
}
function headerSessionId(plaintext) {
	const newline = plaintext.indexOf(10);
	if (newline < 0) throw new Error("会话文件缺少完整的 header 行");
	const record = jsonRecord(plaintext.subarray(0, newline), 1);
	if (record.type !== "session" || typeof record.id !== "string" || record.id.length === 0) throw new Error("会话文件 header 没有有效的 Session ID");
	return record.id;
}
function artifactSessionId(input, encoding) {
	if (encoding === "jsonl") return headerSessionId(input);
	const first = scanZstdFrames(input)[0];
	if (first === void 0) throw new Error("会话文件不包含 header 帧");
	const plaintext = zstdDecompressSync(input.subarray(first.start, first.end));
	if (plaintext.indexOf(10) !== plaintext.length - 1) throw new Error("会话文件的第一个 Zstandard 帧不是独立 header");
	return headerSessionId(plaintext);
}
function backupName(path) {
	const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/gu, "-");
	return resolve(dirname(path), `${basename(path)}.agent-rp-backup-${stamp}-${randomUUID().slice(0, 8)}`);
}
async function replaceWithBackup(path, output, mode) {
	const temporary = resolve(dirname(path), `.${basename(path)}.agent-rp-repair-${randomUUID()}.tmp`);
	const backup = backupName(path);
	const handle = await open(temporary, "wx", mode);
	try {
		await handle.writeFile(output);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await rename(path, backup);
	} catch (error) {
		await unlink(temporary).catch(() => void 0);
		throw error;
	}
	try {
		await rename(temporary, path);
	} catch (error) {
		try {
			await rename(backup, path);
		} catch (restoreError) {
			throw new AggregateError([error, restoreError], `替换失败；原文件仍在 ${backup}`);
		}
		throw error;
	}
	return backup;
}
/** Inspect or repair one exact DSH session file; never scans a directory. */
async function repairAgentRpSessionFile(inputPath, options = {}) {
	const path = resolve(inputPath);
	const encoding = artifactEncoding(path);
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink()) throw new Error("修复目标必须是普通会话文件，不能是目录或符号链接");
	const input = await readFile(path);
	const sessionId = artifactSessionId(input, encoding);
	if (options.expectedSessionId !== void 0 && sessionId !== options.expectedSessionId) throw new Error(`会话文件 header ID ${JSON.stringify(sessionId)} 与请求的 ${JSON.stringify(options.expectedSessionId)} 不一致`);
	const patched = encoding === "jsonl.zstd" ? patchZstd(input) : patchPlaintext(input);
	if (patched.unknownAgentRpEventTypes.length > 0) throw new Error(`会话还包含本工具不认识的 Agent RP 事件：${patched.unknownAgentRpEventTypes.join("、")}`);
	if (options.apply !== true || !patched.changed) return {
		path,
		sessionId,
		encoding,
		repairedEvents: patched.repairedEvents,
		alreadySafeEvents: patched.alreadySafeEvents,
		unknownAgentRpEventTypes: patched.unknownAgentRpEventTypes,
		applied: false
	};
	const verified = encoding === "jsonl.zstd" ? patchZstd(patched.output) : patchPlaintext(patched.output);
	if (verified.repairedEvents !== 0 || verified.unknownAgentRpEventTypes.length > 0) throw new Error("修复后校验失败，原文件未替换");
	const backupPath = await replaceWithBackup(path, patched.output, info.mode);
	return {
		path,
		sessionId,
		encoding,
		repairedEvents: patched.repairedEvents,
		alreadySafeEvents: patched.alreadySafeEvents,
		unknownAgentRpEventTypes: [],
		applied: true,
		backupPath
	};
}
/** Locate and inspect/repair one unique default-JSONL Session by exact id. */
async function repairAgentRpSessionById(sessionsRoot, sessionId, options = {}) {
	return repairAgentRpSessionFile(await locateAgentRpSessionFile(sessionsRoot, sessionId), {
		...options,
		expectedSessionId: sessionId
	});
}
function usage() {
	console.error("用法：dsh-agent-rp-repair-session [--apply] <session.jsonl|session.jsonl.zstd>");
	console.error("      dsh-agent-rp-repair-session [--apply] --session <id> [--root <sessions目录>]");
	console.error("默认只读检查；关闭 DSH 后显式加 --apply 才会备份并修复。");
	process.exit(2);
}
const args = process.argv.slice(2);
let apply = false;
let sessionId;
let root;
const positional = [];
for (let index = 0; index < args.length; index += 1) {
	const argument = args[index];
	if (argument === "--apply") apply = true;
	else if (argument === "--session" || argument === "--root") {
		const value = args[index + 1];
		if (value === void 0 || value.startsWith("--")) usage();
		if (argument === "--session") sessionId = value;
		else root = value;
		index += 1;
	} else if (argument.startsWith("--")) usage();
	else positional.push(argument);
}
if (sessionId === void 0 ? positional.length !== 1 || root !== void 0 : positional.length !== 0) usage();
const defaultRoot = resolve(process.env["DSH_HOME"]?.trim() || resolve(homedir(), ".dsh"), "sessions");
try {
	const result = sessionId === void 0 ? await repairAgentRpSessionFile(positional[0], { apply }) : await repairAgentRpSessionById(root ?? defaultRoot, sessionId, { apply });
	if (!apply) {
		console.log(`只读检查完成：${result.path}`);
		console.log(`会话 ID：${result.sessionId}`);
		console.log(`带旧 ignorable 字段的事件：${result.repairedEvents}`);
		console.log(`已经使用当前 envelope 的 Agent RP 事件：${result.alreadySafeEvents}`);
		if (result.repairedEvents > 0) console.log("请先完全关闭 DSH，再用同一条命令加 --apply 执行。");
	} else if (result.applied) {
		console.log(`已从 ${result.repairedEvents} 条旧事件移除 ignorable 字段。`);
		console.log(`原文件备份：${result.backupPath}`);
	} else console.log("该会话不需要修复，未写入任何文件。");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
export {};
