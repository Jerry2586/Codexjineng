param([Parameter(Mandatory)][string]$BackupPath, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'smartbuild-files.ps1')
$backupFull = [IO.Path]::GetFullPath($BackupPath)
$destinationFull = [IO.Path]::GetFullPath($Destination)
if ((Split-Path -Leaf $destinationFull) -ne 'auto-dev') { throw '恢复目标必须是 auto-dev 目录。' }
$libraryRoot = Split-Path -Parent $destinationFull
Assert-NoLink $backupFull
Assert-NoLink $destinationFull
Assert-Outside $backupFull $libraryRoot
$manifestPath = Join-Path $backupFull 'manifest.json'
Assert-NoLink $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or -not @($manifest.files).Count -or -not $manifest.destination.Equals($libraryRoot,[StringComparison]::OrdinalIgnoreCase)) { throw '备份清单或原安装目标不匹配。' }
$targets = @()
foreach ($entry in $manifest.files) {
    if ($entry.path -notmatch '^(auto-dev|aoci-workflow)/' -or $entry.path.Contains('\') -or @($entry.path.Split('/')) -contains '..') { throw '非法备份路径。' }
    $source = [IO.Path]::GetFullPath((Join-Path $backupFull $entry.path))
    $target = [IO.Path]::GetFullPath((Join-Path $libraryRoot $entry.path))
    Assert-Within $source $backupFull
    Assert-Within $target $libraryRoot
    Assert-NoLink $source
    Assert-FileTarget $target
    if ((Get-FileHash -LiteralPath $source).Hash -ne $entry.sha256) { throw '备份内容已改变，停止恢复。' }
    $targets += @{source=$source;target=$target;entry=$entry}
}
$safetyRoot = Join-Path (Split-Path -Parent $backupFull) ('smartbuild-backup-' + [guid]::NewGuid().ToString('N'))
Assert-Outside $safetyRoot $libraryRoot
Assert-NoLink $safetyRoot
$safetyFiles = @()
foreach ($item in $targets) {
    if (Test-Path -LiteralPath $item.target -PathType Leaf) {
        $saved = Join-Path $safetyRoot $item.entry.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
        Copy-Item -LiteralPath $item.target -Destination $saved
        $safetyFiles += @{path=$item.entry.path;sha256=(Get-FileHash -LiteralPath $saved).Hash}
        @{schemaVersion=1;destination=$libraryRoot;files=$safetyFiles} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $safetyRoot 'manifest.json') -Encoding utf8NoBOM
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $item.target) -Force | Out-Null
    Copy-Item -LiteralPath $item.source -Destination $item.target -Force
    if ((Get-FileHash -LiteralPath $item.target).Hash -ne $item.entry.sha256) { throw '恢复后摘要不匹配。' }
}
Write-Output "已恢复 $($targets.Count) 个原文件；恢复前文件另存于：$safetyRoot"
