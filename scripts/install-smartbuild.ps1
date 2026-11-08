param(
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents/skills/auto-dev'),
    [string]$BackupDirectory,
    [switch]$ReplaceCustomizedSkills
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'smartbuild-files.ps1')
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '../skills')).Path
$destinationFull = (Resolve-FileSystemPath $Destination).TrimEnd([IO.Path]::DirectorySeparatorChar)
$destinationParent = Split-Path -Parent $destinationFull
if ((Split-Path -Leaf $destinationFull) -ne 'auto-dev' -or [string]::IsNullOrWhiteSpace($destinationParent)) { throw '安装目标必须是名为 auto-dev 的独立技能目录。' }
if (-not $BackupDirectory) { $BackupDirectory = Join-Path (Split-Path -Parent $destinationParent) 'smartbuild-backups' }
$backupContainer = (Resolve-FileSystemPath $BackupDirectory)
Assert-Outside $backupContainer $destinationParent
Assert-Outside $backupContainer $packageRoot
Assert-NoLink $destinationFull
Assert-NoLink $backupContainer
$backupRoot = Join-Path $backupContainer ('smartbuild-backup-' + [guid]::NewGuid().ToString('N'))
$skillNames = @(Get-SmartBuildSkillNames $packageRoot)
if ($skillNames -notcontains 'auto-dev' -or $skillNames -notcontains 'aoci-workflow') { throw '安装包缺少核心技能 auto-dev 或 aoci-workflow。' }
$node = Get-Command node -ErrorAction Stop
$installFiles = @()
$preserved = @()
foreach ($skillName in $skillNames) {
    $skillSource = [IO.Path]::GetFullPath((Join-Path $packageRoot $skillName))
    $skillTarget = [IO.Path]::GetFullPath((Join-Path $destinationParent $skillName))
    Assert-Outside $skillTarget $packageRoot
    Assert-NoLink $skillTarget
    $candidates = @()
    foreach ($sourceFile in Get-ChildItem -LiteralPath $skillSource -File -Recurse -Force) {
        Assert-NoLink $sourceFile.FullName
        $relative = "$skillName/$((Get-RelativePathCompat $skillSource $sourceFile.FullName).Replace('\','/'))"
        Assert-SkillRelativePath $relative
        $targetFile = [IO.Path]::GetFullPath((Join-Path $destinationParent $relative))
        Assert-Within $targetFile $skillTarget
        Assert-FileTarget $targetFile
        $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName).Hash
        $existed = Test-Path -LiteralPath $targetFile -PathType Leaf
        $targetHash = if ($existed) { (Get-FileHash -LiteralPath $targetFile).Hash } else { $null }
        if ($relative -eq 'auto-dev/references/profiles.json') { continue }
        if ($sourceHash -ne $targetHash) { $candidates += @{source=$sourceFile.FullName;target=$targetFile;path=$relative;existed=$existed;sha256=$targetHash;installedSha256=$sourceHash} }
    }
    if ($skillName -notin @('auto-dev','aoci-workflow') -and (Test-Path -LiteralPath $skillTarget) -and $candidates.Count -and -not $ReplaceCustomizedSkills) {
        $preserved += $skillName
    } else { $installFiles += $candidates }
}
# Legacy backups move out of discovery only after all paths and files are checked.
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
        foreach ($file in $files) { if ((Get-FileHash -LiteralPath (Join-Path $migrationTarget $file.path)).Hash -ne $file.sha256) { throw '备份迁移摘要核对失败。' } }
        if (-not (Test-Path -LiteralPath (Join-Path $migrationTarget 'manifest.json'))) {
            Write-JsonNoBom (Join-Path $migrationTarget 'manifest.json') @{schemaVersion=1;destination=$destinationParent;files=$files;migrated=$true}
        }
        Write-Output "已迁移旧备份：$migrationTarget"
    }
}
# Build the exact post-install document in isolation before any installed file changes.
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$stageRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ('smartbuild-profile-stage-' + [guid]::NewGuid().ToString('N'))))
Assert-Within $stageRoot $tempBase
$stageSkills = Join-Path $stageRoot 'skills'
New-Item -ItemType Directory -Path $stageSkills -Force | Out-Null
try {
    if (Test-Path -LiteralPath $destinationParent) {
        foreach ($dir in Get-ChildItem -LiteralPath $destinationParent -Directory -Force) {
            if ($dir.Name -match '^(smartbuild-backup-|\.skill-library-(stage|old)-)' -or -not (Test-Path -LiteralPath (Join-Path $dir.FullName 'SKILL.md') -PathType Leaf)) { continue }
            Assert-NoLink $dir.FullName
            foreach ($file in Get-ChildItem -LiteralPath $dir.FullName -File -Recurse -Force) {
                Assert-NoLink $file.FullName
                $stageFile = Join-Path $stageSkills (Get-RelativePathCompat $destinationParent $file.FullName)
                Assert-Within $stageFile $stageSkills
                New-Item -ItemType Directory -Path (Split-Path -Parent $stageFile) -Force | Out-Null
                Copy-Item -LiteralPath $file.FullName -Destination $stageFile
            }
        }
    }
    foreach ($item in $installFiles) {
        $stageFile = Join-Path $stageSkills $item.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $stageFile) -Force | Out-Null
        Copy-Item -LiteralPath $item.source -Destination $stageFile -Force
    }
    $profileRelative = 'auto-dev/references/profiles.json'
    $profileTarget = Join-Path $destinationParent $profileRelative
    Assert-FileTarget $profileTarget
    $profileStage = Join-Path $stageRoot 'profiles.json'
    & $node.Source (Join-Path $packageRoot 'auto-dev/scripts/build-profiles.mjs') $stageSkills $profileStage
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $profileStage -PathType Leaf)) { throw '能力档案预生成失败，安装文件未改动。' }
    $profileHash = (Get-FileHash -LiteralPath $profileStage).Hash
    $existsProfile = Test-Path -LiteralPath $profileTarget -PathType Leaf
    $oldProfileHash = if ($existsProfile) { (Get-FileHash -LiteralPath $profileTarget).Hash } else { $null }
    if ($profileHash -ne $oldProfileHash) {
        $installFiles += @{source=$profileStage;target=$profileTarget;path=$profileRelative;existed=$existsProfile;sha256=$oldProfileHash;installedSha256=$profileHash}
    }
$manifest = @{schemaVersion=2;destination=$destinationParent;skills=$skillNames;preserved=$preserved;phase='prepared';files=@()}
if ($installFiles.Count) {
    # Back up every original before the first installed file changes.
    foreach ($item in $installFiles) {
        if ($item.existed) {
            $backupFile = Join-Path $backupRoot $item.path
            New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
            Copy-Item -LiteralPath $item.target -Destination $backupFile
            if ((Get-FileHash -LiteralPath $backupFile).Hash -ne $item.sha256) { throw '备份摘要不匹配，未开始安装。' }
        }
        $manifest.files += @{path=$item.path;existed=$item.existed;sha256=$item.sha256;installedSha256=$item.installedSha256}
    }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Write-JsonNoBom (Join-Path $backupRoot 'manifest.json') $manifest
    foreach ($item in $installFiles) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $item.target) -Force | Out-Null
        Copy-FileAtomic $item.source $item.target $item.installedSha256
        if ((Get-FileHash -LiteralPath $item.target).Hash -ne $item.installedSha256) { throw "安装校验失败，可从 $backupRoot 恢复。" }
    }
}
if ($installFiles.Count) {
    foreach ($entry in $manifest.files) { $entry.installedSha256 = (Get-FileHash -LiteralPath (Join-Path $destinationParent $entry.path)).Hash }
    $manifest.phase = 'applied'
    Write-JsonNoBom (Join-Path $backupRoot 'manifest.json') $manifest
    Write-Output "可恢复清单：$backupRoot"
}
Write-Output "已检查 $($skillNames.Count) 个技能，更新 $($installFiles.Count) 个文件：$destinationParent"
if ($preserved.Count) { Write-Output "已保留本地定制：$($preserved -join ', ')" }

} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
    Assert-Within $resolvedStage $tempBase
    if ((Split-Path -Leaf $resolvedStage) -notmatch '^smartbuild-profile-stage-[a-f0-9]{32}$') { throw '暂存目录不合法，已停止清理。' }
    Assert-NoLink $resolvedStage
    if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
