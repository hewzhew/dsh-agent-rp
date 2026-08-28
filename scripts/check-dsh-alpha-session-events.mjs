import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'

const eventType = 'agent-rp/alpha-source-capability-probe'
const packageName = '@hewzhew/dsh-agent-rp'
const ctx = new Context()
const fiber = await ctx.plugin(SessionStore)

try {
  const dispose = ctx.sessions.registerEventType(eventType, packageName)
  const registered = ctx.sessions.recognizesEventType(eventType)
  dispose()
  const released = !ctx.sessions.recognizesEventType(eventType)
  if (!registered || !released) process.exitCode = 1
  else process.stdout.write('ready')
} finally {
  await fiber.dispose()
}
