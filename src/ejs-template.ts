/** Isolated, deterministic rendering for the supported SillyTavern EJS subset. */

import variant from '@jitl/quickjs-singlefile-mjs-release-sync'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import type {
  LorebookRegexEngine,
  LorebookRegexMatcher,
  LorebookRegexMatchResult,
} from './import/lorebook.ts'

const MAX_TEMPLATE_CHARS = 256 * 1024
const MAX_OUTPUT_CHARS = 256 * 1024
const MAX_RESOURCE_CHARS = 4 * 1024 * 1024
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
const MAX_STACK_BYTES = 512 * 1024
const MAX_INTERRUPT_POLLS = 512
const MAX_PENDING_JOBS = 1_024
const MAX_RENDERER_EVALUATIONS = 256
const MAX_REGEX_PATTERN_CHARS = 16 * 1024
const MAX_REGEX_INPUT_CHARS = 512 * 1024
const MAX_REGEX_EVALUATIONS = 4_096
const MAX_REGEX_PATTERN_CHARS_PER_MATCHER = 2 * 1024 * 1024
const MAX_REGEX_INTERRUPT_POLLS = 64

let quickjsModule: Promise<QuickJSWASMModule> | undefined

/** One role-preserving visible Session message exposed to a template. */
export interface EjsTemplateMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** One Session-owned World Info book available to deterministic template reads. */
export interface EjsTemplateWorldInfoBook {
  readonly id: string
  readonly name?: string
  readonly entries: readonly {
    readonly sourceId: string
    readonly name?: string
    readonly comment?: string
    readonly content: string
  }[]
}

/** Project normalized Session lorebooks into the read-only EJS resource index. */
export function createEjsWorldInfoBooks(books: readonly {
  readonly id: string
  readonly name?: string
  readonly lorebook: {
    readonly entries: readonly {
      readonly sourceId: string
      readonly name?: string
      readonly comment?: string
      readonly content: string
    }[]
  }
}[]): EjsTemplateWorldInfoBook[] {
  return books.map(book => ({
    id: book.id,
    ...(book.name === undefined ? {} : { name: book.name }),
    entries: book.lorebook.entries.map(entry => ({
      sourceId: entry.sourceId,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      ...(entry.comment === undefined ? {} : { comment: entry.comment }),
      content: entry.content,
    })),
  }))
}

/** Resource identity of the template currently being rendered. */
export interface EjsTemplateTarget {
  readonly worldInfoBookId?: string
}

/** JSON-only values exposed to one template evaluation. */
export interface EjsTemplateContext {
  readonly characterName: string
  readonly userName: string
  readonly messages: readonly string[]
  /** Replayable per-turn entropy; omitted contexts keep nondeterministic APIs disabled. */
  readonly entropy?: string
  readonly transcript?: readonly EjsTemplateMessage[]
  readonly variables?: Readonly<Record<string, JsonValue>>
  readonly variableScopes?: Readonly<Partial<Record<'global' | 'preset' | 'character' | 'chat' | 'message', Readonly<Record<string, JsonValue>>>>>
  readonly statData?: JsonValue
  readonly worldInfoBooks?: readonly EjsTemplateWorldInfoBook[]
}

/** Stable failure categories that never include private template source. */
export type EjsTemplateFailureKind =
  | 'source-limit'
  | 'syntax-error'
  | 'runtime-error'
  | 'execution-limit'
  | 'memory-limit'
  | 'output-limit'
  | 'resource-unsupported'
  | 'resource-limit'

/** JSON-safe error returned by the isolated EJS runtime for explicit local Debug reports. */
export interface EjsTemplateErrorDetail {
  readonly name?: string
  readonly message: string
  readonly stack?: string
}

/** Result of one isolated template evaluation. */
export type EjsTemplateResult =
  | { readonly ok: true; readonly text: string }
  | {
    readonly ok: false
    readonly kind: EjsTemplateFailureKind
    readonly error?: EjsTemplateErrorDetail
  }

interface TemplateSegment {
  readonly kind: 'text' | 'code' | 'escaped' | 'raw'
  readonly value: string
}

function segments(template: string): TemplateSegment[] | undefined {
  const result: TemplateSegment[] = []
  const literalClosings = (value: string) => value.replaceAll('%%>', '%>')
  let cursor = 0
  let trimLeadingWhitespace = false
  while (cursor < template.length) {
    const opening = template.indexOf('<%', cursor)
    if (opening < 0) {
      const tail = literalClosings(trimLeadingWhitespace ? template.slice(cursor).replace(/^\s+/u, '') : template.slice(cursor))
      if (tail !== '') result.push({ kind: 'text', value: tail })
      return result
    }
    let text = template.slice(cursor, opening)
    if (trimLeadingWhitespace) text = text.replace(/^\s+/u, '')
    const marker = template[opening + 2]
    if (marker === '%') {
      if (text !== '') result.push({ kind: 'text', value: literalClosings(text) })
      result.push({ kind: 'text', value: '<%' })
      cursor = opening + 3
      trimLeadingWhitespace = false
      continue
    }
    const trimBefore = marker === '_'
    if (trimBefore) text = text.replace(/\s+$/u, '')
    if (text !== '') result.push({ kind: 'text', value: literalClosings(text) })

    const contentStart = opening + (marker === '=' || marker === '-' || marker === '#' || marker === '_' ? 3 : 2)
    const closing = template.indexOf('%>', contentStart)
    if (closing < 0) return undefined
    const closeMarker = template[closing - 1]
    const contentEnd = closeMarker === '-' || closeMarker === '_' ? closing - 1 : closing
    const value = template.slice(contentStart, contentEnd)
    if (marker !== '#') {
      result.push({
        kind: marker === '=' ? 'escaped' : marker === '-' ? 'raw' : 'code',
        value,
      })
    }
    cursor = closing + 2
    if (closeMarker === '_') {
      trimLeadingWhitespace = true
    } else {
      trimLeadingWhitespace = false
      if (closeMarker === '-') {
        if (template.startsWith('\r\n', cursor)) cursor += 2
        else if (template[cursor] === '\n' || template[cursor] === '\r') cursor += 1
      }
    }
  }
  return result
}

function compileTemplate(template: string, context: EjsTemplateContext): string | undefined {
  const parsed = segments(template)
  if (parsed === undefined) return undefined
  const transcript = context.transcript ?? []
  const transcriptIsMessagePrefix = transcript.length <= context.messages.length
    && transcript.every((message, index) => message.content === context.messages[index])
  const input = JSON.stringify({
    char: context.characterName,
    user: context.userName,
    messages: transcriptIsMessagePrefix ? context.messages.slice(transcript.length) : context.messages,
    transcript,
    transcriptIsMessagePrefix,
    variables: context.variables ?? {},
    scopes: context.variableScopes ?? {},
    ...(context.entropy === undefined ? {} : { randomEntropy: JSON.stringify([context.entropy, template]) }),
    ...(context.statData === undefined ? {} : { stat_data: context.statData }),
  })
  const statements = parsed.map(segment => {
    if (segment.kind === 'text') return `__append(${JSON.stringify(segment.value)});`
    if (segment.kind === 'escaped') return `__append(__escape((${segment.value})));`
    if (segment.kind === 'raw') return `__append((${segment.value}));`
    return segment.value
  }).join('\n')
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
      has: (record, path) => {
        const missing = Object.create(null);
        return __readPath(record, path, missing) !== missing;
      },
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
    if (typeof __input.randomEntropy === 'string') {
      let __randomState = 2166136261;
      for (let __index = 0; __index < __input.randomEntropy.length; __index += 1) {
        __randomState ^= __input.randomEntropy.charCodeAt(__index);
        __randomState = Math.imul(__randomState, 16777619) >>> 0;
      }
      Math.random = () => {
        __randomState = (__randomState + 0x6D2B79F5) >>> 0;
        let __value = __randomState;
        __value = Math.imul(__value ^ (__value >>> 15), __value | 1);
        __value ^= __value + Math.imul(__value ^ (__value >>> 7), __value | 61);
        return ((__value ^ (__value >>> 14)) >>> 0) / 4294967296;
      };
    } else {
      Math.random = () => { throw new Error('__AGENT_RP_EJS_NONDETERMINISTIC__'); };
    }
    ${statements}
    return __output;
  })()`
}

function failureKind(value: unknown): EjsTemplateFailureKind {
  if (typeof value !== 'object' || value === null) return 'runtime-error'
  const record = value as { readonly name?: unknown; readonly message?: unknown }
  const message = typeof record.message === 'string' ? record.message : ''
  if (message.includes('__AGENT_RP_EJS_OUTPUT_LIMIT__')) return 'output-limit'
  if (message.includes('__AGENT_RP_EJS_RESOURCE_UNSUPPORTED__')) return 'resource-unsupported'
  if (message.includes('__AGENT_RP_EJS_RESOURCE_LIMIT__')) return 'resource-limit'
  if (message.includes('interrupted')) return 'execution-limit'
  if (/out of memory|memory limit/iu.test(message)) return 'memory-limit'
  if (record.name === 'SyntaxError') return 'syntax-error'
  return 'runtime-error'
}

function templateErrorDetail(value: unknown): EjsTemplateErrorDetail | undefined {
  if (typeof value === 'object' && value !== null) {
    const record = value as { readonly name?: unknown; readonly message?: unknown; readonly stack?: unknown }
    const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name : undefined
    const message = typeof record.message === 'string' && record.message !== '' ? record.message : undefined
    const stack = typeof record.stack === 'string' && record.stack !== '' ? record.stack : undefined
    if (message !== undefined) return {
      ...(name === undefined ? {} : { name }),
      message,
      ...(stack === undefined ? {} : { stack }),
    }
  }
  if (typeof value === 'string' && value !== '') return { message: value }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { message: String(value) }
  }
  return undefined
}

function templateFailure(value: unknown): Extract<EjsTemplateResult, { readonly ok: false }> {
  const error = templateErrorDetail(value)
  return {
    ok: false,
    kind: failureKind(value),
    ...(error === undefined ? {} : { error }),
  }
}

interface ParsedRegexPattern {
  readonly source: string
  readonly flags: string
}

function parsedRegexPattern(value: string, caseSensitive: boolean): ParsedRegexPattern | undefined {
  if (value === '') return undefined
  let source = value
  let flags = ''
  if (value[0] === '/') {
    let escaped = false
    let inClass = false
    let closing = -1
    for (let index = 1; index < value.length; index += 1) {
      const character = value[index]!
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '[') inClass = true
      else if (character === ']') inClass = false
      else if (character === '/' && !inClass) closing = index
    }
    if (closing > 0) {
      source = value.slice(1, closing)
      flags = value.slice(closing + 1)
      if (!/^[a-z]*$/u.test(flags)) return undefined
    }
  }
  if (!caseSensitive && !flags.includes('i')) flags += 'i'
  return { source, flags }
}

function regexFailure(value: unknown): 'invalid' | 'execution-limit' | 'resource-limit' {
  if (typeof value !== 'object' || value === null) return 'invalid'
  const record = value as { readonly name?: unknown; readonly message?: unknown }
  const message = typeof record.message === 'string' ? record.message : ''
  if (message.includes('interrupted')) return 'execution-limit'
  if (/out of memory|memory limit/iu.test(message)) return 'resource-limit'
  return 'invalid'
}

function createQuickJsRegexMatcher(quickjs: QuickJSWASMModule): LorebookRegexMatcher {
  const runtime = quickjs.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
  runtime.setMaxStackSize(MAX_STACK_BYTES)
  let polls = 0
  runtime.setInterruptHandler(() => ++polls > MAX_REGEX_INTERRUPT_POLLS)
  const vm = runtime.newContext()
  const compiled = vm.evalCode('(pattern, flags, text) => new RegExp(pattern, flags).test(text)', 'agent-rp:world-info-regex')
  let matchFunction: QuickJSHandle | undefined
  if (compiled.error !== undefined) compiled.error.dispose()
  else matchFunction = compiled.value
  let disposed = false
  let evaluations = 0
  let patternChars = 0

  return {
    match(keys, text, caseSensitive): LorebookRegexMatchResult {
      if (disposed || matchFunction === undefined || text.length > MAX_REGEX_INPUT_CHARS) {
        return { ok: false, kind: 'resource-limit' }
      }
      if (evaluations + keys.length > MAX_REGEX_EVALUATIONS) return { ok: false, kind: 'resource-limit' }
      const matchedKeys: string[] = []
      for (const key of keys) {
        const parsed = parsedRegexPattern(key, caseSensitive)
        if (parsed === undefined || parsed.source.length > MAX_REGEX_PATTERN_CHARS) {
          return { ok: false, kind: 'invalid' }
        }
        patternChars += parsed.source.length
        evaluations += 1
        if (patternChars > MAX_REGEX_PATTERN_CHARS_PER_MATCHER) return { ok: false, kind: 'resource-limit' }
        let patternHandle: QuickJSHandle | undefined
        let flagsHandle: QuickJSHandle | undefined
        let textHandle: QuickJSHandle | undefined
        try {
          patternHandle = vm.newString(parsed.source)
          flagsHandle = vm.newString(parsed.flags)
          textHandle = vm.newString(text)
          polls = 0
          const result = vm.callFunction(matchFunction, vm.undefined, patternHandle, flagsHandle, textHandle)
          const errorHandle = result.error
          if (errorHandle !== undefined) {
            const error = vm.dump(errorHandle)
            errorHandle.dispose()
            return { ok: false, kind: regexFailure(error) }
          }
          const valueHandle = result.value
          if (valueHandle === undefined) return { ok: false, kind: 'invalid' }
          const matched = vm.dump(valueHandle)
          valueHandle.dispose()
          if (typeof matched !== 'boolean') return { ok: false, kind: 'invalid' }
          if (matched) matchedKeys.push(key)
        } catch (error: unknown) {
          return { ok: false, kind: regexFailure(error) }
        } finally {
          patternHandle?.dispose()
          flagsHandle?.dispose()
          textHandle?.dispose()
        }
      }
      return { ok: true, matchedKeys }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      matchFunction?.dispose()
      vm.dispose()
      runtime.dispose()
    },
  }
}

/** QuickJS-backed evaluator; every render gets a fresh runtime and context. */
export class EjsTemplateEngine implements LorebookRegexEngine {
  private constructor(private readonly quickjs: QuickJSWASMModule) {}

  /** Load the embedded QuickJS WebAssembly module once during plugin startup. */
  static async create(): Promise<EjsTemplateEngine> {
    quickjsModule ??= newQuickJSWASMModuleFromVariant(variant)
    return new EjsTemplateEngine(await quickjsModule)
  }

  /** Render one template without exposing Host globals, modules, files, or network APIs. */
  render(template: string, context: EjsTemplateContext, target: EjsTemplateTarget = {}): EjsTemplateResult {
    if (template.length > MAX_TEMPLATE_CHARS) return { ok: false, kind: 'source-limit' }
    const code = compileTemplate(template, context)
    if (code === undefined) return { ok: false, kind: 'syntax-error' }
    const runtime = this.quickjs.newRuntime()
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
    runtime.setMaxStackSize(MAX_STACK_BYTES)
    let polls = 0
    runtime.setInterruptHandler(() => ++polls > MAX_INTERRUPT_POLLS)
    const vm = runtime.newContext()
    try {
      let resourceReads = 0
      let resourceChars = 0
      const lookup = vm.newFunction('__agentRpGetWorldInfo', (...handles) => {
        resourceReads += 1
        if (resourceReads > 128) throw new Error('__AGENT_RP_EJS_RESOURCE_LIMIT__')
        const args = handles.map(handle => vm.dump(handle) as unknown)
        const books = context.worldInfoBooks ?? []
        const explicitEntry = typeof args[1] === 'string' || typeof args[1] === 'number'
        const selectedBooks = explicitEntry
          ? books.filter(book => book.id === String(args[0]) || book.name === args[0])
          : target.worldInfoBookId === undefined
            ? books
            : books.filter(book => book.id === target.worldInfoBookId)
        const query = explicitEntry ? args[1] : args[0]
        const entry = (typeof query === 'string' || typeof query === 'number')
          ? selectedBooks.flatMap(book => book.entries).find(item =>
              item.sourceId === String(query) || item.name === query || item.comment === query)
          : undefined
        const text = entry?.content ?? ''
        if (/<%[=_-]?[\s\S]*?%>/imu.test(text)) throw new Error('__AGENT_RP_EJS_RESOURCE_UNSUPPORTED__')
        resourceChars += text.length
        if (resourceChars > MAX_RESOURCE_CHARS) throw new Error('__AGENT_RP_EJS_RESOURCE_LIMIT__')
        return vm.newString(text)
      })
      vm.setProp(vm.global, '__agentRpGetWorldInfo', lookup)
      lookup.dispose()
      const result = vm.evalCode(code, 'agent-rp:ejs')
      const errorHandle = result.error
      if (errorHandle !== undefined) {
        const error = vm.dump(errorHandle)
        errorHandle.dispose()
        return templateFailure(error)
      }
      const promiseHandle = result.value
      if (promiseHandle === undefined) return { ok: false, kind: 'runtime-error' }
      const jobs = runtime.executePendingJobs(MAX_PENDING_JOBS)
      const jobError = jobs.error
      if (jobError !== undefined) {
        const error = jobError.context.dump(jobError)
        jobError.dispose()
        jobs.dispose()
        promiseHandle.dispose()
        return templateFailure(error)
      }
      jobs.dispose()
      const settled = vm.getPromiseState(promiseHandle)
      promiseHandle.dispose()
      if (settled.type === 'pending') return { ok: false, kind: 'execution-limit' }
      if (settled.type === 'rejected') {
        const error = vm.dump(settled.error)
        settled.error.dispose()
        return templateFailure(error)
      }
      const value = vm.dump(settled.value)
      settled.value.dispose()
      return typeof value === 'string'
        ? { ok: true, text: value }
        : { ok: false, kind: 'runtime-error' }
    } catch (error) {
      return templateFailure(error)
    } finally {
      vm.dispose()
      runtime.dispose()
    }
  }

  /** Bind one immutable context and cap the number of templates evaluated for one prompt or projection pass. */
  createRenderer(context: EjsTemplateContext): (template: string, target?: EjsTemplateTarget) => EjsTemplateResult {
    let evaluations = 0
    return (template, target) => {
      if (evaluations >= MAX_RENDERER_EVALUATIONS) return { ok: false, kind: 'execution-limit' }
      evaluations += 1
      return this.render(template, context, target)
    }
  }

  /** Create one bounded matcher that never executes untrusted regex in the Host JavaScript engine. */
  createRegexMatcher(): LorebookRegexMatcher {
    return createQuickJsRegexMatcher(this.quickjs)
  }
}
