[CmdletBinding()]
param(
  [string]$DshVersion = '0.1.1-rc.2',
  [string]$PluginSource = '@hewzhew/dsh-agent-rp@next',
  [string]$RunnerSourceBase = 'https://raw.githubusercontent.com/hewzhew/dsh-agent-rp/main/host-runner',
  [string]$Registry,
  [switch]$ChinaMirror,
  [switch]$Start
)

$ErrorActionPreference = 'Stop'
$pluginPackageName = '@hewzhew/dsh-agent-rp'
$legacyPluginPackageNames = @('@dsh-external/dsh-agent-rp')
$minimumPnpmMajor = 11
$previousRegistry = $env:npm_config_registry
$agentHostVersion = '0.1.1-rc.2'
$agentHostPort = 3080
$runnerFiles = @(
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'patches/@deepseek-ai__dsh-session@0.1.1-rc.2.patch'
)

function Write-Stage {
  param(
    [int]$Current,
    [int]$Total,
    [string]$Message
  )
  Write-Host "[$Current/$Total] $Message" -ForegroundColor Cyan
}

function Read-SemanticVersion {
  param(
    [string]$Value,
    [string]$CommandName
  )
  if ($Value -notmatch '(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)') {
    throw "无法识别 $CommandName 返回的版本：$Value"
  }
  return [pscustomobject]@{
    Major = [int]$Matches.major
    Minor = [int]$Matches.minor
    Patch = [int]$Matches.patch
    Text = $Matches[0]
  }
}

function Read-JsonFile {
  param([string]$Path)
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    throw "无法读取 $Path：$($_.Exception.Message)"
  }
}

function Get-DependencySpec {
  param(
    [object]$Manifest,
    [string]$PackageName
  )
  if ($null -eq $Manifest.dependencies) { return $null }
  $property = $Manifest.dependencies.PSObject.Properties | Where-Object Name -EQ $PackageName | Select-Object -First 1
  if ($null -eq $property) { return $null }
  return [string]$property.Value
}

function Invoke-PnpmInstall {
  param([string]$WorkingDirectory)
  & pnpm --dir $WorkingDirectory install --frozen-lockfile --reporter append-only
  if ($LASTEXITCODE -ne 0) {
    throw "Agent Host 依赖安装失败（退出码 $LASTEXITCODE）"
  }
}

function Invoke-Dsh {
  param(
    [string]$CommandPath,
    [string[]]$Arguments
  )
  & $CommandPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "DSH 执行失败（退出码 $LASTEXITCODE）"
  }
}

function Assert-AgentHostCapability {
  param([string]$RunnerDirectory)
  $probe = "import { Session } from '@deepseek-ai/dsh-session'; process.stdout.write(typeof Session.prototype.appendIgnorable)"
  Push-Location $RunnerDirectory
  try {
    $result = (& node --input-type=module --eval $probe | Select-Object -Last 1)
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($exitCode -ne 0 -or ([string]$result).Trim() -ne 'function') {
    throw 'Agent Host 缺少安全插件事件能力；补丁没有正确应用，已停止安装，避免生成无法保存 Agent 回合的启动入口。'
  }
}

function Write-AgentHostLauncher {
  param(
    [string]$DshHomePath,
    [string]$RunnerCommand
  )
  $launcherDirectory = Join-Path $DshHomePath 'bin'
  $powershellLauncher = Join-Path $launcherDirectory 'dsh-agent-rp.ps1'
  $commandLauncher = Join-Path $launcherDirectory 'dsh-agent-rp.cmd'
  New-Item -ItemType Directory -Path $launcherDirectory -Force | Out-Null

  $escapedRunner = $RunnerCommand.Replace("'", "''")
  $powershellSource = @"
`$ErrorActionPreference = 'Stop'
`$runner = '$escapedRunner'
if (-not (Test-Path -LiteralPath `$runner -PathType Leaf)) {
  throw "Agent RP 专用 Host 不存在：`$runner。请重新运行 Agent RP 安装器。"
}
& `$runner --profile web @args
exit `$LASTEXITCODE
"@
  $commandSource = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0dsh-agent-rp.ps1`" %*`r`n"
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($powershellLauncher, $powershellSource, $utf8)
  [IO.File]::WriteAllText($commandLauncher, $commandSource, $utf8)
  return [pscustomobject]@{
    PowerShell = $powershellLauncher
    Command = $commandLauncher
  }
}

function Get-AgentHostPortListener {
  param([int]$Port)
  if ($null -eq (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return $null }
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $connection) { return $null }
  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    ProcessId = $connection.OwningProcess
    ProcessName = if ($null -eq $process) { '未知进程' } else { $process.ProcessName }
  }
}

function Sync-RunnerFile {
  param(
    [string]$RunnerDirectory,
    [string]$RelativePath
  )
  $localRelativePath = $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $destination = Join-Path $RunnerDirectory $localRelativePath
  $destinationDirectory = Split-Path -Parent $destination
  if (-not (Test-Path -LiteralPath $destinationDirectory)) {
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  }
  $download = "$destination.download"
  if (Test-Path -LiteralPath $RunnerSourceBase -PathType Container) {
    Copy-Item -LiteralPath (Join-Path $RunnerSourceBase $localRelativePath) -Destination $download -Force
  } else {
    Invoke-WebRequest "$($RunnerSourceBase.TrimEnd('/'))/$RelativePath" -OutFile $download
  }
  Move-Item -LiteralPath $download -Destination $destination -Force
}

try {
  if ($ChinaMirror -and -not [string]::IsNullOrWhiteSpace($Registry)) {
    throw 'ChinaMirror 与 Registry 不能同时使用；请选择一个 registry 来源。'
  }
  if ($ChinaMirror) {
    $Registry = 'https://registry.npmmirror.com'
  }
  if (-not [string]::IsNullOrWhiteSpace($Registry)) {
    $registryUri = $null
    if (-not [Uri]::TryCreate($Registry, [UriKind]::Absolute, [ref]$registryUri) -or $registryUri.Scheme -notin @('http', 'https')) {
      throw "Registry 必须是完整的 HTTP(S) 地址：$Registry"
    }
    $env:npm_config_registry = $Registry.TrimEnd('/')
  }

  Write-Stage 1 4 '检查 Node.js、pnpm 与本机数据目录'
  if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '没有找到 Node.js。请先安装 Node.js 22.19+ 或 24+，再重新运行。'
  }
  $nodeVersion = Read-SemanticVersion (& node --version) 'Node.js'
  $supportedNode = ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 19) -or $nodeVersion.Major -ge 24
  if (-not $supportedNode) {
    throw "当前 Node.js 为 $($nodeVersion.Text)；DSH 需要 Node.js 22.19+ 或 24+（Node 23 不在支持范围）。"
  }

  if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw '没有找到 pnpm。请先运行 npm install --global pnpm@11，再重新运行；安装器不会静默修改全局工具。'
  }
  $pnpmVersion = Read-SemanticVersion (& pnpm --version) 'pnpm'
  if ($pnpmVersion.Major -lt $minimumPnpmMajor) {
    throw "当前 pnpm 为 $($pnpmVersion.Text)；请先运行 npm install --global pnpm@11。"
  }

  $dshHomePath = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
  } else {
    $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:DSH_HOME)
  }
  $profileManifestPath = Join-Path $dshHomePath 'profiles\web\package.json'
  $legacyPluginPath = Join-Path $dshHomePath 'plugins\dsh-agent-rp'
  $runnerDirectory = Join-Path $dshHomePath 'runners\agent-rp'
  $runnerCommand = Join-Path $runnerDirectory 'node_modules\.bin\dsh.cmd'
  Write-Host "    Node.js $($nodeVersion.Text) · pnpm $($pnpmVersion.Text)"
  Write-Host "    DSH 数据目录：$dshHomePath"
  if (-not [string]::IsNullOrWhiteSpace($Registry)) {
    Write-Host "    本次使用 registry：$env:npm_config_registry"
  }
  if (Test-Path -LiteralPath $legacyPluginPath) {
    Write-Warning "发现旧安装目录 $legacyPluginPath。安装器不会删除它；若 DSH 启动日志仍引用这里，请先把该目录移出 plugins 后再启动。"
  }

  $normalizedDshVersion = $DshVersion.Trim().TrimStart('@')
  if ([string]::IsNullOrWhiteSpace($normalizedDshVersion)) { throw 'DshVersion 不能为空。' }
  if ([string]::IsNullOrWhiteSpace($PluginSource)) { throw 'PluginSource 不能为空。' }
  if ($normalizedDshVersion -ne $agentHostVersion) {
    throw "Agent Host 目前固定基于 DSH $agentHostVersion；不能把补丁应用到未验收版本 $normalizedDshVersion。"
  }

  Write-Stage 2 4 "准备 Agent Host（DSH $agentHostVersion + 插件事件补丁）"
  foreach ($runnerFile in $runnerFiles) {
    Sync-RunnerFile $runnerDirectory $runnerFile
  }
  Invoke-PnpmInstall $runnerDirectory
  if (-not (Test-Path -LiteralPath $runnerCommand -PathType Leaf)) {
    throw "Agent Host 没有生成 DSH 命令：$runnerCommand"
  }
  $reportedDshVersion = (& $runnerCommand --version | Select-Object -Last 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $reportedDshVersion -ne $agentHostVersion) {
    throw "Agent Host 版本验证失败：预期 $agentHostVersion，实际 $reportedDshVersion"
  }
  Assert-AgentHostCapability $runnerDirectory
  $launcher = Write-AgentHostLauncher $dshHomePath $runnerCommand
  Write-Host '    安全插件事件能力：已验证'

  $installedSpec = $null
  if (Test-Path -LiteralPath $profileManifestPath) {
    $installedSpec = Get-DependencySpec (Read-JsonFile $profileManifestPath) $pluginPackageName
  }
  if ($null -eq $installedSpec) {
    Write-Stage 3 4 '安装 Agent RP'
    Invoke-Dsh $runnerCommand @('plugin', '--profile', 'web', 'add', $PluginSource)
  } elseif ($installedSpec -eq $PluginSource) {
    Write-Stage 3 4 "更新 Agent RP（当前来源：$installedSpec）"
    Invoke-Dsh $runnerCommand @('plugin', '--profile', 'web', 'update', $pluginPackageName)
  } else {
    Write-Stage 3 4 "同步 Agent RP 来源（当前：$installedSpec）"
    Invoke-Dsh $runnerCommand @('plugin', '--profile', 'web', 'add', $PluginSource)
  }

  if (Test-Path -LiteralPath $profileManifestPath) {
    $profileAfterInstall = Read-JsonFile $profileManifestPath
    foreach ($legacyPackageName in $legacyPluginPackageNames) {
      if ($null -ne (Get-DependencySpec $profileAfterInstall $legacyPackageName)) {
        Write-Host "    迁移历史包名：$legacyPackageName → $pluginPackageName"
        Invoke-Dsh $runnerCommand @('plugin', '--profile', 'web', 'remove', $legacyPackageName)
      }
    }
  }

  Write-Stage 4 4 '验证 web profile 与插件入口'
  if (-not (Test-Path -LiteralPath $profileManifestPath)) {
    throw "没有生成 web profile：$profileManifestPath"
  }
  $profileManifest = Read-JsonFile $profileManifestPath
  if ($null -eq (Get-DependencySpec $profileManifest $pluginPackageName)) {
    throw "web profile 中没有找到 $pluginPackageName"
  }
  $bundles = @($profileManifest.dsh.profile.bundles)
  if ($bundles -notcontains $pluginPackageName) {
    throw "插件已经写入依赖，但没有加入 DSH bundle 列表：$profileManifestPath"
  }
  $installedManifestPath = Join-Path $dshHomePath 'profiles\web\node_modules\@hewzhew\dsh-agent-rp\package.json'
  if (-not (Test-Path -LiteralPath $installedManifestPath)) {
    throw "插件目录没有正确落盘：$installedManifestPath"
  }
  $installedManifest = Read-JsonFile $installedManifestPath
  if ([string]::IsNullOrWhiteSpace([string]$installedManifest.dsh.bundle.patch)) {
    throw '安装包没有声明 dsh.bundle.patch，DSH 无法把它作为 profile 插件加载。'
  }

  Write-Host "Agent RP $($installedManifest.version) 已就绪，已有角色卡和会话不会被清空。" -ForegroundColor Green
  Write-Host "以后请从 Agent RP 专用入口启动：& '$($launcher.PowerShell)'" -ForegroundColor Cyan
  Write-Host "也可以在 cmd 中运行：`"$($launcher.Command)`""
  if ($Start) {
    $listener = Get-AgentHostPortListener $agentHostPort
    if ($null -ne $listener) {
      Write-Warning "端口 $agentHostPort 已由 $($listener.ProcessName)（PID $($listener.ProcessId)）占用；安装已经完成，但没有再启动第二个 DSH。"
      Write-Host "请先关闭旧的 DSH，再运行：& '$($launcher.PowerShell)'" -ForegroundColor Yellow
    } else {
      Write-Host '正在启动 Agent RP 专用 DSH；关闭这个窗口或按 Ctrl+C 会停止本地服务。' -ForegroundColor Cyan
      Invoke-Dsh $runnerCommand @('--profile', 'web')
    }
  } else {
    Write-Host "启动命令：& '$($launcher.PowerShell)'"
  }
} catch {
  Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '如果卡在“准备 Agent Host”的依赖安装，可以重试 -ChinaMirror；若下载 runner 文件失败，则需要检查 GitHub 连通性。' -ForegroundColor Yellow
  Write-Host '如果卡在“安装 Agent RP”，可以重试 -ChinaMirror；runner 文件仍需要访问 GitHub。' -ForegroundColor Yellow
  exit 1
} finally {
  if ($null -eq $previousRegistry) {
    Remove-Item Env:npm_config_registry -ErrorAction SilentlyContinue
  } else {
    $env:npm_config_registry = $previousRegistry
  }
}
