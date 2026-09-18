# Starts watch-stale-merge-head.ps1 at every Windows logon for this user, and right now.
# Per user, no admin rights. Remove with: .\scripts\install-merge-head-watcher.ps1 -Uninstall
param([switch]$Uninstall)

$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'watch-stale-merge-head.ps1'
$startup = [Environment]::GetFolderPath('Startup')
$name = 'jobwork-merge-head-watcher-' + [Math]::Abs($repo.ToLower().GetHashCode())
$shortcut = Join-Path $startup "$name.lnk"

function Stop-Watcher {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*watch-stale-merge-head.ps1*$repo*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

Stop-Watcher
if ($Uninstall) {
  Remove-Item -Force -ErrorAction SilentlyContinue $shortcut
  Write-Output "Removed $shortcut and stopped the watcher."
  return
}

$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Repo `"$repo`""
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$lnk.TargetPath = (Get-Command powershell.exe).Source
$lnk.Arguments = $psArgs
$lnk.WorkingDirectory = $repo
$lnk.WindowStyle = 7
$lnk.Save()

Start-Process powershell.exe -ArgumentList $psArgs -WindowStyle Hidden
Write-Output "Installed $shortcut and started the watcher for $repo."
