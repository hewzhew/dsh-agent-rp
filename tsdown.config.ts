import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig, type UserConfig } from 'tsdown'

function isHostExternal(id: string): boolean {
  return id.startsWith('node:') || id.startsWith('@deepseek-ai/')
    || id === 'quickjs-emscripten-core'
    || id === '@jitl/quickjs-singlefile-mjs-release-sync'
    || id === 'es-module-lexer/js'
}

export function host(entry: Readonly<Record<string, string>>): UserConfig {
  return {
    entry,
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: isHostExternal,
      alwaysBundle: id => isHostExternal(id) ? undefined : true,
    },
    plugins: [{
      name: 'bundle-browser-safe-fflate',
      resolveId(id) {
        return id === 'fflate' ? resolve('node_modules/fflate/esm/browser.js') : null
      },
    }, {
      name: 'assert-profile-host-externals',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue
          const invalid = [...output.imports, ...output.dynamicImports]
            .filter(id => !isHostExternal(id))
          if (invalid.length > 0) this.error(`Host bundle retains unsupported imports: ${invalid.join(', ')}`)
        }
      },
    }, {
      name: 'normalize-generated-host-bundle',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue
          output.code = output.code
            .replace(/^\/\/#(?:end)?region.*(?:\r?\n|$)/gmu, '')
            .replace(/[ \t]+$/gmu, '')
        }
      },
    }],
  }
}

const client: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'],
    alwaysBundle: id => [
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives',
    ].includes(id) ? undefined : true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [{
    name: 'bundle-raw-css',
    resolveId(id, importer) {
      if (!id.endsWith('.css?raw')) return null
      const request = id.slice(0, -4)
      const path = request.startsWith('.') && importer !== undefined
        ? resolve(dirname(importer), request)
        : resolve('node_modules', request)
      return `\0agent-rp-raw-css:${path}.js`
    },
    load(id) {
      const prefix = '\0agent-rp-raw-css:'
      if (!id.startsWith(prefix)) return null
      return `export default ${JSON.stringify(readFileSync(id.slice(prefix.length, -3), 'utf8'))}`
    },
  }, {
    name: 'bundle-browser-safe-fflate',
    resolveId(id) {
      return id === 'fflate' ? resolve('node_modules/fflate/esm/browser.js') : null
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@hewzhew/dsh-agent-rp", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([
  host({ index: 'src/index.ts' }),
  { ...host({ 'extension-v0': 'src/extension-v0.ts' }), dts: true },
  { ...host({ 'client-extension-v0': 'src/client-extension-v0.ts' }), dts: true },
  host({ 'repair-session': 'src/session-repair-cli.ts' }),
  client,
])
