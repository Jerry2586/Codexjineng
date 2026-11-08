param([string[]]$Cases = @('install-interruption','restore-interruption','relative-paths','hidden-files'))
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase ('smartbuild-recovery-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
. (Join-Path $PSScriptRoot 'smartbuild-files.ps1')
$failures = @()
function Assert-Content([string]$File, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf) -or [IO.File]::ReadAllText($File) -ne $Expected) { throw "Content was not preserved: $File" }
}
function Invoke-Case([string]$Name, [scriptblock]$Body) {
    if ($Cases -notcontains $Name) { return }
    try { & $Body; Write-Output "PASS: $Name" } catch { $script:failures += "$Name : $($_.Exception.Message)"; Write-Output "FAIL: $($script:failures[-1])" }
}
try {
    Invoke-Case 'install-interruption' {
        foreach ($existing in @($true,$false)) {
            $target = Join-Path $testRoot "install-$existing/skills/auto-dev"
            $backups = Join-Path $testRoot "install-$existing/backups"
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            $file = Join-Path $target 'SKILL.md'
            if ($existing) { [IO.File]::WriteAllText($file, 'original') }
            $global:smartbuildRecoveryInjectParent = [IO.Path]::GetFullPath($target)
            function Copy-Item {
                [CmdletBinding()]param([string]$LiteralPath,[string]$Destination,[switch]$Force,[switch]$Recurse)
                if (([IO.Path]::GetFullPath((Split-Path -Parent $Destination))) -eq $global:smartbuildRecoveryInjectParent -and (Split-Path -Leaf $LiteralPath) -eq 'SKILL.md') {
                    [IO.File]::WriteAllText($Destination, 'partial')
                    throw 'Injected interrupted copy'
                }
                Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
            }
            $caught = $false
            try { & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination $target -BackupDirectory $backups | Out-Null } catch { $failureMessage = $_.Exception.Message; $caught = $_.Exception.Message -eq 'Injected interrupted copy' } finally { Remove-Item -LiteralPath 'Function:\Copy-Item' }
            if (-not $caught) { throw "Copy failure was not reached: $failureMessage" }
            if ($existing) { Assert-Content $file 'original' } elseif (Test-Path -LiteralPath $file) { throw 'Interrupted new file became visible.' }
            $backup = @(Get-ChildItem -LiteralPath $backups -Directory)[0].FullName
            & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $backup -Destination $target | Out-Null
            if ($existing) { Assert-Content $file 'original' } elseif (Test-Path -LiteralPath $file) { throw 'Recovery retained a new file.' }
        }
    }
    Invoke-Case 'restore-interruption' {
        $target = Join-Path $testRoot 'restore/skills/auto-dev'
        $backup = Join-Path $testRoot 'restore/backups/original'
        New-Item -ItemType Directory -Path $target,(Join-Path $backup 'auto-dev') -Force | Out-Null
        $file = Join-Path $target 'SKILL.md'
        $saved = Join-Path $backup 'auto-dev/SKILL.md'
        [IO.File]::WriteAllText($file,'installed')
        [IO.File]::WriteAllText($saved,'original')
        Write-JsonNoBom (Join-Path $backup 'manifest.json') @{schemaVersion=2;destination=(Split-Path -Parent $target);skills=@('auto-dev');phase='applied';files=@(@{path='auto-dev/SKILL.md';existed=$true;sha256=(Get-FileHash -LiteralPath $saved).Hash;installedSha256=(Get-FileHash -LiteralPath $file).Hash})}
        $global:smartbuildRecoveryInjectParent = [IO.Path]::GetFullPath($target)
        function Copy-Item {
            [CmdletBinding()]param([string]$LiteralPath,[string]$Destination,[switch]$Force,[switch]$Recurse)
            if (([IO.Path]::GetFullPath((Split-Path -Parent $Destination))) -eq $global:smartbuildRecoveryInjectParent) { [IO.File]::WriteAllText($Destination,'partial'); throw 'Injected interrupted restore' }
            Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
        }
        $caught = $false
        try { & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $backup -Destination $target | Out-Null } catch { $failureMessage = $_.Exception.Message; $caught = $_.Exception.Message -eq 'Injected interrupted restore' } finally { Remove-Item -LiteralPath 'Function:\Copy-Item' }
        if (-not $caught) { throw "Restore failure was not reached: $failureMessage" }
        Assert-Content $file 'installed'
        & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath $backup -Destination $target | Out-Null
        Assert-Content $file 'original'
    }
    Invoke-Case 'relative-paths' {
        $processRoot = Join-Path $testRoot 'relative/process'
        $locationRoot = Join-Path $testRoot 'relative/location'
        New-Item -ItemType Directory -Path $processRoot,$locationRoot -Force | Out-Null
        $beforeProcess = [Environment]::CurrentDirectory
        $beforeLocation = (Get-Location).Path
        try {
            [Environment]::CurrentDirectory = $processRoot
            Set-Location -LiteralPath $locationRoot
            & (Join-Path $PSScriptRoot 'install-smartbuild.ps1') -Destination './skills/auto-dev' -BackupDirectory './backups' | Out-Null
            $file = Join-Path $locationRoot 'skills/auto-dev/SKILL.md'
            if (-not (Test-Path -LiteralPath $file) -or (Test-Path -LiteralPath (Join-Path $processRoot 'skills'))) { throw 'Relative install ignored PowerShell location.' }
            $backup = @(Get-ChildItem -LiteralPath (Join-Path $locationRoot 'backups') -Directory)[0]
            & (Join-Path $PSScriptRoot 'restore-smartbuild.ps1') -BackupPath (Join-Path './backups' $backup.Name) -Destination './skills/auto-dev' | Out-Null
            if (Test-Path -LiteralPath $file) { throw 'Relative restore did not undo the fresh install.' }
        } finally { Set-Location -LiteralPath $beforeLocation; [Environment]::CurrentDirectory = $beforeProcess }
    }
    Invoke-Case 'hidden-files' {
        $package = Join-Path $testRoot 'package'
        New-Item -ItemType Directory -Path $package | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts'),(Join-Path $repoRoot 'skills') -Destination $package -Recurse
        $hidden = Join-Path $package 'skills/auto-dev/scripts/hidden-helper.cjs'
        [IO.File]::WriteAllText($hidden,'console.log("hidden helper");')
        (Get-Item -LiteralPath $hidden).Attributes = [IO.FileAttributes]::Hidden
        $hiddenDir = Join-Path $package 'skills/auto-dev/hidden-resources'
        New-Item -ItemType Directory -Path $hiddenDir | Out-Null
        [IO.File]::WriteAllText((Join-Path $hiddenDir 'required.txt'),'required')
        (Get-Item -LiteralPath $hiddenDir).Attributes = [IO.FileAttributes]::Hidden
        $target = Join-Path $testRoot 'hidden/skills/auto-dev'
        & (Join-Path $package 'scripts/install-smartbuild.ps1') -Destination $target | Out-Null
        Assert-Content (Join-Path $target 'scripts/hidden-helper.cjs') 'console.log("hidden helper");'
        Assert-Content (Join-Path $target 'hidden-resources/required.txt') 'required'
        $result = & node (Join-Path $target 'scripts/hidden-helper.cjs')
        if ($LASTEXITCODE -ne 0 -or $result -ne 'hidden helper') { throw 'Installed hidden helper could not execute.' }
    }
    if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
} finally {
    Remove-Variable -Name smartbuildRecoveryInjectParent -Scope Global -ErrorAction SilentlyContinue
    Assert-Within $testRoot $tempBase
    Assert-NoLink $testRoot
    if ((Split-Path -Leaf $testRoot) -notmatch '^smartbuild-recovery-[a-f0-9]{32}$') { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
