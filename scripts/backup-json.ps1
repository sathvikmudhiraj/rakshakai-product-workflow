[CmdletBinding()]
param(
  [string]$Source = "backend\data\db.json",
  [string]$DestinationDirectory = "backups"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot $Source
$backupDirectory = Join-Path $projectRoot $DestinationDirectory

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "JSON source file does not exist: $sourcePath"
}

if (-not (Test-Path -LiteralPath $backupDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $backupDirectory | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$backupPath = Join-Path $backupDirectory "db-$timestamp.json"
if (Test-Path -LiteralPath $backupPath) {
  throw "Refusing to overwrite existing backup: $backupPath"
}

Copy-Item -LiteralPath $sourcePath -Destination $backupPath
$backup = Get-Item -LiteralPath $backupPath
if ($backup.Length -le 0) {
  throw "Backup verification failed: copied file is empty"
}

Write-Host "Backup created and verified: $($backup.FullName)"
Write-Host "Backup size: $($backup.Length) bytes"
