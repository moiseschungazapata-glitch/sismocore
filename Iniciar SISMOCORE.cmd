@echo off
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js LTS con npm y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node scripts\dev.mjs
pause
