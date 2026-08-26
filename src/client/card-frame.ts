/** Browser-side compilation of character display segments into isolated iframe documents. */

import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  cardDisplayCustomElementTags,
  normalizeLegacyCardHtml,
  type CardDisplayDiagnostic,
  type CompiledCharacterDisplay,
} from '../card-display-compiler.ts'
import {
  characterLibraryImageUrl,
  type CharacterLibraryDetail,
  type CharacterRemoteResourceApproval,
  type CharacterRemoteResourceType,
} from '../character-library-protocol.ts'
import {
  cardRemoteResourceApprovalKey,
  cardRemoteResourceRequirements,
} from '../card-remote-resource.ts'
import type { ImportedTavernHelperScript } from '../import/types.ts'
import {
  projectSillyTavernIdentityMacros,
  type SillyTavernIdentityMacroValues,
} from '../sillytavern-identity-macro.ts'
import type { CardVariableScope } from './card-capability.ts'
import type { CardFrameAppearance } from './card-frame-appearance.ts'
import { embeddedNativeIdentityRelayRuntime } from './embedded-identity.ts'

/** One browser-ready display piece consumed directly by the React view. */
export type CompiledCardFrameSegment =
  | { readonly kind: 'markdown'; readonly text: string }
  | {
      readonly kind: 'frame'
      readonly sourceKind: 'html' | 'inline-html'
      readonly srcDoc: string
      /** The source needs scripts or remote document loading and must not run in the library picker. */
      readonly interactive: boolean
      /** HTTPS origins referenced by this display segment. */
      readonly remoteOrigins: readonly string[]
      /** Statically identifiable resource classes referenced by this display segment. */
      readonly remoteResources: readonly CharacterRemoteResourceApproval[]
    }

/** Browser-ready segments plus content-free compatibility diagnostics. */
export interface CompiledCardFrames {
  readonly segments: readonly CompiledCardFrameSegment[]
  readonly diagnostics: readonly CardDisplayDiagnostic[]
}

/** Inputs that vary with the active Session and local browser origin. */
export interface CardFrameCompileOptions {
  readonly origin: string
  /** Host theme baseline used only for mixed prose and inline HTML. */
  readonly appearance?: CardFrameAppearance
  readonly statData?: JsonValue
  /** Active identities used only while projecting state into the isolated view. */
  readonly identity?: SillyTavernIdentityMacroValues
  readonly character?: CharacterLibraryDetail
  /** Successful script-runtime markers that a card may use for compatibility checks. */
  readonly compatibilityMarkers?: readonly string[]
  /** Current greeting plus card-owned alternatives exposed without sharing the rest of the transcript. */
  readonly greetingChoices?: CardFrameGreetingChoices
  /** Read-only current-card projection for frontends that inspect their own Tavern Helper scripts. */
  readonly currentCharacter?: {
    readonly name: string
    readonly tavernHelperScripts: readonly ImportedTavernHelperScript[]
  }
  /** Session variable namespaces exposed through the bounded Tavern Helper-compatible facade. */
  readonly variableScopes?: Readonly<Record<CardVariableScope, Readonly<Record<string, JsonValue>>>>
  /** Opaque Host registration used to authenticate capability and resize messages from this frame. */
  readonly capabilityToken?: string
}

/** Bounded Character Card greetings available to an isolated light frontend. */
export interface CardFrameGreetingChoices {
  readonly selected: string
  readonly alternatives: readonly string[]
}

/** Select card resource classes that still need local approval. */
export function blockedCardFrameResources(
  resources: readonly CharacterRemoteResourceApproval[],
  character: {
    readonly approvedRemoteResourceOrigins?: readonly string[]
    readonly approvedRemoteResources?: readonly CharacterRemoteResourceApproval[]
    readonly remoteResourcePolicy?: CharacterLibraryDetail['remoteResourcePolicy']
  },
): readonly CharacterRemoteResourceApproval[] {
  if (character.remoteResourcePolicy === 'isolated-https') return []
  const approved = new Set((character.approvedRemoteResources ?? []).map(cardRemoteResourceApprovalKey))
  const legacy = new Set(character.approvedRemoteResourceOrigins ?? [])
  return resources.filter(resource => !approved.has(cardRemoteResourceApprovalKey(resource)) && !legacy.has(resource.origin))
}

const cardFrameCompatibility = `<style>
html{background:transparent!important;color-scheme:dark;scrollbar-color:rgba(145,158,181,.58) transparent;scrollbar-width:thin}
*,*::before,*::after{box-sizing:border-box}
[data-agent-rp-center]{display:block;text-align:center}
[data-agent-rp-legacy-symbol-bar]{display:block!important;width:100%!important;height:.28em!important;min-height:2px;max-height:6px;border-radius:999px;background:currentColor!important;overflow:hidden;font-size:0!important;line-height:0!important;letter-spacing:0!important}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:999px;background:rgba(145,158,181,.58);background-clip:padding-box}
img,svg,video,canvas{max-width:100%}
</style>`

function cardFrameAppearanceRuntime(appearance: CardFrameAppearance | undefined): string {
  if (appearance === undefined) return ''
  const json = JSON.stringify(appearance)
    .replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  return `(function(){var value=${json};function apply(target){if(!target)return;target.style.setProperty('background-color',value.backgroundColor,'important');target.style.setProperty('color',value.color,'important');target.style.setProperty('font-family',value.fontFamily);target.style.setProperty('font-size',value.fontSize);target.style.setProperty('font-style',value.fontStyle);target.style.setProperty('font-weight',value.fontWeight);target.style.setProperty('letter-spacing',value.letterSpacing);target.style.setProperty('line-height',value.lineHeight);if(target===document.body){target.style.setProperty('margin','0','important');target.style.setProperty('padding','0','important')}}apply(document.documentElement);addEventListener('DOMContentLoaded',function(){apply(document.body)},{once:true})})();`
}

function remoteOrigins(source: string): readonly string[] {
  const origins = new Set<string>()
  for (const match of source.matchAll(/https:\/\/[^\s"'<>`\\)]+/giu)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/u, ''))
      if (url.protocol === 'https:') origins.add(url.origin)
    } catch {
      // URL-like card text does not declare a usable browser resource.
    }
  }
  return [...origins].sort()
}

const compatibilityMarkerPattern = /^__[\p{L}\p{N}_-]{1,112}_loaded__$/u

function boundedCompatibilityMarkers(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  return [...new Set(value.filter(marker => marker.length <= 128 && compatibilityMarkerPattern.test(marker)))]
    .sort().slice(0, 32)
}

function isolatedCardStorageRuntime(): string {
  return `
(function(){
  var stores=window.__dshCardStorageStores;
  if(!stores){
    stores={local:new Map(),session:new Map()};
    Object.defineProperty(window,'__dshCardStorageStores',{value:stores});
  }
  function quotaError(){var error=new Error('隔离页面存储空间已满');error.name='QuotaExceededError';return error}
  function storage(data){
    var api={};
    Object.defineProperty(api,'length',{enumerable:true,get:function(){return data.size}});
    api.key=function(index){var keys=Array.from(data.keys());return Number.isInteger(Number(index))?keys[Number(index)]??null:null};
    api.getItem=function(key){key=String(key);return data.has(key)?data.get(key):null};
    api.setItem=function(key,value){
      key=String(key);value=String(value);
      if(key.length>1024||value.length>2097152)throw quotaError();
      var units=key.length+value.length;
      for(var entry of data)if(entry[0]!==key)units+=entry[0].length+entry[1].length;
      if((!data.has(key)&&data.size>=256)||units>5242880)throw quotaError();
      data.set(key,value);
    };
    api.removeItem=function(key){data.delete(String(key))};
    api.clear=function(){data.clear()};
    return Object.freeze(api);
  }
  Object.defineProperty(window,'localStorage',{configurable:true,enumerable:true,value:storage(stores.local)});
  Object.defineProperty(window,'sessionStorage',{configurable:true,enumerable:true,value:storage(stores.session)});
})();
`
}

function mvuFrameRuntime(
  statData: JsonValue | undefined,
  compatibilityMarkers: readonly string[] | undefined,
  greetingChoices: CardFrameGreetingChoices | undefined,
  currentCharacter: CardFrameCompileOptions['currentCharacter'],
  variableScopes: CardFrameCompileOptions['variableScopes'],
  capabilityToken: string | undefined,
): string {
  const json = JSON.stringify(statData ?? {}).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const markers = JSON.stringify(boundedCompatibilityMarkers(compatibilityMarkers))
  const greetingJson = JSON.stringify(greetingChoices ?? null)
    .replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const currentCharacterJson = JSON.stringify(currentCharacter ?? null)
    .replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const capabilityTokenJson = JSON.stringify(capabilityToken ?? null)
  const scopesJson = JSON.stringify(variableScopes ?? {
    global: {}, preset: {}, character: {}, chat: {}, message: {},
  }).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  return `
var __dshStatData=${json};
var __dshCompatibilityMarkers=${markers};
var __dshCardGreetingChoices=${greetingJson};
var __dshCurrentCharacter=${currentCharacterJson};
var __dshCardScopes=${scopesJson};
var __dshCardCapabilityToken=${capabilityTokenJson};
function __dshDeepFreezeCardValue(value,seen){
  if(!value||typeof value!=='object')return value;
  seen=seen??new Set();if(seen.has(value))return value;seen.add(value);
  for(var key of Object.keys(value))__dshDeepFreezeCardValue(value[key],seen);
  return Object.freeze(value);
}
var __dshCardCharacters=Object.freeze(__dshCurrentCharacter===null?[]:[__dshDeepFreezeCardValue({
  name:__dshCurrentCharacter.name,
  data:{name:__dshCurrentCharacter.name,extensions:{tavern_helper:{scripts:__dshCurrentCharacter.tavernHelperScripts}}}
})]);
Object.defineProperty(window,'characters',{configurable:false,enumerable:true,writable:false,value:__dshCardCharacters});
Object.defineProperty(window,'this_chid',{configurable:false,enumerable:true,writable:false,value:0});
for(var __dshMarker of __dshCompatibilityMarkers)window[__dshMarker]=true;
var __dshCardListeners=new Map();
function __dshCardOn(type,listener){var list=__dshCardListeners.get(String(type))??[];list.push(listener);__dshCardListeners.set(String(type),list);var stop=function(){var current=__dshCardListeners.get(String(type))??[];__dshCardListeners.set(String(type),current.filter(function(value){return value!==listener}))};stop.stop=stop;return stop}
function __dshCardEmit(type){var args=Array.prototype.slice.call(arguments,1);for(var listener of [...(__dshCardListeners.get(String(type))??[])]){try{listener.apply(window,args)}catch(error){console.error(error)}}}
window.Mvu={events:{VARIABLE_INITIALIZED:'mag_variable_initialized',VARIABLE_UPDATE_STARTED:'mag_variable_update_started',COMMAND_PARSED:'mag_command_parsed',VARIABLE_UPDATE_ENDED:'mvu-variable-update-ended',BEFORE_MESSAGE_UPDATE:'mag_before_message_update'},getMvuData:function(){return {stat_data:__dshStatData}},replaceMvuData:function(value){__dshStatData=value?.stat_data??value??{};__dshCardEmit('mvu-variable-update-ended',{stat_data:__dshStatData});return Promise.resolve()},isDuringExtraAnalysis:function(){return false}};
window.getAllVariables=function(){return {stat_data:__dshStatData}};
window.waitGlobalInitialized=function(){return Promise.resolve()};
window.eventOn=__dshCardOn;
window.eventOnce=function(type,listener){var control;control=__dshCardOn(type,function(){control.stop();return listener.apply(this,arguments)});return control};
window.eventEmit=__dshCardEmit;
window.errorCatched=function(fn){return function(){try{var value=fn.apply(this,arguments);if(value&&typeof value.catch==='function')value.catch(console.error)}catch(error){console.error(error)}}};
window.toastr={info:function(){},success:function(){},warning:function(){},error:function(){}};
var __dshCardChat=[{message_id:0,message:__dshCardGreetingChoices?.selected??'',mes:__dshCardGreetingChoices?.selected??'',name:'角色',is_user:false,role:'assistant',extra:{},swipe_id:Math.max(0,__dshCardGreetingChoices?.alternatives?.indexOf(__dshCardGreetingChoices.selected)??0),swipes:__dshCardGreetingChoices?.alternatives??[]}];
var __dshCardPending=new Map(),__dshCardRequestSequence=0;
var __dshCardExternalWindows=new Map();
var __dshCardDeliveredExternalWindowRequests=new Set();
function __dshCardOpenExternalWindow(url,target,features){var parsed;try{parsed=new URL(String(url))}catch{return null}if(!__dshCardCapabilityToken||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.href.length>4096)return null;target=String(target??'');features=String(features??'');if(target.length>200||features.length>2000)return null;var requestId='card-external-window-'+(++__dshCardRequestSequence);var handle={closed:false,close:function(){if(handle.closed)return;handle.closed=true;__dshCardExternalWindows.delete(requestId);parent.postMessage({source:'dsh-agent-rp-card',action:'external-window-close',token:__dshCardCapabilityToken,requestId:requestId},'*')},focus:function(){parent.postMessage({source:'dsh-agent-rp-card',action:'external-window-focus',token:__dshCardCapabilityToken,requestId:requestId},'*')}};__dshCardExternalWindows.set(requestId,handle);parent.postMessage({source:'dsh-agent-rp-card',action:'capability-request',capability:'ui.external-window.open',token:__dshCardCapabilityToken,requestId:requestId,payload:{url:parsed.href,target:target,features:features}},'*');return handle}
window.open=__dshCardOpenExternalWindow;
function __dshCardNativeIdentityRequest(option){option=option??{};var audience,nonce=String(option.nonce??''),includeDisplayName=option.includeDisplayName===true;try{var parsed=new URL(String(option.audience??''));if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.origin!==String(option.audience))throw new Error('身份服务必须是完整 HTTPS 来源');audience=parsed.origin}catch(error){return Promise.reject(error)}if(!/^[A-Za-z0-9_-]{16,256}$/.test(nonce))return Promise.reject(new Error('身份服务 nonce 无效'));if(!__dshCardCapabilityToken)return Promise.reject(new Error('本机身份能力不可用'));var requestId='card-native-identity-'+(++__dshCardRequestSequence);return new Promise(function(resolve,reject){var timer=setTimeout(function(){if(!__dshCardPending.delete(requestId))return;reject(new Error('本机身份请求超时，请重试'))},300000);__dshCardPending.set(requestId,{kind:'identity',resolve:resolve,reject:reject,timer:timer});parent.postMessage({source:'dsh-agent-rp-card',action:'capability-request',capability:'identity.native.attest',token:__dshCardCapabilityToken,requestId:requestId,payload:{audience:audience,nonce:nonce,includeDisplayName:includeDisplayName}},'*')})}
window.dshIdentity=Object.freeze({request:__dshCardNativeIdentityRequest});
window.DshIdentity=window.dshIdentity;
${embeddedNativeIdentityRelayRuntime('__dshCardNativeIdentityRequest')}
function __dshCloneCardValue(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value))}
function __dshCardVariableScope(option){var scope=typeof option==='string'?option:option?.type??'message';if(!['global','preset','character','chat','message'].includes(scope))throw new Error('不支持的变量作用域: '+String(scope));return scope}
function __dshMergeCardVariables(target,source){var result=__dshCloneCardValue(target??{});for(var key of Object.keys(source??{})){var value=source[key];if(value&&typeof value==='object'&&!Array.isArray(value)&&result[key]&&typeof result[key]==='object'&&!Array.isArray(result[key]))result[key]=__dshMergeCardVariables(result[key],value);else result[key]=__dshCloneCardValue(value)}return result}
window.getVariables=function(option){return __dshCloneCardValue(__dshCardScopes[__dshCardVariableScope(option)]??{})};
window.replaceVariables=function(variables,option){
  var scope=__dshCardVariableScope(option),next=__dshCloneCardValue(variables??{}),previous=JSON.stringify(__dshCardScopes[scope]??{});
  if(!next||typeof next!=='object'||Array.isArray(next))return Promise.reject(new Error('变量必须是对象'));
  __dshCardScopes[scope]=next;
  if(previous===JSON.stringify(next)||!__dshCardCapabilityToken)return Promise.resolve(__dshCloneCardValue(next));
  return new Promise(function(resolve,reject){
    var requestId='card-variables-'+(++__dshCardRequestSequence);
    var timer=setTimeout(function(){if(!__dshCardPending.delete(requestId))return;reject(new Error('变量保存超时，请重试'))},15000);
    __dshCardPending.set(requestId,{kind:'variables',resolve:resolve,reject:reject,timer:timer});
    parent.postMessage({source:'dsh-agent-rp-card',action:'variables-replace',token:__dshCardCapabilityToken,requestId:requestId,scope:scope,variables:next},'*');
  });
};
window.updateVariablesWith=function(updater,option){var current=window.getVariables(option);return Promise.resolve(updater(current)).then(function(next){return window.replaceVariables(next,option).then(function(){return next})})};
window.insertOrAssignVariables=function(variables,option){return window.updateVariablesWith(function(current){return __dshMergeCardVariables(current,variables)},option)};
function __dshSetCardCapabilityState(value){document.documentElement.dataset.agentRpCapabilityState=String(value)}
function __dshCloneCardMessage(message){return Object.assign({},message,{extra:Object.assign({},message.extra),swipes:Array.isArray(message.swipes)?message.swipes.slice():[]})}
function __dshApplyCardMessage(text,index){__dshCardChat[index].message=text;__dshCardChat[index].mes=text;var swipe=__dshCardChat[index].swipes.indexOf(text);if(swipe>=0)__dshCardChat[index].swipe_id=swipe;__dshCardEmit('mag_before_message_update',index);__dshCardEmit('mvu-variable-update-ended',{stat_data:__dshStatData})}
function __dshCardSendMessage(value){var text=String(value??'');if(!text.trim())return Promise.reject(new Error('消息不能为空'));if(!__dshCardCapabilityToken)return Promise.reject(new Error('当前卡片发送能力不可用'));if(navigator.userActivation&&navigator.userActivation.isActive!==true){__dshSetCardCapabilityState('chat-send-user-activation-required');return Promise.reject(new Error('需要点击后才能发送消息'))}var requestId='card-chat-send-'+(++__dshCardRequestSequence);return new Promise(function(resolve,reject){var timer=setTimeout(function(){if(!__dshCardPending.delete(requestId))return;__dshSetCardCapabilityState('chat-send-timeout');reject(new Error('消息发送超时，请重试'))},30000);__dshCardPending.set(requestId,{kind:'chat-send',resolve:resolve,reject:reject,timer:timer});__dshSetCardCapabilityState('chat-send-pending');parent.postMessage({source:'dsh-agent-rp-card',action:'capability-request',capability:'chat.send',token:__dshCardCapabilityToken,requestId:requestId,value:text},'*')})}
addEventListener('message',function(event){var message=event.data;if(event.source!==parent||!message||message.source!=='dsh-agent-rp-host')return;if(message.action==='external-window-message'){if(typeof message.requestId!=='string'||typeof message.origin!=='string')return;if(!__dshCardDeliveredExternalWindowRequests.has(message.requestId)){if(__dshCardDeliveredExternalWindowRequests.size>=64)__dshCardDeliveredExternalWindowRequests.delete(__dshCardDeliveredExternalWindowRequests.values().next().value);__dshCardDeliveredExternalWindowRequests.add(message.requestId);dispatchEvent(new MessageEvent('message',{data:message.value,origin:message.origin}))}parent.postMessage({source:'dsh-agent-rp-card',action:'external-window-delivered',token:__dshCardCapabilityToken,requestId:message.requestId},'*');return}if(message.action==='external-window-closed'){var external=__dshCardExternalWindows.get(message.requestId);if(!external)return;external.closed=true;__dshCardExternalWindows.delete(message.requestId);return}if(message.action==='capability-result'&&message.capability==='ui.external-window.open'){var external=__dshCardExternalWindows.get(message.requestId);if(!external)return;if(message.ok!==true){external.closed=true;__dshCardExternalWindows.delete(message.requestId);__dshSetCardCapabilityState('external-window-error')}else __dshSetCardCapabilityState('external-window-open');return}if(message.action!=='capability-result'&&message.action!=='variables-result')return;var pending=__dshCardPending.get(message.requestId);if(!pending)return;__dshCardPending.delete(message.requestId);clearTimeout(pending.timer);if(pending.kind==='variables'){message.ok===true?pending.resolve():pending.reject(new Error(String(message.error??'变量保存失败')));return}if(pending.kind==='identity'){message.ok===true?pending.resolve(message.value):pending.reject(new Error(String(message.error??'本机身份请求失败')));return}if(pending.kind==='chat-send'){__dshSetCardCapabilityState(message.ok===true?'chat-send-result-ok':'chat-send-result-error');message.ok===true?pending.resolve():pending.reject(new Error(String(message.error??'消息发送失败')));return}__dshSetCardCapabilityState(message.ok===true?'greeting-select-result-ok':'greeting-select-result-error');if(message.ok===true){__dshApplyCardMessage(pending.text,pending.index);pending.resolve()}else pending.reject(new Error(String(message.error??'开场切换失败')))});
window.getChatMessages=function(){__dshSetCardCapabilityState('chat-read');return __dshCardChat.map(__dshCloneCardMessage)};
window.getLastMessageId=function(){return Math.max(-1,__dshCardChat.length-1)};
window.getCurrentMessageId=window.getLastMessageId;
window.sendMessage=__dshCardSendMessage;
window.setChatMessage=function(value,id){var index=Number(id);if(!Number.isSafeInteger(index)||index<0||index>=__dshCardChat.length)index=__dshCardChat.length-1;var text=typeof value==='string'?value:value?.message??value?.mes;if(typeof text!=='string')return Promise.resolve();var greetingIndex=__dshCardGreetingChoices?.alternatives?.indexOf(text)??-1;if(index===0&&greetingIndex>=0&&__dshCardCapabilityToken){if(navigator.userActivation&&navigator.userActivation.isActive!==true){__dshSetCardCapabilityState('greeting-select-user-activation-required');return Promise.reject(new Error('需要点击后才能切换开场'))}return new Promise(function(resolve,reject){var requestId='card-capability-'+(++__dshCardRequestSequence);var timer=setTimeout(function(){if(!__dshCardPending.delete(requestId))return;__dshSetCardCapabilityState('greeting-select-timeout');reject(new Error('开场切换超时，请重试'))},15000);__dshCardPending.set(requestId,{index:index,text:text,resolve:resolve,reject:reject,timer:timer});__dshSetCardCapabilityState('greeting-select-pending');parent.postMessage({source:'dsh-agent-rp-card',action:'capability-request',capability:'greeting.select',token:__dshCardCapabilityToken,requestId:requestId,greetingIndex:greetingIndex},'*')})}__dshSetCardCapabilityState('local-message-update');__dshApplyCardMessage(text,index);return Promise.resolve()};
window.SillyTavern={chat:__dshCardChat,name1:'用户',name2:__dshCurrentCharacter?.name??'角色',characters:__dshCardCharacters,this_chid:0,characterId:0,groups:[],groupId:null,chatMetadata:{},chat_metadata:{},extensionSettings:{EjsTemplate:{enabled:true}},eventSource:{on:window.eventOn,once:window.eventOnce,emit:window.eventEmit},getChatMessages:window.getChatMessages,setChatMessage:window.setChatMessage,sendMessage:window.sendMessage,getContext:function(){return this}};
window.getContext=function(){return window.SillyTavern.getContext()};
window.TavernHelper=window;
window._={
  get:function(object,path,fallback){var parts=Array.isArray(path)?path:String(path).replace(/^\\./,'').split('.').filter(Boolean);var value=object;for(var i=0;i<parts.length;i++){if(value==null)return fallback;value=value[parts[i]]}return value===undefined?fallback:value},
  clamp:function(value,min,max){return Math.min(max,Math.max(min,Number(value)))},
};
(function(){
  function nodes(value){if(value instanceof Mini)return value.items;if(typeof value==='string'&&value.trim().startsWith('<')){var template=document.createElement('template');template.innerHTML=value.trim();return Array.from(template.content.childNodes)}if(typeof value==='string')return Array.from(document.querySelectorAll(value));if(value===window||value===document||value instanceof Element||value instanceof DocumentFragment)return [value];if(value&&typeof value.length==='number')return Array.from(value);return []}
  function Mini(value){this.items=nodes(value)}
  Mini.prototype.each=function(callback){this.items.forEach(function(item,index){callback.call(item,index,item)});return this};
  Mini.prototype.text=function(value){if(value===undefined)return this.items[0]?.textContent??'';return this.each(function(){this.textContent=String(value)})};
  Mini.prototype.html=function(value){if(value===undefined)return this.items[0]?.innerHTML??'';return this.each(function(){this.innerHTML=String(value)})};
  Mini.prototype.empty=function(){return this.html('')};
  Mini.prototype.val=function(value){if(value===undefined)return this.items[0]?.value??'';return this.each(function(){this.value=value})};
  Mini.prototype.attr=function(name,value){if(value===undefined)return this.items[0]?.getAttribute?.(name);return this.each(function(){this.setAttribute?.(name,String(value))})};
  Mini.prototype.addClass=function(value){var names=String(value).split(/\\s+/).filter(Boolean);return this.each(function(){this.classList?.add(...names)})};
  Mini.prototype.removeClass=function(value){var names=String(value).split(/\\s+/).filter(Boolean);return this.each(function(){this.classList?.remove(...names)})};
  Mini.prototype.toggleClass=function(value,force){return this.each(function(){this.classList?.toggle(String(value),force)})};
  Mini.prototype.on=function(type,selector,handler){if(typeof selector==='function'){handler=selector;selector=undefined}return this.each(function(){this.addEventListener(type,function(event){if(selector===undefined){handler.call(this,event);return}var target=event.target?.closest?.(selector);if(target&&this.contains(target))handler.call(target,event)})})};
  window.$=function(value){if(typeof value==='function'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',value,{once:true});else queueMicrotask(value);return new Mini([])}return new Mini(value)};
})();
`
}

function resourceViolationRuntime(): string {
  return `
var __dshBlockedCardResources=new Set();
window.__dshCardRuntimeMonitor=function(value){
  if(__dshCardCapabilityToken)parent.postMessage({source:'dsh-agent-rp-card',action:'runtime-monitor',token:__dshCardCapabilityToken,value:value},'*');
};
window.__dshCardReportContent=function(){
  var body=document.body;
  var present=!!body&&((body.innerText||'').trim()!==''||body.querySelector('img,svg,canvas,video,iframe')!==null);
  window.__dshCardRuntimeMonitor(present?'content-present':'content-empty');
};
window.__dshInstallCardRuntimeMonitor=function(){
  addEventListener('error',function(event){if(event&&('error' in event||typeof event.message==='string'))window.__dshCardRuntimeMonitor('runtime-error')});
  addEventListener('unhandledrejection',function(){window.__dshCardRuntimeMonitor('runtime-rejection')});
  addEventListener('DOMContentLoaded',function(){window.__dshCardRuntimeMonitor('dom-ready');setTimeout(window.__dshCardReportContent,250);setTimeout(window.__dshCardReportContent,2000)},{once:true});
  addEventListener('load',function(){window.__dshCardRuntimeMonitor('load-complete')},{once:true});
};
window.__dshInstallCardRuntimeMonitor();
window.__dshCardRuntimeMonitor('bootstrap-installed');
window.__dshCardResourceMonitor=function(value){
  if(__dshCardCapabilityToken)parent.postMessage({source:'dsh-agent-rp-card',action:'resource-monitor',token:__dshCardCapabilityToken,value:value},'*');
};
window.__dshCardResourceViolation=function(event){
    if(!__dshCardCapabilityToken||__dshBlockedCardResources.size>=32)return;
    var directive=String(event.effectiveDirective||event.violatedDirective||'');
    var type=directive.startsWith('script-src')?'script':directive.startsWith('style-src')?'style':directive==='font-src'?'font':directive==='frame-src'?'frame':directive==='img-src'?'image':directive==='media-src'?'media':directive==='connect-src'?'connect':undefined;
    if(type===undefined)return;
    try{
      var url=new URL(String(event.blockedURI));
      if(url.protocol!=='https:'||url.username!==''||url.password!=='')return;
      var key=type+'\\u0000'+url.origin;
      if(__dshBlockedCardResources.has(key))return;
      __dshBlockedCardResources.add(key);
      document.documentElement.dataset.agentRpBlockedResources=String(__dshBlockedCardResources.size);
      parent.postMessage({source:'dsh-agent-rp-card',action:'resource-blocked',token:__dshCardCapabilityToken,origin:url.origin,type:type},'*');
    }catch{}
};
window.__dshInstallCardResourceListener=function(){
  addEventListener('securitypolicyviolation',window.__dshCardResourceViolation);
  document.addEventListener('securitypolicyviolation',window.__dshCardResourceViolation);
};
window.__dshInstallCardResourceListener();
window.__dshCardResourceMonitor('listener-installed');
(function(){
  var nativeOpen=Document.prototype.open;
  var nativeWrite=Document.prototype.write;
  var needsBootstrap=false;
  var bootstrap='<script>window.__dshInstallCardResourceListener&&window.__dshInstallCardResourceListener();window.__dshInstallCardRuntimeMonitor&&window.__dshInstallCardRuntimeMonitor();window.__dshCardResourceMonitor&&window.__dshCardResourceMonitor("listener-restored");window.__dshCardRuntimeMonitor&&window.__dshCardRuntimeMonitor("document-restored")<\\/script>';
  Document.prototype.open=function(){var result=nativeOpen.apply(this,arguments);needsBootstrap=true;window.__dshCardResourceMonitor('document-open');window.__dshCardRuntimeMonitor('document-open');return result};
  Document.prototype.write=function(){
    var values=Array.prototype.map.call(arguments,String);
    if(needsBootstrap){
      needsBootstrap=false;
      var html=values.join('');
      html=/<head(?:\\s[^>]*)?>/i.test(html)?html.replace(/<head(?:\\s[^>]*)?>/i,function(value){return value+bootstrap}):bootstrap+html;
      window.__dshCardResourceMonitor('bootstrap-injected');
      return nativeWrite.call(this,html);
    }
    return nativeWrite.apply(this,values);
  };
})();
`
}

const sandboxFacadeNames = [
  'SillyTavern', 'Mvu', 'getAllVariables', 'waitGlobalInitialized', 'eventOn', 'eventOnce', 'eventEmit',
  'errorCatched', 'toastr', 'getChatMessages', 'getLastMessageId', 'getCurrentMessageId', 'setChatMessage',
  'getContext', 'TavernHelper', '_', '$',
] as const

function redirectKnownHostFacades(source: string): string {
  const localHostAliases = source
    .replace(
      /(?:window\s*\.\s*)?(?:parent|top)\s*(?:\|\||\?\?)\s*window\b/gu,
      'window',
    )
    // The live card renderer supplies a bounded parent document. Preserve
    // direct parent.document access for legacy input bridges while keeping
    // top.document away from the real DSH document.
    .replace(
      /(?:window\s*\.\s*)?top\s*(?:\?\.\s*|\.\s*)document(?![\w$])/gu,
      'parent.document',
    )
    .replace(
      /(?:window\s*\.\s*)?(?:parent|top)\s*(?:\?\.\s*)?(\[[^\]\r\n]+\])/gu,
      'window$1',
    )
  return sandboxFacadeNames.reduce((value, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    return value.replace(new RegExp(
      `(?:window\\s*\\.\\s*)?(?:parent|top)\\s*(?:\\?\\.)?\\.?\\s*${escaped}(?![\\w$])`,
      'gu',
    ), `window.${name}`)
  }, localHostAliases)
}

function cardFrameSource(source: string, options: CardFrameCompileOptions): string {
  const assets = (options.character?.imageAssets ?? []).map(asset => ({
    ...asset,
    url: new URL(characterLibraryImageUrl(options.character!.id, asset.index), options.origin).href,
  }))
  const legacy = normalizeLegacyCardHtml(source)
  const adapted = redirectKnownHostFacades(
    assets.reduce((html, asset) => asset.sourceUri === '' ? html : html.replaceAll(asset.sourceUri, asset.url), legacy.source),
  )
  const assetJson = JSON.stringify(assets).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const approvedResources = options.character?.approvedRemoteResources
  const approvedOrigin = (type: CharacterRemoteResourceType): readonly string[] =>
    options.character?.remoteResourcePolicy === 'isolated-https'
      ? ['https:']
      : approvedResources === undefined
        ? options.character?.approvedRemoteResourceOrigins ?? []
        : approvedResources.filter(resource => resource.type === type).map(resource => resource.origin)
  const allowedImageOrigins = [...new Set([
    options.origin,
    ...approvedOrigin('image'),
    ...(options.character?.displayExtensions?.filter(extension => extension.enabled)
      .flatMap(extension => extension.remoteImageOrigins) ?? []),
  ])].map(origin => origin.replace(/["'<>\s]/gu, '')).filter(Boolean).join(' ')
  const policy = (type: CharacterRemoteResourceType): string => {
    const origins = approvedOrigin(type).map(origin => origin.replace(/["'<>\s]/gu, '')).filter(Boolean).join(' ')
    return origins === '' ? "'none'" : origins
  }
  const styleOrigins = policy('style') === "'none'" ? '' : ` ${policy('style')}`
  const scriptOrigins = policy('script') === "'none'" ? '' : ` ${policy('script')}`
  const unsafeEval = options.character?.remoteResourcePolicy === 'isolated-https' ? " 'unsafe-eval'" : ''
  const statData = options.statData === undefined || options.identity === undefined
    ? options.statData
    : projectSillyTavernIdentityMacros(options.statData, options.identity)
  const head = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: ${allowedImageOrigins}; media-src ${policy('media')}; style-src 'unsafe-inline'${styleOrigins}; script-src 'unsafe-inline'${unsafeEval}${scriptOrigins}; connect-src ${policy('connect')}; font-src ${policy('font')}; frame-src ${policy('frame')};"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">${cardFrameCompatibility}<script>${cardFrameAppearanceRuntime(options.appearance)}${isolatedCardStorageRuntime()}${mvuFrameRuntime(statData, options.compatibilityMarkers, options.greetingChoices, options.currentCharacter, options.variableScopes, options.capabilityToken)}${resourceViolationRuntime()}window.dshCharacterAssets=Object.freeze(${assetJson}.map(Object.freeze));window.getCharacterAsset=function(type,name){var target=window.dshCharacterAssets.find(function(asset){return asset.type===String(type).toLowerCase()&&(name===undefined||asset.name===String(name))});return target?.url};window.triggerSlash=function(value){parent.postMessage({source:'dsh-agent-rp-card',action:'trigger-slash',token:__dshCardCapabilityToken,value:String(value)},'*')};var __dshLastSize=-1,__dshSizeFrame=0;function __dshReportSize(force){__dshSizeFrame=0;var root=document.documentElement;var body=document.body;var value=Math.max(root?root.scrollHeight:0,body?body.scrollHeight:0);if(!force&&value===__dshLastSize)return;__dshLastSize=value;parent.postMessage({source:'dsh-agent-rp-card',action:'resize',token:__dshCardCapabilityToken,value:value},'*')}function __dshScheduleSize(force){if(__dshSizeFrame)return;__dshSizeFrame=requestAnimationFrame(function(){__dshReportSize(force===true)})}addEventListener('message',function(event){var message=event.data;if(message&&message.source==='dsh-agent-rp-host'&&message.action==='request-resize')__dshScheduleSize(true)});addEventListener('load',function(){__dshScheduleSize(true)});addEventListener('DOMContentLoaded',function(){var input=document.getElementById('send_textarea');if(!input){input=document.createElement('textarea');input.id='send_textarea';input.hidden=true;document.body.appendChild(input)}input.addEventListener('input',function(){parent.postMessage({source:'dsh-agent-rp-card',action:'draft',token:__dshCardCapabilityToken,value:input.value},'*')});var send=document.getElementById('send_but');if(!send){send=document.createElement('button');send.id='send_but';send.type='button';send.hidden=true;document.body.appendChild(send)}send.addEventListener('click',function(){void __dshCardSendMessage(input.value).then(function(){input.value='';parent.postMessage({source:'dsh-agent-rp-card',action:'draft',token:__dshCardCapabilityToken,value:''},'*')}).catch(console.error)});__dshScheduleSize(true);if(window.ResizeObserver){var resizeObserver=new ResizeObserver(function(){__dshScheduleSize(false)});resizeObserver.observe(document.documentElement);resizeObserver.observe(document.body)}if(window.MutationObserver)new MutationObserver(function(){__dshScheduleSize(false)}).observe(document.body,{attributes:true,childList:true,subtree:true});setTimeout(function(){__dshScheduleSize(true)},250);setTimeout(function(){__dshScheduleSize(true)},2000)});</script>`
  if (/<head(?:\s|>)/iu.test(adapted)) {
    return adapted.replace(/<head([^>]*)>/iu, (_matched, attributes: string) => `<head${attributes}>${head}`)
  }
  if (/<html(?:\s|>)/iu.test(adapted)) {
    return adapted.replace(/<html([^>]*)>/iu, (_matched, attributes: string) => `<html${attributes}><head>${head}</head>`)
  }
  return `<!doctype html><html><head>${head}</head><body>${adapted}</body></html>`
}

/** Wrap one already-isolated frontend document with the shared sandbox runtime. */
export function compileCardFrameDocument(source: string, options: CardFrameCompileOptions): string {
  return cardFrameSource(source, options)
}

function cardFrameCompatibilityShell(source: string, capabilityToken: string | undefined): string {
  const cardSource = JSON.stringify(source)
    .replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const token = JSON.stringify(capabilityToken ?? null)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#chat{background:transparent;border:0;margin:0;min-width:0;padding:0;width:100%}body{overflow:hidden}#agent-rp-card-content{background:transparent;border:0;color-scheme:dark;display:block;height:72px;width:100%}#send_textarea,#send_but{display:none!important}</style></head><body><main id="chat"><iframe id="agent-rp-card-content" title="角色卡界面"></iframe></main><textarea id="send_textarea" aria-hidden="true"></textarea><button id="send_but" type="button" aria-hidden="true"></button><script>(()=>{'use strict';const token=${token};const source=${cardSource};const card=document.getElementById('agent-rp-card-content');const input=document.getElementById('send_textarea');const send=document.getElementById('send_but');let lastHeight=-1;let sendSequence=800000000;let pendingSend;const postHost=message=>parent.postMessage(message,'*');const reportHeight=value=>{const measured=Math.max(72,Math.ceil(Number(value)||0),document.documentElement.scrollHeight,document.body.scrollHeight);if(measured===lastHeight)return;lastHeight=measured;postHost({source:'dsh-agent-rp-card',action:'resize',token,value:measured})};const measureCard=()=>{try{const root=card.contentDocument?.documentElement;const body=card.contentDocument?.body;const height=Math.max(root?.scrollHeight??0,body?.scrollHeight??0);if(height>0)card.style.height=Math.max(72,Math.ceil(height))+'px'}catch{}reportHeight(card.getBoundingClientRect().height)};const installCardObservers=()=>{measureCard();try{const document=card.contentDocument;if(!document)return;if(window.ResizeObserver){const observer=new ResizeObserver(measureCard);if(document.documentElement)observer.observe(document.documentElement);if(document.body)observer.observe(document.body)}if(window.MutationObserver&&document.body)new MutationObserver(measureCard).observe(document.body,{attributes:true,childList:true,subtree:true})}catch{}};input.addEventListener('input',()=>{if(token!==null)postHost({source:'dsh-agent-rp-card',action:'draft',token,value:input.value})});send.addEventListener('click',()=>{const value=String(input.value??'');if(token===null||pendingSend!==undefined||!value.trim())return;if(navigator.userActivation&&navigator.userActivation.isActive!==true){document.documentElement.dataset.agentRpCapabilityState='chat-send-user-activation-required';return}sendSequence=sendSequence>=999999998?800000001:sendSequence+1;pendingSend='card-chat-send-'+sendSequence;document.documentElement.dataset.agentRpCapabilityState='chat-send-pending';postHost({source:'dsh-agent-rp-card',action:'capability-request',capability:'chat.send',token,requestId:pendingSend,value})});addEventListener('message',event=>{const message=event.data;if(event.source===card.contentWindow){if(!message||typeof message!=='object'||message.source!=='dsh-agent-rp-card')return;if(message.action==='resize'&&typeof message.value==='number'&&Number.isFinite(message.value)){card.style.height=Math.max(72,Math.ceil(message.value))+'px';reportHeight(message.value);return}postHost(message);return}if(event.source!==parent||!message||typeof message!=='object'||message.source!=='dsh-agent-rp-host')return;if(message.action==='capability-result'&&message.capability==='chat.send'&&message.requestId===pendingSend){pendingSend=undefined;document.documentElement.dataset.agentRpCapabilityState=message.ok===true?'chat-send-result-ok':'chat-send-result-error';if(message.ok===true){input.value='';if(token!==null)postHost({source:'dsh-agent-rp-card',action:'draft',token,value:''})}}card.contentWindow?.postMessage(message,'*')});card.addEventListener('load',installCardObservers);if(window.ResizeObserver)new ResizeObserver(measureCard).observe(document.getElementById('chat'));if(window.MutationObserver)new MutationObserver(measureCard).observe(document.getElementById('chat'),{attributes:true,childList:true,subtree:true});card.srcdoc=source;setTimeout(measureCard,250);setTimeout(measureCard,2000)})();</script></body></html>`
}

/**
 * Place a card document behind a cross-origin data: shell. The shell remains
 * isolated from DSH while its nested srcdoc can use a bounded parent.document
 * surface for legacy Tavern input controls.
 */
export function cardFrameCompatibilityUrl(source: string, capabilityToken?: string): string {
  const bytes = new TextEncoder().encode(cardFrameCompatibilityShell(source, capabilityToken))
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:text/html;charset=utf-8;base64,${btoa(binary)}`
}

function inlineCardFrameSource(source: string, options: CardFrameCompileOptions): {
  readonly srcDoc: string
  readonly diagnostics: readonly CardDisplayDiagnostic[]
  readonly remoteResources: readonly CharacterRemoteResourceApproval[]
} {
  const legacy = normalizeLegacyCardHtml(source)
  const sanitized = sanitizeInlineCardHtml(legacy.source)
  return {
    srcDoc: cardFrameSource(sanitized, options), diagnostics: legacy.diagnostics,
    remoteResources: cardRemoteResourceRequirements(sanitized),
  }
}

function sanitizeInlineCardHtml(source: string): string {
  const markdown = marked.parse(source, { async: false, breaks: true, gfm: true }) as string
  const customElementTags = cardDisplayCustomElementTags(source)
  return DOMPurify.sanitize(markdown, {
    ADD_TAGS: ['style', ...customElementTags],
    FORBID_ATTR: ['srcdoc'],
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object', 'script'],
    USE_PROFILES: { html: true },
    WHOLE_DOCUMENT: true,
  })
}

let inlineCardSanitizerProbe: 'ready' | 'failed' | undefined

/** Verify the browser sanitizer preserves inert custom wrappers without preserving active content. */
export function inlineCardSanitizerProbeState(): 'ready' | 'failed' {
  if (inlineCardSanitizerProbe !== undefined) return inlineCardSanitizerProbe
  const tag = 'agent-rp-sanitizer-probe'
  const visible = 'agent-rp-visible-probe'
  const active = 'agent-rp-active-probe'
  const sanitized = sanitizeInlineCardHtml(
    `<style>${tag}{display:block}</style><${tag} onclick="${active}">${visible}</${tag}>`
      + `<script>${active}</script><iframe srcdoc="${active}"></iframe>`,
  )
  inlineCardSanitizerProbe = new RegExp(`<${tag}(?:\\s|>)`, 'u').test(sanitized)
    && sanitized.includes(visible)
    && !sanitized.includes(active)
    && !/<(?:script|iframe)\b/iu.test(sanitized)
      ? 'ready'
      : 'failed'
  return inlineCardSanitizerProbe
}

/** Compile deterministic display segments into browser-ready Markdown and iframe documents. */
export function compileCardFrames(
  compilation: CompiledCharacterDisplay,
  options: CardFrameCompileOptions,
): CompiledCardFrames {
  const diagnostics = [...compilation.diagnostics]
  const segments = compilation.segments.map((segment, index) => {
    if (segment.kind === 'markdown') return segment
    const frameOptions = options.capabilityToken === undefined
      ? options : { ...options, capabilityToken: `${options.capabilityToken}:${index}` }
    if (segment.kind === 'html') {
      const { appearance: _appearance, ...documentOptions } = frameOptions
      return {
        kind: 'frame' as const,
        sourceKind: segment.kind,
        srcDoc: cardFrameSource(segment.source, documentOptions),
        interactive: /<script\b|\bfetch\s*\(|\bon[a-z]+\s*=/iu.test(segment.source),
        remoteOrigins: remoteOrigins(segment.source),
        remoteResources: cardRemoteResourceRequirements(segment.source),
      }
    }
    const compiled = inlineCardFrameSource(segment.source, frameOptions)
    diagnostics.push(...compiled.diagnostics)
    return {
      kind: 'frame' as const,
      sourceKind: segment.kind,
      srcDoc: compiled.srcDoc,
      interactive: false,
      remoteOrigins: remoteOrigins(segment.source),
      remoteResources: compiled.remoteResources,
    }
  })
  return { segments, diagnostics }
}

/** Serialize diagnostics for DOM inspection without retaining card text. */
export function cardFrameDiagnosticSummary(diagnostics: readonly CardDisplayDiagnostic[]): string | undefined {
  if (diagnostics.length === 0) return undefined
  return diagnostics.map(value => `${value.code}:${value.count}`).join(',')
}
