param(
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents/skills/auto-dev'),
    [string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '../skills')).Path
$destinationFull = [IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar)
$destinationParent = Split-Path -Parent $destinationFull
if ((Split-Path -Leaf $destinationFull) -ne 'auto-dev' -or [string]::IsNullOrWhiteSpace($destinationParent)) { throw '安装目标必须是名为 auto-dev 的独立技能目录。' }
. (Join-Path $PSScriptRoot 'smartbuild-files.ps1')
if (-not $BackupDirectory) { $BackupDirectory = Join-Path (Split-Path -Parent $destinationParent) 'smartbuild-backups' }
$backupContainer = [IO.Path]::GetFullPath($BackupDirectory)
Assert-Outside $backupContainer $destinationParent
Assert-Outside $backupContainer $packageRoot
Assert-NoLink $destinationFull
Assert-NoLink $backupContainer
$backupRoot = Join-Path $backupContainer ('smartbuild-backup-' + [guid]::NewGuid().ToString('N'))
$manifest = @()
$copied = 0
$backedUp = 0
$installFiles = @()
foreach ($skillName in @('auto-dev', 'aoci-workflow')) {
    $skillSource = [IO.Path]::GetFullPath((Join-Path $packageRoot $skillName))
    $skillTarget = [IO.Path]::GetFullPath((Join-Path $destinationParent $skillName))
    Assert-Outside $skillTarget $packageRoot
    Assert-NoLink $skillTarget
    foreach ($sourceFile in Get-ChildItem -LiteralPath $skillSource -File -Recurse) {
        Assert-NoLink $sourceFile.FullName
        $relative = [IO.Path]::GetRelativePath($skillSource, $sourceFile.FullName)
        $targetFile = [IO.Path]::GetFullPath((Join-Path $skillTarget $relative))
        Assert-Within $targetFile $skillTarget
        Assert-FileTarget $targetFile
        $installFiles += @{source=$sourceFile.FullName;target=$targetFile;skill=$skillName;relative=$relative}
    }
}
# Move only the installer's known backup directories; validate both absolute paths first.
if (Test-Path -LiteralPath $destinationParent) {
    foreach ($old in Get-ChildItem -LiteralPath $destinationParent -Directory -Filter 'smartbuild-backup-*') {
        if ($old.Name -notmatch '^smartbuild-backup-[a-f0-9]{32}$') { continue }
        Assert-Within $old.FullName $destinationParent
        Assert-NoLink $old.FullName
        $migrationTarget = [IO.Path]::GetFullPath((Join-Path $backupContainer $old.Name))
        Assert-Within $migrationTarget $backupContainer
        Assert-NoLink $migrationTarget
        if (Test-Path -LiteralPath $migrationTarget) { throw "备份迁移目标已存在，原备份保留：$migrationTarget" }
        $files = @(Get-BackupInventory $old.FullName)
        if (-not $files.Count) { continue }
        New-Item -ItemType Directory -Path $backupContainer -Force | Out-Null
        Move-Item -LiteralPath $old.FullName -Destination $migrationTarget
        foreach ($file in $files) {
            if ((Get-FileHash -LiteralPath (Join-Path $migrationTarget $file.path)).Hash -ne $file.sha256) { throw '备份迁移摘要核对失败。' }
        }
        @{ schemaVersion=1; destination=$destinationParent; files=$files; migrated=$true } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $migrationTarget 'manifest.json') -Encoding utf8NoBOM
        Write-Output "已迁移旧备份并核对 $($files.Count) 个文件：$migrationTarget"
    }
}
foreach ($item in $installFiles) {
        $sourceFile = Get-Item -LiteralPath $item.source
        $targetFile = $item.target
        $skillName = $item.skill
        $relative = $item.relative
        if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
            if ((Get-FileHash -LiteralPath $sourceFile.FullName).Hash -eq (Get-FileHash -LiteralPath $targetFile).Hash) { continue }
            $backupRelative = "$skillName/$($relative.Replace('\','/'))"
            $backupFile = Join-Path $backupRoot $backupRelative
            New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
            Copy-Item -LiteralPath $targetFile -Destination $backupFile
            $manifest += @{path=$backupRelative; sha256=(Get-FileHash -LiteralPath $backupFile).Hash}
            # Persist after every saved original so an interrupted install remains recoverable.
            @{schemaVersion=1; destination=$destinationParent; files=$manifest} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupRoot 'manifest.json') -Encoding utf8NoBOM
            $backedUp++
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
        Copy-Item -LiteralPath $sourceFile.FullName -Destination $targetFile -Force
        if ((Get-FileHash -LiteralPath $sourceFile.FullName).Hash -ne (Get-FileHash -LiteralPath $targetFile).Hash) { throw "安装校验失败：$targetFile" }
        $copied++
}
Write-Output "已安装 auto-dev 与 aoci-workflow（含运行脚本），复制 $copied 个文件：$destinationParent"
if ($backedUp -gt 0) { Write-Output "原文件备份 $backedUp 个：$backupRoot" }
