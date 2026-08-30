/** Browser-only isolated Tavern Helper runtime. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  faArrowLeft, faArrowsRotate, faBatteryFull, faBookOpen, faCalendarXmark, faCheckCircle, faChessRook,
  faChevronDown, faChevronLeft, faChevronRight, faChevronUp, faCircleInfo, faCircleNotch, faCloud,
  faCloudShowersHeavy, faComment, faCommentDots, faComments, faDice, faDragon, faExpand, faGamepad,
  faGear, faGlobe, faHeart, faHourglassHalf, faImage, faImages, faLock, faMagicWandSparkles,
  faPaperPlane, faSave, faSpinner, faStop, faThumbsUp, faThumbtack, faTriangleExclamation, faUndo,
  faUnlockKeyhole, faUpload, faUserGroup, faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { gunzipSync, strFromU8 } from 'fflate'
import type { ImportedRegexScript, ImportedTavernHelperScript } from '../import/types.ts'
import type { SessionPersonaSnapshot } from '../persona-library-protocol.ts'
import { characterRemoteResourceOrigin, isCharacterRemoteResourceType } from '../card-remote-resource.ts'
import type { CharacterRemoteResourceType } from '../character-library-protocol.ts'
import {
  BUILT_IN_TAVERN_SCRIPT_ORIGINS, declaredTavernCompatibilityMarkers, declaredTavernFrameOrigins,
  declaredTavernImageOrigins, declaredTavernStyleOrigins, declaredTavernStylesheetUrls,
  type TavernScriptExecution,
  type TavernScriptPreload,
} from '../tavern-script-resolver.ts'
import type {
  TavernInjectedPrompt, TavernInstalledExtensionPrompt, TavernScriptTree, TavernScriptTreeScope,
  TavernWorldbookBindings, TavernWorldbookEntry,
} from '../tavern-helper.ts'
import { embeddedNativeIdentityRelayRuntime } from './embedded-identity.ts'
import { inlineScriptJson } from './inline-script-json.ts'
import {
  TAVERN_COMPARE_VERSIONS_GZIP_BASE64, TAVERN_JQUERY_GZIP_BASE64, TAVERN_JSON5_GZIP_BASE64,
  TAVERN_JSON_REPAIR_GZIP_BASE64, TAVERN_KLONA_GZIP_BASE64, TAVERN_LODASH_GZIP_BASE64,
  TAVERN_PINIA_GZIP_BASE64, TAVERN_VUE_GZIP_BASE64, TAVERN_YAML_GZIP_BASE64, TAVERN_ZOD_GZIP_BASE64,
} from './tavern-vendor-sources.generated.ts'

export { advanceTavernTranscript } from './tavern-transcript.ts'
export type { TavernTranscriptCursor } from './tavern-transcript.ts'

export {
  BUILT_IN_TAVERN_SCRIPT_ORIGINS, resolveTavernScriptExecution, TavernScriptOriginApprovalError,
  validatedTavernCompatibilityMarkers,
} from '../tavern-script-resolver.ts'
export type { TavernScriptExecution } from '../tavern-script-resolver.ts'

type JsonRecord = Readonly<Record<string, JsonValue>>

/** Preserve model reasoning in the read-only fields used by Tavern Helper message APIs. */
export function tavernReasoningExtra(reasoning: string | undefined): JsonRecord {
  return reasoning === undefined ? {} : { reasoning, reasoning_content: reasoning }
}

/** One bounded CSP resource observation from an isolated Tavern Helper frame. */
export interface TavernResourceBlockedReport {
  readonly source: 'dsh-agent-rp-tavern-script'
  readonly action: 'resource-blocked'
  readonly scriptId: string
  readonly origin: string
  readonly type: CharacterRemoteResourceType
}

/** Parse a content-free resource observation without accepting paths, credentials, or extra fields. */
export function parseTavernResourceBlockedReport(value: unknown): TavernResourceBlockedReport | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'scriptId', 'origin', 'type'])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-tavern-script' || record.action !== 'resource-blocked'
    || typeof record.scriptId !== 'string' || record.scriptId.length === 0 || record.scriptId.length > 512
    || typeof record.origin !== 'string' || !isCharacterRemoteResourceType(record.type)) return undefined
  try {
    const origin = characterRemoteResourceOrigin(record.origin)
    if (origin !== record.origin) return undefined
    return {
      source: 'dsh-agent-rp-tavern-script', action: 'resource-blocked', scriptId: record.scriptId,
      origin, type: record.type,
    }
  } catch {
    return undefined
  }
}

/** Decide whether a script execution plan needs a complete Host runtime reset. */
export function shouldResetTavernScriptRuntime(
  previous: { readonly sessionId: string; readonly planSignature: string } | undefined,
  next: { readonly sessionId: string; readonly planSignature: string },
): boolean {
  return previous === undefined || previous.sessionId !== next.sessionId
    || previous.planSignature !== next.planSignature
}

/** Content-free lifecycle state for one isolated Tavern Helper script frame. */
export type TavernScriptRuntimePhase =
  | 'preparing'
  | 'permission-required'
  | 'load-error'
  | 'booting'
  | 'ready'
  | 'runtime-error'

/**
 * Reduce Host-side script observations to one stable acceptance state.
 * @param input - whether the script resolved, started, requested permission, or failed.
 * @returns the highest-priority current lifecycle state.
 */
export function tavernScriptRuntimePhase(input: {
  readonly hasDocument: boolean
  readonly permissionRequired: boolean
  readonly loadError: boolean
  readonly ready: boolean
  readonly runtimeError: boolean
}): TavernScriptRuntimePhase {
  if (input.permissionRequired) return 'permission-required'
  if (input.loadError) return 'load-error'
  if (!input.hasDocument) return 'preparing'
  if (input.runtimeError) return 'runtime-error'
  return input.ready ? 'ready' : 'booting'
}

type FontAwesomeDefinition = typeof faArrowLeft

const mobileFontAwesomeIcons = {
  'fa-arrow-left': faArrowLeft,
  'fa-battery-full': faBatteryFull,
  'fa-book-open': faBookOpen,
  'fa-calendar-times': faCalendarXmark,
  'fa-check-circle': faCheckCircle,
  'fa-chess-rook': faChessRook,
  'fa-chevron': faChevronDown,
  'fa-chevron-down': faChevronDown,
  'fa-chevron-left': faChevronLeft,
  'fa-chevron-right': faChevronRight,
  'fa-chevron-up': faChevronUp,
  'fa-circle-info': faCircleInfo,
  'fa-circle-notch': faCircleNotch,
  'fa-cloud': faCloud,
  'fa-cloud-showers-heavy': faCloudShowersHeavy,
  'fa-cog': faGear,
  'fa-comment': faComment,
  'fa-comment-dots': faCommentDots,
  'fa-comments': faComments,
  'fa-dice': faDice,
  'fa-dragon': faDragon,
  'fa-exclamation-triangle': faTriangleExclamation,
  'fa-expand': faExpand,
  'fa-gamepad': faGamepad,
  'fa-globe': faGlobe,
  'fa-heart': faHeart,
  'fa-hourglass-half': faHourglassHalf,
  'fa-image': faImage,
  'fa-images': faImages,
  'fa-info-circle': faCircleInfo,
  'fa-lock': faLock,
  'fa-magic': faMagicWandSparkles,
  'fa-paper-plane': faPaperPlane,
  'fa-save': faSave,
  'fa-spinner': faSpinner,
  'fa-stop': faStop,
  'fa-sync': faArrowsRotate,
  'fa-sync-alt': faArrowsRotate,
  'fa-thumbs-up': faThumbsUp,
  'fa-thumbtack': faThumbtack,
  'fa-times': faXmark,
  'fa-undo': faUndo,
  'fa-unlock-alt': faUnlockKeyhole,
  'fa-upload': faUpload,
  'fa-user-friends': faUserGroup,
} satisfies Readonly<Record<string, FontAwesomeDefinition>>

function fontAwesomeMask(icon: FontAwesomeDefinition): string {
  const [width, height, , , pathData] = icon.icon
  const paths = (Array.isArray(pathData) ? pathData : [pathData])
    .map(path => `<path d="${path}"/>`).join('')
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>`)}")`
}

const mobileFontAwesomeStyle = [
  '.fa::before,.fas::before,.fa-solid::before{background-color:currentColor;content:""!important;display:inline-block;height:1em;mask-position:center;mask-repeat:no-repeat;mask-size:contain;vertical-align:-.125em;width:1em;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:contain}',
  '.fa-fw{display:inline-block;text-align:center;width:1.25em}',
  '@keyframes dsh-fa-spin{to{transform:rotate(360deg)}}.fa-spin::before{animation:dsh-fa-spin 1s linear infinite}',
  '#mobile-phone-overlay#mobile-phone-overlay{color-scheme:light}',
  '#mobile-phone-overlay#mobile-phone-overlay input[type="email"],#mobile-phone-overlay#mobile-phone-overlay input[type="number"],#mobile-phone-overlay#mobile-phone-overlay input[type="password"],#mobile-phone-overlay#mobile-phone-overlay input[type="text"],#mobile-phone-overlay#mobile-phone-overlay input[type="url"],#mobile-phone-overlay#mobile-phone-overlay select,#mobile-phone-overlay#mobile-phone-overlay textarea{background-color:#fff!important;color:#1f2937!important}',
  '#mobile-phone-overlay#mobile-phone-overlay .phone-size-preset-btn,#mobile-phone-overlay#mobile-phone-overlay .phone-size-reset-btn{align-items:center!important;color:#2d3748!important;display:flex!important;flex-direction:column!important;justify-content:center!important;line-height:1.35!important;min-height:58px!important;text-align:center!important}',
  '#mobile-phone-overlay#mobile-phone-overlay .app-page{padding-block:8px!important}',
  '#mobile-phone-overlay#mobile-phone-overlay .app-grid{padding-bottom:10px!important}',
  ...Object.entries(mobileFontAwesomeIcons).map(([className, icon]) => {
    const mask = fontAwesomeMask(icon)
    return `.${className}::before{mask-image:${mask};-webkit-mask-image:${mask}}`
  }),
].join('')

const extensionMenuStyle = [
  '#extensionsMenu:empty{display:none}',
  '#extensionsMenu{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:12px;width:100%}',
  '#extensionsMenu .extension_container{display:block;min-width:0}',
  '#extensionsMenu .list-group-item{align-items:center;border:1px solid rgba(255,255,255,.18);border-radius:8px;cursor:pointer;display:flex;gap:8px;padding:9px 11px}',
].join('')

/** Current session preset exposed to one isolated Tavern Helper script. */
export interface TavernScriptPresetSnapshot {
  readonly name: string
  readonly revision: number
  readonly value: JsonRecord
}

/** Initial state copied into one script sandbox. */
export interface TavernPageSnapshot {
  readonly characterName: string
  readonly characterId: string
  /** Exact current character card, when this Session was created from one. */
  readonly characterCard?: JsonValue
  readonly chatId: string
  readonly userName?: string
  readonly persona?: SessionPersonaSnapshot
  readonly preset?: TavernScriptPresetSnapshot
  /** Host-persisted SillyTavern extension settings shared by this page lifecycle. */
  readonly extensionSettings?: JsonRecord
  /** Durable prompts owned by the singleton installed-extension page. */
  readonly installedExtensionPrompts?: readonly TavernInstalledExtensionPrompt[]
  readonly scopes: {
    readonly global: JsonRecord
    readonly preset: JsonRecord
    readonly character: JsonRecord
    readonly chat: JsonRecord
    readonly message: JsonRecord
  }
  readonly worldbooks: Readonly<Record<string, readonly TavernWorldbookEntry[]>>
  readonly worldbookBindings: Required<TavernWorldbookBindings>
  /** Precise `book.uid` references activated for the next Host prompt. */
  readonly activeWorldbookEntries: readonly string[]
  readonly messages: readonly {
    readonly messageId: number
    readonly seq: number
    readonly role: 'user' | 'assistant'
    readonly text: string
    readonly isHidden: boolean
    readonly data: JsonRecord
    readonly extra: JsonRecord
    /** Root-level SillyTavern fields visible to the selected runtime owner. */
    readonly annotations?: JsonRecord
  }[]
  /** Current character-card regexes in Tavern Helper's public representation. */
  readonly characterRegexScripts: readonly JsonRecord[]
  /** Standalone Session regex packs in Tavern Helper's global-scope representation. */
  readonly globalRegexScripts?: readonly JsonRecord[]
  /** Current preset scripts in Tavern Helper's public tree representation. */
  readonly presetScriptTrees: readonly TavernScriptTree[]
  /** Current character-card scripts in Tavern Helper's public tree representation. */
  readonly characterScriptTrees: readonly TavernScriptTree[]
  /** Session-local global scripts; DSH has no process-wide mutable script source. */
  readonly globalScriptTrees?: readonly TavernScriptTree[]
  readonly displayRegexScripts: readonly ImportedRegexScript[]
}

/** Page state plus the private identity and permissions of one Tavern Helper script. */
export interface TavernScriptSnapshot extends TavernPageSnapshot {
  readonly scriptScope: TavernScriptTreeScope
  readonly scriptId: string
  readonly scriptName: string
  readonly scriptInfo: string
  readonly buttons: readonly { readonly name: string; readonly visible: boolean }[]
  /** Last durable session panel for this owner, used to avoid no-op writes on boot. */
  readonly statusPanelHtml?: string | null
  readonly approvedScriptOrigins: readonly string[]
  /** Player-approved HTTPS origins available only to image elements and CSS images. */
  readonly approvedImageOrigins?: readonly string[]
  /** Player-approved HTTPS origins available only to external stylesheets. */
  readonly approvedStyleOrigins?: readonly string[]
  /** Player-approved HTTPS origins available only to font files. */
  readonly approvedFontOrigins?: readonly string[]
  /** Player-approved HTTPS origins available only to nested browsing contexts. */
  readonly approvedFrameOrigins?: readonly string[]
  readonly scopes: TavernPageSnapshot['scopes'] & {
    readonly script: JsonRecord
  }
  /** Prompts currently owned by this script and persisted by the Host. */
  readonly injectedPrompts?: readonly Omit<TavernInjectedPrompt, 'scriptId' | 'scriptScope'>[]
}

/** Resolve SillyTavern regex depth from transcript order without counting Host-only flow nodes. */
export function tavernMessageDepth(
  messages: readonly { readonly messageId: number }[] | undefined,
  messageId: number | undefined,
): number | undefined {
  if (messages === undefined || messageId === undefined) return undefined
  const index = messages.findIndex(message => message.messageId === messageId)
  return index < 0 ? undefined : messages.length - index - 1
}

const DOMPURIFY_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/dompurify@3.3.0/dist/purify.min.js'
const DOMPURIFY_SCRIPT_INTEGRITY = 'sha384-+qi1h9Ene5uYXijovnRnDpm2TZiNyVFgYjKIqjw6id8zLdWYt+tCPG9/1u6yLaNj'
const FUSE_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.min.js'
const FUSE_SCRIPT_INTEGRITY = 'sha384-P/y/5cwqUn6MDvJ9lCHJSaAi2EoH3JSeEdyaORsQMPgbpvA+NvvUqik7XH2YGBjb'
const tavernVendorSourceCache = new Map<string, string>()

function tavernVendorSource(name: string, compressed: string): string {
  const cached = tavernVendorSourceCache.get(name)
  if (cached !== undefined) return cached
  const binary = atob(compressed)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const source = strFromU8(gunzipSync(bytes))
  tavernVendorSourceCache.set(name, source)
  return source
}

function tavernPreloadScript(preload: TavernScriptPreload): string {
  switch (preload) {
    case 'compare-versions':
      return `<script data-dsh-runtime-vendor="compare-versions">${tavernVendorSource(preload, TAVERN_COMPARE_VERSIONS_GZIP_BASE64)}</script>`
    case 'json5':
      return `<script data-dsh-runtime-vendor="json5">${tavernVendorSource(preload, TAVERN_JSON5_GZIP_BASE64)}</script>`
    case 'jsonrepair':
      return `<script data-dsh-runtime-vendor="jsonrepair">${tavernVendorSource(preload, TAVERN_JSON_REPAIR_GZIP_BASE64)}</script>`
    case 'klona':
      return `<script data-dsh-runtime-vendor="klona">${tavernVendorSource(preload, TAVERN_KLONA_GZIP_BASE64)}</script>`
    case 'pinia':
      return `<script data-dsh-runtime-vendor="pinia">${tavernVendorSource(preload, TAVERN_PINIA_GZIP_BASE64)}</script>`
    case 'vue':
      return `<script data-dsh-runtime-vendor="vue">${tavernVendorSource(preload, TAVERN_VUE_GZIP_BASE64)}</script>`
    case 'yaml':
      return `<script data-dsh-runtime-vendor="yaml">${tavernVendorSource(preload, TAVERN_YAML_GZIP_BASE64)}</script>`
    case 'zod':
      return `<script data-dsh-runtime-vendor="zod">${tavernVendorSource(preload, TAVERN_ZOD_GZIP_BASE64)}</script>`
  }
}

function runtimeSource(
  snapshot: TavernScriptSnapshot,
  compatibilityMarkers: readonly string[],
  externalBootstrap: boolean,
): string {
  return `
'use strict';
var __dshSnapshot=${externalBootstrap ? 'globalThis.__dshBootSnapshot' : inlineScriptJson(snapshot)};
if(!__dshSnapshot||typeof __dshSnapshot!=='object')throw new Error('酒馆脚本初始状态不可用');
var __dshDeclaredCompatibilityMarkers=${inlineScriptJson(compatibilityMarkers)};
var __dshScopes=__dshSnapshot.scopes;
var __dshMessages=__dshSnapshot.messages;
var __dshCharacterRegexScripts=__dshSnapshot.characterRegexScripts??[];
var __dshGlobalRegexScripts=__dshSnapshot.globalRegexScripts??[];
var __dshGlobalScriptTrees=__dshSnapshot.globalScriptTrees??[];
var __dshPresetScriptTrees=__dshSnapshot.presetScriptTrees??[];
var __dshCharacterScriptTrees=__dshSnapshot.characterScriptTrees??[];
var __dshInjectedPrompts=__dshSnapshot.injectedPrompts??[];
var __dshDisplayRegexScripts=__dshSnapshot.displayRegexScripts;
var __dshWorldbooks=__dshSnapshot.worldbooks;
var __dshWorldbookBindings=__dshSnapshot.worldbookBindings;
var __dshActiveWorldbookEntries=__dshSnapshot.activeWorldbookEntries;
var __dshPreset=__dshSnapshot.preset;
var __dshExtensionSettings=__dshClone(__dshSnapshot.extensionSettings??{});
var __dshMacroLikes=[];
function __dshScriptButtons(value){var result=[],seen=new Set();for(var button of Array.isArray(value)?value:[]){if(!button||typeof button!=='object')continue;var name=String(button.name??'').trim();if(!name||name.length>200||seen.has(name))continue;seen.add(name);result.push({name:name,visible:button.visible!==false});if(result.length>=50)break}return result}
var __dshCurrentScriptButtons=__dshScriptButtons(__dshScopes.script?.__dsh_script_buttons??__dshSnapshot.buttons);
var __dshCurrentScriptInfo=typeof __dshScopes.script?.__dsh_script_info==='string'?__dshScopes.script.__dsh_script_info:__dshSnapshot.scriptInfo;
var __dshListeners=new Map();
var __dshPending=new Map();
var __dshRequest=0;
var __dshMutationCause;
var __dshEventQueue=Promise.resolve();
function __dshClone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
function __dshPath(path){if(Array.isArray(path))return path.map(String);return String(path??'').replace(/\\[([^[\\]]+)\\]/g,'.$1').replace(/^\\./,'').split('.').filter(Boolean)}
function __dshGet(object,path,fallback){var value=object;for(var part of __dshPath(path)){if(value==null)return fallback;value=value[part]}return value===undefined?fallback:value}
function __dshSet(object,path,value){var parts=__dshPath(path);if(parts.length===0)return object;var target=object;for(var i=0;i<parts.length-1;i++){var key=parts[i];var next=parts[i+1];if(target[key]===null||typeof target[key]!=='object')target[key]=/^\\d+$/.test(next)?[]:{};target=target[key]}target[parts.at(-1)]=value;return object}
function __dshUnset(object,path){var parts=__dshPath(path);var target=object;for(var i=0;i<parts.length-1;i++){target=target?.[parts[i]];if(target==null)return false}return target!=null&&delete target[parts.at(-1)]}
function __dshPlain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function __dshMerge(target){for(var source of Array.prototype.slice.call(arguments,1)){if(!__dshPlain(source))continue;for(var key of Object.keys(source)){var value=source[key];if(__dshPlain(value)){if(!__dshPlain(target[key]))target[key]={};__dshMerge(target[key],value)}else target[key]=__dshClone(value)}}return target}
function __dshScope(option){var type=option?.type??'chat';if(type==='script')return 'script';if(type==='message')return 'message';return ['global','preset','character','chat'].includes(type)?type:'chat'}
function __dshPost(action,data){var causal=action==='variables-replace'||action==='worldbook-mutate'||action==='chat-mutate'||action==='injections-replace'||action==='status-panel-replace'||action==='event-emit'||action==='trigger-slash';parent.postMessage(Object.assign({source:'dsh-agent-rp-tavern-script',scriptId:__dshSnapshot.scriptId,action:action},data??{},causal&&__dshMutationCause!==undefined?{cause:__dshClone(__dshMutationCause)}:{}),'*')}
var __dshBlockedResources=new Set();
function __dshBlockedResourceType(value){var directive=String(value??'').trim().toLowerCase();if(directive.startsWith('connect-src'))return 'connect';if(directive.startsWith('font-src'))return 'font';if(directive.startsWith('frame-src')||directive==='child-src')return 'frame';if(directive.startsWith('img-src'))return 'image';if(directive.startsWith('media-src'))return 'media';if(directive.startsWith('script-src'))return 'script';if(directive.startsWith('style-src'))return 'style'}
function __dshReportBlockedResource(event){var type=__dshBlockedResourceType(event?.effectiveDirective||event?.violatedDirective);if(type===undefined)return;var url;try{url=new URL(String(event?.blockedURI??''))}catch(error){return}if(url.protocol!=='https:'||url.username||url.password)return;var key=type+'\u0000'+url.origin;if(__dshBlockedResources.has(key)||__dshBlockedResources.size>=64)return;__dshBlockedResources.add(key);__dshPost('resource-blocked',{type:type,origin:url.origin})}
addEventListener('securitypolicyviolation',__dshReportBlockedResource);
var __dshExternalWindows=new Map();
var __dshDeliveredExternalWindowRequests=new Set();
function __dshOpenExternalWindow(url,target,features){var parsed;try{parsed=new URL(String(url))}catch(error){return null}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.href.length>4096)return null;target=String(target??'');features=String(features??'');if(target.length>200||features.length>2000)return null;var requestId=String(++__dshRequest);var handle={closed:false,close:function(){if(handle.closed)return;handle.closed=true;__dshExternalWindows.delete(requestId);__dshPost('external-window-close',{requestId:requestId})},focus:function(){__dshPost('external-window-focus',{requestId:requestId})}};__dshExternalWindows.set(requestId,handle);__dshPost('capability-request',{requestId:requestId,capability:'ui.external-window.open',payload:{url:parsed.href,target:target,features:features}});return handle}
window.open=__dshOpenExternalWindow;
function __dshNativeIdentityRequest(option){option=option??{};var audience,nonce=String(option.nonce??''),includeDisplayName=option.includeDisplayName===true;try{var parsed=new URL(String(option.audience??''));if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.origin!==String(option.audience))throw new Error('身份服务必须是完整 HTTPS 来源');audience=parsed.origin}catch(error){return Promise.reject(error)}if(!/^[A-Za-z0-9_-]{16,256}$/.test(nonce))return Promise.reject(new Error('身份服务 nonce 无效'));var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject,capability:'identity.native.attest'});__dshPost('capability-request',{requestId:requestId,capability:'identity.native.attest',payload:{audience:audience,nonce:nonce,includeDisplayName:includeDisplayName}})})}
window.dshIdentity=Object.freeze({request:__dshNativeIdentityRequest});
window.DshIdentity=window.dshIdentity;
${embeddedNativeIdentityRelayRuntime('__dshNativeIdentityRequest')}
function __dshRuntimeError(error,line,column){var value=error&&typeof error.message==='string'?((typeof error.name==='string'&&error.name&&error.name!=='Error'?error.name+': ':'')+error.message):String(error??'未知脚本错误');var row=Number.isSafeInteger(line)&&line>0?line:undefined;var col=Number.isSafeInteger(column)&&column>0?column:undefined;if(row===undefined&&typeof error?.stack==='string'){var match=error.stack.match(/:(\\d+):(\\d+)\\)?(?:\\n|$)/);if(match){row=Number(match[1]);col=Number(match[2])}}value=value.slice(0,8000);return row===undefined?value:value+'（行 '+row+(col===undefined?'':'，列 '+col)+'）'}
var __dshWindowFunctions=new WeakMap();var __dshScriptWindow;
__dshScriptWindow=new Proxy(window,{get:function(target,property){if(property==='window'||property==='self'||property==='parent'||property==='top'||property==='globalThis')return __dshScriptWindow;var value=Reflect.get(target,property,target);if(typeof value!=='function')return value;var bound=__dshWindowFunctions.get(value);if(bound===undefined){bound=value.bind(target);__dshWindowFunctions.set(value,bound)}return bound},set:function(target,property,value){return Reflect.set(target,property,value,target)}});
  try{Object.defineProperty(document,'defaultView',{configurable:true,value:__dshScriptWindow});Object.defineProperty(document,'parentWindow',{configurable:true,value:__dshScriptWindow})}catch(error){}
  Object.defineProperty(document,'__dshScriptWindow',{configurable:false,enumerable:false,value:__dshScriptWindow});
var __dshAsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function __dshRunClassic(source){return __dshAsyncFunction('window','parent','top','self','globalThis','localStorage','sessionStorage',source)(__dshScriptWindow,__dshScriptWindow,__dshScriptWindow,__dshScriptWindow,__dshScriptWindow,__dshLocalStorage,__dshSessionStorage)}
function __dshInstallCompatibilitySurface(name){if(name!=='mobile-trigger'||document.getElementById('mobile-trigger-btn'))return;var button=document.createElement('button');button.id='mobile-trigger-btn';button.type='button';button.textContent='小手机';button.dataset.dshCompatibilitySurface='mobile-trigger';button.setAttribute('aria-label','打开小手机');Object.assign(button.style,{bottom:'18px',position:'fixed',right:'18px',zIndex:'20'});document.body.appendChild(button)}
function __dshActivateCompatibilitySurface(name){if(name!=='mobile-trigger')return;var overlay=document.getElementById('mobile-phone-overlay');if(overlay?.classList.contains('active'))return;if(typeof window.openMobilePhone==='function'){window.openMobilePhone();return}var button=document.getElementById('mobile-trigger-btn');if(!button)return;if(typeof PointerEvent!=='function'){button.click();return}var rect=button.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,init={bubbles:true,cancelable:true,clientX:x,clientY:y,isPrimary:true,pointerId:1,pointerType:'mouse'};var capture=Object.getOwnPropertyDescriptor(button,'setPointerCapture'),release=Object.getOwnPropertyDescriptor(button,'releasePointerCapture');try{Object.defineProperty(button,'setPointerCapture',{configurable:true,value:function(){}});Object.defineProperty(button,'releasePointerCapture',{configurable:true,value:function(){}});var down=new PointerEvent('pointerdown',init);button.dispatchEvent(down);window.dispatchEvent(new PointerEvent('pointerup',init));if(!down.defaultPrevented)button.click()}finally{if(capture)Object.defineProperty(button,'setPointerCapture',capture);else delete button.setPointerCapture;if(release)Object.defineProperty(button,'releasePointerCapture',release);else delete button.releasePointerCapture}}
function __dshCompatibilityMarkers(){var markers=__dshDeclaredCompatibilityMarkers.slice(),seen=new Set(markers);for(var name of Object.getOwnPropertyNames(window)){if(markers.length>=32)break;if(typeof name!=='string'||name.length>128||!/^__[\\p{L}\\p{N}_-]{1,112}_loaded__$/u.test(name)||seen.has(name))continue;var descriptor=Object.getOwnPropertyDescriptor(window,name);if(descriptor&&Object.prototype.hasOwnProperty.call(descriptor,'value')&&descriptor.value===true){seen.add(name);markers.push(name)}}return markers.sort()}
function __dshReplace(variables,option){var scope=__dshScope(option);var cloned=__dshClone(variables??{});__dshScopes[scope]=cloned;if(scope==='script')__dshSyncScriptTreeData(__dshSnapshot.scriptId,cloned);var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('variables-replace',{requestId:requestId,scope:scope,variables:cloned})})}
function __dshWorldbookMutation(request){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('worldbook-mutate',{requestId:requestId,request:__dshClone(request)})})}
function __dshChatMutation(request){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('chat-mutate',{requestId:requestId,request:__dshClone(request)})})}
function __dshPresetMutation(value){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject,preset:value});__dshPost('preset-replace',{requestId:requestId,preset:__dshClone(value)})})}
function __dshInjectionMutation(prompts){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('injections-replace',{requestId:requestId,prompts:__dshClone(prompts)})})}
var __dshSettingsTimer;
function __dshSettingsRequest(){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject,capability:'settings.extension.persist'});__dshPost('capability-request',{requestId:requestId,capability:'settings.extension.persist',payload:{settings:__dshClone(__dshExtensionSettings)}})})}
function __dshSaveSettingsDebounced(){clearTimeout(__dshSettingsTimer);__dshSettingsTimer=setTimeout(function(){__dshSettingsTimer=undefined;void __dshSettingsRequest().catch(function(error){__dshPost('runtime-error',{value:String(error)})})},300)}
function __dshSaveSettings(){clearTimeout(__dshSettingsTimer);__dshSettingsTimer=undefined;return __dshSettingsRequest()}
function __dshStorageRequest(namespace,operation,key,value,index){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject,capability:'storage.script.persist'});__dshPost('capability-request',{requestId:requestId,capability:'storage.script.persist',payload:{namespace:namespace,operation:operation,...(key===undefined?{}:{key:String(key)}),...(value===undefined?{}:{value:value}),...(index===undefined?{}:{index:index})}})})}
function __dshLocalForage(namespace){var storage={getItem:function(key){return __dshStorageRequest(namespace,'get',key)},setItem:function(key,value){return __dshStorageRequest(namespace,'set',key,value===undefined?null:value)},removeItem:function(key){return __dshStorageRequest(namespace,'remove',key)},clear:function(){return __dshStorageRequest(namespace,'clear')},keys:function(){return __dshStorageRequest(namespace,'keys')},length:function(){return __dshStorageRequest(namespace,'length')},key:function(index){return __dshStorageRequest(namespace,'key',undefined,undefined,index)}};storage.iterate=function(iteratee){return storage.keys().then(async function(keys){var iteration=1;for(var key of keys){var value=await storage.getItem(key);var result=await iteratee(value,key,iteration++);if(result!==undefined)return result}})};return storage}
var __dshLocalForageRoot=__dshLocalForage('localforage\u0000keyvaluepairs');
__dshLocalForageRoot.createInstance=function(option){option=__dshPlain(option)?option:{};var name=String(option.name??'localforage'),store=String(option.storeName??'keyvaluepairs');if(!name||!store)throw new Error('酒馆脚本存储实例名称不能为空');return __dshLocalForage(name+'\u0000'+store)};
var __dshScriptMetadataScheduled=false;
function __dshPersistScriptMetadata(){if(__dshScriptMetadataScheduled)return;__dshScriptMetadataScheduled=true;queueMicrotask(function(){__dshScriptMetadataScheduled=false;var variables=__dshClone(__dshScopes.script??{});variables.__dsh_script_buttons=__dshClone(__dshCurrentScriptButtons);variables.__dsh_script_info=__dshCurrentScriptInfo;void __dshReplace(variables,{type:'script'}).catch(function(error){__dshPost('runtime-error',{value:String(error)})})})}
function __dshReportScriptButtons(){__dshPost('script-buttons',{buttons:__dshClone(__dshCurrentScriptButtons)})}
function __dshWorldbookName(value){var name=String(value??'').trim();if(!name)throw new Error('世界书名称不能为空');return name}
function __dshWorldbookEntries(entries){entries=Array.isArray(entries)?entries:[];var used=new Set();return entries.map(function(value,index){var entry=value&&typeof value==='object'?value:{};var uid=Number.isSafeInteger(entry.uid)&&entry.uid>=0&&entry.uid<1000000?entry.uid:index%1000000;while(used.has(uid))uid=(uid+1)%1000000;used.add(uid);var strategy=entry.strategy&&typeof entry.strategy==='object'?entry.strategy:{};var secondary=strategy.keys_secondary&&typeof strategy.keys_secondary==='object'?strategy.keys_secondary:{};var position=entry.position&&typeof entry.position==='object'?entry.position:{};var recursion=entry.recursion&&typeof entry.recursion==='object'?entry.recursion:{};var effect=entry.effect&&typeof entry.effect==='object'?entry.effect:{};var key=function(item){return item instanceof RegExp?item.toString():String(item)};return {uid:uid,name:String(entry.name??''),enabled:entry.enabled!==false,strategy:{type:['constant','selective','vectorized'].includes(strategy.type)?strategy.type:'constant',keys:Array.isArray(strategy.keys)?strategy.keys.map(key):[],keys_secondary:{logic:['and_any','and_all','not_all','not_any'].includes(secondary.logic)?secondary.logic:'and_any',keys:Array.isArray(secondary.keys)?secondary.keys.map(key):[]},scan_depth:strategy.scan_depth==='same_as_global'?'same_as_global':Number.isFinite(strategy.scan_depth)?Math.max(0,strategy.scan_depth):'same_as_global'},position:{type:['before_character_definition','after_character_definition','before_example_messages','after_example_messages','before_author_note','after_author_note','at_depth','outlet'].includes(position.type)?position.type:'at_depth',role:['system','assistant','user'].includes(position.role)?position.role:'system',depth:Number.isFinite(position.depth)?position.depth:4,order:Number.isFinite(position.order)?position.order:100},content:String(entry.content??''),probability:Number.isFinite(entry.probability)?Math.min(100,Math.max(0,entry.probability)):100,recursion:{prevent_incoming:recursion.prevent_incoming===true,prevent_outgoing:recursion.prevent_outgoing===true,delay_until:Number.isFinite(recursion.delay_until)&&recursion.delay_until>0?recursion.delay_until:null},effect:{sticky:Number.isFinite(effect.sticky)&&effect.sticky>0?effect.sticky:null,cooldown:Number.isFinite(effect.cooldown)&&effect.cooldown>0?effect.cooldown:null,delay:Number.isFinite(effect.delay)&&effect.delay>0?effect.delay:null},...(entry.extra&&typeof entry.extra==='object'?{extra:__dshClone(entry.extra)}:{}),...(entry.ignoreBudget===true?{ignoreBudget:true}:{})}})}
window.getWorldbookNames=function(){return Object.keys(__dshWorldbooks)};
window.getGlobalWorldbookNames=function(){return __dshClone(__dshWorldbookBindings.global)};
window.rebindGlobalWorldbooks=function(names){names=Array.from(new Set((Array.isArray(names)?names:[]).map(__dshWorldbookName)));return __dshWorldbookMutation({format:0,operation:'bind-global-worldbooks',names:names}).then(function(){__dshWorldbookBindings.global=names})};
window.getCharWorldbookNames=function(name){if(name!=='current')throw new Error('当前仅支持查询当前角色卡');return __dshClone(__dshWorldbookBindings.character)};
window.rebindCharWorldbooks=function(name,bindings){if(name!=='current')return Promise.reject(new Error('当前仅支持绑定当前角色卡'));bindings=bindings??{};var primary=bindings.primary==null?null:__dshWorldbookName(bindings.primary);var additional=Array.from(new Set((Array.isArray(bindings.additional)?bindings.additional:[]).map(__dshWorldbookName)));return __dshWorldbookMutation({format:0,operation:'bind-character-worldbooks',primary:primary,additional:additional}).then(function(){__dshWorldbookBindings.character={primary:primary,additional:additional}})};
window.getChatWorldbookName=function(name){if(name!=='current')throw new Error('当前仅支持查询当前聊天');return __dshWorldbookBindings.chat};
window.rebindChatWorldbook=function(name,worldbook){if(name!=='current')return Promise.reject(new Error('当前仅支持绑定当前聊天'));var value=worldbook==null?null:__dshWorldbookName(worldbook);return __dshWorldbookMutation({format:0,operation:'bind-chat-worldbook',name:value}).then(function(){__dshWorldbookBindings.chat=value})};
window.getWorldbook=function(name){name=__dshWorldbookName(name);if(!Object.hasOwn(__dshWorldbooks,name))return Promise.reject(new Error("未能找到世界书 '"+name+"'"));return Promise.resolve(__dshClone(__dshWorldbooks[name]))};
function __dshLegacyWorldbookEntry(entry,index){var type=entry.strategy?.type??'constant';var position=entry.position?.type??'at_depth';var atDepth=position==='at_depth'||position==='outlet';var extra=__dshPlain(entry.extra)?entry.extra:{};var keys=__dshClone(entry.strategy?.keys??[]),filters=__dshClone(entry.strategy?.keys_secondary?.keys??[]);return Object.assign({},__dshClone(extra),{uid:entry.uid,display_index:index,comment:entry.name??'',enabled:entry.enabled!==false,type:type,position:atDepth?'at_depth_as_'+(entry.position?.role??'system'):position,depth:atDepth?(entry.position?.depth??4):null,order:entry.position?.order??100,probability:entry.probability??100,keys:keys,key:__dshClone(keys),logic:entry.strategy?.keys_secondary?.logic??'and_any',filters:filters,filter:__dshClone(filters),scan_depth:entry.strategy?.scan_depth??'same_as_global',case_sensitive:extra.case_sensitive??'same_as_global',match_whole_words:extra.match_whole_words??'same_as_global',use_group_scoring:extra.use_group_scoring??'same_as_global',automation_id:extra.automation_id??null,exclude_recursion:entry.recursion?.prevent_incoming===true,prevent_recursion:entry.recursion?.prevent_outgoing===true,delay_until_recursion:entry.recursion?.delay_until??false,content:entry.content??'',group:extra.group??'',group_prioritized:extra.group_prioritized===true,group_weight:extra.group_weight??100,sticky:entry.effect?.sticky??null,cooldown:entry.effect?.cooldown??null,delay:entry.effect?.delay??null,constant:type==='constant',disable:entry.enabled===false})}
function __dshWorldbookFromLegacy(value){var entry=__dshPlain(value)?value:{};var position=typeof entry.position==='string'?entry.position:'before_character_definition';var atDepthRoles={at_depth_as_system:'system',at_depth_as_assistant:'assistant',at_depth_as_user:'user'};var atDepth=Object.hasOwn(atDepthRoles,position);var ordinaryPositions=['before_character_definition','after_character_definition','before_example_messages','after_example_messages','before_author_note','after_author_note'];var keys=Array.isArray(entry.keys)?entry.keys:Array.isArray(entry.key)?entry.key:[];var filters=Array.isArray(entry.filters)?entry.filters:Array.isArray(entry.filter)?entry.filter:[];var type=['constant','selective','vectorized'].includes(entry.type)?entry.type:'selective';var extra={case_sensitive:typeof entry.case_sensitive==='boolean'?entry.case_sensitive:'same_as_global',match_whole_words:typeof entry.match_whole_words==='boolean'?entry.match_whole_words:'same_as_global',use_group_scoring:typeof entry.use_group_scoring==='boolean'?entry.use_group_scoring:'same_as_global',automation_id:typeof entry.automation_id==='string'?entry.automation_id:null,group:String(entry.group??''),group_prioritized:entry.group_prioritized===true,group_weight:Number.isFinite(entry.group_weight)?entry.group_weight:100};return {...(Number.isSafeInteger(entry.uid)&&entry.uid>=0&&entry.uid<1000000?{uid:entry.uid}:{}),name:String(entry.comment??''),enabled:entry.enabled!==false,strategy:{type:type,keys:keys,keys_secondary:{logic:['and_any','and_all','not_all','not_any'].includes(entry.logic)?entry.logic:'and_any',keys:filters},scan_depth:entry.scan_depth==='same_as_global'?'same_as_global':Number.isFinite(entry.scan_depth)?entry.scan_depth:'same_as_global'},position:{type:atDepth?'at_depth':ordinaryPositions.includes(position)?position:'before_character_definition',role:atDepth?atDepthRoles[position]:'system',depth:Number.isFinite(entry.depth)?entry.depth:4,order:Number.isFinite(entry.order)?entry.order:100},content:String(entry.content??''),probability:Number.isFinite(entry.probability)?entry.probability:100,recursion:{prevent_incoming:entry.exclude_recursion===true,prevent_outgoing:entry.prevent_recursion===true,delay_until:Number.isFinite(entry.delay_until_recursion)&&entry.delay_until_recursion>0?entry.delay_until_recursion:null},effect:{sticky:Number.isFinite(entry.sticky)&&entry.sticky>0?entry.sticky:null,cooldown:Number.isFinite(entry.cooldown)&&entry.cooldown>0?entry.cooldown:null,delay:Number.isFinite(entry.delay)&&entry.delay>0?entry.delay:null},extra:extra}}
function __dshWorldbookFromLegacyEntries(entries){return (Array.isArray(entries)?entries:[]).map(__dshWorldbookFromLegacy)}
function __dshLorebookFilter(entry,filter){return Object.entries(filter).every(function(pair){var actual=entry[pair[0]],expected=pair[1];if(Array.isArray(actual))return Array.isArray(expected)&&expected.every(function(value){return actual.includes(value)});if(typeof actual==='string')return typeof expected==='string'&&actual.includes(expected);return actual===expected})}
window.getLorebookEntries=function(name,option){var filter=option?.filter??'none';if(filter!=='none'&&!__dshPlain(filter))return Promise.reject(new Error("世界书条目筛选必须是对象或 'none'"));return window.getWorldbook(name).then(function(entries){var result=entries.map(__dshLegacyWorldbookEntry);return filter==='none'?result:result.filter(function(entry){return __dshLorebookFilter(entry,filter)})})};
window.replaceLorebookEntries=function(name,entries){return window.replaceWorldbook(name,__dshWorldbookFromLegacyEntries(entries))};
window.updateLorebookEntriesWith=function(name,updater){return window.getLorebookEntries(name).then(updater).then(function(entries){return window.replaceLorebookEntries(name,entries)}).then(function(){return window.getLorebookEntries(name)})};
window.setLorebookEntries=function(name,entries){var patches=Array.isArray(entries)?entries:[];return window.updateLorebookEntriesWith(name,function(current){for(var patch of patches){if(!__dshPlain(patch)||!Number.isSafeInteger(patch.uid))continue;var target=current.find(function(entry){return entry.uid===patch.uid});if(target)__dshMerge(target,patch)}return current})};
window.createLorebookEntries=function(name,entries){var newUids=[];return window.updateLorebookEntriesWith(name,function(current){var used=new Set(current.map(function(entry){return entry.uid}));var added=(Array.isArray(entries)?entries:[]).map(function(entry){var uid=0;while(uid<1000000&&used.has(uid))uid++;if(uid===1000000)throw new Error('无法找到可用的世界书条目 uid');used.add(uid);newUids.push(uid);return Object.assign({},__dshPlain(entry)?__dshClone(entry):{},{uid:uid})});return current.concat(added)}).then(function(entries){return {entries:entries,new_uids:newUids}})};
window.deleteLorebookEntries=function(name,uids){var targets=new Set((Array.isArray(uids)?uids:[]).filter(Number.isSafeInteger));var occurred=false;return window.updateLorebookEntriesWith(name,function(current){var next=current.filter(function(entry){if(targets.has(entry.uid)){occurred=true;return false}return true});return next}).then(function(entries){return {entries:entries,delete_occurred:occurred}})};
window.createLorebookEntry=function(name,entry){return window.createLorebookEntries(name,[entry]).then(function(result){return result.new_uids[0]})};
window.deleteLorebookEntry=function(name,uid){return window.deleteLorebookEntries(name,[uid]).then(function(result){return result.delete_occurred})};
window.createWorldbook=function(name,entries){name=__dshWorldbookName(name);if(Object.hasOwn(__dshWorldbooks,name))return Promise.resolve(false);var next=__dshWorldbookEntries(entries);return __dshWorldbookMutation({format:0,operation:'replace-worldbook',name:name,entries:next}).then(function(){__dshWorldbooks[name]=next;return true})};
window.createOrReplaceWorldbook=function(name,entries){name=__dshWorldbookName(name);var created=!Object.hasOwn(__dshWorldbooks,name);var next=__dshWorldbookEntries(entries);return __dshWorldbookMutation({format:0,operation:'replace-worldbook',name:name,entries:next}).then(function(){__dshWorldbooks[name]=next;return created})};
window.replaceWorldbook=function(name,entries){name=__dshWorldbookName(name);if(!Object.hasOwn(__dshWorldbooks,name))return Promise.reject(new Error("未能找到世界书 '"+name+"'"));var next=__dshWorldbookEntries(entries);return __dshWorldbookMutation({format:0,operation:'replace-worldbook',name:name,entries:next}).then(function(){__dshWorldbooks[name]=next})};
window.deleteWorldbook=function(name){name=__dshWorldbookName(name);if(!Object.hasOwn(__dshWorldbooks,name))return Promise.resolve(false);return __dshWorldbookMutation({format:0,operation:'delete-worldbook',name:name}).then(function(){delete __dshWorldbooks[name];return true})};
window.updateWorldbookWith=function(name,updater){return window.getWorldbook(name).then(updater).then(function(entries){return window.replaceWorldbook(name,entries)}).then(function(){return window.getWorldbook(name)})};
window.createWorldbookEntries=function(name,entries){var start=0;return window.updateWorldbookWith(name,function(current){start=current.length;return current.concat(Array.isArray(entries)?entries:[])}).then(function(worldbook){return {worldbook:worldbook,new_entries:worldbook.slice(start)}})};
window.deleteWorldbookEntries=function(name,predicate){var removed=[];return window.updateWorldbookWith(name,function(current){return current.filter(function(entry){if(predicate(entry)){removed.push(entry);return false}return true})}).then(function(worldbook){return {worldbook:worldbook,deleted_entries:removed}})};
window.getOrCreateChatWorldbook=function(chatName,worldbookName){if(chatName!=='current')return Promise.reject(new Error('当前仅支持当前聊天'));if(__dshWorldbookBindings.chat&&Object.hasOwn(__dshWorldbooks,__dshWorldbookBindings.chat))return Promise.resolve(__dshWorldbookBindings.chat);var name=worldbookName?__dshWorldbookName(worldbookName):'聊天世界书-'+Date.now();return window.createWorldbook(name).then(function(){return window.rebindChatWorldbook('current',name)}).then(function(){return name})};
window.getLorebooks=window.getWorldbookNames;window.deleteLorebook=window.deleteWorldbook;window.createLorebook=window.createWorldbook;window.getCharLorebooks=function(){return window.getCharWorldbookNames('current')};window.getCurrentCharPrimaryLorebook=function(){return window.getCharWorldbookNames('current').primary};window.setCurrentCharLorebooks=function(value){return window.rebindCharWorldbooks('current',{...window.getCharWorldbookNames('current'),...value})};window.getChatLorebook=function(){return window.getChatWorldbookName('current')};window.setChatLorebook=function(value){return window.rebindChatWorldbook('current',value)};window.getOrCreateChatLorebook=function(name){return window.getOrCreateChatWorldbook('current',name)};
function __DshStorage(initial,persist){this.data=new Map(Object.entries(initial??{}).map(function(pair){return [String(pair[0]),String(pair[1])]}));this.persist=persist}
Object.defineProperty(__DshStorage.prototype,'length',{get:function(){return this.data.size}});
__DshStorage.prototype.key=function(index){return Array.from(this.data.keys())[Number(index)]??null};
__DshStorage.prototype.getItem=function(key){key=String(key);return this.data.has(key)?this.data.get(key):null};
__DshStorage.prototype.setItem=function(key,value){this.data.set(String(key),String(value));this.persist?.(this.data)};
__DshStorage.prototype.removeItem=function(key){this.data.delete(String(key));this.persist?.(this.data)};
__DshStorage.prototype.clear=function(){this.data.clear();this.persist?.(this.data)};
var __dshStorageScheduled=false;
var __dshLocalStorage=new __DshStorage(__dshScopes.script?.__dsh_local_storage,function(data){if(__dshStorageScheduled)return;__dshStorageScheduled=true;queueMicrotask(function(){__dshStorageScheduled=false;var variables=__dshClone(__dshScopes.script??{});variables.__dsh_local_storage=Object.fromEntries(data);void __dshReplace(variables,{type:'script'}).catch(function(error){__dshPost('runtime-error',{value:String(error)})})})});
var __dshSessionStorage=new __DshStorage();
try{Object.defineProperty(window,'localStorage',{configurable:true,value:__dshLocalStorage})}catch(error){}
try{Object.defineProperty(window,'sessionStorage',{configurable:true,value:__dshSessionStorage})}catch(error){}
window.getVariables=function(option){return __dshClone(__dshScopes[__dshScope(option)]??{})};
window.replaceVariables=__dshReplace;
window.updateVariablesWith=function(updater,option){var current=window.getVariables(option);return Promise.resolve(updater(current)).then(function(next){return __dshReplace(next,option).then(function(){return next})})};
window.insertOrAssignVariables=function(variables,option){return window.updateVariablesWith(function(current){return __dshMerge(current,variables)},option)};
window.insertVariables=function(variables,option){return window.updateVariablesWith(function(current){return __dshMerge({},variables,current)},option)};
window.deleteVariable=function(path,option){var occurred=false;return window.updateVariablesWith(function(current){occurred=__dshUnset(current,path);return current},option).then(function(variables){return {variables:variables,delete_occurred:occurred}})};
window.getAllVariables=function(){return __dshClone(__dshMerge({},__dshScopes.global,__dshScopes.character,__dshScopes.script,__dshScopes.chat,__dshScopes.message))};
var __dshInjectionWrite=Promise.resolve(),__dshInjectionRefresh=0;
var __dshInjectionDefinitions=new Map(__dshInjectedPrompts.map(function(prompt){return [prompt.id,{prompt:prompt}]}));
function __dshPersistInjections(){var prompts=__dshClone(__dshInjectedPrompts);var write=__dshInjectionMutation(prompts).catch(function(error){__dshPost('runtime-error',{value:String(error)})});__dshInjectionWrite=Promise.all([__dshInjectionWrite,write]).then(function(){});return write}
function __dshInjectedPrompt(value,index,once){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('注入提示词 '+index+' 必须是对象');var id=String(value.id??'').trim();if(!id||id.length>512)throw new Error('注入提示词 '+index+' 的 id 无效');if(!['before','after','in_chat','none'].includes(value.position))throw new Error('注入提示词 '+id+' 的 position 无效');if(!['system','assistant','user'].includes(value.role))throw new Error('注入提示词 '+id+' 的 role 无效');if(value.should_scan!==undefined&&typeof value.should_scan!=='boolean')throw new Error('注入提示词 '+id+' 的 should_scan 无效');var depth=Number(value.depth);if(!Number.isSafeInteger(depth)||depth<0||depth>20000)throw new Error('注入提示词 '+id+' 的 depth 无效');var content=String(value.content??'');if(content.length>262144)throw new Error('注入提示词 '+id+' 过长');return {id:id,position:value.position,depth:depth,role:value.role,content:content,shouldScan:value.should_scan===true,once:once}}
function __dshApplyInjectionFilters(version,definitions,enabled){if(version!==__dshInjectionRefresh)return;var prompts=definitions.flatMap(function(definition,index){return enabled[index]?[definition.prompt]:[]});if(JSON.stringify(prompts)===JSON.stringify(__dshInjectedPrompts))return;__dshInjectedPrompts=prompts;return __dshPersistInjections()}
function __dshRefreshInjections(){var version=++__dshInjectionRefresh,definitions=Array.from(__dshInjectionDefinitions.values()),enabled=definitions.map(function(definition){if(typeof definition.filter!=='function')return true;try{return definition.filter()}catch(error){__dshPost('runtime-error',{value:String(error)});return false}});var async=enabled.some(function(value){return value&&typeof value.then==='function'});var task=async?Promise.all(enabled.map(function(value){return Promise.resolve(value).catch(function(error){__dshPost('runtime-error',{value:String(error)});return false})})).then(function(values){return __dshApplyInjectionFilters(version,definitions,values)}):Promise.resolve(__dshApplyInjectionFilters(version,definitions,enabled));return task.then(function(){})}
window.injectPrompts=function(prompts,option){if(!Array.isArray(prompts)||prompts.length>256)throw new Error('注入提示词列表无效');if(option?.once!==undefined&&typeof option.once!=='boolean')throw new Error('注入提示词 once 无效');var prepared=prompts.map(function(source,index){return {source:source,prompt:__dshInjectedPrompt(source,index,option?.once===true)}});if(prepared.reduce(function(total,item){return total+item.prompt.content.length},0)>1048576)throw new Error('注入提示词合计过长');var ids=prepared.map(function(item){return item.prompt.id});for(var item of prepared)__dshInjectionDefinitions.set(item.prompt.id,{prompt:item.prompt,filter:item.source.filter});void __dshRefreshInjections();return {uninject:function(){window.uninjectPrompts(ids)}}};
window.uninjectPrompts=function(ids){var targets=new Set((Array.isArray(ids)?ids:[]).map(String));if(targets.size===0)return;for(var id of targets)__dshInjectionDefinitions.delete(id);__dshInjectionRefresh++;var next=__dshInjectedPrompts.filter(function(prompt){return !targets.has(prompt.id)});if(next.length===__dshInjectedPrompts.length)return;__dshInjectedPrompts=next;__dshPersistInjections()};
var __dshExtensionPromptTypes=Object.freeze({NONE:-1,IN_PROMPT:0,IN_CHAT:1,BEFORE_PROMPT:2});
var __dshExtensionPromptRoles=Object.freeze({SYSTEM:0,USER:1,ASSISTANT:2});
function __dshExtensionPromptPosition(value){value=Number(value);if(value===2)return 'before';if(value===0)return 'after';if(value===1)return 'in_chat';if(value===-1)return 'none';throw new Error('不支持的酒馆提示词位置：'+String(value))}
function __dshExtensionPromptPositionValue(value){return value==='before'?2:value==='after'?0:value==='in_chat'?1:-1}
function __dshExtensionPromptRole(value){if(typeof value==='string'){value=value.toLowerCase().trim();if(value==='user')return 'user';if(value==='assistant')return 'assistant';return 'system'}value=Number(value);return value===1?'user':value===2?'assistant':'system'}
function __dshExtensionPromptRoleValue(value){return value==='user'?1:value==='assistant'?2:0}
var __dshExtensionPrompts={};
for(var __dshExistingPrompt of __dshInjectedPrompts)__dshExtensionPrompts[__dshExistingPrompt.id]={value:__dshExistingPrompt.content,position:__dshExtensionPromptPositionValue(__dshExistingPrompt.position),depth:__dshExistingPrompt.depth,scan:__dshExistingPrompt.shouldScan,role:__dshExtensionPromptRoleValue(__dshExistingPrompt.role),filter:null};
function __dshSetExtensionPrompt(key,value,position,depth,scan,role,filter,once){var id=String(key??'').trim();if(!id||id.length>512)throw new Error('酒馆提示词 id 无效');var promptPosition=__dshExtensionPromptPosition(position),promptRole=__dshExtensionPromptRole(role),content=String(value??''),promptDepth=Number(depth),shouldScan=!!scan;if(!Number.isSafeInteger(promptDepth)||promptDepth<0||promptDepth>20000)throw new Error('酒馆提示词 depth 无效');if(filter!==null&&filter!==undefined&&typeof filter!=='function')throw new Error('酒馆提示词 filter 必须是函数');__dshExtensionPrompts[id]={value:content,position:Number(position),depth:promptDepth,scan:shouldScan,role:__dshExtensionPromptRoleValue(promptRole),filter:filter??null};if(content===''){__dshInjectionDefinitions.delete(id);void __dshRefreshInjections();return}var prompt=__dshInjectedPrompt({id:id,position:promptPosition,depth:promptDepth,role:promptRole,content:content,should_scan:shouldScan},0,once===true);__dshInjectionDefinitions.set(id,{prompt:prompt,filter:filter});void __dshRefreshInjections()}
window.extension_prompt_types=__dshExtensionPromptTypes;
window.extension_prompt_roles=__dshExtensionPromptRoles;
window.extension_prompts=__dshExtensionPrompts;
window.setExtensionPrompt=function(key,value,position,depth,scan,role,filter){__dshSetExtensionPrompt(key,value,position,depth,scan,role,filter,false)};
function __dshReadSlashValue(source,start){var index=start;if(source[index]==='"'||source[index]==="'"){var quote=source[index++],value='';while(index<source.length){var character=source[index++];if(character==='\\\\'&&index<source.length){value+=source[index++];continue}if(character===quote)return {value:value,end:index};value+=character}return {value:value,end:index}}var end=index;while(end<source.length&&!/\\s/u.test(source[end]))end++;return {value:source.slice(index,end),end:end}}
function __dshSlashArguments(source){var options={},index=0;while(index<source.length){while(index<source.length&&/\\s/u.test(source[index]))index++;var match=source.slice(index).match(/^([A-Za-z][\\w-]*)=/u);if(!match)break;index+=match[0].length;var token=__dshReadSlashValue(source,index);options[match[1].toLowerCase()]=token.value;index=token.end}while(index<source.length&&/\\s/u.test(source[index]))index++;var value=source.slice(index);if(value[0]==='"'||value[0]==="'"){var token=__dshReadSlashValue(value,0);if(value.slice(token.end).trim()==='')value=token.value}return {options:options,value:value}}
function __dshSlashBoolean(value){return ['1','true','yes','on'].includes(String(value??'').toLowerCase())}
function __dshPromptSlash(command){var inject=String(command).match(/^\\/inject(?:\\s+([\\s\\S]*))?$/iu);if(inject){var parsed=__dshSlashArguments(inject[1]??''),option=parsed.options,id=String(option.id??'').trim()||Math.random().toString(36).slice(2),positionName=String(option.position??'after').toLowerCase(),positions={before:2,after:0,chat:1,none:-1},position=positions[positionName]??0,depth=Number(option.depth??4),roleName=String(option.role??'system').toLowerCase(),roles={system:0,user:1,assistant:2},role=roles[roleName]??0;if(!Number.isSafeInteger(depth)||depth<0||depth>20000)depth=4;var key='script_inject_'+id;__dshSetExtensionPrompt(key,parsed.value,position,depth,__dshSlashBoolean(option.scan),role,null,__dshSlashBoolean(option.ephemeral));return {matched:true,value:id}}var flush=String(command).match(/^\\/flushinjects?(?:\\s+([\\s\\S]*))?$/iu);if(flush){var id=String(flush[1]??'').trim(),prefix='script_inject_',targets=Object.keys(__dshExtensionPrompts).filter(function(key){return key.startsWith(prefix)&&(!id||key===prefix+id)});for(var key of targets)__dshSetExtensionPrompt(key,'',__dshExtensionPrompts[key].position,__dshExtensionPrompts[key].depth,__dshExtensionPrompts[key].scan,__dshExtensionPrompts[key].role,null,false);return {matched:true,value:''}}return {matched:false}}
function __dshConsumeOnceInjections(){var ids=new Set(__dshInjectedPrompts.filter(function(prompt){return prompt.once===true}).map(function(prompt){return prompt.id}));if(ids.size===0)return;for(var id of ids)__dshInjectionDefinitions.delete(id);__dshInjectionRefresh++;__dshInjectedPrompts=__dshInjectedPrompts.filter(function(prompt){return !ids.has(prompt.id)});__dshPersistInjections()}
window.waitGlobalInitialized=function(name){return Promise.resolve(window[name])};
window.getScriptId=function(){return __dshSnapshot.scriptId};
window.getScriptName=function(){return __dshSnapshot.scriptName};
window.getScriptInfo=function(){return __dshCurrentScriptInfo};
window.replaceScriptInfo=function(info){__dshCurrentScriptInfo=String(info??'').slice(0,8000);__dshPersistScriptMetadata()};
window.getScriptButtons=function(){return __dshClone(__dshCurrentScriptButtons)};
window.replaceScriptButtons=function(buttons){__dshCurrentScriptButtons=__dshScriptButtons(buttons);__dshReportScriptButtons();__dshPersistScriptMetadata()};
window.updateScriptButtonsWith=function(updater){var next=updater(window.getScriptButtons());if(next&&typeof next.then==='function')return next.then(function(value){window.replaceScriptButtons(value);return window.getScriptButtons()});window.replaceScriptButtons(next);return window.getScriptButtons()};
window.getCurrentCharId=function(){return __dshSnapshot.characterId};
window.getCurrentCharacterId=window.getCurrentCharId;
window.getCurrentCharacterName=function(){return __dshSnapshot.characterName};
window.getCurrentChatId=function(){return __dshSnapshot.chatId};
window.getCurrentPersonaName=function(){return __dshSnapshot.persona?.name??null};
window.getCurrentPersonaId=function(){return __dshSnapshot.persona?.id??null};
function __dshPresetName(name){if(name!=='in_use')throw new Error("当前仅支持正在使用的预设 'in_use'");if(!__dshPreset)throw new Error('当前会话没有预设');return name}
window.getPresetNames=function(){return __dshPreset?['in_use']:[]};
window.getLoadedPresetName=function(){return __dshPreset?.name??''};
window.getPreset=function(name){__dshPresetName(name);return __dshClone(__dshPreset.value)};
window.replacePreset=function(name,value){__dshPresetName(name);if(!__dshPlain(value))return Promise.reject(new Error('预设必须是对象'));var next=__dshClone(value);return __dshPresetMutation(next).then(function(){__dshPreset={name:__dshPreset.name,revision:__dshPreset.revision+1,value:next}})};
window.updatePresetWith=function(name,updater,option){var current=window.getPreset(name);return Promise.resolve(updater(current)).then(function(next){return window.replacePreset(name,next,option).then(function(){return window.getPreset(name)})})};
window.setPreset=function(name,value,option){if(value!==undefined&&!__dshPlain(value))return Promise.reject(new Error('预设修改必须是对象'));return window.updatePresetWith(name,function(current){return __dshMerge({},current,value??{})},option)};
window.isPresetSystemPrompt=function(prompt){return ['main','nsfw','jailbreak','enhanceDefinitions'].includes(String(prompt?.id??''))};
window.isPresetPlaceholderPrompt=function(prompt){return ['worldInfoBefore','personaDescription','charDescription','charPersonality','scenario','worldInfoAfter','dialogueExamples','chatHistory'].includes(String(prompt?.id??''))};
window.isPresetNormalPrompt=function(prompt){return !window.isPresetSystemPrompt(prompt)&&!window.isPresetPlaceholderPrompt(prompt)};
function __dshPresetRegexOption(option){if(!__dshPlain(option)||option.type!=='preset'||(option.name!==undefined&&option.name!=='in_use'))throw new Error("当前仅支持写入正在使用的预设正则 { type: 'preset', name: 'in_use' }");__dshPresetName('in_use')}
function __dshPresetRegexes(){var extensions=__dshPreset?.value?.extensions;return Array.isArray(extensions?.regex_scripts)?extensions.regex_scripts:[]}
function __dshCharacterRegexOption(option){var name=option?.name;if(name!==undefined&&name!=='current'&&name!==__dshSnapshot.characterName)throw new Error('当前仅支持查询当前角色卡正则');return __dshCharacterRegexScripts}
function __dshLegacyRegexes(option){option=option??{};var scope=option.scope??'all',enableState=option.enable_state??'all';if(!['all','global','character'].includes(scope))throw new Error("提供的 scope 无效, 请提供 'all', 'global' 或 'character'");if(!['all','enabled','disabled'].includes(enableState))throw new Error("提供的 enable_state 无效, 请提供 'all', 'enabled' 或 'disabled'");var regexes=[];if(scope==='all'||scope==='global')regexes=regexes.concat(__dshGlobalRegexScripts.map(function(regex){return Object.assign({},regex,{scope:'global'})}));if(scope==='all'||scope==='character')regexes=regexes.concat(__dshCharacterRegexOption({type:'character'}).map(function(regex){return Object.assign({},regex,{scope:'character'})}));return enableState==='all'?regexes:regexes.filter(function(regex){return regex.enabled===(enableState==='enabled')})}
window.isCharacterTavernRegexesEnabled=function(){return __dshCharacterRegexScripts.length>0};
window.getTavernRegexes=function(option){if(option?.type===undefined)return __dshClone(__dshLegacyRegexes(option));if(option.type==='preset'){__dshPresetRegexOption(option);return __dshClone(__dshPresetRegexes())}if(option.type==='character')return __dshClone(__dshCharacterRegexOption(option));if(option.type==='global')return __dshClone(__dshGlobalRegexScripts);throw new Error('不支持的酒馆正则类型: '+String(option.type))};
window.replaceTavernRegexes=function(regexes,option){try{__dshPresetRegexOption(option);if(!Array.isArray(regexes))throw new Error('预设正则必须是数组');var replacement=__dshClone(regexes);for(var index=0;index<replacement.length;index++)if(replacement[index]?.script_name==='')replacement[index].script_name='未命名-'+String(replacement[index]?.id??index+1);var next=__dshClone(__dshPreset.value);if(!__dshPlain(next.extensions))next.extensions={};next.extensions.regex_scripts=replacement;return __dshPresetMutation(next).then(function(){__dshPreset={name:__dshPreset.name,revision:__dshPreset.revision+1,value:next};return window.eventEmit(window.tavern_events.CHAT_CHANGED,__dshSnapshot.chatId)})}catch(error){return Promise.reject(error)}};
window.updateTavernRegexesWith=function(updater,option){var current=window.getTavernRegexes(option);return Promise.resolve(updater(current)).then(function(next){return window.replaceTavernRegexes(next,option).then(function(){return window.getTavernRegexes(option)})})};
var __dshScriptTreeId=0;
function __dshNormalizeScript(value,seen){var script=__dshPlain(value)?value:{};var id=String(script.id??'').trim()||'dsh-script-'+Date.now()+'-'+(++__dshScriptTreeId);var original=id,suffix=1;while(seen.has(id))id=original+'-'+(++suffix);seen.add(id);var button=__dshPlain(script.button)?script.button:{};var exported=__dshPlain(script.export_with)?script.export_with:{};return {type:'script',enabled:script.enabled===true,name:String(script.name??''),id:id,content:String(script.content??''),info:String(script.info??''),button:{enabled:button.enabled!==false,buttons:__dshScriptButtons(button.buttons)},data:__dshPlain(script.data)?__dshClone(script.data):{},export_with:{data:exported.data!==false,button:exported.button!==false}}}
function __dshNormalizeScriptTrees(value){if(!Array.isArray(value))throw new Error('脚本树必须是数组');var trees=value,seen=new Set(),count=0;if(trees.length>512)throw new Error('脚本树数量超过限制');return trees.map(function(value){var tree=__dshPlain(value)?value:{};count++;if(tree.type!=='folder')return __dshNormalizeScript(tree,seen);var id=String(tree.id??'').trim()||'dsh-folder-'+Date.now()+'-'+(++__dshScriptTreeId);var original=id,suffix=1;while(seen.has(id))id=original+'-'+(++suffix);seen.add(id);var children=Array.isArray(tree.scripts)?tree.scripts:[];count+=children.length;if(count>512)throw new Error('脚本树数量超过限制');return {type:'folder',enabled:tree.enabled===true,name:String(tree.name??''),id:id,icon:String(tree.icon??'fa-solid fa-folder'),color:String(tree.color??''),scripts:children.map(function(script){return __dshNormalizeScript(script,seen)})}})}
function __dshScriptTreeScope(option){if(!__dshPlain(option)||!['global','preset','character'].includes(option.type))throw new Error("脚本类型必须是 'global'、'preset' 或 'character'");return option.type}
function __dshSetScriptTrees(scope,trees){if(scope==='global')__dshGlobalScriptTrees=trees;else if(scope==='preset')__dshPresetScriptTrees=trees;else __dshCharacterScriptTrees=trees}
function __dshSyncScriptTreeData(id,data){var trees=__dshSnapshot.scriptScope==='global'?__dshGlobalScriptTrees:__dshSnapshot.scriptScope==='preset'?__dshPresetScriptTrees:__dshCharacterScriptTrees;for(var tree of trees){var scripts=tree?.type==='folder'?tree.scripts:[tree];for(var script of Array.isArray(scripts)?scripts:[])if(script?.id===id)script.data=__dshClone(data)}}
window.getScriptTrees=function(option){var scope=__dshScriptTreeScope(option);return __dshClone(scope==='global'?__dshGlobalScriptTrees:scope==='preset'?__dshPresetScriptTrees:__dshCharacterScriptTrees)};
window.replaceScriptTrees=function(trees,option){var scope=__dshScriptTreeScope(option),next=__dshNormalizeScriptTrees(trees);__dshSetScriptTrees(scope,next);void __dshWorldbookMutation({format:0,operation:'replace-script-trees',scope:scope,trees:next}).catch(function(error){__dshPost('runtime-error',{value:String(error)})})};
window.updateScriptTreesWith=function(updater,option){var current=window.getScriptTrees(option),next=updater(current);if(next&&typeof next.then==='function')return next.then(function(value){window.replaceScriptTrees(value,option);return window.getScriptTrees(option)});window.replaceScriptTrees(next,option);return window.getScriptTrees(option)};
function __dshEnabledScripts(trees){return trees.flatMap(function(tree){if(tree?.type==='folder')return tree.enabled===false?[]:(Array.isArray(tree.scripts)?tree.scripts:[]).filter(function(script){return script?.enabled!==false});return tree?.enabled===false?[]:[tree]})}
window.getAllEnabledScriptButtons=function(){var result={};for(var tree of __dshEnabledScripts(__dshGlobalScriptTrees.concat(__dshPresetScriptTrees,__dshCharacterScriptTrees))){if(tree?.type!=='script'||tree.button?.enabled!==true)continue;var buttons=(Array.isArray(tree.button.buttons)?tree.button.buttons:[]).filter(function(button){return button?.visible!==false}).map(function(button){return {button_id:String(tree.id)+'_'+String(button.name),button_name:String(button.name)}});if(buttons.length>0)result[String(tree.id)]=buttons}return __dshClone(result)};
window.appendInexistentScriptButtons=function(buttons){var current=window.getScriptButtons();var names=new Set(current.map(function(button){return button.name}));window.replaceScriptButtons(current.concat(__dshScriptButtons(buttons).filter(function(button){return !names.has(button.name)})))};
window.getButtonEvent=function(name){return __dshSnapshot.scriptId+'_'+String(name)};
window.getLastMessageId=function(){return Math.max(-1,__dshMessages.length-1)};
window.getCurrentMessageId=window.getLastMessageId;
function __dshMessageId(value){if(__dshMessages.length===0)return;var id=Number(String(value).replaceAll('{{lastMessageId}}',String(__dshMessages.length-1)));if(!Number.isInteger(id))return;if(id<0)id=__dshMessages.length+id;if(id<0||id>=__dshMessages.length)return;return id}
function __dshMessageRange(range){if(__dshMessages.length===0)return [];var source=String(range??('0-'+(__dshMessages.length-1))).replaceAll('{{lastMessageId}}',String(__dshMessages.length-1));var match=source.match(/^(-?\\d+)(?:-(-?\\d+))?$/);if(!match)return [];var left=__dshMessageId(match[1]);var right=__dshMessageId(match[2]??match[1]);if(left===undefined||right===undefined)return [];var start=Math.min(left,right),end=Math.max(left,right);return __dshMessages.slice(start,end+1)}
function __dshMessageBoundary(value){if(value==='end')return __dshMessages.length;var id=Number(String(value).replaceAll('{{lastMessageId}}',String(__dshMessages.length-1)));if(!Number.isInteger(id))return __dshMessages.length;if(id<0)id=__dshMessages.length+id+1;return Math.min(__dshMessages.length,Math.max(0,id))}
function __dshReindexMessages(){__dshMessages=__dshMessages.map(function(message,messageId){return Object.assign({},message,{messageId:messageId})})}
function __dshMessageSignature(messages){return JSON.stringify((messages??[]).map(function(message){return [message.seq,message.role,message.text,message.isHidden===true]}))}
var __dshChatReservedFields=new Set(['name','is_user','is_system','is_name','is_hidden','send_date','mes','force_avatar','original_avatar','swipe_id','swipes','variables','swipe_info','extra','token_count','reasoning','reasoning_content','reasoning_duration','gen_started','gen_finished']);
function __dshChatAnnotations(value){if(!__dshPlain(value))return {};var result={};for(var pair of Object.entries(value))if(!__dshChatReservedFields.has(pair[0]))result[pair[0]]=pair[1];var encoded=JSON.stringify(result);return encoded===undefined?{}:JSON.parse(encoded)}
function __dshSyncSillyTavernChat(){if(!window.SillyTavern)return;window.SillyTavern.chat=__dshMessages.map(function(message){return Object.assign({},__dshChatAnnotations(message.annotations),{name:message.role==='user'?(__dshSnapshot.userName??'用户'):__dshSnapshot.characterName,is_user:message.role==='user',is_system:false,is_hidden:message.isHidden===true,mes:message.text,swipe_id:0,swipes:[message.text],variables:[message.data??{}],swipe_info:[message.extra??{}],extra:message.extra??{}})})}
var __dshSaveChatQueue=Promise.resolve();
function __dshSaveChat(){var next=__dshSaveChatQueue.catch(function(){return undefined}).then(function(){var updates=[];for(var messageId=0;messageId<__dshMessages.length;messageId++){var message=__dshMessages[messageId],current=window.SillyTavern?.chat?.[messageId];if(!message||!__dshPlain(current))continue;var value=__dshChatAnnotations(current),before=__dshChatAnnotations(message.annotations);if(JSON.stringify(value)!==JSON.stringify(before))updates.push({message_id:messageId,seq:message.seq,value:value})}if(updates.length===0)return;return __dshChatMutation({format:0,operation:'replace-message-annotations',messages:updates.map(function(update){return {message_id:update.message_id,value:update.value}})}).then(function(){for(var update of updates){var index=__dshMessages.findIndex(function(message){return message.seq===update.seq});if(index<0)index=update.message_id;if(__dshMessages[index])__dshMessages[index]=Object.assign({},__dshMessages[index],{annotations:update.value})}})});__dshSaveChatQueue=next;return next}
function __dshDisplayedMessageId(value){if(__dshMessages.length===0)throw new Error('未找到任何消息楼层');if(value===undefined||value==='last')return __dshMessages.length-1;if(value==='last_user'||value==='last_char'){var role=value==='last_user'?'user':'assistant';for(var index=__dshMessages.length-1;index>=0;index--)if(__dshMessages[index]?.role===role)return index;throw new Error(value==='last_user'?'未找到任何 user 消息楼层':'未找到任何 char 消息楼层')}var id=__dshMessageId(value);if(id===undefined)throw new Error('提供的 message_id 不在当前聊天楼层范围内: '+String(value));return id}
function __dshApplyMacroLikes(value,messageId,role){var context={...(Number.isInteger(messageId)?{message_id:messageId}:{}),...(['user','assistant','system'].includes(role)?{role:role}:{})};for(var macro of __dshMacroLikes){macro.regex.lastIndex=0;value=String(value).replace(macro.regex,function(){return String(macro.replace.apply(undefined,[context].concat(Array.from(arguments))))})}return value}
window.unregisterMacroLike=function(regex){if(!(regex instanceof RegExp))return;var index=__dshMacroLikes.findIndex(function(macro){return macro.regex.source===regex.source});if(index>=0)__dshMacroLikes.splice(index,1)};
window.registerMacroLike=function(regex,replace){if(!(regex instanceof RegExp))throw new Error('助手宏必须使用 RegExp');if(typeof replace!=='function')throw new Error('助手宏替换器必须是函数');if(!__dshMacroLikes.some(function(macro){return macro.regex.source===regex.source}))__dshMacroLikes.push({regex:regex,replace:replace});return {unregister:function(){window.unregisterMacroLike(regex)}}};
function __dshLastMessage(role){for(var index=__dshMessages.length-1;index>=0;index--){var message=__dshMessages[index];if(role===undefined||message?.role===role)return String(message?.text??'')}return ''}
function __dshPublicVariable(value){if(Array.isArray(value))return value.map(__dshPublicVariable);if(__dshPlain(value))return Object.fromEntries(Object.entries(value).filter(function(pair){return !pair[0].startsWith('$')}).map(function(pair){return [pair[0],__dshPublicVariable(pair[1])] }));return value}
function __dshVariableScope(type,messageId){if(type==='message'){var id=Number.isInteger(messageId)?messageId:__dshMessages.length-1;return __dshMessages[id]?.data??__dshScopes.message??{}}return __dshScopes[type]??{}}
function __dshYamlString(value){value=String(value).replace(/\\r\\n?/g,'\\n');if(value.includes('\\n'))return;var ambiguous=/^(?:null|true|false|~|[-+]?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:e[-+]?\\d+)?|[-+]?\\.(?:inf|nan))$/iu.test(value);var unsafe=value===''||value.trim()!==value||ambiguous||!/^[\\p{L}\\p{N}_./#:+ -]+$/u.test(value)||value.startsWith('#')||/^(?:-|\\?|:)\\s/u.test(value)||/:\\s|\\s#/u.test(value);return unsafe?JSON.stringify(value):value}
function __dshYamlScalar(value){if(value===null)return 'null';if(typeof value==='string')return __dshYamlString(value);return String(value)}
function __dshYamlMultiline(value,indent,head){var source=String(value).replace(/\\r\\n?/g,'\\n'),keep=source.endsWith('\\n'),body=keep?source.slice(0,-1):source,pad=' '.repeat(indent);return [head+(keep?'|':'|-')].concat(body.split('\\n').map(function(line){return pad+line}))}
function __dshYamlLines(value,indent){var pad=' '.repeat(indent);if(typeof value==='string'&&value.includes('\\n'))return __dshYamlMultiline(value,indent,pad);if(Array.isArray(value)){if(value.length===0)return [pad+'[]'];var array=[];for(var item of value){if(typeof item==='string'&&item.includes('\\n'))array.push.apply(array,__dshYamlMultiline(item,indent+2,pad+'- '));else if(Array.isArray(item)||__dshPlain(item)){array.push(pad+'-');array.push.apply(array,__dshYamlLines(item,indent+2))}else array.push(pad+'- '+__dshYamlScalar(item))}return array}if(__dshPlain(value)){var entries=Object.entries(value);if(entries.length===0)return [pad+'{}'];var object=[];for(var pair of entries){var key=__dshYamlString(pair[0])??JSON.stringify(pair[0]),item=pair[1];if(typeof item==='string'&&item.includes('\\n'))object.push.apply(object,__dshYamlMultiline(item,indent+2,pad+key+': '));else if(Array.isArray(item)||__dshPlain(item)){object.push(pad+key+':');object.push.apply(object,__dshYamlLines(item,indent+2))}else object.push(pad+key+': '+__dshYamlScalar(item))}return object}return [pad+__dshYamlScalar(value)]}
function __dshYaml(value){return __dshYamlLines(value,0).join('\\n')}
var __dshFormatVariableRegex=/^(.*)\\{\\{format_(message|chat|character|preset|global)_variable::(.*?)\\}\\}/im;
function __dshFormatVariable(context,_match,prefix,type,path){var nested=prefix.match(__dshFormatVariableRegex);if(nested)prefix=__dshFormatVariable(context,'',nested[1],nested[2],nested[3])+prefix.slice(nested[0].length);var value=__dshPublicVariable(__dshGet(__dshVariableScope(type,context.message_id),path,null));return prefix+__dshYaml(value).replaceAll('\\n','\\n'+' '.repeat(prefix.length))}
window.registerMacroLike(/\\{\\{get_(message|chat|character|preset|global)_variable::(.*?)\\}\\}/gi,function(context,_match,type,path){var value=__dshPublicVariable(__dshGet(__dshVariableScope(type,context.message_id),path,null));return typeof value==='string'?value:JSON.stringify(value)});
window.registerMacroLike(/^(.*)\\{\\{format_(message|chat|character|preset|global)_variable::(.*?)\\}\\}/gim,__dshFormatVariable);
function __dshDisplayMacros(value,messageId,transform,role){var applyRegistered=transform===undefined;transform=transform??function(item){return item};var result=String(value).replace(/\\{\\{char\\}\\}|<char>|<bot>/giu,transform(__dshSnapshot.characterName)).replace(/\\{\\{user\\}\\}|<user>/giu,transform(__dshSnapshot.userName??'用户')).replace(/\\{\\{lastMessage\\}\\}/giu,transform(__dshLastMessage())).replace(/\\{\\{lastUserMessage\\}\\}/giu,transform(__dshLastMessage('user'))).replace(/\\{\\{lastCharMessage\\}\\}/giu,transform(__dshLastMessage('assistant'))).replace(/\\{\\{lastMessageId\\}\\}/giu,String(__dshMessages.length-1)).replace(/\\{\\{messageId\\}\\}/giu,String(messageId));return applyRegistered?__dshApplyMacroLikes(result,messageId,role??__dshMessages[messageId]?.role):result}
window.substitudeMacros=function(text){var messageId=Math.max(-1,__dshMessages.length-1);return __dshDisplayMacros(String(text??''),messageId)};
window.substituteParams=window.substitudeMacros;
function __dshDisplayRegex(value){try{var literal=String(value).match(/^\\/([\\s\\S]*)\\/([a-z]*)$/iu);return literal===null?new RegExp(String(value)):new RegExp(literal[1]??'',literal[2]??'')}catch(error){return}}
function __dshEscapeDisplayRegex(value){return String(value).replace(/[\\n\\r\\t\\v\\f\\0.^$*+?{}[\\]\\\\/|()]/gu,function(character){if(character==='\\n')return '\\\\n';if(character==='\\r')return '\\\\r';if(character==='\\t')return '\\\\t';if(character==='\\v')return '\\\\v';if(character==='\\f')return '\\\\f';if(character==='\\0')return '\\\\0';return '\\\\'+character})}
function __dshDisplayReplace(raw,script,messageId){var mode=Number(script.substituteRegex);var findSource=mode===1?__dshDisplayMacros(script.findRegex,messageId):mode===2?__dshDisplayMacros(script.findRegex,messageId,__dshEscapeDisplayRegex):script.findRegex;var find=__dshDisplayRegex(findSource);if(!find||!script.findRegex||!raw)return raw;return raw.replace(find,function(){var args=Array.from(arguments);var groups=typeof args.at(-1)==='object'&&args.at(-1)!==null?args.at(-1):undefined;var replacement=String(script.replaceString??'').replace(/\\{\\{match\\}\\}/giu,'$0').replace(/\\$(?:(&)|(\\d+)|<([^>]+)>)/gu,function(token,whole,numeric,named){var match=whole==='&'?args[0]:numeric===undefined?groups?.[named??'']:args[Number(numeric)];if(typeof match!=='string')return '';return (script.trimStrings??[]).reduce(function(text,trim){return text.replaceAll(__dshDisplayMacros(trim,messageId),'')},match)});return __dshDisplayMacros(replacement,messageId)})}
window.formatAsTavernRegexedString=function(text,source,destination,option){if(!['user_input','ai_output','slash_command','world_info','reasoning'].includes(source))throw new Error('不支持的预设正则来源: '+String(source));if(destination!=='display'&&destination!=='prompt')throw new Error('不支持的预设正则目标: '+String(destination));option=option??{};if(option.character_name!==undefined&&option.character_name!==__dshSnapshot.characterName)throw new Error('当前仅支持使用当前角色名格式化预设正则');var depth=typeof option.depth==='number'&&Number.isFinite(option.depth)?option.depth:undefined;var messageId=depth===undefined?Math.max(0,__dshMessages.length-1):Math.max(0,__dshMessages.length-depth-1);var value=String(text??'');for(var regex of __dshPresetRegexes()){if(regex.enabled===false||regex.source?.[source]!==true||regex.destination?.[destination]!==true)continue;if(depth!==undefined&&regex.min_depth!==null&&regex.min_depth>=-1&&depth<regex.min_depth)continue;if(depth!==undefined&&regex.max_depth!==null&&regex.max_depth>=0&&depth>regex.max_depth)continue;value=__dshDisplayReplace(value,{findRegex:regex.find_regex,replaceString:regex.replace_string,trimStrings:regex.trim_strings,substituteRegex:0},messageId)}var role=source==='user_input'?'user':source==='ai_output'?'assistant':'system';return __dshDisplayMacros(value,messageId,undefined,role)};
function __dshDisplayedSource(text,messageId,role){var message=__dshMessages[messageId];role=role??message?.role;var placement=role==='user'?1:2;var depth=Math.max(0,__dshMessages.length-messageId-1);var value=__dshDisplayMacros(text,messageId,undefined,role);for(var phase of ['message','markdown'])for(var script of __dshDisplayRegexScripts??[]){if(script.disabled||!Array.isArray(script.placement)||!script.placement.includes(placement))continue;if(phase==='message'&&(script.markdownOnly||script.promptOnly))continue;if(phase==='markdown'&&!script.markdownOnly)continue;if(script.minDepth!==null&&script.minDepth>=-1&&depth<script.minDepth)continue;if(script.maxDepth!==null&&script.maxDepth>=0&&depth>script.maxDepth)continue;value=__dshDisplayReplace(value,script,messageId)}return value}
function __dshEscapeHtml(value){return String(value).replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;').replace(/"/gu,'&quot;').replace(/'/gu,'&#39;')}
function __dshMarkdownProse(value){var html=__dshEscapeHtml(value),tick=String.fromCharCode(96);html=html.replace(/\\*\\*([^*\\n]+)\\*\\*/gu,'<strong>$1</strong>').replace(/\\*([^*\\n]+)\\*/gu,'<em>$1</em>').replace(new RegExp(tick+'([^'+tick+'\\\\n]+)'+tick,'gu'),'<code>$1</code>');return html.trim()===''?'':html.trim().split(/\\n{2,}/u).map(function(paragraph){return '<p>'+paragraph.replace(/\\n/gu,'<br>')+'</p>'}).join('')}
function __dshMarkdownHtml(text){var source=String(text??''),result='',cursor=0,tick=String.fromCharCode(96),marker=tick.repeat(3),fence=new RegExp(marker+'([^'+tick+'\\\\n]*)\\\\n([\\\\s\\\\S]*?)'+marker,'gu'),match;while((match=fence.exec(source))!==null){result+=__dshMarkdownProse(source.slice(cursor,match.index));var language=match[1].trim().replace(/[^A-Za-z0-9_-]/gu,'');var code=match[2].replace(/\\n$/u,'');result+='<pre><code'+(language?' class="language-'+language+'"':'')+'>'+__dshEscapeHtml(code)+'</code></pre>';cursor=match.index+match[0].length}return result+__dshMarkdownProse(source.slice(cursor))}
function __dshDisplayedHtml(text,messageId,role){var value=__dshDisplayedSource(text,messageId,role);var marker=String.fromCharCode(96).repeat(3);var trimmed=value.trim();if(trimmed.slice(0,marker.length+4).toLowerCase()===marker+'html'&&trimmed.endsWith(marker)){var newline=trimmed.indexOf('\\n');return newline<0?'':trimmed.slice(newline+1,-marker.length).trim()}if(/<\\/?[A-Za-z][^>]*>/u.test(value))return value;return __dshMarkdownHtml(value)}
window.getChatMessages=function(range,option){option=option??{};return __dshClone(__dshMessageRange(range).flatMap(function(message){if(option.role&&option.role!=='all'&&option.role!==message.role)return [];if(option.hide_state==='hidden'&&message.isHidden!==true)return [];if(option.hide_state==='unhidden'&&message.isHidden===true)return [];if(option.include_swipes)return [{message_id:message.messageId,name:message.role==='user'?(__dshSnapshot.userName??'用户'):__dshSnapshot.characterName,role:message.role,is_hidden:message.isHidden===true,swipe_id:0,swipes:[message.text],swipes_data:[message.data??{}],swipes_info:[message.extra??{}]}];return [{message_id:message.messageId,name:message.role==='user'?(__dshSnapshot.userName??'用户'):__dshSnapshot.characterName,role:message.role,is_hidden:message.isHidden===true,message:message.text,data:message.data??{},extra:message.extra??{},swipe_id:0,swipes:[message.text],swipes_data:[message.data??{}]}]}))};
window.setChatMessages=function(messages){messages=(Array.isArray(messages)?messages:[]).flatMap(function(message){var messageId=__dshMessageId(message?.message_id);return messageId===undefined?[]:[Object.assign({},__dshClone(message),{message_id:messageId})]});if(messages.length===0)return Promise.resolve();return __dshChatMutation({format:0,operation:'set-chat-messages',messages:messages}).then(function(){for(var update of messages){var current=__dshMessages[update.message_id];if(!current)continue;var swipeId=update.swipe_id??0;var text=update.message??update.swipes?.[swipeId]??current.text;var data=update.data??update.swipes_data?.[swipeId]??current.data;var extra=update.extra??update.swipes_info?.[swipeId]??current.extra;__dshMessages[update.message_id]=Object.assign({},current,{role:update.role??current.role,text:text,data:data??{},extra:extra??{}})}__dshSyncSillyTavernChat();return Promise.all(messages.map(function(message){return window.eventEmit(window.tavern_events.MESSAGE_UPDATED,message.message_id)}))})};
window.createChatMessages=function(messages,option){messages=Array.isArray(messages)?__dshClone(messages):[];if(messages.length===0)return Promise.resolve();option=option??{};var insertAt=__dshMessageBoundary(option.insert_at??option.insert_before??'end');return __dshChatMutation({format:0,operation:'create-chat-messages',messages:messages,insertAt:insertAt}).then(function(){var created=messages.map(function(message){return {messageId:0,role:message.role,text:String(message.message??''),isHidden:false,data:message.data??{},extra:message.extra??{}}});__dshMessages.splice(insertAt,0,...created);__dshReindexMessages();__dshSyncSillyTavernChat();return Promise.all(created.map(function(message,index){var id=insertAt+index;return window.eventEmit(message.role==='user'?window.tavern_events.MESSAGE_SENT:window.tavern_events.MESSAGE_RECEIVED,id,'extension')}))})};
window.deleteChatMessages=function(messageIds){messageIds=Array.from(new Set((Array.isArray(messageIds)?messageIds:[]).flatMap(function(value){var id=__dshMessageId(value);return id===undefined?[]:[id]}))).sort(function(a,b){return a-b});if(messageIds.length===0)return Promise.resolve();return __dshChatMutation({format:0,operation:'delete-chat-messages',messageIds:messageIds}).then(function(){for(var id of [...messageIds].reverse())__dshMessages.splice(id,1);__dshReindexMessages();__dshSyncSillyTavernChat();return Promise.all(messageIds.map(function(id){return window.eventEmit(window.tavern_events.MESSAGE_DELETED,id)}))})};
window.rotateChatMessages=function(begin,middle,end){begin=__dshMessageBoundary(begin);middle=__dshMessageBoundary(middle);end=__dshMessageBoundary(end);middle=Math.min(end,Math.max(begin,middle));if(begin===middle||middle===end)return Promise.resolve();return __dshChatMutation({format:0,operation:'rotate-chat-messages',begin:begin,middle:middle,end:end}).then(function(){var right=__dshMessages.splice(middle,end-middle);__dshMessages.splice(begin,0,...right);__dshReindexMessages();__dshSyncSillyTavernChat();return window.eventEmit(window.tavern_events.CHAT_CHANGED,'dsh-agent-rp')})};
var __dshNativeFetch=window.fetch.bind(window);
var __dshResolvedStylesheets=new Map((window.__dshResolvedStylesheets??[]).map(function(entry){return [entry.url,entry]}));
delete window.__dshResolvedStylesheets;
function __dshGenerationBody(config){var value=__dshClone(config??{});var custom=__dshPlain(value.custom_api)?value.custom_api:null;return Object.assign({},value,{chat_completion_source:custom?String(custom.source??'openai'):'dsh',...(custom&&typeof custom.apiurl==='string'?{reverse_proxy:custom.apiurl,custom_url:custom.apiurl}:{}),...(custom&&typeof custom.key==='string'?{proxy_password:custom.key}:{}),...(custom&&typeof custom.model==='string'?{model:custom.model}:{}),messages:[],stream:false})}
function __dshGenerationConfig(body){var value=__dshClone(body);for(var key of ['__dsh_generation_mode','chat_completion_source','reverse_proxy','custom_url','proxy_password','model','messages','stream'])delete value[key];var fields=['custom_include_body','custom_exclude_body','custom_include_headers'];if(fields.some(function(key){return body[key]!==undefined})){if(!__dshPlain(value.custom_api))throw new Error('附加请求参数只能用于自定义 API');value.custom_api=Object.assign({},value.custom_api);for(var field of fields)if(body[field]!==undefined)value.custom_api[field]=body[field]}for(var field of fields)delete value[field];return value}
function __dshOpenAiResponse(value,generationId){return {id:generationId||'dsh-agent-rp-'+Date.now(),object:'chat.completion',created:Math.floor(Date.now()/1000),model:'dsh-agent-rp',choices:[{index:0,message:{role:'assistant',content:String(value??'')},finish_reason:'stop'}]}}
function __dshGenerationError(value){if(typeof value==='string')return value;if(!value||typeof value!=='object')return '生成失败';var error=value.error;if(typeof error==='string')return error;if(error&&typeof error==='object'&&typeof error.message==='string')return error.message;return typeof value.message==='string'?value.message:'生成失败'}
function __dshGenerationText(value){if(!value||typeof value!=='object')throw new Error('模型返回了无法识别的结果');var choice=Array.isArray(value.choices)?value.choices[0]:undefined;var content=choice?.message?.content??choice?.text;if(typeof content==='string')return content;if(Array.isArray(content)){var text=content.flatMap(function(item){return typeof item==='string'?[item]:item&&typeof item==='object'&&typeof item.text==='string'?[item.text]:[]}).join('');if(text)return text}throw new Error('模型没有返回文本')}
window.fetch=function(input,init){var url=typeof input==='string'?input:input?.url??String(input??'');var method=String(init?.method??input?.method??'GET').toUpperCase();var stylesheet=method==='GET'?__dshResolvedStylesheets.get(String(url)):undefined;if(stylesheet!==undefined){var body=stylesheet.status===204||stylesheet.status===205?null:stylesheet.source;return Promise.resolve(new Response(body,{status:stylesheet.status,headers:{'content-type':'text/css; charset=utf-8'}}))}if(!String(url).includes('/api/backends/chat-completions/generate'))return __dshNativeFetch(input,init);var body=init?.body;if(typeof body!=='string')return Promise.resolve(new Response(JSON.stringify({error:{message:'生成请求体必须是 JSON 文本'}}),{status:400,headers:{'content-type':'application/json'}}));var parsed;try{parsed=JSON.parse(body)}catch(error){return Promise.resolve(new Response(JSON.stringify({error:{message:'生成请求体不是有效 JSON'}}),{status:400,headers:{'content-type':'application/json'}}))}if(!__dshPlain(parsed))return Promise.resolve(new Response(JSON.stringify({error:{message:'生成请求体必须是对象'}}),{status:400,headers:{'content-type':'application/json'}}));var requestId=String(++__dshRequest);var config;try{config=__dshGenerationConfig(parsed)}catch(error){return Promise.resolve(new Response(JSON.stringify({error:{message:String(error?.message??error)}}),{status:400,headers:{'content-type':'application/json'}}))}return new Promise(function(resolve){__dshPending.set(requestId,{resolve:resolve,generationFetch:true});__dshPost('generate',{requestId:requestId,mode:parsed.__dsh_generation_mode==='preset'?'preset':'raw',config:config})}).then(function(result){if(result.ok)return new Response(JSON.stringify(__dshOpenAiResponse(result.value,typeof parsed.generation_id==='string'?parsed.generation_id:undefined)),{status:200,headers:{'content-type':'application/json'}});return new Response(JSON.stringify({error:{message:String(result.error??'生成失败')}}),{status:400,headers:{'content-type':'application/json'}})})};
function __dshHasPromptListener(type){return (__dshListeners.get(String(type))??[]).length>0}
function __dshPromptPreview(mode,config){var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('generation-preview',{requestId:requestId,mode:mode,config:__dshClone(config)})})}
async function __dshEmitPromptPreview(prompts,config){var generationId=typeof config.generation_id==='string'?config.generation_id:undefined;if(__dshHasPromptListener(window.tavern_events.CHAT_COMPLETION_PROMPT_READY))await __dshEmitLocal(window.tavern_events.CHAT_COMPLETION_PROMPT_READY,[{chat:__dshClone(prompts),generation_id:generationId}]);if(__dshHasPromptListener(window.tavern_events.GENERATE_AFTER_DATA))await __dshEmitLocal(window.tavern_events.GENERATE_AFTER_DATA,[{prompt:__dshClone(prompts),generation_id:generationId},false]);if(__dshHasPromptListener(window.tavern_events.GENERATE_AFTER_COMBINE_PROMPTS))await __dshEmitLocal(window.tavern_events.GENERATE_AFTER_COMBINE_PROMPTS,[{prompt:__dshClone(prompts),generation_id:generationId}])}
async function __dshGenerate(mode,config){var value=__dshClone(config??{});value.__dsh_generation_mode=mode;await __dshRefreshInjections();await __dshInjectionWrite;void __dshEmitLocal(window.iframe_events.GENERATION_STARTED,[]);var promptEvents=[window.tavern_events.CHAT_COMPLETION_PROMPT_READY,window.tavern_events.GENERATE_AFTER_DATA,window.tavern_events.GENERATE_AFTER_COMBINE_PROMPTS];if(promptEvents.some(__dshHasPromptListener)){var prompts=await __dshPromptPreview(mode,__dshGenerationConfig(__dshGenerationBody(value)));await __dshEmitPromptPreview(prompts,value)}var response=await window.fetch('/api/backends/chat-completions/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(__dshGenerationBody(value))});var raw=await response.text();var result;try{result=JSON.parse(raw)}catch(error){throw new Error(response.ok?'模型返回了无法识别的结果':'生成失败（'+response.status+'）')}if(!response.ok)throw new Error(__dshGenerationError(result));var text=__dshGenerationText(result);if(value.should_stream===true){void __dshEmitLocal(window.iframe_events.STREAM_TOKEN_RECEIVED_FULLY,[text]);void __dshEmitLocal(window.iframe_events.STREAM_TOKEN_RECEIVED_INCREMENTALLY,[text])}void __dshEmitLocal(window.iframe_events.GENERATION_ENDED,[text]);__dshConsumeOnceInjections();return text}
window.generate=function(config){return __dshGenerate('preset',config)};
window.generateRaw=function(config){return __dshGenerate('raw',config)};
window.stopGenerationById=function(value){__dshPost('generation-cancel',{generationId:String(value??'')});return true};
window.stopAllGeneration=function(){__dshPost('generation-cancel-all');return true};
window.getTavernHelperVersion=function(){return '4.0.0'};
window.getTavernVersion=function(){return '1.13.5'};
window.getModelList=function(config){if(!__dshPlain(config)||typeof config.apiurl!=='string'||config.apiurl.trim()==='')return Promise.reject(new Error('API 地址不能为空'));if(config.key!==undefined&&typeof config.key!=='string')return Promise.reject(new Error('API 密钥必须是文本'));var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('model-list',{requestId:requestId,apiurl:config.apiurl,key:config.key})})};
window.triggerSlash=function(value){var command=String(value),local=__dshPromptSlash(command);if(local.matched)return Promise.resolve(local.value);var requestId=String(++__dshRequest);return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject});__dshPost('trigger-slash',{requestId:requestId,value:command})}).then(function(){var match=command.match(/^\\/(hide|unhide)\\s+(\\d+)(?:-(\\d+))?\\s*$/i);if(match){var left=Number(match[2]),right=Number(match[3]??match[2]),start=Math.max(0,Math.min(left,right)),end=Math.min(__dshMessages.length-1,Math.max(left,right)),hidden=match[1].toLowerCase()==='hide';for(var index=start;index<=end;index++)if(__dshMessages[index])__dshMessages[index].isHidden=hidden;__dshSyncSillyTavernChat()}return ''})};
window.errorCatched=function(fn){return function(){try{return Promise.resolve(fn.apply(this,arguments)).catch(console.error)}catch(error){console.error(error)}}};
function __dshOn(type,listener,mode){var list=__dshListeners.get(String(type))??[];if(list.some(entry=>entry.listener===listener))return {stop:function(){}};var entry={listener:listener,once:mode==='once'};if(mode==='first')list.unshift(entry);else list.push(entry);__dshListeners.set(String(type),list);return {stop:function(){window.eventRemoveListener(type,listener)}}}
window.eventOn=function(type,listener){return __dshOn(type,listener)};
window.eventOnce=function(type,listener){return __dshOn(type,listener,'once')};
window.eventMakeFirst=function(type,listener){window.eventRemoveListener(type,listener);return __dshOn(type,listener,'first')};
window.eventMakeLast=function(type,listener){window.eventRemoveListener(type,listener);return __dshOn(type,listener)};
window.eventRemoveListener=function(type,listener){var list=__dshListeners.get(String(type))??[];__dshListeners.set(String(type),list.filter(entry=>entry.listener!==listener))};
window.eventClearEvent=function(type){__dshListeners.delete(String(type))};
window.eventClearListener=function(listener){for(var pair of __dshListeners)__dshListeners.set(pair[0],pair[1].filter(entry=>entry.listener!==listener))};
window.eventClearAll=function(){__dshListeners.clear()};
async function __dshEmitLocal(type,args){var list=[...(__dshListeners.get(String(type))??[])];for(var entry of list){await entry.listener.apply(window,args);if(entry.once)window.eventRemoveListener(type,entry.listener)}}
window.eventEmit=function(type){var args=Array.prototype.slice.call(arguments,1);__dshPost('event-emit',{eventType:String(type),args:__dshClone(args)});return __dshEmitLocal(type,args)};
window.eventEmitAndWait=window.eventEmit;
window.eventOnButton=window.eventOn;
window.iframe_events={MESSAGE_IFRAME_RENDER_STARTED:'message_iframe_render_started',MESSAGE_IFRAME_RENDER_ENDED:'message_iframe_render_ended',GENERATION_STARTED:'js_generation_started',STREAM_TOKEN_RECEIVED_FULLY:'js_stream_token_received_fully',STREAM_TOKEN_RECEIVED_INCREMENTALLY:'js_stream_token_received_incrementally',GENERATION_ENDED:'js_generation_ended'};
window.tavern_events={APP_READY:'app_ready',MESSAGE_SENT:'message_sent',MESSAGE_RECEIVED:'message_received',MESSAGE_EDITED:'message_edited',MESSAGE_DELETED:'message_deleted',MESSAGE_UPDATED:'message_updated',CHAT_CHANGED:'chat_id_changed',GENERATION_STARTED:'generation_started',GENERATION_STOPPED:'generation_stopped',GENERATION_ENDED:'generation_ended',CHAT_COMPLETION_PROMPT_READY:'chat_completion_prompt_ready',GENERATE_AFTER_DATA:'generate_after_data',GENERATE_AFTER_COMBINE_PROMPTS:'generate_after_combine_prompts',USER_MESSAGE_RENDERED:'user_message_rendered',CHARACTER_MESSAGE_RENDERED:'character_message_rendered'};
var __dshPopupType=Object.freeze({TEXT:1,CONFIRM:2,INPUT:3,DISPLAY:4,CROP:5});
var __dshPopupResult=Object.freeze({AFFIRMATIVE:1,NEGATIVE:0,CANCELLED:null,CUSTOM1:1001,CUSTOM2:1002,CUSTOM3:1003,CUSTOM4:1004,CUSTOM5:1005,CUSTOM6:1006,CUSTOM7:1007,CUSTOM8:1008,CUSTOM9:1009});
function __dshPopupContent(value){if(value instanceof Mini)return value.items.map(function(item){return item?.outerHTML??item?.textContent??''}).join('');if(value instanceof Element)return value.outerHTML;return String(value??'')}
function __dshPopupOptions(value){if(!__dshPlain(value))return {};var result={};for(var key of ['okButton','cancelButton'])if(typeof value[key]==='string')result[key]=value[key].slice(0,200);else if(typeof value[key]==='boolean')result[key]=value[key];for(var key of ['placeholder','tooltip'])if(typeof value[key]==='string')result[key]=value[key].slice(0,2000);if(Number.isSafeInteger(value.rows))result.rows=Math.max(1,Math.min(20,value.rows));for(var key of ['wide','wider','large','leftAlign','allowEscapeClose'])if(typeof value[key]==='boolean')result[key]=value[key];if(Array.isArray(value.customButtons))result.customButtons=value.customButtons.slice(0,9).flatMap(function(button,index){if(typeof button==='string')return [{text:button.slice(0,200),result:index+2}];if(!__dshPlain(button)||typeof button.text!=='string')return [];return [{text:button.text.slice(0,200),result:typeof button.result==='number'&&Number.isFinite(button.result)?button.result:index+2}]});return result}
function __dshCallGenericPopup(content,type,inputValue,options){if(![1,2,3,4].includes(type))return Promise.reject(new Error(type===5?'当前不支持图片裁剪弹窗':'弹窗类型无效'));var requestId=String(++__dshRequest);var value=__dshPopupContent(content);if(value.length>262144)return Promise.reject(new Error('弹窗内容超过 256 KiB'));var input=String(inputValue??'');if(input.length>65536)return Promise.reject(new Error('弹窗输入超过 64 KiB'));return new Promise(function(resolve,reject){__dshPending.set(requestId,{resolve:resolve,reject:reject,capability:'ui.popup.open'});__dshPost('capability-request',{requestId:requestId,capability:'ui.popup.open',payload:{popupType:type,content:value,inputValue:input,options:__dshPopupOptions(options)}})})}
function __dshPopupMessage(title,message){var heading=String(title??'').trim();return (heading?'<h3>'+__dshEscapeHtml(heading)+'</h3>':'')+__dshMarkdownHtml(message??'')}
function __DshPopup(content,type,inputValue,options){this.content=content;this.type=type;this.inputValue=inputValue;this.options=options}
__DshPopup.prototype.show=function(){return __dshCallGenericPopup(this.content,this.type,this.inputValue,this.options)};
__DshPopup.show={confirm:function(title,message,options){return __dshCallGenericPopup(__dshPopupMessage(title,message),__dshPopupType.CONFIRM,'',options).then(function(result){return result===true||result===__dshPopupResult.AFFIRMATIVE})},input:function(title,message,defaultValue,options){return __dshCallGenericPopup(__dshPopupMessage(title,message),__dshPopupType.INPUT,defaultValue,options)},text:function(title,message,options){return __dshCallGenericPopup(__dshPopupMessage(title,message),__dshPopupType.TEXT,'',options).then(function(){})},display:function(content,options){return __dshCallGenericPopup(content,__dshPopupType.DISPLAY,'',options)}};
window.Mvu={events:{VARIABLE_INITIALIZED:'mag_variable_initialized',VARIABLE_UPDATE_STARTED:'mag_variable_update_started',COMMAND_PARSED:'mag_command_parsed',VARIABLE_UPDATE_ENDED:'mag_variable_update_ended',BEFORE_MESSAGE_UPDATE:'mag_before_message_update'},getMvuData:function(option){return window.getVariables(option??{type:'message'})},replaceMvuData:function(value,option){return __dshReplace(value,option??{type:'message'})},isDuringExtraAnalysis:function(){return false}};
function __dshChatMetadata(){return Object.assign({},__dshClone(__dshScopes.chat??{}),{wi_activated:__dshClone(__dshActiveWorldbookEntries??[])})}
var __dshCurrentChatMetadata=__dshChatMetadata();
function __dshCurrentCharacter(){var raw=__dshClone(__dshSnapshot.characterCard);if(!__dshPlain(raw))return;var data=__dshPlain(raw.data)?raw.data:raw;var name=typeof data.name==='string'&&data.name.trim()?data.name:__dshSnapshot.characterName;return Object.assign({},raw,__dshClone(data),{name:name,avatar:__dshSnapshot.characterId,description:String(data.description??''),personality:String(data.personality??''),scenario:String(data.scenario??''),first_mes:String(data.first_mes??''),mes_example:String(data.mes_example??''),data:__dshClone(data)})}
var __dshCharacter=__dshCurrentCharacter();
var __dshCharacters=__dshCharacter===undefined?[]:[__dshCharacter];
window.characters=__dshCharacters;
window.this_chid=__dshCharacter===undefined?undefined:0;
window.getCharData=function(name){name=name||'current';if(__dshCharacter===undefined)return null;if(name!=='current'&&name!==__dshCharacter.name&&name!==__dshCharacter.avatar&&name!==__dshSnapshot.characterName)return null;return __dshClone(__dshCharacter)};
window.getCharacterNames=function(){return __dshCharacters.map(function(character){return character.name})};
window.getCharacterIds=function(){return __dshCharacters.map(function(character){return character.avatar})};
window.uuidv4=function(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,function(value,index){var hex=value.toString(16).padStart(2,'0');return [4,6,8,10].includes(index)?'-'+hex:hex}).join('')};
window.SillyTavern={chat:[],name1:__dshSnapshot.userName??'用户',name2:__dshSnapshot.characterName,characters:__dshCharacters,this_chid:window.this_chid,characterId:window.this_chid,groups:[],groupId:null,chatId:__dshSnapshot.chatId,chatMetadata:__dshCurrentChatMetadata,chat_metadata:__dshCurrentChatMetadata,extensionSettings:__dshExtensionSettings,extensionPrompts:__dshExtensionPrompts,extension_prompts:__dshExtensionPrompts,extension_prompt_types:__dshExtensionPromptTypes,extension_prompt_roles:__dshExtensionPromptRoles,setExtensionPrompt:window.setExtensionPrompt,executeSlashCommands:window.triggerSlash,libs:{},saveSettingsDebounced:__dshSaveSettingsDebounced,saveChat:__dshSaveChat,Popup:__DshPopup,POPUP_TYPE:__dshPopupType,POPUP_RESULT:__dshPopupResult,callGenericPopup:__dshCallGenericPopup,getCurrentCharacterId:window.getCurrentCharId,getCurrentChatId:window.getCurrentChatId,uuidv4:window.uuidv4,substituteParams:window.substituteParams,eventSource:{on:window.eventOn,once:window.eventOnce,emit:window.eventEmit,emitAndWait:window.eventEmitAndWait,removeListener:window.eventRemoveListener},eventTypes:window.tavern_events,getContext:function(){return this}};
window.SillyTavern.stopGeneration=window.stopAllGeneration;
window.SillyTavern.messageFormatting=function(message,_characterName,isSystem,isUser,messageId,_sanitizerOverrides,isReasoning){var id=Number.isInteger(messageId)?Math.max(0,Math.min(__dshMessages.length-1,messageId)):Math.max(0,__dshMessages.length-1);var role=isSystem===true?'system':isUser===true?'user':'assistant';var value=String(message??'');if(isReasoning===true)value=window.formatAsTavernRegexedString(value,'reasoning','display',{depth:Math.max(0,__dshMessages.length-id-1)});return __dshDisplayedHtml(value,id,role)};
window.getContext=function(){return window.SillyTavern.getContext()};
window.saveSettingsDebounced=__dshSaveSettingsDebounced;
window.extension_settings=__dshExtensionSettings;
__dshSyncSillyTavernChat();
window.TavernHelper=window;
var __dshFrameHost=document.createElement('div');
var __dshFrameElement=document.createElement('iframe');
__dshFrameHost.id='chat';__dshFrameHost.className='chat';__dshFrameHost.hidden=true;__dshFrameHost.appendChild(__dshFrameElement);document.body.appendChild(__dshFrameHost);
var __dshExtensionMenu=document.createElement('div');
__dshExtensionMenu.id='extensionsMenu';__dshExtensionMenu.dataset.dshCompatibilitySurface='extensions-menu';__dshExtensionMenu.setAttribute('aria-label','扩展菜单');document.body.appendChild(__dshExtensionMenu);
try{Object.defineProperty(window,'frameElement',{configurable:true,value:__dshFrameElement})}catch(error){}
var __dshStatusPanelReady=false,__dshStatusPanelScheduled=false,__dshStatusPanelLast=__dshSnapshot.statusPanelHtml??null,__dshStatusPanelRestoring=__dshSnapshot.statusPanelHtml!==undefined,__dshStatusPanelCause,__dshStatusPanelCauseTimer;
var __dshStatusPanelHead=document.head;
var __dshStatusPanelInitialStyles=new Set(document.querySelectorAll('style'));
function __dshStatusPanelSource(){var nodes=Array.from(__dshFrameHost.children).filter(function(node){return node!==__dshFrameElement&&!node.classList.contains('mes')});if(nodes.length===0)return '';var styles=Array.from(document.querySelectorAll('style')).filter(function(style){return !__dshStatusPanelInitialStyles.has(style)});return styles.concat(nodes).map(function(node){return node.outerHTML}).join('')}
function __dshReportStatusPanel(){__dshStatusPanelScheduled=false;if(!__dshStatusPanelReady)return;var html=__dshStatusPanelSource(),value=html===''?null:html;if(__dshStatusPanelRestoring){__dshStatusPanelRestoring=false;if(__dshSnapshot.statusPanelHtml!==null)__dshStatusPanelLast=value;__dshStatusPanelCause=undefined;return}if(value===__dshStatusPanelLast){__dshStatusPanelCause=undefined;return}__dshStatusPanelLast=value;__dshPost('status-panel-replace',{value:value,...(__dshStatusPanelCause===undefined?{}:{cause:__dshClone(__dshStatusPanelCause)})});__dshStatusPanelCause=undefined}
function __dshScheduleStatusPanel(){if(__dshStatusPanelScheduled)return;__dshStatusPanelScheduled=true;setTimeout(__dshReportStatusPanel,40)}
function __dshStartStatusPanel(){__dshStatusPanelReady=true;__dshScheduleStatusPanel()}
function __dshRememberStatusPanelCause(value){if(!__dshPlain(value))return;__dshStatusPanelCause=__dshClone(value);clearTimeout(__dshStatusPanelCauseTimer);__dshStatusPanelCauseTimer=setTimeout(function(){__dshStatusPanelCause=undefined},100)}
new MutationObserver(__dshScheduleStatusPanel).observe(__dshFrameHost,{attributes:true,characterData:true,childList:true,subtree:true});
if(__dshStatusPanelHead)new MutationObserver(__dshScheduleStatusPanel).observe(__dshStatusPanelHead,{attributes:true,characterData:true,childList:true,subtree:true});
var __dshSurfaceReported;
var __dshSurfaceScheduled=false;
function __dshHasSurface(){return Array.from(document.body.children).some(function(element){if(element===__dshFrameHost||element===__dshExtensionMenu&&element.children.length===0||element.tagName==='SCRIPT'||element.tagName==='STYLE'||element.tagName==='LINK'||element.hidden)return false;var style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'})}
function __dshReportSurface(){__dshSurfaceScheduled=false;var visible=__dshHasSurface();if(visible===__dshSurfaceReported)return;__dshSurfaceReported=visible;__dshPost('surface',{visible:visible})}
function __dshScheduleSurface(){if(__dshSurfaceScheduled)return;__dshSurfaceScheduled=true;queueMicrotask(__dshReportSurface)}
new MutationObserver(__dshScheduleSurface).observe(document.body,{attributes:true,attributeFilter:['class','hidden','style'],childList:true,subtree:true});
__dshScheduleSurface();
var __dshApprovedOrigins=new Set(__dshSnapshot.approvedScriptOrigins);
var __dshNativeAppend=Element.prototype.appendChild;
var __dshNativeInsert=Element.prototype.insertBefore;
function __dshGuardScript(node){if(node?.tagName!=='SCRIPT'||!node.src)return;var origin;try{origin=new URL(node.src).origin}catch(error){origin=String(node.src)};if(__dshApprovedOrigins.has(origin))return;node.type='application/x-dsh-blocked';node.removeAttribute('src');__dshPost('external-script-request',{origin:origin})}
Element.prototype.appendChild=function(node){__dshGuardScript(node);return __dshNativeAppend.call(this,node)};
Element.prototype.insertBefore=function(node,before){__dshGuardScript(node);return __dshNativeInsert.call(this,node,before)};
function Chain(value){this.data=value}
Chain.prototype.value=function(){return this.data};
for(var method of ['map','filter','flatMap'])Chain.prototype[method]=function(method){return function(callback){this.data=Array.from(this.data??[])[method](callback);return this}}(method);
Chain.prototype.assign=function(){this.data=Object.assign(this.data,...arguments);return this};
Chain.prototype.sortBy=function(iteratee){var getter=typeof iteratee==='function'?iteratee:function(value){return __dshGet(value,iteratee)};this.data=Array.from(this.data??[]).sort(function(a,b){return String(getter(a)).localeCompare(String(getter(b)))});return this};
Chain.prototype.fromPairs=function(){this.data=Object.fromEntries(this.data);return this};
function lodash(value){return new Chain(value)}
function __dshCollectionValues(value){return Array.isArray(value)?value:Object.values(value??{})}
function __dshIteratee(value){if(typeof value==='function')return value;if(value==null)return function(item){return item};if(Array.isArray(value)&&value.length===2)return function(item){return Object.is(__dshGet(item,value[0]),value[1])};if(__dshPlain(value))return function(item){return Object.entries(value).every(function(pair){return Object.is(__dshGet(item,pair[0]),pair[1])})};return function(item){return __dshGet(item,value)}}
function __dshSortBy(value){var iteratees=Array.prototype.slice.call(arguments,1).flat();if(iteratees.length===0)iteratees=[function(item){return item}];iteratees=iteratees.map(__dshIteratee);return __dshCollectionValues(value).map(function(item,index){return {item:item,index:index,criteria:iteratees.map(function(iteratee){return iteratee(item)})}}).sort(function(left,right){for(var index=0;index<left.criteria.length;index++){var a=left.criteria[index],b=right.criteria[index];if(Object.is(a,b))continue;if(a==null)return 1;if(b==null)return -1;return a>b?1:-1}return left.index-right.index}).map(function(entry){return entry.item})}
function __dshPullAt(array){if(!Array.isArray(array))return [];var indexes=Array.prototype.slice.call(arguments,1).flat().map(function(value){var index=Math.trunc(Number(value));return index<0?array.length+index:index});var removed=indexes.map(function(index){return array[index]});for(var index of Array.from(new Set(indexes)).sort(function(a,b){return b-a}))if(index>=0&&index<array.length)array.splice(index,1);return removed}
function __dshDebounce(func,wait,option){if(typeof func!=='function')throw new TypeError('Expected a function');wait=Math.max(0,Number(wait)||0);option=__dshPlain(option)?option:{};var timer,lastArgs,lastThis,lastCall=0,lastInvoke=0,result;var leading=option.leading===true,trailing=option.trailing!==false,maxing=Number.isFinite(option.maxWait),maxWait=maxing?Math.max(wait,Number(option.maxWait)):0;function invoke(time){var args=lastArgs,receiver=lastThis;lastArgs=lastThis=undefined;lastInvoke=time;result=func.apply(receiver,args);return result}function expire(){var time=Date.now(),sinceCall=time-lastCall,sinceInvoke=time-lastInvoke;if(lastArgs&&(sinceCall<wait||(maxing&&sinceInvoke<maxWait))){var remaining=wait-sinceCall;if(maxing)remaining=Math.min(remaining,maxWait-sinceInvoke);timer=setTimeout(expire,Math.max(0,remaining));return}timer=undefined;if(trailing&&lastArgs)invoke(time);else lastArgs=lastThis=undefined}function debounced(){var time=Date.now(),fresh=timer===undefined;lastArgs=arguments;lastThis=this;lastCall=time;if(fresh){lastInvoke=time;timer=setTimeout(expire,wait);if(leading)return invoke(time)}else if(maxing&&time-lastInvoke>=maxWait){clearTimeout(timer);timer=setTimeout(expire,wait);return invoke(time)}return result}debounced.cancel=function(){clearTimeout(timer);timer=lastArgs=lastThis=undefined;lastCall=lastInvoke=0};debounced.flush=function(){if(timer===undefined)return result;clearTimeout(timer);timer=undefined;if(trailing&&lastArgs)return invoke(Date.now());lastArgs=lastThis=undefined;return result};debounced.pending=function(){return timer!==undefined};return debounced}
Object.assign(lodash,{get:__dshGet,set:__dshSet,has:function(object,path){return __dshGet(object,path,Symbol.for('missing'))!==Symbol.for('missing')},unset:__dshUnset,merge:__dshMerge,assign:Object.assign,cloneDeep:__dshClone,debounce:__dshDebounce,isArray:Array.isArray,isPlainObject:__dshPlain,isEqual:function(a,b){return JSON.stringify(a)===JSON.stringify(b)},clamp:function(value,min,max){return Math.min(max,Math.max(min,Number(value)))},inRange:function(value,start,end){return value>=start&&value<end},range:function(start,end){if(end===undefined){end=start;start=0}return Array.from({length:Math.max(0,end-start)},function(_,i){return start+i})},times:function(count,iteratee){return Array.from({length:count},function(_,i){return iteratee(i)})},constant:function(value){return function(){return value}},keys:Object.keys,values:Object.values,size:function(value){return Array.isArray(value)||typeof value==='string'?value.length:Object.keys(value??{}).length},forEach:function(value,iteratee){Object.entries(value??{}).forEach(function(pair){iteratee(pair[1],pair[0])});return value},pickBy:function(value,predicate){return Object.fromEntries(Object.entries(value??{}).filter(function(pair){return predicate(pair[1],pair[0])}))},pick:function(value,keys){return Object.fromEntries(keys.filter(function(key){return key in value}).map(function(key){return [key,value[key]]}))},omit:function(value,keys){return Object.fromEntries(Object.entries(value??{}).filter(function(pair){return !keys.includes(pair[0])}))},difference:function(left,right){return left.filter(function(value){return !right.includes(value)})},pull:function(array){var values=Array.prototype.slice.call(arguments,1);for(var i=array.length-1;i>=0;i--)if(values.includes(array[i]))array.splice(i,1);return array},toInteger:function(value){var number=Number(value);return Number.isFinite(number)?Math.trunc(number):0}});
Object.assign(lodash,{escape:function(value){return String(value??'').replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]})},isObject:function(value){return value!==null&&(typeof value==='object'||typeof value==='function')},isDate:function(value){return Object.prototype.toString.call(value)==='[object Date]'},isString:function(value){return typeof value==='string'||value instanceof String},toPath:__dshPath,uniq:function(value){return Array.from(new Set(Array.isArray(value)?value:[]))},concat:function(value){var result=Array.isArray(value)?value.slice():[value];for(var item of Array.prototype.slice.call(arguments,1))Array.isArray(item)?result.push.apply(result,item):result.push(item);return result},remove:function(array,predicate){var removed=[];if(!Array.isArray(array))return removed;for(var index=array.length-1;index>=0;index--)if(predicate(array[index],index,array))removed.unshift(array.splice(index,1)[0]);return removed},intersectionBy:function(){var values=Array.from(arguments);var iteratee=typeof values.at(-1)==='function'?values.pop():function(value){return value};var arrays=values.filter(Array.isArray);if(arrays.length===0)return [];var rest=arrays.slice(1).map(function(array){return new Set(array.map(iteratee))});return arrays[0].filter(function(value,index,array){var key=iteratee(value);return array.findIndex(function(item){return Object.is(iteratee(item),key)})===index&&rest.every(function(keys){return keys.has(key)})})},isEmpty:function(value){if(value==null)return true;if(typeof value==='string'||Array.isArray(value))return value.length===0;if(value instanceof Map||value instanceof Set)return value.size===0;return typeof value==='object'?Object.keys(value).length===0:true},mapValues:function(value,iteratee){return Object.fromEntries(Object.entries(value??{}).map(function(pair){return [pair[0],iteratee(pair[1],pair[0],value)]}))}});
Object.assign(lodash,{sortBy:__dshSortBy,flatMap:function(value,iteratee){iteratee=__dshIteratee(iteratee);return __dshCollectionValues(value).flatMap(function(item,index){return iteratee(item,index,value)})},some:function(value,predicate){predicate=__dshIteratee(predicate);return __dshCollectionValues(value).some(function(item,index){return predicate(item,index,value)})},update:function(object,path,updater){return __dshSet(object,path,updater(__dshGet(object,path)))},isNil:function(value){return value==null},dropRight:function(value,count){value=Array.isArray(value)?value:[];count=count===undefined?1:Math.max(0,Math.trunc(Number(count))||0);return value.slice(0,Math.max(0,value.length-count))},pullAt:__dshPullAt,last:function(value){return Array.isArray(value)?value.at(-1):undefined}});
var __dshLodash=typeof window._==='function'?window._:lodash;
window._=__dshLodash;
window.SillyTavern.libs.lodash=__dshLodash;
window.SillyTavern.libs.DOMPurify=window.DOMPurify;
window.SillyTavern.libs.Fuse=window.Fuse;
window.SillyTavern.libs.localforage=__dshLocalForageRoot;
function Mini(value){if(value===parent||(typeof top!=='undefined'&&value===top))value=__dshScriptWindow;if(value instanceof Mini)this.items=value.items;else if(typeof value==='string'&&value.trim().startsWith('<')){var template=document.createElement('template');template.innerHTML=value.trim();this.items=Array.from(template.content.childNodes)}else if(typeof value==='string')this.items=Array.from(document.querySelectorAll(value));else if(value===window||value===__dshScriptWindow||value===document||value instanceof Node)this.items=[value];else this.items=value&&typeof value.length==='number'?Array.from(value):[];for(var index=0;index<this.items.length;index++)this[index]=this.items[index]}
Mini.prototype.each=function(callback){this.items.forEach(function(item,index){callback.call(item,index,item)});return this};
var __dshMiniEvents=new WeakMap();var __dshMiniData=new WeakMap();
function __dshMiniTypes(value){return String(value??'').split(/\\s+/).filter(Boolean).map(function(value){return {value:value,type:value.split('.')[0]}})}
Mini.prototype.on=function(types,selector,handler){if(typeof selector==='function'){handler=selector;selector=undefined}if(typeof handler!=='function')return this;return this.each(function(){var element=this,records=__dshMiniEvents.get(element)??[];for(var eventType of __dshMiniTypes(types)){if(!eventType.type)continue;var wrapped=function(event){if(selector===undefined)return handler.call(element,event);var target=event.target?.closest?.(selector);if(target&&element.contains(target))return handler.call(target,event)};records.push({value:eventType.value,type:eventType.type,handler:handler,wrapped:wrapped});element.addEventListener(eventType.type,wrapped)}__dshMiniEvents.set(element,records)})};
Mini.prototype.bind=function(types,data,handler){return this.on(types,typeof data==='function'?data:handler)};
Mini.prototype.off=function(types,handler){var requested=types===undefined?[]:__dshMiniTypes(types);return this.each(function(){var element=this,kept=[];for(var record of __dshMiniEvents.get(element)??[]){var matchesType=requested.length===0||requested.some(function(type){return type.value.includes('.')?record.value===type.value:record.type===type.type});var matchesHandler=handler===undefined||record.handler===handler;if(matchesType&&matchesHandler)element.removeEventListener(record.type,record.wrapped);else kept.push(record)}__dshMiniEvents.set(element,kept)})};
for(var pair of [['text','textContent'],['html','innerHTML'],['val','value']])Mini.prototype[pair[0]]=function(property){return function(value){if(value===undefined)return this.items[0]?.[property]??'';return this.each(function(){this[property]=String(value)})}}(pair[1]);
Mini.prototype.attr=function(name,value){if(typeof name==='object')return this.each(function(){for(var pair of Object.entries(name))this.setAttribute?.(pair[0],String(pair[1]))});if(value===undefined)return this.items[0]?.getAttribute?.(name);return this.each(function(){this.setAttribute?.(name,String(value))})};
Mini.prototype.removeAttr=function(name){var names=String(name).split(/\\s+/).filter(Boolean);return this.each(function(){for(var value of names)this.removeAttribute?.(value)})};
Mini.prototype.prop=function(name,value){if(value===undefined)return this.items[0]?.[name];return this.each(function(){this[name]=value})};
Mini.prototype.css=function(name,value){if(typeof name==='object')return this.each(function(){Object.assign(this.style,name)});if(value===undefined)return this.items[0] instanceof Element?getComputedStyle(this.items[0]).getPropertyValue(name):'';return this.each(function(){this.style?.setProperty(name,String(value))})};
Mini.prototype.data=function(name,value){var element=this.items[0];if(name===undefined)return element===undefined?{}:Object.assign({},element.dataset??{},__dshMiniData.get(element)??{});if(typeof name==='object')return this.each(function(){var data=__dshMiniData.get(this)??{};Object.assign(data,name);__dshMiniData.set(this,data)});if(value===undefined)return element===undefined?undefined:(__dshMiniData.get(element)?.[name]??element.dataset?.[name]);return this.each(function(){var data=__dshMiniData.get(this)??{};data[name]=value;__dshMiniData.set(this,data)})};
Mini.prototype.removeData=function(name){return this.each(function(){var data=__dshMiniData.get(this);if(data===undefined)return;if(name===undefined)data={};else for(var key of String(name).split(/\\s+/).filter(Boolean))delete data[key];__dshMiniData.set(this,data)})};
Mini.prototype.append=function(value){var nodes=new Mini(value).items;return this.each(function(targetIndex){for(var node of nodes)this.append(targetIndex===0?node:node.cloneNode(true))})};
Mini.prototype.prepend=function(value){var nodes=new Mini(value).items;return this.each(function(targetIndex){for(var node of [...nodes].reverse())this.prepend(targetIndex===0?node:node.cloneNode(true))})};
Mini.prototype.appendTo=function(target){new Mini(target).append(this);return this};
Mini.prototype.find=function(selector){return new Mini(this.items.flatMap(function(item){return Array.from(item.querySelectorAll?.(selector)??[])}))};
Mini.prototype.closest=function(selector){return new Mini(this.items.map(function(item){return item.closest?.(selector)}).filter(Boolean))};
Mini.prototype.children=function(selector){var result=new Mini(this.items.flatMap(function(item){return Array.from(item.children??[])}));return selector===undefined?result:result.filter(selector)};
Mini.prototype.parent=function(selector){var result=new Mini(this.items.map(function(item){return item.parentElement}).filter(Boolean));return selector===undefined?result:result.filter(selector)};
Mini.prototype.siblings=function(selector){var result=new Mini(this.items.flatMap(function(item){return Array.from(item.parentElement?.children??[]).filter(function(value){return value!==item})}));return selector===undefined?result:result.filter(selector)};
Mini.prototype.prev=function(selector){var result=new Mini(this.items.map(function(item){return item.previousElementSibling}).filter(Boolean));return selector===undefined?result:result.filter(selector)};
Mini.prototype.next=function(selector){var result=new Mini(this.items.map(function(item){return item.nextElementSibling}).filter(Boolean));return selector===undefined?result:result.filter(selector)};
Mini.prototype.filter=function(value){return new Mini(typeof value==='function'?this.items.filter(function(item,index){return value.call(item,index,item)}):this.items.filter(function(item){return item.matches?.(value)}))};
Mini.prototype.is=function(value){var item=this.items[0];if(item===undefined)return false;if(typeof value==='function')return value.call(item,0,item)===true;if(value instanceof Mini)return value.items.includes(item);if(value instanceof Node)return item===value;return item.matches?.(String(value))===true};
Mini.prototype.remove=function(){return this.each(function(){this.remove()})};Mini.prototype.hide=function(){return this.css('display','none')};Mini.prototype.show=function(){return this.css('display','')};Mini.prototype.toggle=function(value){return this.each(function(){var visible=value===undefined?getComputedStyle(this).display==='none':Boolean(value);this.style?.setProperty('display',visible?'':'none')})};
Mini.prototype.addClass=function(value){var names=String(value).split(/\\s+/).filter(Boolean);return this.each(function(){this.classList?.add(...names)})};Mini.prototype.removeClass=function(value){var names=String(value).split(/\\s+/).filter(Boolean);return this.each(function(){this.classList?.remove(...names)})};Mini.prototype.toggleClass=function(value,force){return this.each(function(){this.classList?.toggle(String(value),force)})};Mini.prototype.hasClass=function(value){return this.items.some(function(item){return item.classList?.contains(String(value))===true})};
if(typeof window.jQuery!=='function'){window.$=function(value,properties){if(typeof value==='function'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',value,{once:true});else queueMicrotask(value);return new Mini([])}var result=new Mini(value);if(typeof value==='string'&&value.trim().startsWith('<')&&__dshPlain(properties)){for(var pair of Object.entries(properties)){var name=pair[0],property=pair[1];if(typeof property==='function'){result.on(name,property);continue}if(name==='text'){result.text(property);continue}if(name==='html'){result.html(property);continue}if(name==='css'&&__dshPlain(property)){result.css(property);continue}result.attr(name==='className'?'class':name,property)}}return result};window.jQuery=window.$}else{window.$=window.jQuery}
Object.defineProperty(Mini.prototype,'length',{get:function(){return this.items.length}});
Mini.prototype.get=function(index){if(index===undefined)return this.items.slice();index=Number(index);return this.items[index<0?this.items.length+index:index]};
Mini.prototype.eq=function(index){var item=this.get(index);return new Mini(item===undefined?[]:[item])};
Mini.prototype.first=function(){return this.eq(0)};Mini.prototype.last=function(){return this.eq(-1)};Mini.prototype.toArray=function(){return this.items.slice()};
Mini.prototype.add=function(value){return new Mini(Array.from(new Set(this.items.concat(new Mini(value).items))))};
Mini.prototype.clone=function(){return new Mini(this.items.map(function(item){return item.cloneNode?.(true)}).filter(Boolean))};
Mini.prototype.has=function(value){var targets=typeof value==='string'?Array.from(document.querySelectorAll(value)):new Mini(value).items;return new Mini(this.items.filter(function(item){return targets.some(function(target){return target!==item&&item.contains?.(target)})}))};
Mini.prototype.map=function(callback){return new Mini(this.items.flatMap(function(item,index){var value=callback.call(item,index,item);return value==null?[]:Array.isArray(value)?value:[value]}))};
Mini.prototype.slice=function(){return new Mini(Array.prototype.slice.apply(this.items,arguments))};
Mini.prototype.trigger=function(type,data){return this.each(function(){var event=typeof CustomEvent==='function'?new CustomEvent(String(type),{bubbles:true,detail:data}):new Event(String(type),{bubbles:true});this.dispatchEvent?.(event)})};
Mini.prototype.click=function(handler){return typeof handler==='function'?this.on('click',handler):this.trigger('click')};Mini.prototype.focus=function(){return this.each(function(){this.focus?.()})};
Mini.prototype.scrollTop=function(value){var item=this.items[0];if(value===undefined)return item?.scrollTop??0;return this.each(function(){this.scrollTop=Number(value)||0})};
function __dshMiniDimension(collection,name,value){var item=collection.items[0];if(value===undefined){if(item===window||item===__dshScriptWindow)return name==='width'?window.innerWidth:window.innerHeight;return item?.getBoundingClientRect?.()[name]??0}return collection.css(name,typeof value==='number'?value+'px':value)}
Mini.prototype.width=function(value){return __dshMiniDimension(this,'width',value)};Mini.prototype.height=function(value){return __dshMiniDimension(this,'height',value)};Mini.prototype.outerWidth=function(){return __dshMiniDimension(this,'width')};Mini.prototype.outerHeight=function(){return __dshMiniDimension(this,'height')};Mini.prototype.position=function(){var item=this.items[0];return {left:item?.offsetLeft??0,top:item?.offsetTop??0}};
Mini.prototype.slideDown=Mini.prototype.show;Mini.prototype.slideUp=Mini.prototype.hide;Mini.prototype.slideToggle=Mini.prototype.toggle;Mini.prototype.fadeOut=Mini.prototype.hide;
Mini.prototype.empty=function(){return this.each(function(){this.replaceChildren?.()})};
var __dshDisplayedRoots=new Map();
var __dshDisplayedScheduled=new Set();
function __dshReportDisplayed(messageId,root){if(__dshDisplayedScheduled.has(messageId))return;__dshDisplayedScheduled.add(messageId);queueMicrotask(function(){__dshDisplayedScheduled.delete(messageId);if(__dshDisplayedRoots.get(messageId)!==root)return;__dshPost('display-override',{messageId:messageId,value:root.outerHTML})})}
function __dshMessageById(messageId){return __dshMessages.find(function(message){return message.messageId===messageId})}
function __dshDisplayedRoot(messageId){var existing=__dshDisplayedRoots.get(messageId);if(existing)return existing;var message=__dshMessageById(messageId);var shell=document.createElement('div');shell.className='mes '+(message?.role==='user'?'user_mes':'character_mes');shell.dataset.messageId=String(messageId);shell.setAttribute('mesid',String(messageId));var root=document.createElement('div');root.className='mes_text';root.dataset.dshMessageId=String(messageId);root.innerHTML=__dshDisplayedHtml(message?.text??'',messageId);shell.appendChild(root);__dshFrameHost.appendChild(shell);new MutationObserver(function(){__dshReportDisplayed(messageId,root)}).observe(root,{attributes:true,characterData:true,childList:true,subtree:true});__dshDisplayedRoots.set(messageId,root);return root}
window.formatAsDisplayedMessage=function(text,option){var messageId=__dshDisplayedMessageId(option?.message_id);return __dshDisplayedHtml(String(text??''),messageId)};
window.retrieveDisplayedMessage=function(messageId){messageId=__dshDisplayedMessageId(messageId);var result=new Mini(__dshDisplayedRoot(messageId));result.__dshMessageId=messageId;return result};
window.refreshOneMessage=function(messageId,target){var sourceId=__dshDisplayedMessageId(messageId);var targetId=Number.isInteger(target?.__dshMessageId)?target.__dshMessageId:sourceId;var source=__dshMessageById(sourceId);var root=__dshDisplayedRoot(targetId);root.innerHTML=__dshDisplayedHtml(source?.text??'',sourceId);__dshReportDisplayed(targetId,root);var eventType=source?.role==='user'?window.tavern_events.USER_MESSAGE_RENDERED:window.tavern_events.CHARACTER_MESSAGE_RENDERED;return window.eventEmit(eventType,sourceId).then(function(){})};
window.builtin={renderMarkdown:function(value){return __dshMarkdownHtml(value)},saveSettings:__dshSaveSettings};
function __dshToastText(value){if(typeof value==='string')return value;try{return JSON.stringify(value)}catch(error){return String(value)}}
function __dshToast(level,args){var value=Array.from(args).slice(0,2).map(__dshToastText).filter(Boolean).join(' · ').slice(0,8000);(level==='error'?console.error:level==='warning'?console.warn:console.info)(value);if(value)__dshPost('toast',{level:level,value:value});return value}
window.toastr={info:function(){return __dshToast('info',arguments)},success:function(){return __dshToast('success',arguments)},warning:function(){return __dshToast('warning',arguments)},error:function(){return __dshToast('error',arguments)}};
addEventListener('message',function(event){if(event.source!==parent||!event.data||event.data.source!=='dsh-agent-rp-host'||event.data.action!=='compatibility-surface-open')return;if(event.data.surface==='mobile-trigger'&&__dshDeclaredCompatibilityMarkers.includes('__小手机脚本_loaded__'))__dshActivateCompatibilitySurface('mobile-trigger')});
  addEventListener('message',function(event){if(event.source!==parent||!event.data||event.data.source!=='dsh-agent-rp-host')return;var message=event.data;if(message.action==='script-buttons-request'){__dshReportScriptButtons();return}if(message.action==='compatibility-markers-request'){__dshPost('compatibility-markers',{markers:__dshCompatibilityMarkers()});return}if(message.action==='external-window-message'){if(typeof message.requestId!=='string'||typeof message.origin!=='string')return;if(!__dshDeliveredExternalWindowRequests.has(message.requestId)){if(__dshDeliveredExternalWindowRequests.size>=64)__dshDeliveredExternalWindowRequests.delete(__dshDeliveredExternalWindowRequests.values().next().value);__dshDeliveredExternalWindowRequests.add(message.requestId);dispatchEvent(new MessageEvent('message',{data:message.value,origin:message.origin}))}__dshPost('external-window-delivered',{requestId:message.requestId});return}if(message.action==='external-window-closed'){var external=__dshExternalWindows.get(message.requestId);if(!external)return;external.closed=true;__dshExternalWindows.delete(message.requestId);return}if(message.action==='capability-result'&&message.capability==='ui.external-window.open'){var external=__dshExternalWindows.get(message.requestId);if(!external)return;if(message.ok!==true){external.closed=true;__dshExternalWindows.delete(message.requestId);__dshPost('toast',{level:'warning',value:String(message.error??'外部窗口未打开')})}return}if(message.action==='variables-result'||message.action==='preset-result'||message.action==='model-list-result'||message.action==='capability-result'){var pending=__dshPending.get(message.requestId);if(!pending||message.action==='capability-result'&&pending.capability!==message.capability)return;__dshPending.delete(message.requestId);message.ok?pending.resolve(message.action==='model-list-result'||message.action==='capability-result'?message.value:undefined):pending.reject(new Error(String(message.error??'保存失败')));return}if(message.action==='extension-settings-sync'&&__dshPlain(message.settings)){for(var key of Object.keys(__dshExtensionSettings))delete __dshExtensionSettings[key];Object.assign(__dshExtensionSettings,__dshClone(message.settings));return}if(message.action==='generation-preview-result'){var pending=__dshPending.get(message.requestId);if(!pending)return;__dshPending.delete(message.requestId);message.ok?pending.resolve(message.value):pending.reject(new Error(String(message.error??'提示词预览失败')));return}if(message.action==='generation-result'){var pending=__dshPending.get(message.requestId);if(!pending)return;__dshPending.delete(message.requestId);if(pending.generationFetch){pending.resolve({ok:message.ok===true,value:message.value,error:message.error});return}message.ok?pending.resolve(String(message.value??'')):pending.reject(new Error(String(message.error??'生成失败')));return}if(message.action==='preset-sync'){__dshPreset=message.preset;return}if(message.action==='variables-sync'){var transcriptChanged=__dshMessageSignature(__dshMessages)!==__dshMessageSignature(message.messages);__dshScopes=message.scopes;__dshMessages=message.messages;__dshCharacterRegexScripts=message.characterRegexScripts??__dshCharacterRegexScripts;__dshGlobalRegexScripts=message.globalRegexScripts??__dshGlobalRegexScripts;__dshGlobalScriptTrees=message.globalScriptTrees??__dshGlobalScriptTrees;__dshPresetScriptTrees=message.presetScriptTrees??__dshPresetScriptTrees;__dshCharacterScriptTrees=message.characterScriptTrees??__dshCharacterScriptTrees;__dshInjectedPrompts=message.injectedPrompts??__dshInjectedPrompts;__dshDisplayRegexScripts=message.displayRegexScripts??__dshDisplayRegexScripts;__dshWorldbooks=message.worldbooks;__dshWorldbookBindings=message.worldbookBindings;__dshActiveWorldbookEntries=message.activeWorldbookEntries??__dshActiveWorldbookEntries;var metadata=__dshChatMetadata();window.SillyTavern.chatMetadata=metadata;window.SillyTavern.chat_metadata=metadata;if(message.preset!==undefined)__dshPreset=message.preset;if(transcriptChanged){for(var root of __dshDisplayedRoots.values())(root.parentElement??root).remove();__dshDisplayedRoots.clear()}__dshSyncSillyTavernChat();void __dshRefreshInjections();return}if(message.action==='event'){__dshEventQueue=__dshEventQueue.catch(function(){return undefined}).then(async function(){var args=message.args??[];var mutableMvuEvent=message.eventType==='mag_variable_initialized'||message.eventType==='mag_variable_initiailized'||message.eventType==='mag_variable_update_ended';var before=mutableMvuEvent?JSON.stringify(args[0]??{}):undefined;var previousCause=__dshMutationCause;__dshMutationCause=__dshPlain(message.mutationCause)?__dshClone(message.mutationCause):undefined;__dshRememberStatusPanelCause(__dshMutationCause);try{await __dshEmitLocal(message.eventType,args);var changed=before!==undefined&&JSON.stringify(args[0]??{})!==before?__dshReplace(args[0]??{},{type:'message'}):undefined;await Promise.resolve(changed);if(message.eventType==='generation_ended')__dshConsumeOnceInjections()}finally{__dshMutationCause=previousCause}}).catch(function(error){console.error(error);__dshPost('runtime-error',{value:String(error)})})}});
addEventListener('error',function(event){__dshPost('runtime-error',{value:__dshRuntimeError(event.error??event.message,event.lineno,event.colno)})});
addEventListener('unhandledrejection',function(event){__dshPost('runtime-error',{value:__dshRuntimeError(event.reason)})});
__dshReportScriptButtons();
__dshPost('startup-phase',{value:'runtime'});
`
}

/** Create a network-isolated script document from an authorized execution plan. */
export function tavernScriptFrameSource(
  script: ImportedTavernHelperScript,
  execution: string | TavernScriptExecution,
  snapshot: TavernScriptSnapshot,
  option: { readonly externalBootstrap?: boolean } = {},
): string {
  const plan: TavernScriptExecution = typeof execution === 'string' ? {
    source: execution,
    mode: 'classic',
    inlineDependencies: [],
    preloads: [],
    needsDomPurify: /\bDOMPurify\b/u.test(execution),
    needsFuse: /\bFuse\b/u.test(execution),
    compatibilityMarkers: declaredTavernCompatibilityMarkers(execution),
    remoteImageOrigins: declaredTavernImageOrigins(execution),
    remoteStyleOrigins: declaredTavernStyleOrigins(execution),
    remoteStylesheetUrls: declaredTavernStylesheetUrls(execution),
    remoteFontOrigins: [],
    stylesheetDependencies: [],
    remoteFrameOrigins: declaredTavernFrameOrigins(execution),
  } : execution
  const source = plan.source
  const moduleFacade = plan.mode === 'module'
    ? 'const __dshModuleWindow=document.__dshScriptWindow;const window=__dshModuleWindow,parent=__dshModuleWindow,top=__dshModuleWindow,self=__dshModuleWindow,globalThis=__dshModuleWindow;\n'
    : ''
  const encoded = inlineScriptJson(`${moduleFacade}${source}\n//# sourceURL=dsh-agent-rp:${snapshot.scriptScope}:${script.id}`)
  const approvedStyles = new Set(snapshot.approvedStyleOrigins ?? [])
  const stylesheetDependencies = inlineScriptJson((plan.stylesheetDependencies ?? []).filter(dependency => {
    try {
      return approvedStyles.has(new URL(dependency.url).origin)
    } catch {
      return false
    }
  }))
  const stylesheetSetup = `window.__dshResolvedStylesheets=Object.freeze(${stylesheetDependencies}.map(Object.freeze));`
  const moduleDependencies = inlineScriptJson(plan.moduleDependencies ?? [])
  const dependencies = (plan.inlineDependencies ?? []).map((dependency, index) =>
    `await __dshRunClassic(${inlineScriptJson(`${dependency}\n//# sourceURL=dsh-agent-rp-dependency:${index + 1}`)})`).join(';')
  const origins = [...new Set([...BUILT_IN_TAVERN_SCRIPT_ORIGINS, ...snapshot.approvedScriptOrigins])]
    .map(origin => new URL(origin).origin).join(' ')
  const libraries = [
    `<script data-dsh-runtime-vendor="jquery">${tavernVendorSource('jquery', TAVERN_JQUERY_GZIP_BASE64)}</script>`,
    `<script data-dsh-runtime-vendor="lodash">${tavernVendorSource('lodash', TAVERN_LODASH_GZIP_BASE64)}</script>`,
    ...plan.preloads.map(tavernPreloadScript),
    plan.needsDomPurify
      ? `<script src="${DOMPURIFY_SCRIPT_URL}" integrity="${DOMPURIFY_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>`
      : '',
    plan.needsFuse
      ? `<script src="${FUSE_SCRIPT_URL}" integrity="${FUSE_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>`
      : '',
  ].join('')
  const preloads = plan.preloads.map(preload => {
    switch (preload) {
      case 'vue':
        return 'Promise.resolve()'
      case 'yaml':
        return 'Promise.resolve()'
      case 'zod':
        return 'Promise.resolve()'
    }
  })
  const execute = plan.mode === 'module'
    ? `var __dshModuleFacade=${inlineScriptJson(moduleFacade)},__dshRemoteModulePlans=${moduleDependencies},__dshRemoteModuleById=new Map(__dshRemoteModulePlans.map(function(plan){return [plan.id,plan]})),__dshRemoteModuleUrls=new Map(),__dshRemoteModuleResolving=new Set();function __dshRemoteModuleUrl(id){var existing=__dshRemoteModuleUrls.get(id);if(existing)return existing;if(__dshRemoteModuleResolving.has(id))throw new Error('远程模块依赖存在循环，无法在隔离环境中加载');var plan=__dshRemoteModuleById.get(id);if(!plan)throw new Error('远程模块依赖图不完整');__dshRemoteModuleResolving.add(id);try{var value=__dshModuleFacade+plan.source;for(var dependencyId of plan.dependencies){var dependency=__dshRemoteModuleById.get(dependencyId);if(!dependency)throw new Error('远程模块依赖图不完整');value=value.replaceAll(dependency.placeholder,__dshRemoteModuleUrl(dependencyId))}var url=URL.createObjectURL(new Blob([value+'\\n//# sourceURL=dsh-agent-rp-module:'+plan.id],{type:'text/javascript'}));__dshRemoteModuleUrls.set(id,url);return url}finally{__dshRemoteModuleResolving.delete(id)}}var __dshEntrySource=${encoded};for(var __dshRemotePlan of __dshRemoteModulePlans)__dshEntrySource=__dshEntrySource.replaceAll(__dshRemotePlan.placeholder,__dshRemoteModuleUrl(__dshRemotePlan.id));var __dshModuleUrl=URL.createObjectURL(new Blob([__dshEntrySource],{type:'text/javascript'}));try{await import(__dshModuleUrl)}finally{URL.revokeObjectURL(__dshModuleUrl);for(var __dshRemoteUrl of __dshRemoteModuleUrls.values())URL.revokeObjectURL(__dshRemoteUrl)}`
    : `await __dshRunClassic(${encoded})`
  const preload = preloads.length === 0 ? '' : `await Promise.all([${preloads.join(',')}]);`
  const mobileCompatibility = plan.compatibilityMarkers.includes('__小手机脚本_loaded__')
  const compatibilitySetup = mobileCompatibility ? "__dshInstallCompatibilitySurface('mobile-trigger');" : ''
  const compatibilityStyle = mobileCompatibility ? mobileFontAwesomeStyle : ''
  const approvedImageOrigins = (snapshot.approvedImageOrigins ?? []).flatMap(origin => {
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.origin === origin ? [url.origin] : []
    } catch {
      return []
    }
  })
  const imageSource = ['data:', 'blob:', ...new Set(approvedImageOrigins)].join(' ')
  const approvedStyleOrigins = (snapshot.approvedStyleOrigins ?? []).flatMap(origin => {
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.origin === origin ? [url.origin] : []
    } catch {
      return []
    }
  })
  const styleSource = ["'unsafe-inline'", ...new Set(approvedStyleOrigins)].join(' ')
  const approvedFontOrigins = (snapshot.approvedFontOrigins ?? []).flatMap(origin => {
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.origin === origin ? [url.origin] : []
    } catch {
      return []
    }
  })
  const fontSource = approvedFontOrigins.length === 0 ? "'none'" : [...new Set(approvedFontOrigins)].join(' ')
  const approvedFrameOrigins = (snapshot.approvedFrameOrigins ?? []).flatMap(origin => {
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.origin === origin ? [url.origin] : []
    } catch {
      return []
    }
  })
  const frameSource = approvedFrameOrigins.length === 0 ? "'none'" : [...new Set(approvedFrameOrigins)].join(' ')
  const bootstrap = `void (async function(){var __dshScriptStartedAt=Date.now();try{__dshPost('startup-phase',{value:'script'});${preload}${compatibilitySetup}${dependencies}${dependencies === '' ? '' : ';'}${execute};__dshStartStatusPanel();__dshPost('ready',{markers:__dshCompatibilityMarkers(),startupMs:Math.max(0,Date.now()-__dshScriptStartedAt)})}catch(error){__dshStartStatusPanel();console.error(error);__dshPost('runtime-error',{value:__dshRuntimeError(error)})}})();`
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${origins}; connect-src 'none'; img-src ${imageSource}; style-src ${styleSource}; font-src ${fontSource}; frame-src ${frameSource}">${libraries}<style>html,body{background:transparent;color-scheme:dark}${extensionMenuStyle}${compatibilityStyle}</style></head><body><script>${stylesheetSetup}${runtimeSource(snapshot, plan.compatibilityMarkers, option.externalBootstrap === true)}\n${bootstrap}</script></body></html>`
}

/** Opaque navigation shell plus the runtime program delivered after the shell proves its origin. */
export interface TavernScriptFrameNavigation {
  readonly url: string
  readonly vendors: readonly string[]
  readonly program: string
}

function tavernProgramKey(program: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < program.length; index += 1) {
    hash ^= program.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${program.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

/** Keep large scripts and private Session state out of the iframe navigation URL. */
export function tavernScriptFrameNavigation(source: string): TavernScriptFrameNavigation {
  const programs: string[] = []
  const inlineScript = /<script([^>]*)>([\s\S]*?)<\/script>/gu
  let shell = ''
  let cursor = 0
  for (const match of source.matchAll(inlineScript)) {
    shell += source.slice(cursor, match.index)
    cursor = match.index + match[0].length
    if (/\bsrc\s*=/iu.test(match[1] ?? '')) shell += match[0]
    else programs.push(match[2] ?? '')
  }
  shell += source.slice(cursor)
  if (programs.length === 0) throw new Error('酒馆脚本文档缺少运行入口')
  const sharedVendorCount = programs.length >= 3 ? 2 : 0
  const vendors = programs.slice(0, sharedVendorCount)
  const program = programs.slice(sharedVendorCount).join('\n;\n')
  const key = tavernProgramKey(programs.join('\n;\n'))
  const loader = `(function(){var started=false,timer;function request(){parent.postMessage({source:'dsh-agent-rp-tavern-loader',action:'bootstrap-request'},'*')}addEventListener('message',function(event){var message=event.data;if(started||event.source!==parent||!message||message.source!=='dsh-agent-rp-host'||message.action!=='runtime-bootstrap'||!Array.isArray(message.vendors)||message.vendors.length>2||message.vendors.some(function(value){return typeof value!=='string'})||typeof message.program!=='string'||!message.snapshot||typeof message.snapshot!=='object')return;started=true;clearInterval(timer);parent.postMessage({source:'dsh-agent-rp-tavern-loader',action:'bootstrap-started'},'*');var programStartedAt=Date.now();try{for(var vendor of message.vendors)Function(vendor)();Object.defineProperty(globalThis,'__dshBootSnapshot',{configurable:true,value:message.snapshot});Function(message.program)()}catch(error){parent.postMessage({source:'dsh-agent-rp-tavern-script',action:'runtime-error',value:String(error&&error.message||error)},'*')}finally{delete globalThis.__dshBootSnapshot;parent.postMessage({source:'dsh-agent-rp-tavern-loader',action:'bootstrap-finished',value:Math.max(0,Date.now()-programStartedAt)},'*')}},false);request();timer=setInterval(request,250)})();`
  const bodyClose = shell.lastIndexOf('</body>')
  if (bodyClose < 0) throw new Error('酒馆脚本文档缺少 body')
  const navigationShell = `${shell.slice(0, bodyClose)}<script>${loader}</script>${shell.slice(bodyClose)}`
    .replace('<body>', `<body data-dsh-program="${key}">`)
  return { url: tavernScriptFrameUrl(navigationShell), vendors, program }
}

/** Encode one script document as an opaque-origin navigation URL for a sandboxed runtime frame. */
export function tavernScriptFrameUrl(source: string): string {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return `data:text/html;charset=utf-8;base64,${btoa(binary)}`
}
