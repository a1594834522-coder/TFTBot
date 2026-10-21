@echo off
cd /d "%~dp0"
set "TFTBOT_MONITOR_DIR=%~dp0dist\live-monitor"
if exist "%~dp0desktop-release\TFTBot-win32-x64\TFTBot.exe" (
  start "" "%~dp0desktop-release\TFTBot-win32-x64\TFTBot.exe"
  exit /b
)
call npm run start
if errorlevel 1 pause
