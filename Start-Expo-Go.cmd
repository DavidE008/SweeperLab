@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul || (echo Install Node.js LTS, then reopen this launcher. & pause & exit /b 1)
call npm.cmd ci
if errorlevel 1 (pause & exit /b 1)
call npm.cmd run go
if errorlevel 1 pause
