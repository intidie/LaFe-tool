# Prepara los recursos que se empaquetan dentro del instalador de LaFe Tool:
#   src-tauri/resources/engine    motor de render (engine/*.py compilado con PyInstaller, modo carpeta)
#   src-tauri/resources/ffmpeg    FFmpeg + FFprobe (build GPL con libass)
#   src-tauri/resources/exiftool  ExifTool para Windows (el mismo motor que usa ExifCleaner)
# Uso: powershell -ExecutionPolicy Bypass -File scripts/prepare-resources.ps1 [-Python python] [-Skip engine,ffmpeg,exiftool]
param(
  [string]$Python = "python",
  [string[]]$Skip = @()
)
$Skip = @($Skip | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() })
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$Res = Join-Path $Root "src-tauri/resources"
$Work = Join-Path $Root "build"
New-Item -ItemType Directory -Force $Work | Out-Null

$FFMPEG_URLS = @(
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip",
  "https://github.com/GyanD/codexffmpeg/releases/download/9.1/ffmpeg-9.1-essentials_build.zip"
)
# ExifCleaner fija ExifTool 13.59 (update_exiftool.pl); se usa la misma versión, build de 64 bits.
$EXIFTOOL_VERSION = "13.59"
$EXIFTOOL_URLS = @(
  "https://sourceforge.net/projects/exiftool/files/exiftool-${EXIFTOOL_VERSION}_64.zip/download",
  "https://exiftool.org/exiftool-${EXIFTOOL_VERSION}_64.zip"
)

function Get-File([string[]]$Urls, [string]$Out) {
  foreach ($u in $Urls) {
    for ($i = 1; $i -le 3; $i++) {
      try {
        Write-Host "  descargando $u"
        Invoke-WebRequest -UseBasicParsing -UserAgent "Wget" -Uri $u -OutFile $Out
        if ((Get-Item $Out).Length -gt 1MB) { return }
      } catch { Write-Host "  fallo: $($_.Exception.Message)" }
      Start-Sleep -Seconds (3 * $i)
    }
  }
  throw "No se pudo descargar $Out"
}

function Reset-Dir([string]$Dir) {
  if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
  New-Item -ItemType Directory -Force $Dir | Out-Null
  New-Item -ItemType File -Force (Join-Path $Dir ".gitkeep") | Out-Null
}

# 1) Motor de render ---------------------------------------------------------
if ($Skip -notcontains "engine") {
  Write-Host "[1/3] Motor de render (PyInstaller)"
  & $Python -m pip install --disable-pip-version-check -q -r (Join-Path $Root "engine/requirements.txt") pyinstaller==6.11.1
  if ($LASTEXITCODE) { throw "pip falló" }
  & $Python -m PyInstaller --noconfirm --clean --onedir --console --name lafe-engine `
      --distpath (Join-Path $Work "engine-dist") --workpath (Join-Path $Work "pyi") --specpath $Work `
      --collect-data edge_tts --collect-data certifi --hidden-import fontTools.ttLib `
      (Join-Path $Root "engine/engine.py")
  if ($LASTEXITCODE) { throw "PyInstaller falló" }
  $dst = Join-Path $Res "engine"
  Reset-Dir $dst
  Copy-Item -Recurse -Force (Join-Path $Work "engine-dist/lafe-engine/*") $dst
}

# 2) FFmpeg ------------------------------------------------------------------
if ($Skip -notcontains "ffmpeg") {
  Write-Host "[2/3] FFmpeg"
  $zip = Join-Path $Work "ffmpeg.zip"
  Get-File $FFMPEG_URLS $zip
  $x = Join-Path $Work "ffmpeg-x"
  if (Test-Path $x) { Remove-Item -Recurse -Force $x }
  Expand-Archive -Force $zip $x
  $bin = Get-ChildItem -Recurse -Directory $x | Where-Object { Test-Path (Join-Path $_.FullName "ffmpeg.exe") } | Select-Object -First 1
  $dst = Join-Path $Res "ffmpeg"
  Reset-Dir $dst
  New-Item -ItemType Directory -Force (Join-Path $dst "bin") | Out-Null
  Get-ChildItem $bin.FullName | Where-Object { $_.Name -ne "ffplay.exe" } | Copy-Item -Destination (Join-Path $dst "bin")
  $lic = Get-ChildItem -Recurse $x -Include "LICENSE*", "COPYING*" | Select-Object -First 1
  if ($lic) { Copy-Item $lic.FullName (Join-Path $dst "LICENSE-FFmpeg.txt") }
  & (Join-Path $dst "bin/ffmpeg.exe") -hide_banner -filters | Select-String -Quiet "ass " | Out-Null
}

# 3) ExifTool (motor de ExifCleaner) -----------------------------------------
if ($Skip -notcontains "exiftool") {
  Write-Host "[3/3] ExifTool $EXIFTOOL_VERSION"
  $zip = Join-Path $Work "exiftool.zip"
  Get-File $EXIFTOOL_URLS $zip
  $x = Join-Path $Work "exiftool-x"
  if (Test-Path $x) { Remove-Item -Recurse -Force $x }
  Expand-Archive -Force $zip $x
  $exe = Get-ChildItem -Recurse $x -Filter "exiftool*.exe" | Select-Object -First 1
  $dst = Join-Path $Res "exiftool"
  Reset-Dir $dst
  Copy-Item $exe.FullName (Join-Path $dst "exiftool.exe")
  Copy-Item -Recurse -Force (Join-Path $exe.DirectoryName "exiftool_files") $dst
  & (Join-Path $dst "exiftool.exe") -ver
  if ($LASTEXITCODE) { throw "ExifTool no arranca" }
}
Write-Host "Recursos listos en $Res"
