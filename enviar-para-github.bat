@echo off
chcp 65001 >nul
title EISBERG - Enviar para o GitHub
cd /d "%~dp0"

echo ========================================================
echo Enviando projeto EISBERG para o GitHub...
echo Repositorio: https://github.com/lucianoemobileconsultoria-max/eisberg.git
echo ========================================================
echo.
echo Se uma janela do navegador ou do Git abrir solicitando login,
echo autorize com a conta: lucianoemobileconsultoria-max
echo.

git push -u origin main

if errorlevel 1 (
  echo.
  echo [!] Nao foi possivel concluir o envio automaticamente.
  echo     Verifique as instrucoes acima ou entre com suas credenciais.
) else (
  echo.
  echo ========================================================
  echo [V] SUCESSO! Todos os arquivos foram enviados!
  echo     Acesse: https://github.com/lucianoemobileconsultoria-max/eisberg
  echo ========================================================
)

echo.
pause

