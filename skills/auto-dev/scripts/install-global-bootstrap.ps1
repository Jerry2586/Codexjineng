[CmdletBinding()]
param(
    [switch]$Remove,
    [string]$CodexHome
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
    $CodexHome = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
        Join-Path $HOME '.codex'
    } else {
        $env:CODEX_HOME
    }
}

$codexHomeFull = [System.IO.Path]::GetFullPath($CodexHome)
$target = Join-Path $codexHomeFull 'AGENTS.md'
$template = Join-Path $PSScriptRoot '..\references\global-bootstrap.md'
$startMarker = '<!-- SMARTBUILD-GLOBAL-BOOTSTRAP:START -->'
$endMarker = '<!-- SMARTBUILD-GLOBAL-BOOTSTRAP:END -->'
$newline = [Environment]::NewLine

if (-not (Test-Path -LiteralPath $template -PathType Leaf)) {
    throw "缺少全局启动模板：$template"
}

New-Item -ItemType Directory -Force -Path $codexHomeFull | Out-Null
$existing = if (Test-Path -LiteralPath $target -PathType Leaf) {
    [System.IO.File]::ReadAllText($target)
} else {
    ''
}

$pattern = '(?s)' + [regex]::Escape($startMarker) + '.*?' + [regex]::Escape($endMarker) + '(?:\r?\n){0,2}'
$preserved = [regex]::Replace($existing, $pattern, '').TrimStart("`r", "`n")

if ($Remove) {
    $next = $preserved
} else {
    $block = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $template).Path).TrimEnd("`r", "`n")
    $next = if ([string]::IsNullOrWhiteSpace($preserved)) {
        $block + $newline
    } else {
        $block + $newline + $newline + $preserved.TrimEnd() + $newline
    }
}

$temp = Join-Path $codexHomeFull ('.AGENTS.smartbuild.' + [guid]::NewGuid().ToString('N') + '.tmp')
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($temp, $next, $utf8NoBom)
Move-Item -LiteralPath $temp -Destination $target -Force

$saved = [System.IO.File]::ReadAllText($target)
if ($Remove) {
    if ($saved.Contains($startMarker) -or $saved.Contains($endMarker)) {
        throw '全局启动入口移除后核对失败。'
    }
    Write-Output "已从 $target 移除智构开发助手全局启动入口。"
} else {
    foreach ($required in @($startMarker, $endMarker, '开发助手', '【开发助手｜框架内执行】', '## 智构开发指挥中心')) {
        if (-not $saved.Contains($required)) {
            throw "全局启动入口安装后缺少：$required"
        }
    }
    Write-Output "智构开发助手全局启动入口已安装到 $target。新会话输入“开发助手”将先显示完整版，后续自动使用精简面板。"
}
