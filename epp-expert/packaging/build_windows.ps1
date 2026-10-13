# Construction complète sous Windows 10/11 (PowerShell), depuis le dossier epp-expert :
#   powershell -ExecutionPolicy Bypass -File packaging\build_windows.ps1
# Prérequis : Python 3.13 64 bits, Inno Setup 6 (ISCC.exe dans le PATH ou à l'emplacement par défaut).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\pyinstaller --noconfirm --clean packaging\gestion_scolaire.spec
.\dist\GestionScolaireEPP\GestionScolaireEPP.exe --selftest --rapport selftest.txt | Out-Null
Get-Content selftest.txt
$iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) { $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" }
& $iscc packaging\installer.iss
Write-Host "Installateur : dist\GestionScolaireEPP-Setup-*.exe"
