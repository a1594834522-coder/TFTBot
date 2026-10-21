param([Parameter(Mandatory=$true)][string]$StagedPath,[switch]$Restart)
$ErrorActionPreference='Stop'
$releaseRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\desktop-release')).Path
$source=(Resolve-Path -LiteralPath $StagedPath).Path
$target=[IO.Path]::GetFullPath((Join-Path $releaseRoot 'TFTBot-win32-x64'))
$backup=[IO.Path]::GetFullPath((Join-Path $releaseRoot ('previous-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))))
# Verify every resolved directory BEFORE any directory move or process stop.
foreach($candidate in @($source,$target,$backup)){
  if(-not $candidate.StartsWith($releaseRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Release path escapes the workspace release directory'}
}
if($source -eq $target -or (Test-Path -LiteralPath $backup)){throw 'Invalid staging/backup directory'}
$info=Get-Content -LiteralPath (Join-Path $source 'BUILD-INFO.json') -Raw | ConvertFrom-Json
foreach($entry in $info.files.PSObject.Properties){
  $file=[IO.Path]::GetFullPath((Join-Path (Join-Path $source 'resources\app') $entry.Name))
  if(-not $file.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid package manifest path'}
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Value){throw ('Package changed: '+$entry.Name)}
}
if(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'League of Legends.exe'}){throw 'A real game is running; leave the staged release for later'}
$oldExe=Join-Path $target 'TFTBot.exe'
$running=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'TFTBot.exe' -and $_.ExecutablePath -eq $oldExe})
foreach($process in $running){
  $fresh=Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.ProcessId)
  if($fresh -and $fresh.ExecutablePath -eq $oldExe){Stop-Process -Id $fresh.ProcessId -Force -ErrorAction SilentlyContinue}
}
foreach($process in $running){Wait-Process -Id $process.ProcessId -Timeout 5 -ErrorAction SilentlyContinue}
if(Test-Path -LiteralPath $target){Move-Item -LiteralPath $target -Destination $backup}
try{Move-Item -LiteralPath $source -Destination $target}catch{
  if((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $target)){Move-Item -LiteralPath $backup -Destination $target}
  throw
}
$published=[PSCustomObject]@{output=$target;executable=(Join-Path $target 'TFTBot.exe');version=$info.version;backup=$backup}
$published | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\dist\desktop-package.json') -Encoding utf8
if($Restart){
  $env:TFTBOT_MONITOR_DIR=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\dist\live-monitor'))
  Start-Process -FilePath (Join-Path $target 'TFTBot.exe') -ArgumentList @('--reader','--overlay','--background') -WorkingDirectory (Split-Path $releaseRoot) -WindowStyle Hidden
}
[PSCustomObject]@{Version=$info.version;Executable=(Join-Path $target 'TFTBot.exe');Backup=$backup;Restarted=[bool]$Restart} | ConvertTo-Json
