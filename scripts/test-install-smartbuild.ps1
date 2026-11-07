param()
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ('smartbuild-install-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Temporary test path escaped its root.' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
. (Join-Path $PSScriptRoot 'smartbuild-files.ps1')
$expectedSkillNames = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'skills') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') } | ForEach-Object Name)
try {
    $target = Join-Path $testRoot 'library/auto-dev'
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target
    foreach ($name in $expectedSkillNames) {
        $source = Join-Path $repoRoot ('skills/' + $name)
        foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
            $installed = Join-Path (Join-Path $testRoot ('library/' + $name)) (Get-RelativePathCompat $source $file.FullName)
            if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $installed).Hash) { throw "Installed file mismatch: $installed" }
        }
    }
    $firstBackups = @(Get-ChildItem -LiteralPath (Join-Path $testRoot 'smartbuild-backups') -Directory -Filter 'smartbuild-backup-*')
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target
    if (@(Get-ChildItem -LiteralPath (Join-Path $testRoot 'smartbuild-backups') -Directory -Filter 'smartbuild-backup-*').Count -ne $firstBackups.Count) { throw 'Identical reinstall produced unnecessary backup.' }
    [IO.File]::WriteAllText((Join-Path $target 'custom.txt'), 'preserve user extension')
    [IO.File]::WriteAllText((Join-Path $target 'SKILL.md'), 'custom previous skill')
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $testRoot 'smartbuild-backups') -Directory -Filter 'smartbuild-backup-*' | Where-Object { $_.FullName -notin $firstBackups.FullName })
    if ($backups.Count -ne 1) { throw 'Expected one backup of changed installed content.' }
    if ([IO.File]::ReadAllText((Join-Path $backups[0].FullName 'auto-dev/SKILL.md')) -ne 'custom previous skill') { throw 'Backup did not preserve the old file.' }
    if ([IO.File]::ReadAllText((Join-Path $target 'custom.txt')) -ne 'preserve user extension') { throw 'User extension was changed.' }
    & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $backups[0].FullName -Destination $target
    if ([IO.File]::ReadAllText((Join-Path $target 'SKILL.md')) -ne 'custom previous skill') { throw 'Restore did not recover original content.' }
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target
    $legacy = Join-Path $testRoot ('library/smartbuild-backup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $legacy 'auto-dev') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $target 'SKILL.md') -Destination (Join-Path $legacy 'auto-dev/SKILL.md')
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target
    if (Test-Path -LiteralPath $legacy) { throw 'Legacy backup remained in skill discovery root.' }
    $migrated = Join-Path (Join-Path $testRoot 'smartbuild-backups') (Split-Path -Leaf $legacy)
    if (-not (Test-Path -LiteralPath (Join-Path $migrated 'manifest.json'))) { throw 'Migrated backup lost recovery manifest.' }
    $legacyTarget = Join-Path $target 'SKILL.md'
    $legacyBefore = [IO.File]::ReadAllText($legacyTarget)
    [IO.File]::WriteAllText($legacyTarget, 'user edit after legacy backup')
    $legacyRejected = $false
    try { & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $migrated -Destination $target } catch { $legacyRejected = $_.Exception.Message -like '*新改动*' }
    if (-not $legacyRejected -or [IO.File]::ReadAllText($legacyTarget) -ne 'user edit after legacy backup') { throw 'Legacy restore overwrote post-backup user changes.' }
    [IO.File]::WriteAllText($legacyTarget, $legacyBefore)
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target -BackupDirectory (Join-Path $testRoot 'library/backups') } catch { $rejected = $true }
    if (-not $rejected) { throw 'Installer accepted a backup location inside the skill root.' }
    # Detect every file/directory collision before changing any installed file.
    $collisionTarget = Join-Path $testRoot 'collision/library/auto-dev'
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $collisionTarget
    [IO.File]::WriteAllText((Join-Path $collisionTarget 'SKILL.md'), 'must survive preflight')
    $occupied = Join-Path $testRoot 'collision/library/aoci-workflow/SKILL.md'
    Remove-Item -LiteralPath $occupied
    New-Item -ItemType Directory -Path $occupied | Out-Null
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $collisionTarget } catch { $rejected = $_.Exception.Message -like '*路径类型冲突*' }
    if (-not $rejected -or [IO.File]::ReadAllText((Join-Path $collisionTarget 'SKILL.md')) -ne 'must survive preflight') { throw 'Install did not reject path collision before writes.' }
    $restoreOccupied = Join-Path $target 'SKILL.md'
    Remove-Item -LiteralPath $restoreOccupied
    New-Item -ItemType Directory -Path $restoreOccupied | Out-Null
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $backups[0].FullName -Destination $target } catch { $rejected = $_.Exception.Message -like '*路径类型冲突*' }
    if (-not $rejected -or @(Get-ChildItem -LiteralPath $restoreOccupied).Count) { throw 'Restore wrote into a directory occupying a file path.' }
    Remove-Item -LiteralPath $restoreOccupied
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target
    $project = Join-Path $testRoot 'project'
    New-Item -ItemType Directory -Path $project | Out-Null
    $result = & node (Join-Path $target 'scripts/task-runtime.mjs') init $project 'Installed smoke test' 'install-test-1'
    if ($LASTEXITCODE -ne 0 -or ($result | ConvertFrom-Json).revision -ne 0) { throw 'Installed task runtime did not initialize.' }
    $catalog = & node (Join-Path $target 'scripts/skill-catalog.mjs') (Join-Path $testRoot 'library')
    if ($LASTEXITCODE -ne 0) { throw 'Installed catalog failed.' }
    $names = @(($catalog | ConvertFrom-Json).name)
    if ('auto-dev' -notin $names -or 'aoci-workflow' -notin $names) { throw 'Installed catalog missed a bundled skill.' }
    $libraryState = Join-Path $testRoot 'skill-library'
    $scan = & node (Join-Path $target 'scripts/skill-library.mjs') scan (Join-Path $testRoot 'library') --library $libraryState
    if ($LASTEXITCODE -ne 0) { throw 'Installed library scan failed.' }
    $library = & node (Join-Path $target 'scripts/skill-library.mjs') list --library $libraryState
    if ($LASTEXITCODE -ne 0 -or @((($library | ConvertFrom-Json).skills)).Count -ne $expectedSkillNames.Count) { throw 'Installed library registry mismatch.' }
    $routeRequest = Join-Path $testRoot 'route-request.json'
    $routeObject = @{ root = $project; roots = @((Join-Path $testRoot 'library')); context = @{ goal = 'Plan a project'; needs = @('product'); stack = @(); phase = 'planning'; tools = @(); operations = @('local') } }
    Write-JsonNoBom $routeRequest $routeObject
    $recommendation = & node (Join-Path $target 'scripts/skill-router.mjs') recommend $routeRequest
    if ($LASTEXITCODE -ne 0 -or -not ($recommendation | ConvertFrom-Json).contextKey) { throw 'Installed skill router failed.' }
    # Preserve an entire customized specialist; explicit replacement must be reversible.
    $customRoot = Join-Path $testRoot '中文 路径/library'
    $customTarget = Join-Path $customRoot 'auto-dev'
    New-Item -ItemType Directory -Path (Join-Path $customRoot 'animate') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $customRoot 'animate/SKILL.md'), "---
name: animate
description: Use for backend database administration only.
---
用户定制")
    [IO.File]::WriteAllText((Join-Path $customRoot 'animate/custom.txt'), 'local extension')
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $customTarget
    if (-not [IO.File]::ReadAllText((Join-Path $customRoot 'animate/SKILL.md')).Contains('用户定制')) { throw 'Customized specialist was overwritten by default.' }
    $customBackups = Join-Path $testRoot '中文 路径/smartbuild-backups'
    $beforeReplace = @(Get-ChildItem -LiteralPath $customBackups -Directory)
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $customTarget
    if (@(Get-ChildItem -LiteralPath $customBackups -Directory).Count -ne $beforeReplace.Count) { throw 'Customized reinstall produced unnecessary backup.' }
    $profile = Get-Content -LiteralPath (Join-Path $customTarget 'references/profiles.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $customProfile = @($profile.skills | Where-Object name -eq 'animate')
    if ($customProfile.Count -ne 1 -or $customProfile[0].sha256 -ne (Get-FileHash -LiteralPath (Join-Path $customRoot 'animate/SKILL.md')).Hash) { throw 'Custom installed profiles were not generated.' }
    if ($customProfile[0].needs -contains 'frontend' -or $customProfile[0].domains -contains 'web-animation' -or $customProfile[0].declaration.status -ne 'needs-review') { throw 'Custom skill inherited unrelated bundled capabilities.' }
    & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $customTarget -ReplaceCustomizedSkills
    $replacement = @(Get-ChildItem -LiteralPath $customBackups -Directory | Where-Object { $_.FullName -notin $beforeReplace.FullName })
    if ($replacement.Count -ne 1) { throw 'Expected replacement backup.' }
    & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $replacement[0].FullName -Destination $customTarget
    if (-not [IO.File]::ReadAllText((Join-Path $customRoot 'animate/SKILL.md')).Contains('用户定制')) { throw 'Non-core restore failed.' }
    # New files can be undone without deleting unrelated extensions.
    $initialBackup = $beforeReplace[0].FullName
    & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $initialBackup -Destination $customTarget
    if (Test-Path -LiteralPath (Join-Path $customTarget 'SKILL.md')) { throw 'Restore retained a newly installed file.' }
    if ([IO.File]::ReadAllText((Join-Path $customRoot 'animate/custom.txt')) -ne 'local extension') { throw 'Restore removed custom extension.' }
    Write-Output 'PASS: all bundled skills, exact file hashes, idempotent reinstall, backup, user extension, installed runtime and catalog.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'smartbuild-install-*') { throw 'Refusing cleanup outside the temporary test directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
