# Arma el paquete para instalar Kiosco Domingo en otra PC:
#   kiosco-domingo-instalador.zip = imagen Docker exportada + archivos de instalador/
# Uso (desde la raiz del proyecto):  powershell -ExecutionPolicy Bypass -File scripts\crear-paquete.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$salida = "paquete-instalador"
$zip    = "kiosco-domingo-instalador.zip"

Write-Host "1/3 Construyendo la imagen con el codigo actual..."
cmd /c "docker compose build"
if ($LASTEXITCODE -ne 0) { throw "Fallo la construccion de la imagen" }

Write-Host "2/3 Exportando la imagen..."
if (Test-Path $salida) { Remove-Item $salida -Recurse -Force }
New-Item -ItemType Directory $salida | Out-Null
cmd /c "docker save -o $salida\kiosco-domingo.tar kiosco-domingo:latest"
if ($LASTEXITCODE -ne 0) { throw "Fallo docker save" }
Copy-Item "instalador\*" $salida -Force

Write-Host "3/3 Comprimiendo..."
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$salida\*" -DestinationPath $zip

$mb = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host "Listo: $zip ($mb MB). Mandalo a la otra PC y segui instalador\LEEME.txt."
