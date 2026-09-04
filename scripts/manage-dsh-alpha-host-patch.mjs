import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const manifestPath = resolve(repositoryRoot, 'host-patches/dsh-alpha-ignorable-session-events.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const patchPath = resolve(dirname(manifestPath), manifest.patch.file)

function fail(message) {
  throw new Error(`DSH prerelease Host patch check failed: ${message}`)
}

function git(root, ...args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

function linkedDshRoot() {
  const sessionManifest = realpathSync(resolve(
    repositoryRoot,
    'node_modules/@deepseek-ai/dsh-session/package.json',
  ))
  return git(dirname(sessionManifest), 'rev-parse', '--show-toplevel')
}

function parseArguments(args) {
  let mode = 'check'
  let root
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--check' || arg === '--apply') {
      mode = arg.slice(2)
      continue
    }
    if (arg === '--dsh-root') {
      root = args[index + 1]
      if (root === undefined) fail('--dsh-root requires a path')
      index += 1
      continue
    }
    fail(`unknown argument ${JSON.stringify(arg)}`)
  }
  return { mode, root: realpathSync(resolve(root ?? linkedDshRoot())) }
}

function checkPatchAsset() {
  const digest = createHash('sha256').update(readFileSync(patchPath)).digest('hex')
  if (digest !== manifest.patch.sha256) {
    fail(`patch digest is ${digest}; expected ${manifest.patch.sha256}`)
  }
}

function checkVersion(root) {
  const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  if (rootManifest.version !== manifest.dshVersion) {
    fail(`DSH version is ${JSON.stringify(rootManifest.version)}; expected ${JSON.stringify(manifest.dshVersion)}`)
  }
}

function checkPatchedTree(root) {
  const head = git(root, 'rev-parse', 'HEAD')
  const tree = git(root, 'rev-parse', 'HEAD^{tree}')
  if (tree !== manifest.patch.expectedTree) {
    fail(`DSH HEAD ${head} has tree ${tree}; expected patched tree ${manifest.patch.expectedTree}`)
  }
  const status = git(root, 'status', '--porcelain', '--untracked-files=normal')
  if (status !== '') fail('DSH worktree has uncommitted changes')
  const ancestry = spawnSync('git', [
    '-C', root, 'merge-base', '--is-ancestor', manifest.upstream.commit, 'HEAD',
  ])
  if (ancestry.status !== 0) {
    fail(`DSH HEAD does not descend from ${manifest.upstream.tag} (${manifest.upstream.commit})`)
  }
  return head
}

function applyPatch(root) {
  const head = git(root, 'rev-parse', 'HEAD')
  if (git(root, 'rev-parse', 'HEAD^{tree}') === manifest.patch.expectedTree) return checkPatchedTree(root)
  if (head !== manifest.upstream.commit) {
    fail(`--apply requires clean ${manifest.upstream.tag} at ${manifest.upstream.commit}; found ${head}`)
  }
  if (git(root, 'status', '--porcelain', '--untracked-files=normal') !== '') {
    fail('--apply requires a clean DSH worktree')
  }
  const preflight = spawnSync('git', ['-C', root, 'apply', '--check', patchPath], { encoding: 'utf8' })
  if (preflight.status !== 0) fail(`patch preflight failed: ${preflight.stderr.trim()}`)
  const applied = spawnSync('git', ['-C', root, 'am', '--3way', patchPath], { encoding: 'utf8' })
  if (applied.status !== 0) {
    const aborted = spawnSync('git', ['-C', root, 'am', '--abort'], { encoding: 'utf8' })
    const abortDetail = aborted.status === 0 ? 'the interrupted am was aborted' : 'git am --abort also failed'
    fail(`git am failed (${abortDetail}): ${applied.stderr.trim()}`)
  }
  return checkPatchedTree(root)
}

const options = parseArguments(process.argv.slice(2))
checkPatchAsset()
checkVersion(options.root)
const head = options.mode === 'apply' ? applyPatch(options.root) : checkPatchedTree(options.root)
process.stdout.write(JSON.stringify({
  ready: true,
  dshVersion: manifest.dshVersion,
  head,
  patch: manifest.patch.id,
}) + '\n')
