import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cardDisplayCustomElementTags,
  compileCharacterDisplay,
  normalizeLegacyCardHtml,
} from '../src/card-display-compiler.ts'
import {
  blockedCardFrameResources, compileCardFrameDocument, compileCardFrames,
} from '../src/client/card-frame.ts'
import {
  parseCardCapabilityRequest, parseCardExternalWindowCapabilityRequest,
  parseCardExternalWindowControlRequest, parseCardExternalWindowDeliveryReport,
  parseCardNativeIdentityCapabilityRequest,
  parseCardResourceBlockedReport, parseCardRuntimeReport,
  parseCardVariableReplaceRequest,
} from '../src/client/card-capability.ts'
import { cardRemoteResourceRequirements } from '../src/card-remote-resource.ts'
import { AGENT_RP_CAPABILITIES } from '../src/extension-capability.ts'
import { validExternalWindowMessage } from '../src/client/external-window.ts'

test('removes model-defined wrappers and reports only safe tag metadata', () => {
  const source = '<scene>private sample prose</scene>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'markdown', text: 'private sample prose' }])
  assert.deepEqual(compiled.diagnostics, [{
    code: 'unknown-wrapper-removed',
    count: 2,
    tags: ['scene'],
  }])
  assert.doesNotMatch(JSON.stringify(compiled.diagnostics), /private sample prose/u)
})

test('splits a leading block HTML wrapper from following prose', () => {
  const source = '<div class="scene">meta</div>\n\n正文'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [
    { kind: 'inline-html', source: '<div class="scene">meta</div>' },
    { kind: 'markdown', text: '\n\n正文' },
  ])
  assert.deepEqual(compiled.diagnostics, [{ code: 'inline-html', count: 1 }])
})

test('preserves legacy center markup until the compatibility stage normalizes it', () => {
  const source = '<center class="portrait">name<br><img src="portrait.png"></center>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'inline-html', source }])
  assert.deepEqual(normalizeLegacyCardHtml(source), {
    source: '<div data-agent-rp-center class="portrait">name<br><img src="portrait.png"></div>',
    diagnostics: [{ code: 'legacy-center-normalized', count: 1 }],
  })
})

test('normalizes only high-confidence legacy symbol bars into responsive decorations', () => {
  const source = [
    '<style>.title::before{content:\'▄▄▄▄▄▄▄▄\';color:pink}.short::after{content:\'▀▀▀\'}</style>',
    '<div class="footer">▀▀▀▀▀▀▀▀</div>',
    '<div class="mixed">■■□□</div>',
    '<pre>────────</pre>',
    '<script>const css="content:\'▄▄▄▄\';";const sample="<div>▀▀▀▀</div>"</script>',
  ].join('')

  const normalized = normalizeLegacyCardHtml(source)

  assert.match(normalized.source, /\.title::before\{content:"";display:block;flex:1 1 2em;/u)
  assert.match(normalized.source, /<div class="footer" data-agent-rp-legacy-symbol-bar aria-hidden="true"><\/div>/u)
  assert.match(normalized.source, /content:'▀▀▀'/u)
  assert.match(normalized.source, /<div class="mixed">■■□□<\/div>/u)
  assert.match(normalized.source, /<pre>────────<\/pre>/u)
  assert.match(normalized.source, /const css="content:'▄▄▄▄';";const sample="<div>▀▀▀▀<\/div>"/u)
  assert.deepEqual(normalized.diagnostics, [{ code: 'legacy-symbol-bar-normalized', count: 2 }])

  const frame = compileCardFrameDocument(source, { origin: 'http://127.0.0.1:3091' })
  assert.match(frame, /\[data-agent-rp-legacy-symbol-bar\]\{display:block!important;width:100%!important;/u)
  assert.match(frame, /data-agent-rp-legacy-symbol-bar aria-hidden="true"/u)
})

test('keeps a leading style block in inline frontend source for sanitization', () => {
  const source = '<style>.card{display:grid}</style>\n<section class="card">content</section>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'inline-html', source }])
  assert.deepEqual(compiled.diagnostics, [{ code: 'inline-html', count: 1 }])
})

test('preserves styled custom wrappers inside an isolated inline frontend', () => {
  const source = '<style>scene-body{display:block;color:white}</style>\n<scene-body>readable prose</scene-body>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'inline-html', source }])
  assert.deepEqual(compiled.diagnostics, [{ code: 'inline-html', count: 1 }])
  assert.deepEqual(cardDisplayCustomElementTags(source), ['scene-body'])
  assert.deepEqual(cardDisplayCustomElementTags('<script>unsafe()</script><iframe></iframe>'), [])
})

test('distinguishes fenced frontend documents from inline HTML in source order', () => {
  const source = [
    'before',
    '```html',
    '<!doctype html><html><body>frame</body></html>',
    '```',
    'after <details><summary>state</summary>ready</details>',
  ].join('\n')
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [
    { kind: 'markdown', text: 'before\n' },
    { kind: 'html', source: '<!doctype html><html><body>frame</body></html>\n' },
    { kind: 'inline-html', source: 'after <details><summary>state</summary>ready</details>' },
  ])
  assert.deepEqual(compiled.diagnostics, [
    { code: 'frontend-document', count: 1 },
    { code: 'inline-html', count: 1 },
  ])
})

test('keeps application greetings isolated while redirecting only known Host facades', () => {
  const source = '<!doctype html><html><body><script>function getWin(){return window.parent || window}const context=top.SillyTavern.getContext();getWin().Mvu.getMvuData();parent.getChatMessages();parent.getCurrentMessageId();parent.document.body;</script><img src="https://cdn.example.com/cover.webp"></body></html>'
  const frames = compileCardFrames(compileCharacterDisplay(`\`\`\`html\n${source}\n\`\`\``), {
    origin: 'http://127.0.0.1:3091',
  })
  const frame = frames.segments[0]
  assert.equal(frame?.kind, 'frame')
  if (frame?.kind !== 'frame') return
  assert.equal(frame.interactive, true)
  assert.deepEqual(frame.remoteOrigins, ['https://cdn.example.com'])
  assert.match(frame.srcDoc, /window\.SillyTavern\.getContext\(\)/u)
  assert.match(frame.srcDoc, /function getWin\(\)\{return window\}/u)
  assert.doesNotMatch(frame.srcDoc, /window\.parent\s*\|\|\s*window/u)
  assert.match(frame.srcDoc, /window\.getChatMessages\(\)/u)
  assert.match(frame.srcDoc, /window\.getCurrentMessageId\(\)/u)
  assert.match(frame.srcDoc, /parent\.document\.body/u)
  assert.doesNotMatch(frame.srcDoc, /unsafe-eval/u)
})

test('exposes implemented prompt-template support and bounded successful script markers', () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    compatibilityMarkers: [
      '__辅助计算脚本_loaded__',
      '__辅助计算脚本_loaded__',
      '__invalid marker_loaded__',
      'not-a-marker',
    ],
  })

  assert.match(source, /extensionSettings:\{EjsTemplate:\{enabled:true\}\}/u)
  assert.match(source, /var __dshCompatibilityMarkers=\["__辅助计算脚本_loaded__"\]/u)
  assert.doesNotMatch(source, /invalid marker/u)
})

test('exposes only card-owned greeting choices through the isolated chat facade', () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    greetingChoices: {
      selected: '封面开场',
      alternatives: ['封面开场', '剧情开场'],
    },
    capabilityToken: 'registered-frame',
  })

  assert.match(source, /var __dshCardGreetingChoices=\{"selected":"封面开场","alternatives":\["封面开场","剧情开场"\]\}/u)
  assert.match(source, /action:'capability-request'/u)
  assert.match(source, /capability:'greeting\.select'/u)
  assert.match(source, /action!=='capability-result'/u)
  assert.match(source, /var __dshCardCapabilityToken="registered-frame"/u)
  assert.match(source, /window\.getCurrentMessageId=window\.getLastMessageId/u)
  assert.match(source, /window\.getVariables=/u)
  assert.match(source, /window\.insertOrAssignVariables=/u)
  assert.match(source, /action:'variables-replace'/u)
  assert.match(source, /window\.open=__dshCardOpenExternalWindow/u)
  assert.match(source, /capability:'ui\.external-window\.open'/u)
  assert.match(source, /window\.dshIdentity=Object\.freeze/u)
  assert.match(source, /window\.DshIdentity=window\.dshIdentity/u)
  assert.match(source, /capability:'identity\.native\.attest'/u)
  assert.match(source, /card-native-identity-/u)
  assert.match(source, /dsh-agent-rp:identity/u)
  assert.match(source, /__dshEmbeddedIdentityFrameOrigin/u)
  assert.match(source, /action==='external-window-message'/u)
  assert.match(source, /action:'external-window-delivered'/u)
  assert.match(source, /__dshCardDeliveredExternalWindowRequests/u)
  assert.match(source, /agentRpCapabilityState/u)
  assert.match(source, /开场切换超时/u)
  assert.match(source, /Object\.defineProperty\(window,'localStorage'/u)
  assert.match(source, /value\.length>2097152/u)
  assert.doesNotMatch(source, /writeFile|parent\.localStorage|top\.localStorage|document\.cookie/u)
})

test('accepts only authenticated audience-bound native identity requests from light frontends', () => {
  const request = {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'identity.native.attest',
    token: 'frame-token:0', requestId: 'card-native-identity-1',
    payload: {
      audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: true,
    },
  } as const
  assert.deepEqual(parseCardNativeIdentityCapabilityRequest(request), {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'identity.native.attest',
    token: 'frame-token:0', requestId: 'card-native-identity-1',
    audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: true,
  })
  for (const invalid of [
    { ...request, requestId: 'card-native-identity-0' },
    { ...request, payload: { ...request.payload, audience: 'http://workshop.example.test' } },
    { ...request, payload: { ...request.payload, audience: 'https://workshop.example.test/path' } },
    { ...request, payload: { ...request.payload, nonce: 'short' } },
    { ...request, payload: { ...request.payload, privateCardText: 'not accepted' } },
    { ...request, privateCardText: 'not accepted' },
  ]) assert.equal(parseCardNativeIdentityCapabilityRequest(invalid), undefined)
})

test('accepts only authenticated HTTPS external-window requests from light frontends', () => {
  const request = {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'ui.external-window.open',
    token: 'frame-token:0', requestId: 'card-external-window-1',
    payload: { url: 'https://discord.com/oauth2/authorize?client_id=1', target: '_blank', features: 'popup' },
  } as const
  assert.deepEqual(parseCardExternalWindowCapabilityRequest(request), {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'ui.external-window.open',
    token: 'frame-token:0', requestId: 'card-external-window-1',
    url: 'https://discord.com/oauth2/authorize?client_id=1', target: '_blank', features: 'popup',
  })
  assert.equal(parseCardExternalWindowCapabilityRequest({
    ...request, payload: { ...request.payload, url: 'http://discord.com/oauth2/authorize' },
  }), undefined)
  assert.equal(parseCardExternalWindowCapabilityRequest({
    ...request, payload: { ...request.payload, url: 'https://user:secret@discord.com/oauth2/authorize' },
  }), undefined)
  assert.equal(parseCardExternalWindowCapabilityRequest({ ...request, requestId: 'card-external-window-0' }), undefined)
  assert.equal(parseCardExternalWindowCapabilityRequest({ ...request, cardText: 'private' }), undefined)

  assert.deepEqual(parseCardExternalWindowControlRequest({
    source: 'dsh-agent-rp-card', action: 'external-window-focus', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  }), {
    source: 'dsh-agent-rp-card', action: 'external-window-focus', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  })
  assert.equal(parseCardExternalWindowControlRequest({
    source: 'dsh-agent-rp-card', action: 'external-window-navigate', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  }), undefined)
  assert.deepEqual(parseCardExternalWindowDeliveryReport({
    source: 'dsh-agent-rp-card', action: 'external-window-delivered', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  }), {
    source: 'dsh-agent-rp-card', action: 'external-window-delivered', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  })
  assert.equal(parseCardExternalWindowDeliveryReport({
    source: 'dsh-agent-rp-card', action: 'external-window-delivered', token: 'frame-token:0',
    requestId: 'card-external-window-1', result: 'private',
  }), undefined)
  assert.equal(validExternalWindowMessage(
    'card-frame-v0', 'https://workshop.example.test', { action: 'discordLoginSuccess', hash: 'bounded' },
  ), true)
  assert.equal(validExternalWindowMessage(
    'card-frame-v0', 'https://workshop.example.test', { action: 'discordLoginSuccess', hash: '猫'.repeat(70_000) },
  ), false)
})

test('accepts only bounded registered variable replacements from light frontends', () => {
  for (const scope of ['global', 'preset', 'character', 'chat', 'message'] as const) {
    assert.deepEqual(parseCardVariableReplaceRequest({
      source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
      requestId: 'card-variables-1', scope, variables: { presets: { active: true } },
    }), {
      source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
      requestId: 'card-variables-1', scope, variables: { presets: { active: true } },
    })
  }
  assert.equal(parseCardVariableReplaceRequest({
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'script', variables: {},
  }), undefined)
  assert.equal(parseCardVariableReplaceRequest({
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'character', variables: {}, operation: 'delete-session',
  }), undefined)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(parseCardVariableReplaceRequest({
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'character', variables: cyclic,
  }), undefined)

  const limit = AGENT_RP_CAPABILITIES['session.variables.replace']
    .runtimePolicies['card-frame-v0'].requestBytes
  const emptyRequest = {
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'chat', variables: { payload: '' },
  } as const
  const atLimit = {
    ...emptyRequest,
    variables: { payload: 'a'.repeat(limit - Buffer.byteLength(JSON.stringify(emptyRequest))) },
  }
  assert.equal(Buffer.byteLength(JSON.stringify(atLimit)), limit)
  assert.notEqual(parseCardVariableReplaceRequest(atLimit), undefined)
  assert.equal(parseCardVariableReplaceRequest({
    ...atLimit, variables: { payload: `${atLimit.variables.payload}a` },
  }), undefined)
})

test('accepts only bounded registered greeting capability requests', () => {
  assert.deepEqual(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1,
  }), {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1,
  })
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.write',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1,
  }), undefined)
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'session.variables.replace',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1,
  }), undefined)
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1, value: '任意正文',
  }), undefined)
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame token', requestId: 'card-capability-0', greetingIndex: -1,
  }), undefined)
})

test('accepts only bounded HTTPS resource reports from registered frame tokens', () => {
  assert.deepEqual(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com/path?q=1', type: 'script',
  }), {
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com', type: 'script',
  })
  assert.equal(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'http://cdn.example.com', type: 'script',
  }), undefined)
  assert.equal(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com', type: 'document',
  }), undefined)
  assert.deepEqual(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://workshop.example.com/embed', type: 'frame',
  }), {
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://workshop.example.com', type: 'frame',
  })
  assert.equal(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com', type: 'script', cardText: 'private',
  }), undefined)
})

test('accepts only content-free registered light-frontend lifecycle reports', () => {
  assert.deepEqual(parseCardRuntimeReport({
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'content-present',
  }), {
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'content-present',
  })
  assert.equal(parseCardRuntimeReport({
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'mounted',
  }), undefined)
  assert.equal(parseCardRuntimeReport({
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'runtime-error',
    message: 'private card source',
  }), undefined)
})

test('derives a distinct registered token for each frontend frame', () => {
  const frames = compileCardFrames(compileCharacterDisplay([
    '```html', '<!doctype html><html><body>one</body></html>', '```',
    'middle',
    '```html', '<!doctype html><html><body>two</body></html>', '```',
  ].join('\n')), { origin: 'http://127.0.0.1:3091', capabilityToken: 'mount-token' })

  assert.equal(frames.segments[0]?.kind, 'frame')
  assert.equal(frames.segments[1]?.kind, 'markdown')
  assert.equal(frames.segments[2]?.kind, 'frame')
  assert.match(frames.segments[0]?.kind === 'frame' ? frames.segments[0].srcDoc : '', /"mount-token:0"/u)
  assert.match(frames.segments[2]?.kind === 'frame' ? frames.segments[2].srcDoc : '', /"mount-token:2"/u)
})

test('allows only explicitly approved card resource origins in the frame CSP', () => {
  const source = '<!doctype html><html><body><script>fetch("https://app.example.com/view")</script><iframe src="https://workshop.example.com/embed"></iframe></body></html>'
  assert.deepEqual(cardRemoteResourceRequirements(source), [
    { origin: 'https://app.example.com', type: 'connect' },
    { origin: 'https://workshop.example.com', type: 'frame' },
  ])
  const blocked = compileCardFrameDocument(source, { origin: 'http://127.0.0.1:3091' })
  const approved = compileCardFrameDocument(source, {
    origin: 'http://127.0.0.1:3091',
    character: {
      id: 'character-test', approvedRemoteResourceOrigins: [],
      approvedRemoteResources: [
        { origin: 'https://app.example.com', type: 'connect' },
        { origin: 'https://workshop.example.com', type: 'frame' },
      ],
      displayExtensions: [], imageAssets: [],
    } as never,
  })
  assert.match(blocked, /connect-src 'none'/u)
  assert.match(approved, /connect-src https:\/\/app\.example\.com/u)
  assert.match(approved, /frame-src https:\/\/workshop\.example\.com/u)
  assert.doesNotMatch(approved, /script-src 'unsafe-inline' https:\/\/app\.example\.com/u)
  assert.match(approved, /action:'resource-blocked'/u)
  assert.match(approved, /securitypolicyviolation/u)
  assert.match(approved, /Document\.prototype\.open/u)
  assert.match(approved, /__dshInstallCardResourceListener/u)
  assert.match(approved, /action:'runtime-monitor'/u)
  assert.match(approved, /content-present/u)
  assert.match(approved, /document-restored/u)
})

test('classifies static light-frontend CSS, responsive images, media, and module resources', () => {
  const source = String.raw`
<link rel="icon" href="https://icons.example.com/app.png">
<link rel="preload" as="font" href="https://preload-font.example.com/ui.woff2">
<style>
@import url("https://styles.example.com/theme.css");
@font-face { font-family: UI; src: url("https://fonts.example.com/ui.woff2") format("woff2"); }
.cover { background-image: url("https://background.example.com/cover.webp"); }
</style>
<div style="background:url('https://inline.example.com/panel.png')"></div>
<img srcset="https://responsive.example.com/small.webp 1x, https://responsive.example.com/large.webp 2x">
<video poster="https://poster.example.com/poster.webp"><source src="https://media.example.com/intro.mp4"></video>
<script type="module">
import helper from "https://module.example.com/helper.js";
new EventSource("https://events.example.com/stream");
</script>`
  assert.deepEqual(cardRemoteResourceRequirements(source), [
    { origin: 'https://background.example.com', type: 'image' },
    { origin: 'https://events.example.com', type: 'connect' },
    { origin: 'https://fonts.example.com', type: 'font' },
    { origin: 'https://icons.example.com', type: 'image' },
    { origin: 'https://inline.example.com', type: 'image' },
    { origin: 'https://media.example.com', type: 'media' },
    { origin: 'https://module.example.com', type: 'script' },
    { origin: 'https://poster.example.com', type: 'image' },
    { origin: 'https://preload-font.example.com', type: 'font' },
    { origin: 'https://responsive.example.com', type: 'image' },
    { origin: 'https://styles.example.com', type: 'style' },
  ])
})

test('keeps a mixed-version Host response from blanking the card display', () => {
  const resources = [
    { origin: 'https://app.example.com', type: 'script' as const },
    { origin: 'https://cdn.example.com', type: 'image' as const },
  ]

  assert.deepEqual(blockedCardFrameResources(resources, {}), resources)
  assert.deepEqual(blockedCardFrameResources(resources, {
    approvedRemoteResourceOrigins: ['https://cdn.example.com'],
  }), [{ origin: 'https://app.example.com', type: 'script' }])
  assert.deepEqual(blockedCardFrameResources(resources, {
    approvedRemoteResources: [{ origin: 'https://cdn.example.com', type: 'image' }],
  }), [{ origin: 'https://app.example.com', type: 'script' }])
})

test('allows a player to persist broad HTTPS loading only inside one card sandbox', () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    character: {
      id: 'character-test', approvedRemoteResourceOrigins: [], approvedRemoteResources: [],
      remoteResourcePolicy: 'isolated-https', displayExtensions: [], imageAssets: [],
    } as never,
  })

  assert.match(source, /img-src data: blob: http:\/\/127\.0\.0\.1:3091 https:/u)
  assert.match(source, /script-src 'unsafe-inline' 'unsafe-eval' https:/u)
  assert.match(source, /style-src 'unsafe-inline' https:/u)
  assert.match(source, /connect-src https:/u)
  assert.match(source, /font-src https:/u)
  assert.match(source, /frame-src https:/u)
  assert.deepEqual(blockedCardFrameResources([
    { origin: 'https://runtime.example.com', type: 'script' },
  ], { remoteResourcePolicy: 'isolated-https' }), [])
})

test('recognizes a complete frontend document mislabeled as fenced text', () => {
  const source = [
    '```text',
    '<!doctype html><html><head><style>body{margin:0}</style></head><body>panel</body></html>',
    '```',
  ].join('\n')
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{
    kind: 'html',
    source: '<!doctype html><html><head><style>body{margin:0}</style></head><body>panel</body></html>\n',
  }])
  assert.deepEqual(compiled.diagnostics, [{ code: 'frontend-document', count: 1 }])
})

test('keeps an ordinary HTML snippet in a fenced text sample inert', () => {
  const source = '```text\n<div>example markup</div>\n```'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'markdown', text: source }])
  assert.deepEqual(compiled.diagnostics, [])
})
