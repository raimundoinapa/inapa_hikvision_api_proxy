@echo off
setlocal EnableExtensions
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo Este script necesita permisos de administrador.
    echo Click derecho ^> "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

echo Iniciando la tarea programada "CCTV Viewer"...
schtasks /run /tn "CCTV Viewer" >nul 2>&1
if errorlevel 1 goto :manual
goto :check

:manual
echo No se pudo iniciar la tarea. Se intentara el arranque manual con --watch.
powershell -NoProfile -Command "Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList '--watch','server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

:check
echo Esperando a que el servidor responda...
timeout /t 5 /nobreak >nul
curl.exe -s -k -o NUL -w "health: %%{http_code}\n" https://127.0.0.1:3000/health
echo.
echo Si el health no es 200, revise logs\cctv-viewer.log
pause
exit /b 0
