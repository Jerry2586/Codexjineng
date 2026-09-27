param(
    [string]$Destination = (Join-Path $env:USERPROFILE '.agents\skills\auto-dev')
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..\skills\auto-dev')).Path
$destinationFull = [System.IO.Path]::GetFullPath($Destination)
$destinationLeaf = Split-Path -Leaf $destinationFull
$destinationParent = Split-Path -Parent $destinationFull
$profileFull = [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')

if ($destinationLeaf -ne 'auto-dev') {
    throw '安装目标必须是名为 auto-dev 的独立技能目录。'
}

if ([string]::IsNullOrWhiteSpace($destinationParent) -or $destinationFull.TrimEnd('\') -eq $profileFull) {
    throw '拒绝使用过宽的安装目标。'
}

New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
New-Item -ItemType Directory -Force -Path $destinationFull | Out-Null

Copy-Item -LiteralPath (Join-Path $source 'SKILL.md') -Destination (Join-Path $destinationFull 'SKILL.md') -Force

foreach ($directory in @('agents', 'references', 'scripts')) {
    $targetDirectory = [System.IO.Path]::GetFullPath((Join-Path $destinationFull $directory))
    if (-not $targetDirectory.StartsWith(($destinationFull.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝清理技能目录以外的路径：$targetDirectory"
    }
    if (Test-Path -LiteralPath $targetDirectory) {
        Remove-Item -LiteralPath $targetDirectory -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $source $directory) -Destination $targetDirectory -Recurse -Force
}

$bootstrapInstaller = Join-Path $destinationFull 'scripts\install-global-bootstrap.ps1'
if (-not (Test-Path -LiteralPath $bootstrapInstaller -PathType Leaf)) {
    throw "安装后缺少全局启动器：$bootstrapInstaller"
}
& $bootstrapInstaller

Write-Output "智构开发系统已安装到 $destinationFull，并已启用全局“开发助手”强制面板入口。"
