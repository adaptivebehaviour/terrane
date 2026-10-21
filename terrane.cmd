@echo off
rem Starts the desktop application in development mode: double-click this file.
rem Needs Node.js on the PATH and `npm install` already run (the project scaffold does that).
cd /d "%~dp0"
if errorlevel 1 (pause & exit /b 1)
call npm run dev
if errorlevel 1 pause
