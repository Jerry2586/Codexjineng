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
        $relative = [IO.Path]::GetRelativePath($BackupPath, $file.FullName).Replace('\','/')
        if ($relative -eq 'manifest.json') { continue }
        if ($relative -notmatch '^(auto-dev|aoci-workflow)/') { throw "备份含未知内容，保留原目录：$relative" }
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
