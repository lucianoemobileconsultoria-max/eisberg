@echo off
chcp 65001 >nul
title EISBERG - Servidor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org ^(versao 18 ou superior^).
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=3000

echo ========================================================
echo EISBERG - Servidor Local
echo Conectado ao Supabase
echo App de Pedidos: http://localhost:%PORT%
echo Painel Admin:   http://localhost:%PORT%/admin.html
echo ========================================================
echo Feche esta janela para encerrar o servidor.
echo.

REM Abre o navegador apos 1.5 segundo
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

node server.js
pause
