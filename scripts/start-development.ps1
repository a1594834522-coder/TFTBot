param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$runtime=Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$mainFile=Join-Path $projectRoot 'dist\desktop\main.cjs'
$stableExe=Join-Path $projectRoot 'desktop-release\TFTBot-win32-x64\TFTBot.exe'
if(-not (Test-Path -LiteralPath $runtime)){throw 'Electron runtime missing; run npm ci first.'}
if(-not $SkipBuild){
  & npm.cmd run build:desktop
  if($LASTEXITCODE -ne 0){throw 'Development build failed; existing application was left running.'}
}
if(-not (Test-Path -LiteralPath $mainFile)){throw 'Development build is missing.'}
function Is-ProjectMain($process){
  $exe=[string]$process.ExecutablePath
  $line=[string]$process.CommandLine
  if($line -match '(?:^|\s)--type='){return $false}
  return ($exe -eq $stableExe) -or ($exe -eq $runtime -and $line.IndexOf($mainFile,[StringComparison]::OrdinalIgnoreCase) -ge 0)
}
# Build before replacing anything. Only this project's verified main instances
# are closed; Electron then shuts down its own readers and flushes their logs.
$existing=@(Get-CimInstance Win32_Process -Filter "Name = 'TFTBot.exe' OR Name = 'electron.exe'" | Where-Object {Is-ProjectMain $_})
foreach($candidate in $existing){
  $fresh=Get-CimInstance Win32_Process -Filter ('ProcessId='+$candidate.ProcessId)
  if(-not $fresh -or -not (Is-ProjectMain $fresh)){continue}
  $running=Get-Process -Id $fresh.ProcessId -ErrorAction SilentlyContinue
  if($running){[void]$running.CloseMainWindow();try{Wait-Process -Id $running.Id -Timeout 7 -ErrorAction Stop}catch{}}
  $fresh=Get-CimInstance Win32_Process -Filter ('ProcessId='+$candidate.ProcessId)
  if($fresh -and (Is-ProjectMain $fresh)){Stop-Process -Id $fresh.ProcessId -Force;Wait-Process -Id $fresh.ProcessId -Timeout 3 -ErrorAction SilentlyContinue}
}
$monitor=[IO.Path]::GetFullPath((Join-Path $projectRoot ('dist\live-monitor\dev-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))))
[void][IO.Directory]::CreateDirectory($monitor)
$env:TFTBOT_MONITOR_DIR=$monitor
$env:ELECTRON_RUN_AS_NODE=$null
$child=Start-Process -FilePath $runtime -ArgumentList @(('"{0}"' -f $mainFile),'--dev-monitor','--reader','--background') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $monitor 'console.stdout.log') -RedirectStandardError (Join-Path $monitor 'console.stderr.log') -PassThru
$record=[PSCustomObject]@{pid=$child.Id;development=$true;main=$mainFile;executable=$runtime;monitor=$monitor;startedAt=(Get-Date).ToString('o')}
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'dist\tonight-development.json') -Encoding utf8
$record | ConvertTo-Json
