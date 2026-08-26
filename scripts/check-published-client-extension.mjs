import { readFileSync } from 'node:fs'

const bundle = readFileSync(new URL(
  '../.test-dist/published-client-extension/published-client-extension-consumer.cjs',
  import.meta.url,
), 'utf8')

if (!bundle.includes('agent-rp.workbench.section')) {
  throw new Error('Published client extension fixture lost the Agent RP workbench Slot')
}
if (!bundle.includes('agentRpStExtensions')) {
  throw new Error('Published client extension fixture lost the installed ST extension service')
}
if (bundle.includes('@hewzhew/dsh-agent-rp') || /\brequire\s*\(/u.test(bundle)) {
  throw new Error('Published client extension fixture retained a runtime dependency on Agent RP')
}

console.log('Published client extension can be bundled independently.')
