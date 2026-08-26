#!/usr/bin/env bash

# Agent RP runner installer for ordinary Linux desktop and server hosts.
set -Eeuo pipefail
umask 077

DSH_VERSION="${DSH_VERSION:-0.1.1-rc.2}"
PLUGIN_SOURCE="${PLUGIN_SOURCE:-@hewzhew/dsh-agent-rp@next}"
RUNNER_SOURCE_BASE="${RUNNER_SOURCE_BASE:-https://raw.githubusercontent.com/hewzhew/dsh-agent-rp/main/host-runner}"
REGISTRY="${REGISTRY:-}"
AGENT_HOST_PORT="${AGENT_HOST_PORT:-3080}"

PLUGIN_PACKAGE_NAME='@hewzhew/dsh-agent-rp'
AGENT_HOST_VERSION='0.1.1-rc.2'
MINIMUM_PNPM_MAJOR=11
RUNNER_FILES=(
  'package.json'
  'pnpm-lock.yaml'
  'pnpm-workspace.yaml'
  'patches/@deepseek-ai__dsh-session@0.1.1-rc.2.patch'
)

START=0
PRINT_SYSTEMD=0
CHINA_MIRROR=0
ALLOW_ROOT=0
TRUSTED_HOSTS=()

stage() { printf '\033[1;36m[%s/4] %s\033[0m\n' "$1" "$2"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m警告：%s\033[0m\n' "$*" >&2; }
die() {
  printf '\n\033[1;31m安装失败：%s\033[0m\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
用法：bash install-linux.sh [选项]

  --dsh-version <v>        Agent Host 版本；必须等于当前验收版本
  --plugin-source <spec>   插件来源，默认 @hewzhew/dsh-agent-rp@next
  --runner-source-base <u> runner 文件来源；可使用 URL 或本地目录
  --registry <url>         本次安装使用的 npm registry
  --china-mirror           使用 https://registry.npmmirror.com
  --start                  安装完成后前台启动
  --trusted-host <host>    启动或 systemd 服务允许的额外 Host authority；可重复
  --print-systemd          为已经安装的当前用户输出 systemd 系统服务并退出
  --allow-root             允许以 root 安装；不建议用于日常部署
  -h, --help               显示帮助

--print-systemd 不安装或修改服务。请以实际运行 DSH 的用户执行，再由管理员审阅并安装输出。
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dsh-version) DSH_VERSION="${2:?--dsh-version 需要值}"; shift 2 ;;
    --plugin-source) PLUGIN_SOURCE="${2:?--plugin-source 需要值}"; shift 2 ;;
    --runner-source-base) RUNNER_SOURCE_BASE="${2:?--runner-source-base 需要值}"; shift 2 ;;
    --registry) REGISTRY="${2:?--registry 需要值}"; shift 2 ;;
    --china-mirror) CHINA_MIRROR=1; shift ;;
    --start) START=1; shift ;;
    --trusted-host) TRUSTED_HOSTS+=("${2:?--trusted-host 需要值}"); shift 2 ;;
    --print-systemd) PRINT_SYSTEMD=1; shift ;;
    --allow-root) ALLOW_ROOT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "未知参数：$1" ;;
  esac
done

if [ "$(id -u)" -eq 0 ] && [ "$ALLOW_ROOT" != 1 ]; then
  die '不要用 root 运行。请切换到以后实际运行 DSH 的非特权用户。'
fi

# Corepack walks parent manifests, so do not leave it in another user's private directory.
if [ -d "$RUNNER_SOURCE_BASE" ]; then
  RUNNER_SOURCE_BASE="$(cd -- "$RUNNER_SOURCE_BASE" && pwd -P)"
fi
cd -- "$HOME" 2>/dev/null || cd /

dsh_home="${DSH_HOME:-$HOME/.dsh}"
case "$dsh_home" in
  /*) ;;
  *) die "DSH_HOME 必须是绝对路径：$dsh_home" ;;
esac
case "$dsh_home" in
  *$'\n'*|*$'\r'*) die 'DSH_HOME 不能包含换行符' ;;
esac
export DSH_HOME="$dsh_home"

validate_authority() {
  node --input-type=module -e '
    const raw = process.argv[1]
    try {
      const parsed = new URL(`http://${raw}`)
      const valid = parsed.host === raw && parsed.username === "" && parsed.password === ""
        && parsed.pathname === "/" && parsed.search === "" && parsed.hash === ""
      process.exit(valid ? 0 : 1)
    } catch { process.exit(1) }
  ' "$1" >/dev/null 2>&1
}

systemd_quote() {
  local value="$1"
  case "$value" in
    *$'\n'*|*$'\r'*) die 'systemd 参数不能包含换行符' ;;
  esac
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '"%s"' "$value"
}

print_systemd_unit() {
  local launcher="$dsh_home/bin/dsh-agent-rp"
  [ -x "$launcher" ] || die "没有找到 Agent RP 启动入口：$launcher。请先运行安装器。"
  local user group host
  user="$(id -un)"
  group="$(id -gn)"
  printf '%s\n' '[Unit]'
  printf '%s\n' 'Description=DeepSeek Harness Agent RP web host'
  printf '%s\n' 'After=network-online.target'
  printf '%s\n' 'Wants=network-online.target'
  printf '%s\n' 'StartLimitIntervalSec=60'
  printf '%s\n\n' 'StartLimitBurst=3'
  printf '%s\n' '[Service]'
  printf '%s\n' 'Type=simple'
  printf 'User=%s\n' "$user"
  printf 'Group=%s\n' "$group"
  printf 'Environment=%s\n' "$(systemd_quote "HOME=$HOME")"
  printf 'Environment=%s\n' "$(systemd_quote "PATH=$PATH")"
  printf '%s\n' 'EnvironmentFile=-/etc/dsh-agent-rp.env'
  printf 'ExecStart=%s %s' "$(systemd_quote "$launcher")" "$(systemd_quote '--no-open')"
  for host in "${TRUSTED_HOSTS[@]}"; do
    printf ' %s %s' "$(systemd_quote '--trusted-host')" "$(systemd_quote "$host")"
  done
  printf '\n'
  printf '%s\n' 'Restart=on-failure'
  printf '%s\n' 'RestartSec=5'
  printf '%s\n' 'TimeoutStopSec=30'
  printf '%s\n' 'UMask=0077'
  printf '%s\n' 'NoNewPrivileges=yes'
  printf '%s\n' 'PrivateTmp=yes'
  printf '%s\n' 'ProtectSystem=full'
  printf '%s\n' 'ProtectControlGroups=yes'
  printf '%s\n' 'ProtectKernelTunables=yes'
  printf '%s\n\n' 'RestrictSUIDSGID=yes'
  printf '%s\n' '[Install]'
  printf '%s\n' 'WantedBy=multi-user.target'
}

command -v node >/dev/null 2>&1 || die '没有找到 Node.js。请先安装 Node.js 22.19+ 或 24+。'
for trusted_host in "${TRUSTED_HOSTS[@]}"; do
  validate_authority "$trusted_host" || die "trusted-host 必须是规范的 host 或 host:port：$trusted_host"
done
if [ "$PRINT_SYSTEMD" = 1 ]; then
  [ "$START" = 0 ] || die '--print-systemd 与 --start 不能同时使用'
  [ "$CHINA_MIRROR" = 0 ] && [ -z "$REGISTRY" ] \
    || die '--print-systemd 不执行安装，不能与 registry 选项同时使用'
  print_systemd_unit
  exit 0
fi

if [ "$CHINA_MIRROR" = 1 ]; then
  [ -z "$REGISTRY" ] || die '--china-mirror 与 --registry 不能同时使用'
  REGISTRY='https://registry.npmmirror.com'
fi
if [ -n "$REGISTRY" ]; then
  case "$REGISTRY" in
    http://*|https://*) ;;
    *) die "Registry 必须是完整的 HTTP(S) 地址：$REGISTRY" ;;
  esac
  export npm_config_registry="${REGISTRY%/}"
fi

json_dependency_spec() {
  node -e 'const m=require(process.argv[1]);process.stdout.write(String((m.dependencies||{})[process.argv[2]]??""))' \
    "$1" "$2" 2>/dev/null || true
}

json_has_bundle() {
  node -e 'const m=require(process.argv[1]);const b=(m.dsh&&m.dsh.profile&&m.dsh.profile.bundles)||[];process.exit(b.includes(process.argv[2])?0:1)' \
    "$1" "$2" 2>/dev/null
}

json_field() {
  node -e 'const m=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k],m);process.stdout.write(v==null?"":String(v))' \
    "$1" "$2" 2>/dev/null || true
}

sync_runner_file() {
  local runner_directory="$1" relative_path="$2"
  local destination="$runner_directory/$relative_path"
  mkdir -p "$(dirname "$destination")"
  if [ -d "$RUNNER_SOURCE_BASE" ]; then
    cp -f -- "$RUNNER_SOURCE_BASE/$relative_path" "$destination.download" \
      || die "复制 runner 文件失败：$relative_path"
  else
    curl -fsSL --max-time 60 "${RUNNER_SOURCE_BASE%/}/$relative_path" -o "$destination.download" \
      || die "下载 runner 文件失败：$relative_path"
  fi
  mv -f -- "$destination.download" "$destination"
}

stage 1 '检查 Node.js、pnpm 与本机数据目录'

node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
node_rest="${node_version#*.}"
node_minor="${node_rest%%.*}"
if ! { { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 19 ]; } || [ "$node_major" -ge 24 ]; }; then
  die "当前 Node.js 为 $node_version；DSH 需要 Node.js 22.19+ 或 24+（Node 23 不受支持）。"
fi

command -v pnpm >/dev/null 2>&1 \
  || die '没有找到 pnpm。请先运行 npm install --global pnpm@11。'
pnpm_version="$(pnpm --version)"
pnpm_major="${pnpm_version%%.*}"
[ "$pnpm_major" -ge "$MINIMUM_PNPM_MAJOR" ] \
  || die "当前 pnpm 为 $pnpm_version；请先安装 pnpm 11。"

if [ ! -d "$RUNNER_SOURCE_BASE" ]; then
  command -v curl >/dev/null 2>&1 || die '没有找到 curl。'
fi

missing_build_tools=()
for tool in cc make python3; do
  command -v "$tool" >/dev/null 2>&1 || missing_build_tools+=("$tool")
done
if [ "${#missing_build_tools[@]}" -gt 0 ]; then
  warn "没有找到 ${missing_build_tools[*]}；需要现场编译原生模块时会失败。Debian/Ubuntu 可安装 build-essential python3。"
fi

profile_manifest_path="$dsh_home/profiles/web/package.json"
legacy_plugin_path="$dsh_home/plugins/dsh-agent-rp"
runner_directory="$dsh_home/runners/agent-rp"
runner_command="$runner_directory/node_modules/.bin/dsh"
info "Node.js $node_version · pnpm $pnpm_version"
info "DSH 数据目录：$dsh_home"
[ -z "${npm_config_registry:-}" ] || info "本次使用 registry：$npm_config_registry"
[ ! -d "$legacy_plugin_path" ] \
  || warn "发现旧安装目录 $legacy_plugin_path。安装器不会删除它；若启动日志仍引用这里，请先移出该目录作备份。"

normalized_dsh_version="${DSH_VERSION#@}"
[ -n "$normalized_dsh_version" ] || die 'dsh-version 不能为空'
[ -n "$PLUGIN_SOURCE" ] || die 'plugin-source 不能为空'
[ "$normalized_dsh_version" = "$AGENT_HOST_VERSION" ] \
  || die "Agent Host 固定基于 DSH $AGENT_HOST_VERSION，不能套用未验收版本 $normalized_dsh_version。"

stage 2 "准备 Agent Host（DSH $AGENT_HOST_VERSION + 插件事件补丁）"

for runner_file in "${RUNNER_FILES[@]}"; do
  sync_runner_file "$runner_directory" "$runner_file"
done
pnpm --dir "$runner_directory" install --frozen-lockfile --reporter append-only \
  || die 'Agent Host 依赖安装失败。若 npm registry 较慢，可重试 --china-mirror；runner 文件仍来自 GitHub。'

[ -x "$runner_command" ] || die "Agent Host 没有生成 DSH 命令：$runner_command"
reported_dsh_version="$("$runner_command" --version | tail -n1 | tr -d '[:space:]')"
[ "$reported_dsh_version" = "$AGENT_HOST_VERSION" ] \
  || die "Agent Host 版本验证失败：预期 $AGENT_HOST_VERSION，实际 $reported_dsh_version"

capability="$(cd "$runner_directory" && node --input-type=module --eval \
  "import { Session } from '@deepseek-ai/dsh-session'; process.stdout.write(typeof Session.prototype.appendIgnorable)" \
  2>/dev/null || true)"
[ "$capability" = 'function' ] \
  || die 'Agent Host 缺少安全插件事件能力；补丁没有正确应用。'

launcher_directory="$dsh_home/bin"
launcher="$launcher_directory/dsh-agent-rp"
mkdir -p "$launcher_directory"
cat > "$launcher" <<'LAUNCHER'
#!/usr/bin/env bash
set -Eeuo pipefail
launcher_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
dsh_home="$(dirname -- "$(dirname -- "$launcher_path")")"
runner="$dsh_home/runners/agent-rp/node_modules/.bin/dsh"
if [ ! -x "$runner" ]; then
  printf 'Agent RP 专用 Host 不存在：%s。请重新运行 Agent RP 安装器。\n' "$runner" >&2
  exit 1
fi
export DSH_HOME="$dsh_home"
exec "$runner" --profile web "$@"
LAUNCHER
chmod 700 "$launcher"
info '安全插件事件能力：已验证'

installed_spec=''
[ ! -f "$profile_manifest_path" ] \
  || installed_spec="$(json_dependency_spec "$profile_manifest_path" "$PLUGIN_PACKAGE_NAME")"
if [ -z "$installed_spec" ]; then
  stage 3 '安装 Agent RP'
  "$runner_command" plugin --profile web add "$PLUGIN_SOURCE" || die 'Agent RP 安装失败；此阶段需要访问插件来源。'
elif [ "$installed_spec" = "$PLUGIN_SOURCE" ]; then
  stage 3 "更新 Agent RP（当前来源：$installed_spec）"
  "$runner_command" plugin --profile web update "$PLUGIN_PACKAGE_NAME" || die 'Agent RP 更新失败'
else
  stage 3 "同步 Agent RP 来源（当前：$installed_spec）"
  "$runner_command" plugin --profile web add "$PLUGIN_SOURCE" || die 'Agent RP 来源同步失败'
fi

stage 4 '验证 web profile 与插件入口'

[ -f "$profile_manifest_path" ] || die "没有生成 web profile：$profile_manifest_path"
[ -n "$(json_dependency_spec "$profile_manifest_path" "$PLUGIN_PACKAGE_NAME")" ] \
  || die "web profile 中没有找到 $PLUGIN_PACKAGE_NAME"
json_has_bundle "$profile_manifest_path" "$PLUGIN_PACKAGE_NAME" \
  || die "插件没有加入 DSH bundle 列表：$profile_manifest_path"

installed_manifest_path="$dsh_home/profiles/web/node_modules/$PLUGIN_PACKAGE_NAME/package.json"
[ -f "$installed_manifest_path" ] || die "插件目录没有正确落盘：$installed_manifest_path"
[ -n "$(json_field "$installed_manifest_path" 'dsh.bundle.patch')" ] \
  || die '安装包没有声明 dsh.bundle.patch，DSH 无法加载它。'
installed_version="$(json_field "$installed_manifest_path" 'version')"

printf '\n\033[1;32mAgent RP %s 已就绪，已有角色卡和会话不会被清空。\033[0m\n' "$installed_version"
printf '\033[1;36m以后请从 Agent RP 专用入口启动：%s\033[0m\n' "$launcher"

if [ "$START" = 1 ]; then
  listener=''
  if command -v ss >/dev/null 2>&1; then
    listener="$(ss -ltnH "sport = :$AGENT_HOST_PORT" 2>/dev/null | head -n1 || true)"
  elif command -v lsof >/dev/null 2>&1; then
    listener="$(lsof -nP -iTCP:"$AGENT_HOST_PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -n1 || true)"
  fi
  if [ -n "$listener" ]; then
    warn "端口 $AGENT_HOST_PORT 已被占用；没有再启动第二个 DSH。"
    info "占用信息：$listener"
    info "请先停止旧 Host，再运行：$launcher"
  else
    start_arguments=()
    for trusted_host in "${TRUSTED_HOSTS[@]}"; do
      start_arguments+=(--trusted-host "$trusted_host")
    done
    printf '\033[1;36m正在启动 Agent RP 专用 DSH；按 Ctrl+C 会停止本地服务。\033[0m\n'
    exec "$launcher" "${start_arguments[@]}"
  fi
else
  printf '启动命令：%s\n' "$launcher"
  printf '服务器部署：以同一用户运行 %s --print-systemd [--trusted-host <域名>]\n' "$0"
fi
