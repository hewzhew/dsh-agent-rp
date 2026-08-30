/** Host-owned external-window protocol and broker shared by isolated frontend runtimes. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  AGENT_RP_CAPABILITIES,
  type AgentRpExtensionRuntime,
} from '../extension-capability.ts'
import { isJsonValue } from './json-value.ts'

/** Validated legacy `window.open` arguments. */
export interface ExternalWindowRequestPayload {
  readonly url: string
  readonly target: string
  readonly features: string
}

/** Live external-window broker owned by the Host component. */
export interface ExternalWindowBroker {
  /** Confirm that the requesting isolated runtime dispatched the callback locally. */
  acknowledgeDelivery(): void
  /** Close the external child and remove its isolated relay. */
  close(): void
  /** Focus the external child when it exists, otherwise focus the relay prompt. */
  focus(): void
}

/** Minimum fields required to queue one user-approved external-window request. */
export interface ExternalWindowQueueRequest {
  readonly key: string
  readonly target: Window
  readonly requestId: string
}

/** Queue one unique request or return a bounded capability error to its runtime. */
export function enqueueExternalWindowRequest<T extends ExternalWindowQueueRequest>(
  current: ReadonlyMap<string, T>,
  brokers: ReadonlyMap<string, ExternalWindowBroker>,
  request: T,
): ReadonlyMap<string, T> {
  const reject = (error: string): ReadonlyMap<string, T> => {
    request.target.postMessage({
      source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'ui.external-window.open',
      requestId: request.requestId, ok: false, error,
    }, '*')
    return current
  }
  if (current.has(request.key) || brokers.has(request.key)) return reject('外部窗口请求标识重复')
  if (current.size >= 8) return reject('等待确认的外部窗口过多')
  return new Map(current).set(request.key, request)
}

/** Content-free lifecycle phases for one Host-owned external-window request. */
export type ExternalWindowPhase =
  | 'awaiting-user'
  | 'external-opened'
  | 'external-open-unconfirmed'
  | 'callback-rejected'
  | 'callback-validated'
  | 'callback-delivered'
  | 'callback-delivery-unconfirmed'
  | 'external-closed-without-callback'
  | 'broker-closed'

/** Content-free state emitted while one external-window broker is alive. */
export interface ExternalWindowState {
  readonly phase: ExternalWindowPhase
  readonly attempts: number
}

/** Validate one HTTPS `window.open` payload without accepting credentials in the URL. */
export function parseExternalWindowRequestPayload(value: unknown): ExternalWindowRequestPayload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const payload = value as Record<string, unknown>
  const fields = new Set(['url', 'target', 'features'])
  if (Object.keys(payload).some(key => !fields.has(key))
    || typeof payload.url !== 'string' || payload.url.length === 0 || payload.url.length > 4_096
    || typeof payload.target !== 'string' || payload.target.length > 200
    || typeof payload.features !== 'string' || payload.features.length > 2_000) return undefined
  let url: URL
  try {
    url = new URL(payload.url)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
  return { url: url.href, target: payload.target, features: payload.features }
}

/** Verify one callback message before relaying it into its requesting isolated runtime. */
export function validExternalWindowMessage(
  runtime: Extract<AgentRpExtensionRuntime, 'card-frame-v0' | 'tavern-script-frame-v0'>,
  origin: unknown,
  value: unknown,
): value is JsonValue {
  if (typeof origin !== 'string' || origin.length === 0 || origin.length > 2_048 || !isJsonValue(value)) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) return false
  try {
    const policy = AGENT_RP_CAPABILITIES['ui.external-window.open'].runtimePolicies[runtime]
    if (policy === undefined || policy.resultBytes === null) return false
    return new TextEncoder().encode(JSON.stringify({
      source: 'dsh-agent-rp-host', action: 'external-window-message', requestId: 'x'.repeat(128), origin, value,
    })).byteLength <= policy.resultBytes
  } catch {
    return false
  }
}

const EXTERNAL_WINDOW_PHASES: readonly ExternalWindowPhase[] = [
  'awaiting-user',
  'external-opened',
  'external-open-unconfirmed',
  'callback-rejected',
  'callback-validated',
  'callback-delivered',
  'callback-delivery-unconfirmed',
  'external-closed-without-callback',
  'broker-closed',
]

function inlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

/** Compile the static opaque relay that owns one external popup without receiving Host access. */
export function compileExternalWindowRelayDocument(input: {
  readonly token: string
  readonly url: string
  readonly hostname: string
  readonly requesterName: string
  readonly resultBytes: number
}): string {
  const config = inlineScriptJson({
    token: input.token,
    url: input.url,
    hostname: input.hostname,
    requesterName: input.requesterName || '角色卡界面',
    resultBytes: input.resultBytes,
    childName: `agent-rp-external-child-${input.token}`,
  })
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{align-items:center;background:#121318;color:#f2f3f5;display:flex;font-family:system-ui,sans-serif;justify-content:center;padding:18px}main{background:#1d1f25;border:1px solid #3d4049;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.4);display:grid;gap:13px;max-width:440px;padding:22px;width:100%}h1{font-size:18px;margin:0}p{font-size:13px;line-height:1.65;margin:0;opacity:.76}#status{font-size:12px;min-height:18px;opacity:.64}.actions{display:flex;gap:8px}.primary,.secondary{border-radius:9px;color:inherit;cursor:pointer;font:inherit;font-size:14px;padding:10px 14px;text-align:center;text-decoration:none}.primary{background:#3568d4;border:0;color:#fff;flex:1}.secondary{background:transparent;border:1px solid #454852}.secondary:only-child{flex:1}.success{border-color:#3d7654} [hidden]{display:none!important}</style></head><body><main><h1 id="title">继续外部登录</h1><p id="description"></p><p id="status">确认目标站点后继续；登录页将是唯一的新窗口。</p><div class="actions"><button class="secondary" id="cancel" type="button">取消</button><a class="primary" id="open" rel="opener">前往登录</a></div></main><script>(()=>{'use strict';const config=${config};const main=document.querySelector('main');const title=document.getElementById('title');const description=document.getElementById('description');const status=document.getElementById('status');const link=document.getElementById('open');const cancel=document.getElementById('cancel');description.textContent=config.requesterName+' 请求打开 '+config.hostname+'。外部页面只能联系此隔离中继，无法访问 DSH。';link.href=config.url;link.target=config.childName;link.textContent='前往 '+config.hostname;let child=null;let callbackSource=null;let callbackReceived=false;let childExpected=false;let attempts=0;const post=(action,extra={})=>parent.postMessage({source:'dsh-agent-rp-external-relay',token:config.token,action,...extra},'*');const phase=value=>post('state',{phase:value,attempts});const finish=(message)=>{title.textContent='登录结果已返回';status.textContent=message;link.hidden=true;cancel.textContent='关闭';main.classList.add('success')};link.addEventListener('click',event=>{if(child!==null&&!child.closed){event.preventDefault();child.focus();return}callbackSource=null;callbackReceived=false;child=null;childExpected=true;attempts+=1;let opened=null;try{opened=window.open(config.url,config.childName,'popup,width=600,height=800,scrollbars=yes,resizable=yes')}catch{}if(opened===null){phase('external-open-unconfirmed');status.textContent='浏览器没有返回登录窗口句柄；若没有出现新窗口，请允许弹窗后重试。'}else{event.preventDefault();child=opened;phase('external-opened');status.textContent='登录页已打开。外部站点首次显示可能较慢，此面板会继续等待安全回执。'}link.textContent='重试前往 '+config.hostname});cancel.addEventListener('click',()=>post('close-request'));addEventListener('message',event=>{const message=event.data;if(event.source===parent&&message&&message.source==='dsh-agent-rp-host'&&message.token===config.token){if(message.action==='focus'){if(child!==null&&!child.closed)child.focus();else focus()}else if(message.action==='close'){try{child?.close()}finally{post('closed')}}else if(message.action==='callback-validated'){finish('登录结果已通过安全检查，正在交给角色卡运行时。')}else if(message.action==='callback-delivered'){finish('角色卡运行时已收到登录结果。现在可以关闭此面板。')}else if(message.action==='callback-delivery-unconfirmed'){finish('登录结果已通过安全检查，但角色卡运行时没有确认接收。请关闭面板后重试卡片功能。')}else if(message.action==='callback-rejected'){status.textContent='收到的登录回执未通过安全校验，已拒绝。'}return}if(!childExpected||callbackReceived||event.source===null||event.source===parent)return;if(callbackSource!==null&&event.source!==callbackSource)return;let encoded;try{encoded=new TextEncoder().encode(JSON.stringify({origin:event.origin,value:event.data}))}catch{return}if(encoded.byteLength>config.resultBytes)return;callbackReceived=true;callbackSource=event.source;child=event.source;post('callback',{origin:event.origin,value:event.data})});setInterval(()=>{if(child===null||!child.closed)return;child=null;if(callbackSource!==null)return;phase('external-closed-without-callback');status.textContent='登录窗口已关闭，但没有收到登录结果。可以重试。';link.textContent='重试前往 '+config.hostname},250);phase('awaiting-user')})();</script></body></html>`
}

/** Mount an opaque Host relay whose single popup cannot obtain the DSH window as its opener. */
export function openExternalWindowBroker(input: {
  readonly hostWindow: Window
  readonly url: string
  readonly hostname: string
  readonly requesterName: string
  readonly runtime: Extract<AgentRpExtensionRuntime, 'card-frame-v0' | 'tavern-script-frame-v0'>
  readonly requestId: string
  readonly resolveTarget: () => Window | null | undefined
  readonly onClosed: () => void
  readonly onStateChange?: (state: ExternalWindowState) => void
}): ExternalWindowBroker | undefined {
  const token = input.hostWindow.crypto.randomUUID()
  const policy = AGENT_RP_CAPABILITIES['ui.external-window.open'].runtimePolicies[input.runtime]
  if (policy.resultBytes === null) return undefined
  const document = input.hostWindow.document
  const overlay = document.createElement('div')
  const frame = document.createElement('iframe')
  overlay.dataset.agentRpExternalWindowRelay = ''
  Object.assign(overlay.style, {
    alignItems: 'center',
    background: 'rgba(0,0,0,.72)',
    display: 'flex',
    inset: '0',
    justifyContent: 'center',
    padding: '18px',
    position: 'fixed',
    zIndex: '1280',
  })
  frame.title = `打开 ${input.hostname}`
  frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.srcdoc = compileExternalWindowRelayDocument({
    token,
    url: input.url,
    hostname: input.hostname,
    requesterName: input.requesterName,
    resultBytes: policy.resultBytes,
  })
  Object.assign(frame.style, {
    background: '#121318',
    border: '1px solid #3d4049',
    borderRadius: '16px',
    boxShadow: '0 24px 80px rgba(0,0,0,.55)',
    height: '330px',
    maxHeight: '84vh',
    maxWidth: '520px',
    width: 'min(94vw, 520px)',
  })
  overlay.append(frame)
  let settled = false
  let attempts = 0
  let callbackValidated = false
  let callbackDelivered = false
  let deliveryPolls = 0
  let deliveryTimer: number | undefined
  let latestPhase: ExternalWindowPhase | undefined
  const publish = (next: ExternalWindowPhase): void => {
    latestPhase = next
    input.onStateChange?.({ phase: next, attempts })
  }
  const settle = (): void => {
    if (settled) return
    settled = true
    if (deliveryTimer !== undefined) input.hostWindow.clearTimeout(deliveryTimer)
    input.hostWindow.removeEventListener('message', receive)
    overlay.remove()
    if (latestPhase === undefined || latestPhase === 'awaiting-user' || latestPhase === 'external-opened') {
      publish('broker-closed')
    }
    input.onClosed()
  }
  const close = (): void => {
    frame.contentWindow?.postMessage({
      source: 'dsh-agent-rp-host', token, action: 'close',
    }, '*')
    settle()
  }
  const receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== frame.contentWindow || typeof event.data !== 'object'
      || event.data === null || Array.isArray(event.data)) return
    const message = event.data as Record<string, unknown>
    if (message.source !== 'dsh-agent-rp-external-relay' || message.token !== token
      || typeof message.action !== 'string') return
    if (message.action === 'state') {
      if (typeof message.phase !== 'string' || !EXTERNAL_WINDOW_PHASES.includes(message.phase as ExternalWindowPhase)
        || typeof message.attempts !== 'number' || !Number.isSafeInteger(message.attempts)
        || message.attempts < 0 || message.attempts > 1_000) return
      attempts = message.attempts
      publish(message.phase as ExternalWindowPhase)
      return
    }
    if (message.action === 'close-request') {
      close()
      return
    }
    if (message.action === 'closed') {
      settle()
      return
    }
    if (message.action !== 'callback' || typeof message.origin !== 'string') return
    if (callbackValidated) return
    const accepted = validExternalWindowMessage(input.runtime, message.origin, message.value)
    const phase: ExternalWindowPhase = accepted ? 'callback-validated' : 'callback-rejected'
    publish(phase)
    frame.contentWindow?.postMessage({
      source: 'dsh-agent-rp-host', token, action: accepted ? 'callback-validated' : 'callback-rejected',
    }, '*')
    if (!accepted) return
    callbackValidated = true
    const dispatch = (): void => {
      if (settled || callbackDelivered) return
      const target = input.resolveTarget()
      if (target !== null && target !== undefined) {
        target.postMessage({
          source: 'dsh-agent-rp-host', action: 'external-window-message', requestId: input.requestId,
          origin: message.origin, value: message.value,
        }, '*')
      }
      if (callbackDelivered) return
      deliveryPolls += 1
      if (deliveryPolls >= 50) {
        deliveryTimer = undefined
        publish('callback-delivery-unconfirmed')
        frame.contentWindow?.postMessage({
          source: 'dsh-agent-rp-host', token, action: 'callback-delivery-unconfirmed',
        }, '*')
        return
      }
      deliveryTimer = input.hostWindow.setTimeout(dispatch, 100)
    }
    dispatch()
  }
  input.hostWindow.addEventListener('message', receive)
  overlay.addEventListener('mousedown', event => {
    if (event.target === overlay) close()
  })
  document.body.append(overlay)
  return {
    acknowledgeDelivery: () => {
      if (settled || !callbackValidated || callbackDelivered) return
      callbackDelivered = true
      if (deliveryTimer !== undefined) {
        input.hostWindow.clearTimeout(deliveryTimer)
        deliveryTimer = undefined
      }
      publish('callback-delivered')
      frame.contentWindow?.postMessage({
        source: 'dsh-agent-rp-host', token, action: 'callback-delivered',
      }, '*')
    },
    close,
    focus: () => {
      frame.contentWindow?.postMessage({
        source: 'dsh-agent-rp-host', token, action: 'focus',
      }, '*')
      frame.focus()
    },
  }
}
