@echo off
setlocal EnableExtensions EnableDelayedExpansion

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo Este script necesita permisos de administrador.
    echo Click derecho ^> "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

echo Deteniendo la tarea programada "CCTV Viewer"...
schtasks /end /tn "CCTV Viewer" >nul 2>&1

echo Buscando el proceso que escucha en el puerto 3000...
set "FOUND="
set "LASTPID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    if not "%%P"=="!LASTPID!" (
        set "LASTPID=%%P"
        set "FOUND=1"
        echo Deteniendo PID %%P...
        taskkill /PID %%P /F >nul 2>&1
    )
)

if not defined FOUND (
    echo No hay ningun proceso escuchando en el puerto 3000.
) else (
    echo Listo.
)

echo.
echo Nota: solo se detuvo el proceso del puerto 3000.
echo Los demas procesos node.exe, como los de HikCentral, no se tocan.
pause
exit /b 0