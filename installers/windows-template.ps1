# =====================================================================================
#  WhatsApp -> video -> YouTube bot: one-file installer for Windows 10/11 (local desktop)
#
#  Right-click Start -> "Terminal" (or PowerShell), go to the folder with this file, run:
#      powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
#
#  It installs everything, then asks you only for your credentials (and explains where
#  to get each one). Safe to re-run: it updates the code and keeps your settings.
# =====================================================================================
$ErrorActionPreference = 'Stop'
$AppDir = Join-Path $env:USERPROFILE 'wa-video-bot'

function Say($t)  { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  [ok] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Die($t)  { Write-Host "  [x]  $t" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
              (Join-Path $env:USERPROFILE '.local\bin') + ';' +
              (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function WingetInstall($id, $name) {
  Write-Host "     installing $name ..." -ForegroundColor DarkGray
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null
  RefreshPath
}

function Main {
  # ---- run as administrator (needed for installing Docker and the firewall rule)
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host 'Asking for administrator rights (needed to install Docker and set a firewall rule)...'
    Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
  }
  Write-Host 'WhatsApp -> video -> YouTube bot installer (Windows)' -ForegroundColor White
  Write-Host "Install folder: $AppDir" -ForegroundColor DarkGray
  if (-not (Has 'winget')) { Die 'winget is missing. Install "App Installer" from the Microsoft Store, then run this again.' }
  RefreshPath

  # ---- 1. project files
  Say '1/6 Unpacking the bot'
  $tmp = Join-Path $env:TEMP ('wa-video-bot-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'bot.zip'
  [IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String(($script:Payload -replace '\s', '')))
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  Copy-Item -Path (Join-Path $tmp 'wa-video-bot\*') -Destination $AppDir -Recurse -Force
  Remove-Item $tmp -Recurse -Force
  Ok 'Code unpacked (your .env and data folder are kept)'

  # ---- 2. tools
  Say '2/6 Installing tools (Node.js, Git, ffmpeg, Poppler, Pandoc)'
  if (-not (Has 'node')) { WingetInstall 'OpenJS.NodeJS.LTS' 'Node.js' }
  if (-not (Has 'git'))  { WingetInstall 'Git.Git' 'Git (Claude Code needs Git Bash)' }
  if (-not (Has 'ffmpeg')) { WingetInstall 'Gyan.FFmpeg' 'ffmpeg' }
  if (-not (Has 'pdftotext')) { WingetInstall 'oschwartz10612.Poppler' 'Poppler (PDF text)' }
  if (-not (Has 'pandoc')) { WingetInstall 'JohnMacFarlane.Pandoc' 'Pandoc (Word files)' }
  if (-not (Has 'py')) { WingetInstall 'Python.Python.3.12' 'Python (for the free voices)' }
  RefreshPath
  foreach ($t in 'node', 'ffmpeg', 'ffprobe', 'pandoc', 'py') { if (-not (Has $t)) { Die "$t is still not found. Close this window, open a new terminal and run the installer again." } }
  if (-not (Has 'pdftotext')) { Warn 'pdftotext not found: PDFs still work (Claude reads them directly), just slower.' }
  Ok ("Node " + (node -v))

  # ---- 3. Docker Desktop + Claude Code
  Say '3/6 Docker Desktop and Claude Code'
  # Docker Desktop needs WSL2, which needs these two Windows features
  $needReboot = $false
  foreach ($f in 'Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform') {
    $st = (Get-WindowsOptionalFeature -Online -FeatureName $f).State
    if ($st -ne 'Enabled') {
      Write-Host "     enabling Windows feature $f ..." -ForegroundColor DarkGray
      $r = Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart
      if ($r.RestartNeeded) { $needReboot = $true }
    }
  }
  if ($needReboot) {
    Warn 'Windows features for Docker (WSL2 / Virtual Machine Platform) were just enabled.'
    Write-Host '     RESTART your PC now, then run this installer again. It continues from here.' -ForegroundColor Yellow
    if ((Read-Host 'Restart now? (y/n)') -match '^y') { Restart-Computer -Force }
    exit 0
  }
  try { $ErrorActionPreference = 'Continue'; wsl --update *> $null } catch {} finally { $ErrorActionPreference = 'Stop' }
  $virt = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
  $hyper = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
  if (-not $virt -and -not $hyper) {
    Warn 'CPU virtualization looks DISABLED in BIOS. Docker cannot start until you enable it:'
    Write-Host '     restart -> open BIOS/UEFI (F2 / Del / F10 at boot) -> enable "Intel VT-x" or "AMD SVM / AMD-V" -> save.' -ForegroundColor Yellow
    Write-Host '     Check: Task Manager -> Performance -> CPU -> "Virtualization: Enabled".' -ForegroundColor Yellow
  }
  Ok 'WSL2 features enabled'
  $dockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Has 'docker') -and -not (Test-Path $dockerExe)) {
    WingetInstall 'Docker.DockerDesktop' 'Docker Desktop (large download)'
    Warn 'Docker Desktop was just installed. If Windows asks to restart, restart and run this installer again.'
  }
  if (Test-Path $dockerExe) { Start-Process $dockerExe -ErrorAction SilentlyContinue }
  Ok 'Docker Desktop installed (it is started now; first start can take a minute)'
  if (-not (Has 'claude')) {
    Write-Host '     installing Claude Code ...' -ForegroundColor DarkGray
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
    RefreshPath
  }
  if (-not (Has 'claude')) { Die 'Claude Code did not install. Open a new terminal and run the installer again.' }
  Ok 'Claude Code installed'

  # ---- 4. npm packages + browsers
  Say '4/6 Installing the bot packages and headless browsers (a few minutes)'
  Push-Location (Join-Path $AppDir 'orchestrator')
  npm install --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE) { Die 'npm install failed (orchestrator)' }
  npx --yes playwright install chromium; if ($LASTEXITCODE) { Die 'Playwright browser install failed' }
  Pop-Location
  Push-Location (Join-Path $AppDir 'video')
  npm install --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE) { Die 'npm install failed (video)' }
  npx --yes remotion browser ensure; if ($LASTEXITCODE) { Die 'Remotion browser install failed' }
  Pop-Location
  $venvPy = Join-Path $AppDir '.venv\Scripts\python.exe'
  if (-not (Test-Path $venvPy)) { py -3 -m venv (Join-Path $AppDir '.venv'); if ($LASTEXITCODE) { Die 'Could not create Python environment' } }
  & $venvPy -m pip install -q --upgrade pip edge-tts; if ($LASTEXITCODE) { Die 'Could not install edge-tts (free voices)' }
  Ok 'Packages, browsers and free voices (edge-tts) installed'

  # Docker containers reach the bot through host.docker.internal:3000 - allow only private ranges
  if (-not (Get-NetFirewallRule -DisplayName 'wa-video-bot (Docker to bot)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'wa-video-bot (Docker to bot)' -Direction Inbound -Protocol TCP -LocalPort 3000 `
      -RemoteAddress '127.0.0.1', '172.16.0.0/12', '192.168.0.0/16', '10.0.0.0/8' -Action Allow | Out-Null
  }
  Ok 'Firewall rule set (port 3000 only from this PC / Docker)'

  # ---- 5. wizard
  Say '5/6 Your settings and credentials'
  Push-Location (Join-Path $AppDir 'orchestrator')
  node scripts\wizard.js
  if ($LASTEXITCODE) { Pop-Location; Die 'Setup wizard did not finish. Run this installer again to continue.' }
  Pop-Location

  # ---- 6. background task
  Say '6/6 Running the bot in the background (starts when you log in)'
  $runner = Join-Path $AppDir 'run-bot.ps1'
  $nodeExe = (Get-Command node).Source
  @"
`$env:Path = '$env:Path'
Set-Location '$AppDir\orchestrator'
New-Item -ItemType Directory -Force -Path '$AppDir\data' | Out-Null
while (`$true) {
  & '$nodeExe' src\server.js 2>&1 | ForEach-Object { "`$_" } | Out-File -FilePath '$AppDir\data\bot.log' -Append -Encoding utf8
  Start-Sleep -Seconds 5
}
"@ | Set-Content -Path $runner -Encoding UTF8

  $taskName = 'wa-video-bot'
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Ok 'Bot started in the background'

  Push-Location (Join-Path $AppDir 'orchestrator')
  node scripts\wizard.js --test
  if ($LASTEXITCODE) { Warn "Self-test failed. Look at the log: Get-Content '$AppDir\data\bot.log' -Tail 50" }
  Pop-Location

  $sleep = Read-Host "`nThe bot only works while this PC is on and awake. Turn off sleep when plugged in? (y/n)"
  if ($sleep -match '^y') { powercfg /change standby-timeout-ac 0; Ok 'Sleep on AC power disabled' }

  Write-Host "`nAll done!" -ForegroundColor Green
  Write-Host "  - Send a script on WhatsApp to start. Send 'help' for commands."
  Write-Host "  - Docker Desktop must be running (enable 'Start Docker Desktop when you sign in' in its settings)."
  Write-Host "  - Log:              Get-Content '$AppDir\data\bot.log' -Wait"
  Write-Host "  - Change settings:  cd '$AppDir\orchestrator'; node scripts\wizard.js; then restart task 'wa-video-bot'"
  Write-Host "  - Update the bot:   run this installer again"
}

$script:Payload = @'
__PAYLOAD__
'@

Main
