# Instala o actualiza Kiosco Domingo en esta PC.
# - Primera vez: carga la imagen, arma el .env (clave JWT, comercio, administrador) y arranca.
# - Siguientes veces: carga la imagen nueva y reinicia, conservando datos y configuracion.
# (Sin tildes en los mensajes: PowerShell 5.1 no lee bien UTF-8 sin BOM.)

Set-Location $PSScriptRoot
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Salir($mensaje) {
  if ($mensaje) { Write-Host "`nERROR: $mensaje" -ForegroundColor Red }
  Read-Host "`nPresiona Enter para cerrar"
  exit 1
}

function Docker-Ok([string]$argumentos) {
  cmd /c "docker $argumentos >nul 2>&1"
  return $LASTEXITCODE -eq 0
}

function Leer-Clave($texto) {
  $segura = Read-Host $texto -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Poner-Valor([string[]]$lineas, $clave, $valor) {
  return $lineas | ForEach-Object { if ($_ -match "^$clave=") { "$clave=$valor" } else { $_ } }
}

Write-Host "=== Kiosco Domingo - Instalacion ===`n" -ForegroundColor Green

# 1. Docker Desktop tiene que estar abierto
if (-not (Docker-Ok "info")) {
  Salir "Docker Desktop no esta abierto. Abrilo, espera a que diga 'Engine running' y volve a ejecutar instalar.bat."
}

# 2. Cargar la imagen del sistema
if (Test-Path ".\kiosco-domingo.tar") {
  Write-Host "Cargando el sistema (puede tardar un minuto)..."
  cmd /c "docker load -i kiosco-domingo.tar"
  if ($LASTEXITCODE -ne 0) { Salir "No se pudo cargar kiosco-domingo.tar. Puede que el archivo este danado: volve a copiarlo." }
} elseif (-not (Docker-Ok "image inspect kiosco-domingo:latest")) {
  Salir "Falta el archivo kiosco-domingo.tar en esta carpeta."
}

# 3. Configuracion (solo la primera vez)
$primeraVez = -not (Test-Path ".\.env")
if ($primeraVez) {
  Write-Host "`nPrimera instalacion: vamos a configurar el sistema.`n" -ForegroundColor Cyan
  $lineas = [IO.File]::ReadAllLines("$PSScriptRoot\.env.ejemplo", $Utf8)

  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $lineas = Poner-Valor $lineas "JWT_SECRET" (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")

  $comercio = Read-Host "Nombre del comercio (aparece en el ticket)"
  if ($comercio) { $lineas = Poner-Valor $lineas "STORE_NAME" $comercio.Trim() }

  $usuario = Read-Host "Usuario administrador [admin]"
  if (-not $usuario) { $usuario = "admin" }
  if ($usuario -notmatch '^[a-zA-Z0-9._-]{3,64}$') { Salir "Usuario invalido: solo letras, numeros, punto, guion y guion bajo." }
  $lineas = Poner-Valor $lineas "ADMIN_USERNAME" $usuario

  while ($true) {
    $clave = Leer-Clave "Contrasena del administrador (minimo 10 caracteres)"
    if ($clave.Length -lt 10) { Write-Host "Muy corta, minimo 10 caracteres." -ForegroundColor Yellow; continue }
    if ($clave -match "[\s'`"#]") { Write-Host "No uses espacios, comillas ni #." -ForegroundColor Yellow; continue }
    if ((Leer-Clave "Repeti la contrasena") -ne $clave) { Write-Host "No coinciden, proba de nuevo." -ForegroundColor Yellow; continue }
    break
  }
  $lineas = Poner-Valor $lineas "ADMIN_PASSWORD" $clave
  [IO.File]::WriteAllLines("$PSScriptRoot\.env", $lineas, $Utf8)
}

# 4. Arrancar (o reiniciar con la version nueva)
Write-Host "`nIniciando Kiosco Domingo..."
cmd /c "docker compose up -d --force-recreate"
if ($LASTEXITCODE -ne 0) { Salir "No se pudo iniciar. Revisa que el puerto 4000 no lo use otro programa." }

$estado = ""
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  $estado = (cmd /c "docker inspect -f {{.State.Health.Status}} kiosco-domingo 2>nul").Trim()
  if ($estado -eq "healthy") { break }
}
if ($estado -ne "healthy") {
  Write-Host "`nUltimos mensajes del sistema:" -ForegroundColor Yellow
  cmd /c "docker logs --tail 15 kiosco-domingo"
  Salir "El sistema no arranco correctamente. Mandale estos mensajes a soporte."
}

# 5. El administrador ya existe: la contrasena no tiene que quedar guardada en el archivo
if ($primeraVez) {
  $lineas = Poner-Valor ([IO.File]::ReadAllLines("$PSScriptRoot\.env", $Utf8)) "ADMIN_PASSWORD" ""
  [IO.File]::WriteAllLines("$PSScriptRoot\.env", $lineas, $Utf8)
}

Write-Host "`nListo! Kiosco Domingo esta funcionando." -ForegroundColor Green
Write-Host "  En esta PC:          http://localhost:4000"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback' } |
  ForEach-Object { Write-Host "  Desde otra PC/caja:  http://$($_.IPAddress):4000" }
Write-Host "`nSe inicia solo cada vez que se abre Docker Desktop."

Start-Process "http://localhost:4000"
Read-Host "`nPresiona Enter para cerrar"
