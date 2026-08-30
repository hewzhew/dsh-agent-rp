/** Isolated singleton document for browser-installed SillyTavern extensions. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TavernInstalledExtensionPrompt } from '../tavern-helper.ts'
import type { InstalledStExtensionEntry } from './st-extension-registry.ts'
import { inlineScriptJson } from './inline-script-json.ts'
import { isJsonValue } from './json-value.ts'
import type { TavernPageSnapshot } from './tavern-runtime.ts'

const documentNoncePattern = /^[A-Za-z0-9_-]{16,128}$/u

/** Inputs required to build one browser ClientContext's extension document. */
export interface StExtensionDocumentOptions {
  readonly entries: readonly InstalledStExtensionEntry[]
  readonly nonce: string
  readonly sessionId: string | null
  readonly settings: Readonly<Record<string, JsonValue>>
  readonly snapshot?: TavernPageSnapshot
  readonly token: string
}

/** One bounded report emitted by the current singleton extension document. */
export type StExtensionHostMessage =
  | {
    readonly source: 'dsh-agent-rp-st-extension-host'
    readonly token: string
    readonly action: 'extension-state'
    readonly extensionId: string
    readonly status: 'loaded' | 'failed'
    readonly error?: string
  }
  | {
    readonly source: 'dsh-agent-rp-st-extension-host'
    readonly token: string
    readonly action: 'host-state'
    readonly status: 'ready' | 'failed'
    readonly loaded: readonly string[]
    readonly failed: readonly string[]
    readonly error?: string
  }
  | {
    readonly source: 'dsh-agent-rp-st-extension-host'
    readonly token: string
    readonly action: 'settings-surface'
    readonly hasContent: boolean
  }
  | {
    readonly source: 'dsh-agent-rp-st-extension-host'
    readonly token: string
    readonly action: 'settings-save'
    readonly settings: Readonly<Record<string, JsonValue>>
  }
  | {
    readonly source: 'dsh-agent-rp-st-extension-host'
    readonly token: string
    readonly action: 'injections-replace'
    readonly requestId: string
    readonly sessionId: string
    readonly prompts: readonly TavernInstalledExtensionPrompt[]
  }
  | {
    readonly source: 'dsh-agent-rp-st-extension-host'
    readonly token: string
    readonly action: 'generation-ready'
    readonly requestId: string
    readonly sessionId: string
    readonly outcome: 'applied' | 'failed'
    readonly error?: string
  }

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function boundedError(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8_000
}

function identifierList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(boundedIdentifier)
    && new Set(value).size === value.length
}

function settingsRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    return isJsonValue(value) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2 * 1024 * 1024
  } catch {
    return false
  }
}

function installedExtensionPrompts(value: unknown): value is readonly TavernInstalledExtensionPrompt[] {
  if (!Array.isArray(value) || value.length > 256) return false
  let bytes = 0
  const ids = new Set<string>()
  for (const prompt of value) {
    if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt)) return false
    const candidate = prompt as Readonly<Record<string, unknown>>
    if (!generationIdentifier(candidate.id) || ids.has(candidate.id)
      || (candidate.position !== 'before' && candidate.position !== 'after'
        && candidate.position !== 'in_chat' && candidate.position !== 'none')
      || (candidate.role !== 'system' && candidate.role !== 'assistant' && candidate.role !== 'user')
      || !Number.isSafeInteger(candidate.depth) || (candidate.depth as number) < 0
      || (candidate.depth as number) > 20_000 || typeof candidate.content !== 'string'
      || typeof candidate.shouldScan !== 'boolean' || candidate.once !== false) return false
    ids.add(candidate.id)
    bytes += new TextEncoder().encode(candidate.content).byteLength
    if (bytes > 1024 * 1024) return false
  }
  return true
}

function generationIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 512
}

/**
 * Parse a lifecycle report only when it belongs to the current iframe generation.
 * @param value - Untrusted browser message payload.
 * @param token - Current Host-generated frame token.
 * @returns Valid bounded report, or `undefined` for unrelated input.
 */
export function parseStExtensionHostMessage(value: unknown, token: string): StExtensionHostMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.source !== 'dsh-agent-rp-st-extension-host' || message.token !== token) return undefined
  if (message.action === 'injections-replace') {
    if (!generationIdentifier(message.requestId) || !generationIdentifier(message.sessionId)
      || !installedExtensionPrompts(message.prompts)) return undefined
    return {
      source: 'dsh-agent-rp-st-extension-host', token,
      action: 'injections-replace', requestId: message.requestId,
      sessionId: message.sessionId, prompts: message.prompts,
    }
  }
  if (message.action === 'generation-ready') {
    if (!generationIdentifier(message.requestId) || !generationIdentifier(message.sessionId)
      || (message.outcome !== 'applied' && message.outcome !== 'failed')
      || (message.outcome === 'applied' && message.error !== undefined)
      || (message.outcome === 'failed' && !boundedError(message.error))) return undefined
    return {
      source: 'dsh-agent-rp-st-extension-host', token,
      action: 'generation-ready', requestId: message.requestId,
      sessionId: message.sessionId, outcome: message.outcome,
      ...(message.outcome === 'failed' ? { error: message.error as string } : {}),
    }
  }
  if (message.action === 'settings-save') {
    if (!settingsRecord(message.settings)) return undefined
    return {
      source: 'dsh-agent-rp-st-extension-host', token,
      action: 'settings-save', settings: message.settings,
    }
  }
  if (message.action === 'settings-surface') {
    if (typeof message.hasContent !== 'boolean') return undefined
    return {
      source: 'dsh-agent-rp-st-extension-host', token,
      action: 'settings-surface', hasContent: message.hasContent,
    }
  }
  if (message.action === 'extension-state') {
    if (!boundedIdentifier(message.extensionId)
      || (message.status !== 'loaded' && message.status !== 'failed')
      || (message.status === 'loaded' && message.error !== undefined)
      || (message.status === 'failed' && !boundedError(message.error))) return undefined
    return {
      source: 'dsh-agent-rp-st-extension-host', token,
      action: 'extension-state', extensionId: message.extensionId, status: message.status,
      ...(message.status === 'failed' ? { error: message.error as string } : {}),
    }
  }
  if (message.action !== 'host-state' || (message.status !== 'ready' && message.status !== 'failed')
    || !identifierList(message.loaded) || !identifierList(message.failed)) return undefined
  const loaded = message.loaded
  const failed = message.failed
  if (loaded.some(id => failed.includes(id))
    || (message.status === 'ready' && message.error !== undefined)
    || (message.status === 'failed' && !boundedError(message.error))) return undefined
  return {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'host-state', status: message.status, loaded, failed,
    ...(message.status === 'failed' ? { error: message.error as string } : {}),
  }
}

function documentNonce(value: string): string {
  if (!documentNoncePattern.test(value)) throw new Error('Installed ST extension document nonce is invalid')
  return value
}

/** Compile the built-in generation compatibility layer prepended to the first extension. */
export function compileStExtensionGenerationRuntime(options: StExtensionDocumentOptions): string {
  const boot = inlineScriptJson({
    entries: options.entries.map(entry => ({
      id: entry.id,
      ...(entry.generateInterceptor === undefined ? {} : { generateInterceptor: entry.generateInterceptor }),
    })),
    prompts: options.snapshot?.installedExtensionPrompts ?? [],
    token: options.token,
  })
  return `(()=>{'use strict';const boot=${boot};const post=(action,detail={})=>parent.postMessage({source:'dsh-agent-rp-st-extension-host',token:boot.token,action,...detail},'*');const types=Object.freeze({NONE:-1,IN_PROMPT:0,IN_CHAT:1,BEFORE_PROMPT:2});const roles=Object.freeze({SYSTEM:0,USER:1,ASSISTANT:2});const prompts={};const position=value=>{value=Number(value);if(value===2)return 'before';if(value===0)return 'after';if(value===1)return 'in_chat';if(value===-1)return 'none';throw new Error('不支持的酒馆提示词位置：'+String(value))};const positionValue=value=>value==='before'?2:value==='after'?0:value==='in_chat'?1:-1;const role=value=>{if(typeof value==='string'){value=value.toLowerCase().trim();if(value==='user')return 'user';if(value==='assistant')return 'assistant';return 'system'}value=Number(value);return value===1?'user':value===2?'assistant':'system'};const roleValue=value=>value==='user'?1:value==='assistant'?2:0;const installPersisted=value=>{for(const key of Object.keys(prompts))delete prompts[key];for(const prompt of Array.isArray(value)?value:[]){prompts[prompt.id]={value:prompt.content,position:positionValue(prompt.position),depth:prompt.depth,scan:prompt.shouldScan,role:roleValue(prompt.role),filter:null}}};const setExtensionPrompt=(key,value,promptPosition,depth,scan,promptRole,filter)=>{const id=String(key??'').trim();if(!id||id.length>512)throw new Error('酒馆提示词 id 无效');const content=String(value??'');if(content.length>262144)throw new Error('酒馆提示词过长');const resolvedPosition=position(promptPosition);const resolvedRole=role(promptRole);const resolvedDepth=Number(depth);if(!Number.isSafeInteger(resolvedDepth)||resolvedDepth<0||resolvedDepth>20000)throw new Error('酒馆提示词 depth 无效');if(filter!==null&&filter!==undefined&&typeof filter!=='function')throw new Error('酒馆提示词 filter 必须是函数');prompts[id]={value:content,position:positionValue(resolvedPosition),depth:resolvedDepth,scan:Boolean(scan),role:roleValue(resolvedRole),filter:filter??null}};const activePrompts=async()=>{const result=[];let size=0;for(const [id,prompt] of Object.entries(prompts)){if(prompt.value==='')continue;if(typeof prompt.filter==='function'&&!await prompt.filter())continue;size+=prompt.value.length;if(result.length>=256||size>1048576)throw new Error('安装型扩展提示词超过 Host 限制');result.push({id,position:position(prompt.position),depth:prompt.depth,role:role(prompt.role),content:prompt.value,shouldScan:prompt.scan===true,once:false})}return result};installPersisted(boot.prompts);globalThis.extension_prompt_types=types;globalThis.extension_prompt_roles=roles;globalThis.extension_prompts=prompts;globalThis.setExtensionPrompt=setExtensionPrompt;const context=globalThis.SillyTavern;context.extensionPrompts=prompts;context.extension_prompts=prompts;context.extension_prompt_types=types;context.extension_prompt_roles=roles;context.setExtensionPrompt=setExtensionPrompt;let queue=Promise.resolve();const errorText=error=>{try{return (error&&typeof error.message==='string'?error.message:String(error??'未知生成错误')).slice(0,8000)}catch{return '无法读取生成错误'}};const run=async request=>{if(request.sessionId!==globalThis.__dshAgentRpSessionId)throw new Error('扩展生成请求不属于当前会话');await globalThis.eventSource.emit(globalThis.event_types.GENERATION_STARTED,'normal',{},false);for(const entry of boot.entries){if(entry.generateInterceptor===undefined)continue;const interceptor=globalThis[entry.generateInterceptor];if(typeof interceptor!=='function')throw new Error('扩展 '+entry.id+' 未公开生成拦截器 '+entry.generateInterceptor);await interceptor()}post('injections-replace',{requestId:request.requestId,sessionId:request.sessionId,prompts:await activePrompts()});post('generation-ready',{requestId:request.requestId,sessionId:request.sessionId,outcome:'applied'})};addEventListener('message',event=>{const message=event.data;if(event.source!==parent||!message||message.source!=='dsh-agent-rp-host'||message.token!==boot.token)return;if((message.action==='session-bind'||message.action==='page-sync')&&message.snapshot&&Array.isArray(message.snapshot.installedExtensionPrompts))installPersisted(message.snapshot.installedExtensionPrompts);if(message.action!=='generation-start'||typeof message.requestId!=='string'||typeof message.sessionId!=='string'||!Number.isSafeInteger(message.turn))return;const request={requestId:message.requestId,sessionId:message.sessionId,turn:message.turn};queue=queue.catch(()=>undefined).then(()=>run(request)).catch(error=>{post('generation-ready',{requestId:request.requestId,sessionId:request.sessionId,outcome:'failed',error:errorText(error)})})})})()`
}

/** Compile the opt-in adapter for extensions whose interceptor replaces one event listener. */
export function compileStExtensionGenerationEventAdapter(options: StExtensionDocumentOptions): string {
  const boot = inlineScriptJson({
    interceptorOnly: options.entries.flatMap(entry => entry.generationStartedEvent === 'interceptor-only'
      ? [entry.id]
      : []),
  })
  return `(()=>{'use strict';const boot=${boot};if(boot.interceptorOnly.length===0)return;const source=globalThis.eventSource;const suppressed=new Set(boot.interceptorOnly);const skip=(type)=>type===globalThis.event_types.GENERATION_STARTED&&suppressed.has(globalThis.__dshAgentRpCurrentExtensionId);const eventSource=Object.freeze({on(type,listener){if(!skip(type))source.on(type,listener)},once(type,listener){if(!skip(type))source.once(type,listener)},emit(...args){return source.emit(...args)},emitAndWait(...args){return source.emitAndWait(...args)},removeListener(type,listener){source.removeListener(type,listener)}});globalThis.eventSource=eventSource;globalThis.SillyTavern.eventSource=eventSource})()`
}

/**
 * Build the document that starts every installed extension once in a shared ST-compatible page.
 * @param options - Ordered extension snapshot and Host message credentials.
 * @returns Complete iframe `srcdoc` source.
 */
function compileStExtensionDocumentShell(options: StExtensionDocumentOptions): string {
  const nonce = documentNonce(options.nonce)
  const entries = options.entries.map(entry => ({
    ...entry,
    source: `globalThis.__dshAgentRpCurrentExtensionId=${JSON.stringify(entry.id)};\n${entry.source}`,
  }))
  const boot = inlineScriptJson({
    entries,
    sessionId: options.sessionId,
    settings: options.settings,
    snapshot: options.snapshot ?? null,
    token: options.token,
  })
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{background:transparent;color:CanvasText;color-scheme:dark;margin:0;min-height:100%;padding:0}body{box-sizing:border-box;font-family:system-ui,sans-serif}#extensions_settings:empty,#extensions_settings2:empty{display:none}</style></head><body><div id="extensions_settings"></div><div id="extensions_settings2"></div><script nonce="${nonce}">(()=>{'use strict';const boot=${boot};const entries=boot.entries;const token=boot.token;const loaded=new Set();const failed=new Map();const pending=entries.slice();const byId=new Map(entries.map(entry=>[entry.id,entry]));const post=(action,detail={})=>parent.postMessage({source:'dsh-agent-rp-st-extension-host',token,action,...detail},'*');const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));const plain=value=>typeof value==='object'&&value!==null&&!Array.isArray(value);let sessionId=boot.sessionId;let snapshot=boot.snapshot;globalThis.__dshAgentRpSessionId=sessionId;const listeners=new Map();const on=(type,listener)=>{if(typeof listener!=='function')return;const values=listeners.get(type)??new Set();values.add(listener);listeners.set(type,values)};const removeListener=(type,listener)=>{const values=listeners.get(type);values?.delete(listener);if(values?.size===0)listeners.delete(type)};const once=(type,listener)=>{const wrapped=(...args)=>{removeListener(type,wrapped);return listener(...args)};on(type,wrapped)};const emit=async(type,...args)=>{for(const listener of [...(listeners.get(type)??[])])await listener(...args)};const eventTypes=Object.freeze({APP_READY:'app_ready',CHAT_CHANGED:'chat_id_changed',CHAT_COMPLETION_SETTINGS_READY:'chat_completion_settings_ready',MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',MESSAGE_SWIPED:'message_swiped',CHARACTER_MESSAGE_RENDERED:'character_message_rendered',GENERATION_STARTED:'generation_started',GENERATION_ENDED:'generation_ended',GENERATION_STOPPED:'generation_stopped'});const eventNames=new Set(Object.values(eventTypes));const eventSource=Object.freeze({on,once,emit,emitAndWait:emit,removeListener});let eventQueue=Promise.resolve();const enqueueEvent=(type,args)=>{eventQueue=eventQueue.catch(()=>undefined).then(()=>emit(type,...args)).catch(error=>console.error(error))};const context={chat:[],name1:'用户',name2:'',characters:[],this_chid:undefined,characterId:undefined,groups:[],groupId:null,chatId:sessionId,chatMetadata:{},chat_metadata:{},extensionSettings:null,eventSource,eventTypes,getContext(){return this}};const applySnapshot=value=>{snapshot=value;const messages=snapshot?.messages??[];context.chat=messages.map(message=>({name:message.role==='user'?(snapshot?.userName??'用户'):(snapshot?.characterName??''),is_user:message.role==='user',is_system:false,is_hidden:message.isHidden===true,mes:message.text,swipe_id:0,swipes:[message.text],variables:[clone(message.data??{})],swipe_info:[clone(message.extra??{})],extra:clone(message.extra??{})}));context.name1=snapshot?.userName??'用户';context.name2=snapshot?.characterName??'';context.chatId=sessionId;const raw=clone(snapshot?.characterCard);const card=plain(raw)?raw:{};const data=plain(card.data)?card.data:card;const character=snapshot===null?undefined:{...card,...clone(data),name:typeof data.name==='string'&&data.name.trim()?data.name:snapshot.characterName,avatar:snapshot.characterId,description:String(data.description??''),personality:String(data.personality??''),scenario:String(data.scenario??''),first_mes:String(data.first_mes??''),mes_example:String(data.mes_example??''),data:clone(data)};context.characters=character===undefined?[]:[character];context.this_chid=character===undefined?undefined:0;context.characterId=context.this_chid;const metadata={...clone(snapshot?.scopes.chat??{}),wi_activated:clone(snapshot?.activeWorldbookEntries??[])};context.chatMetadata=metadata;context.chat_metadata=metadata;globalThis.characters=context.characters;globalThis.this_chid=context.this_chid};globalThis.extension_settings=clone(boot.settings);context.extensionSettings=globalThis.extension_settings;globalThis.eventSource=eventSource;globalThis.event_types=eventTypes;globalThis.SillyTavern=context;globalThis.getContext=()=>context;applySnapshot(snapshot);addEventListener('message',event=>{const message=event.data;if(event.source!==parent||!message||message.source!=='dsh-agent-rp-host'||message.token!==token)return;if(message.action==='page-event'){if(!eventNames.has(message.eventType)||!Array.isArray(message.args))return;enqueueEvent(message.eventType,clone(message.args));return}if((message.action!=='session-bind'&&message.action!=='page-sync')||(message.sessionId!==null&&typeof message.sessionId!=='string')||(message.snapshot!==null&&typeof message.snapshot!=='object'))return;if(message.action==='page-sync'){if(message.sessionId!==sessionId)return;applySnapshot(message.snapshot);return}const previous=sessionId;sessionId=message.sessionId;globalThis.__dshAgentRpSessionId=sessionId;applySnapshot(message.snapshot);enqueueEvent(eventTypes.CHAT_CHANGED,[sessionId]);dispatchEvent(new CustomEvent('dsh-agent-rp-session-change',{detail:{previous,sessionId}}))});let settingsTimer;const saveSettings=()=>post('settings-save',{settings:clone(globalThis.extension_settings)});globalThis.saveSettings=saveSettings;globalThis.saveSettingsDebounced=()=>{clearTimeout(settingsTimer);settingsTimer=setTimeout(saveSettings,300)};context.saveSettings=saveSettings;context.saveSettingsDebounced=globalThis.saveSettingsDebounced;const errorText=error=>{try{const value=error&&typeof error.message==='string'?error.message:String(error??'未知扩展错误');return value.slice(0,8000)}catch{return '无法读取扩展错误'}};const fail=(entry,error)=>{const detail=errorText(error);failed.set(entry.id,detail);post('extension-state',{extensionId:entry.id,status:'failed',error:detail})};const installStyle=entry=>{if(typeof entry.style!=='string')return;const style=document.createElement('style');style.dataset.agentRpStExtension=entry.id;style.textContent=entry.style;document.head.append(style);return style};const run=async entry=>{let url;let style;try{style=installStyle(entry);url=URL.createObjectURL(new Blob([entry.source+'\\n//# sourceURL=dsh-agent-rp-st-extension:'+encodeURIComponent(entry.id)],{type:'text/javascript'}));await import(url);loaded.add(entry.id);post('extension-state',{extensionId:entry.id,status:'loaded'})}catch(error){style?.remove();fail(entry,error)}finally{if(url!==undefined)URL.revokeObjectURL(url)}};const activate=async()=>{while(pending.length>0){let progressed=false;for(let index=0;index<pending.length;){const entry=pending[index];const missing=entry.dependencies.filter(id=>!byId.has(id));const failedDependencies=entry.dependencies.filter(id=>failed.has(id));if(missing.length>0||failedDependencies.length>0){pending.splice(index,1);fail(entry,new Error(missing.length>0?'缺少扩展依赖：'+missing.join(', '):'扩展依赖启动失败：'+failedDependencies.join(', ')));progressed=true;continue}if(entry.dependencies.some(id=>!loaded.has(id))){index+=1;continue}pending.splice(index,1);await run(entry);progressed=true}if(progressed)continue;for(const entry of pending.splice(0))fail(entry,new Error('扩展依赖存在循环'));}await emit(eventTypes.APP_READY);document.documentElement.dataset.agentRpStExtensionState='ready';post('host-state',{status:'ready',loaded:[...loaded],failed:[...failed.keys()]})};const settingsChanged=()=>post('settings-surface',{hasContent:Boolean(document.querySelector('#extensions_settings>*,#extensions_settings2>*'))});new MutationObserver(settingsChanged).observe(document.body,{childList:true,subtree:true});void activate().then(settingsChanged,error=>{document.documentElement.dataset.agentRpStExtensionState='failed';post('host-state',{status:'failed',error:errorText(error),loaded:[...loaded],failed:[...failed.keys()]})})})()</script></body></html>`
}

/**
 * Build the document that starts every installed extension once in a shared ST-compatible page.
 * @param options - Ordered extension snapshot and Host message credentials.
 * @returns Complete iframe `srcdoc` source.
 */
export function compileStExtensionDocument(options: StExtensionDocumentOptions): string {
  const source = compileStExtensionDocumentShell(options)
  const anchor = 'const errorText=error=>'
  const foundation = `${compileStExtensionGenerationRuntime(options)};\n`
    + `${compileStExtensionGenerationEventAdapter(options)};\n`
  const anchorIndex = source.indexOf(anchor)
  if (anchorIndex < 0) throw new Error('Installed ST extension document foundation anchor is missing')
  return source.slice(0, anchorIndex) + foundation + source.slice(anchorIndex)
}
