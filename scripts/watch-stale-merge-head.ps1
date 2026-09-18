# Deletes .git/MERGE_HEAD the moment something re-creates it after its merge was already committed.
#
# The git hooks cannot cover this: the file reappears 5-45s AFTER the merge commit and push, when
# no hook runs, and no writer could be identified (VS Code's git extension and GitLens only read it,
# and neither OneDrive nor Zoho WorkDrive syncs this folder). Same ancestry test as
# clear-stale-merge-head.sh, so a merge that is genuinely in progress is never touched.
#
# Every removal is logged to .git/stale-merge-head.log together with the processes running at that
# moment, to name the writer next time. Installed per user by install-merge-head-watcher.ps1.
param([string]$Repo = (Split-Path -Parent $PSScriptRoot))

$gitDir = Join-Path $Repo '.git'
$mergeHead = Join-Path $gitDir 'MERGE_HEAD'
$log = Join-Path $gitDir 'stale-merge-head.log'

function Clear-StaleMergeHead([string]$trigger) {
  if (-not (Test-Path $mergeHead)) { return }
  # let a git process that is writing the merge state finish first
  Start-Sleep -Milliseconds 1500
  if (-not (Test-Path $mergeHead)) { return }

  $sha = (Get-Content $mergeHead -Raw -ErrorAction SilentlyContinue)
  $sha = if ($sha) { $sha.Trim() } else { '' }
  if ($sha) {
    & git -C $Repo merge-base --is-ancestor $sha HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return } # not yet merged: a real merge in progress
  }

  $written = (Get-Item $mergeHead).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss.fff')
  $procs = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -match '^(git|git-remote-https|sh|bash|node)\.exe$' -or ($_.Name -eq 'Code.exe' -and $_.CommandLine -match 'node\.mojom\.NodeService') } |
    ForEach-Object {
      $cmd = "$($_.CommandLine)"
      "    $($_.ProcessId) <- $($_.ParentProcessId)  $($cmd.Substring(0, [Math]::Min(180, $cmd.Length)))"
    }
  Remove-Item -Force -ErrorAction SilentlyContinue $mergeHead, (Join-Path $gitDir 'MERGE_MODE'), (Join-Path $gitDir 'MERGE_MSG')
  Add-Content -Path $log -Value (@(
      "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')  removed stale MERGE_HEAD $sha (written $written, via $trigger)"
    ) + $procs)
}

Clear-StaleMergeHead 'startup'

$watcher = New-Object System.IO.FileSystemWatcher $gitDir, 'MERGE_HEAD'
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite'
$watcher.IncludeSubdirectories = $false

while ($true) {
  # WaitForChanged rather than Register-ObjectEvent: no event queue to drain in a hidden session
  $result = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]'Created, Changed, Renamed', 60000)
  if ($result.TimedOut) {
    Clear-StaleMergeHead 'poll'
  } else {
    Clear-StaleMergeHead $result.ChangeType
  }
}
