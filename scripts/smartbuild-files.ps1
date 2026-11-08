# Windows PowerShell 5.1 lacks [IO.Path]::GetRelativePath and the utf8NoBOM encoder;
# provide both so the same scripts run on 5.1 and 7 without branching at every call site.
if (-not ([IO.Path].GetMethod('GetRelativePath', [type[]]@([string],[string])))) {
    function Get-RelativePathCompat([string]$From, [string]$To) {
        $fromFull = [IO.Path]::GetFullPath($From).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $toFull = [IO.Path]::GetFullPath($To)
        $fromUri = New-Object System.Uri($fromFull + [IO.Path]::DirectorySeparatorChar)
        $toUri = New-Object System.Uri($toFull)
        return [System.Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
    }
} else {
    function Get-RelativePathCompat([string]$From, [string]$To) { return [IO.Path]::GetRelativePath($From, $To) }
}
function Resolve-FileSystemPath([string]$Path) {
    $provider = $null
    $drive = $null
    $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path, [ref]$provider, [ref]$drive)
    if ($provider.Name -ne 'FileSystem') { throw "路径必须属于文件系统：$Path" }
    return $resolved
}
function Write-AtomicFile([string]$Path, [scriptblock]$WriteContent, [string]$ExpectedHash) {
    $target = Resolve-FileSystemPath $Path
    Assert-FileTarget $target
    $temporary = Join-Path (Split-Path -Parent $target) ('.smartbuild-write-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        & $WriteContent $temporary
        if ($ExpectedHash -and (Get-FileHash -LiteralPath $temporary).Hash -ne $ExpectedHash) { throw '暂存文件摘要不匹配，原文件未改动。' }
        if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::Replace($temporary, $target, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $target) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}
function Copy-FileAtomic([string]$Source, [string]$Destination, [string]$ExpectedHash) {
    Write-AtomicFile $Destination { param($Temporary) Copy-Item -LiteralPath $Source -Destination $Temporary -Force } $ExpectedHash
}
function Write-JsonNoBom([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 8
    Write-AtomicFile $Path { param($Temporary) [IO.File]::WriteAllText($Temporary, $json, (New-Object System.Text.UTF8Encoding($false))) }
}

function Assert-NoLink([string]$TargetPath) {
    $cursor = [IO.Path]::GetFullPath($TargetPath)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "路径包含链接，需先核对实际目标：$cursor" }
        }
        $parentPath = Split-Path -Parent $cursor
        if ($parentPath -eq $cursor) { break }
        $cursor = $parentPath
    }
}
function Assert-Within([string]$TargetPath, [string]$RootPath) {
    $absolute = [IO.Path]::GetFullPath($TargetPath)
    $prefix = [IO.Path]::GetFullPath($RootPath).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "路径超出指定目录：$absolute" }
}
function Assert-Outside([string]$TargetPath, [string]$RootPath) {
    $absolute = [IO.Path]::GetFullPath($TargetPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $rootFull = [IO.Path]::GetFullPath($RootPath).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($absolute.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase) -or $absolute.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "备份或安装目标必须在指定目录外：$absolute" }
}
function Get-BackupInventory([string]$BackupPath) {
    foreach ($file in Get-ChildItem -LiteralPath $BackupPath -File -Recurse -Force) {
        Assert-NoLink $file.FullName
        $relative = (Get-RelativePathCompat $BackupPath $file.FullName).Replace('\','/')
        if ($relative -eq 'manifest.json') { continue }
        Assert-SkillRelativePath $relative
        @{path=$relative;sha256=(Get-FileHash -LiteralPath $file.FullName).Hash}
    }
}

function Assert-FileTarget([string]$TargetPath) {
    Assert-NoLink $TargetPath
    if (Test-Path -LiteralPath $TargetPath -PathType Container) { throw "路径类型冲突：文件目标被目录占用：$TargetPath" }
    $cursor = Split-Path -Parent ([IO.Path]::GetFullPath($TargetPath))
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor -PathType Leaf) { throw "路径类型冲突：父目录被文件占用：$cursor" }
        $parentPath = Split-Path -Parent $cursor
        if ($parentPath -eq $cursor) { break }
        $cursor = $parentPath
    }
}

function Get-SmartBuildSkillNames([string]$SkillsRoot) {
    @(Get-ChildItem -LiteralPath $SkillsRoot -Directory -Force | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') } | ForEach-Object Name | Sort-Object)
}
function Assert-SkillRelativePath([string]$RelativePath) {
    if ($RelativePath -notmatch '^[a-z0-9][a-z0-9-]*/[^/]' -or $RelativePath.Contains('\') -or $RelativePath.Contains(':')) { throw '非法备份路径。' }
    foreach ($part in $RelativePath.Split('/')) {
        if ($part -in @('', '.', '..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw '非法备份路径。' }
    }
}
