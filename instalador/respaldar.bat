@echo off
rem Copia la base de datos (ventas, productos, usuarios) a la carpeta "respaldos".
setlocal
cd /d "%~dp0"
if not exist respaldos mkdir respaldos
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set FECHA=%%i
docker cp kiosco-domingo:/app/data/pos.db "respaldos\pos_%FECHA%.db"
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo copiar. Revisa que Docker Desktop y el sistema esten funcionando.
) else (
  echo.
  echo Respaldo guardado en respaldos\pos_%FECHA%.db
  echo Guardalo tambien fuera de esta PC: pendrive o Google Drive.
)
pause
