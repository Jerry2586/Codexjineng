param([Parameter(Mandatory)][string]$BackupPath, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'smartbuild-files.ps1')
$backupFull = [IO.Path]::GetFullPath($BackupPath)
$destinationFull = [IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar)
if ((Split-Path -Leaf $destinationFull) -ne 'auto-dev') { throw '恢复目标必须是 auto-dev 目录。' }
$libraryRoot = Split-Path -Parent $destinationFull
Assert-NoLink $backupFull
Assert-NoLink $destinationFull
Assert-Outside $backupFull $libraryRoot
$manifestPath = Join-Path $backupFull 'manifest.json'
Assert-NoLink $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -notin @(1,2) -or -not @($manifest.files).Count -or -not $manifest.destination.Equals($libraryRoot,[StringComparison]::OrdinalIgnoreCase)) { throw '备份清单或原安装目标不匹配。' }
$targets = @()
$seen = @{}
foreach ($entry in $manifest.files) {
    Assert-SkillRelativePath $entry.path
    if ($seen.ContainsKey($entry.path)) { throw '备份清单含重复路径。' }
    $seen[$entry.path] = $true
    if ($manifest.schemaVersion -eq 2 -and $entry.path.Split('/')[0] -notin $manifest.skills) { throw '备份路径不在技能清单中。' }
    $source = [IO.Path]::GetFullPath((Join-Path $backupFull $entry.path))
    $target = [IO.Path]::GetFullPath((Join-Path $libraryRoot $entry.path))
    Assert-Within $source $backupFull
    Assert-Within $target $libraryRoot
    Assert-NoLink $source
    Assert-FileTarget $target
    $existed = $manifest.schemaVersion -eq 1 -or $entry.existed -eq $true
    if ($existed -and (Get-FileHash -LiteralPath $source).Hash -ne $entry.sha256) { throw '备份内容已改变，停止恢复。' }
    $currentHash = if (Test-Path -LiteralPath $target -PathType Leaf) { (Get-FileHash -LiteralPath $target).Hash } else { $null }
    if ($currentHash -and $currentHash -ne $entry.sha256 -and ($manifest.schemaVersion -eq 1 -or $currentHash -ne $entry.installedSha256)) { throw "安装后文件有新改动，保留并停止恢复：$($entry.path)" }
    $targets += @{source=$source;target=$target;entry=$entry;existed=$existed;currentHash=$currentHash}
}
$safetyRoot = Join-Path (Split-Path -Parent $backupFull) ('smartbuild-backup-' + [guid]::NewGuid().ToString('N'))
Assert-Outside $safetyRoot $libraryRoot
Assert-NoLink $safetyRoot
$safety = @{schemaVersion=2;destination=$libraryRoot;skills=@($manifest.files | ForEach-Object { $_.path.Split('/')[0] } | Sort-Object -Unique);phase='prepared';files=@()}
# Save all current files before restoring or removing any file.
foreach ($item in $targets) {
    if ($item.currentHash) {
        $saved = Join-Path $safetyRoot $item.entry.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
        Copy-Item -LiteralPath $item.target -Destination $saved
        if ((Get-FileHash -LiteralPath $saved).Hash -ne $item.currentHash) { throw '恢复安全备份摘要不匹配。' }
    }
    $safety.files += @{path=$item.entry.path;existed=[bool]$item.currentHash;sha256=$item.currentHash;installedSha256=$(if ($item.existed) { $item.entry.sha256 } else { $null })}
}
New-Item -ItemType Directory -Path $safetyRoot -Force | Out-Null
Write-JsonNoBom (Join-Path $safetyRoot 'manifest.json') $safety
foreach ($item in $targets) {
    if ($item.existed) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $item.target) -Force | Out-Null
        Copy-Item -LiteralPath $item.source -Destination $item.target -Force
        if ((Get-FileHash -LiteralPath $item.target).Hash -ne $item.entry.sha256) { throw '恢复后摘要不匹配。' }
    } elseif (Test-Path -LiteralPath $item.target -PathType Leaf) {
        Assert-Within $item.target $libraryRoot
        Remove-Item -LiteralPath $item.target
    }
}
$safety.phase = 'applied'
Write-JsonNoBom (Join-Path $safetyRoot 'manifest.json') $safety
Write-Output "已恢复 $($targets.Count) 个文件状态；恢复前内容另存于：$safetyRoot"
