#!/data/data/com.termux/files/usr/bin/bash

set -u

port="${1:-3080}"
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  printf '用法：dsh-agent-rp-doctor [端口号]\n' >&2
  exit 2
fi

line() {
  printf '%-28s %s\n' "$1" "$2"
}

version_or_missing() {
  local command_name="$1"
  shift
  if command -v "$command_name" >/dev/null 2>&1; then
    "$@" 2>/dev/null | head -n 1
  else
    printf '未安装\n'
  fi
}

printf '\n\033[1;36mDSH Agent RP · Termux 体检\033[0m\n'
printf '只检查版本、模块与文件系统能力，不读取密钥、角色卡或会话内容。\n\n'

android_api="$(getprop ro.build.version.sdk 2>/dev/null || true)"
[[ -n "$android_api" ]] || android_api='未知'
kernel="$(uname -r 2>/dev/null || printf '未知')"
architecture="$(uname -m 2>/dev/null || printf '未知')"
line 'Android API' "$android_api"
line '架构' "$architecture"
line '内核' "$kernel"
line 'Node' "$(version_or_missing node node --version)"
line 'npm' "$(version_or_missing npm npm --version)"
line 'pnpm' "$(version_or_missing pnpm pnpm --version)"

dsh_root=''
if command -v npm >/dev/null 2>&1; then
  npm_root="$(npm root --global 2>/dev/null || true)"
  if [[ -n "$npm_root" && -f "$npm_root/@deepseek-ai/dsh/package.json" ]]; then
    dsh_root="$npm_root/@deepseek-ai/dsh"
  fi
fi

if [[ -n "$dsh_root" ]] && command -v node >/dev/null 2>&1; then
  dsh_version="$(node - "$dsh_root/package.json" <<'JS' 2>/dev/null || true
const { readFileSync } = require('node:fs')
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'))
process.stdout.write(typeof value.version === 'string' ? value.version : '未知')
JS
)"
  [[ -n "$dsh_version" ]] || dsh_version='读取失败'
  line 'DSH' "$dsh_version"
else
  line 'DSH' '未找到全局安装'
fi

if command -v node >/dev/null 2>&1; then
  profile_status="$(node - "$HOME/.dsh/profiles/web" <<'JS' 2>/dev/null || true
const { existsSync, readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join } = require('node:path')
const root = process.argv[2]
const manifest = join(root, 'package.json')
if (!existsSync(manifest)) {
  process.stdout.write('未安装')
  process.exit(0)
}
const profile = JSON.parse(readFileSync(manifest, 'utf8'))
if (typeof profile.dependencies?.['@hewzhew/dsh-agent-rp'] !== 'string') {
  process.stdout.write('未安装')
  process.exit(0)
}
try {
  const requireFromProfile = createRequire(manifest)
  const installed = JSON.parse(readFileSync(requireFromProfile.resolve('@hewzhew/dsh-agent-rp/package.json'), 'utf8'))
  process.stdout.write(`已安装 ${installed.version ?? '未知版本'}`)
} catch {
  process.stdout.write('已登记，但依赖未就绪')
}
JS
)"
  [[ -n "$profile_status" ]] || profile_status='检查失败'
  line 'Agent RP（web profile）' "$profile_status"
else
  line 'Agent RP（web profile）' '无法检查（缺少 Node）'
fi

check_module() {
  local module_name="$1"
  if [[ -z "$dsh_root" ]] || ! command -v node >/dev/null 2>&1; then
    printf '无法检查'
    return
  fi
  node - "$dsh_root/package.json" "$module_name" <<'JS' >/dev/null 2>&1
const { createRequire } = require('node:module')
const requireFromDsh = createRequire(process.argv[2])
requireFromDsh(process.argv[3])
JS
  if [[ $? -eq 0 ]]; then printf '可用'; else printf '缺失'; fi
}

line 'koffi' "$(check_module koffi)"
line 'sharp' "$(check_module sharp)"
if [[ -n "$dsh_root" && -f "$dsh_root/node_modules/@img/sharp-wasm32/package.json" ]]; then
  line 'sharp wasm 后备' '已安装'
else
  line 'sharp wasm 后备' '缺失'
fi

if command -v node >/dev/null 2>&1; then
  storage_status="$(node <<'JS' 2>/dev/null || true
const { constants } = require('node:fs')
const { link, mkdir, mkdtemp, open, rmdir, unlink, writeFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { dirname, join, parse, resolve } = require('node:path')

async function hardLinks() {
  const base = join(homedir(), '.dsh')
  await mkdir(base, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(base, '.agent-rp-doctor-'))
  const source = join(directory, 'source')
  const target = join(directory, 'target')
  try {
    await writeFile(source, 'probe', { mode: 0o600 })
    await link(source, target)
    return '支持'
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '未知错误'
    return `受限（${code}）`
  } finally {
    await unlink(target).catch(() => {})
    await unlink(source).catch(() => {})
    await rmdir(directory).catch(() => {})
  }
}

async function ancestorSync() {
  const home = resolve(homedir())
  const root = parse(home).root
  let level = home
  while (level !== root) {
    const parent = dirname(level)
    let handle
    try {
      handle = await open(parent, constants.O_RDONLY)
      await handle.sync()
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '未知错误'
      return `受限（${code}）`
    } finally {
      await handle?.close().catch(() => {})
    }
    level = parent
  }
  return '支持'
}

process.stdout.write(`${await hardLinks()}\n${await ancestorSync()}`)
JS
)"
  hard_link_status="${storage_status%%$'\n'*}"
  if [[ "$storage_status" == *$'\n'* ]]; then
    ancestor_sync_status="${storage_status#*$'\n'}"
  else
    ancestor_sync_status='检查失败'
  fi
  [[ -n "$hard_link_status" ]] || hard_link_status='检查失败'
  [[ -n "$ancestor_sync_status" ]] || ancestor_sync_status='检查失败'
  line 'DSH_HOME 硬链接' "$hard_link_status"
  line '系统祖先目录同步' "$ancestor_sync_status"
else
  line 'DSH_HOME 硬链接' '无法检查（缺少 Node）'
  line '系统祖先目录同步' '无法检查（缺少 Node）'
fi

kernel_support='未知'
if [[ "$kernel" =~ ^([0-9]+)\.([0-9]+) ]]; then
  kernel_major="${BASH_REMATCH[1]}"
  kernel_minor="${BASH_REMATCH[2]}"
  if (( kernel_major > 5 || (kernel_major == 5 && kernel_minor >= 13) )); then
    kernel_support='内核版本可能支持（不代表 Android 已开放）'
  else
    kernel_support='内核版本低于 5.13'
  fi
fi
line 'Landlock' "$kernel_support"

if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:$port" >/dev/null 2>&1; then
  line "本机端口 $port" '可访问'
else
  line "本机端口 $port" '未启动或不可访问'
fi

printf '\n若需要求助，可以复制上面的结果；它不含令牌或聊天内容。\n'
