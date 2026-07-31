[CmdletBinding()]
param(
  [string]$EnvFile = ".env.docker",
  [string]$ComposeFile = "compose.yaml"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot $EnvFile
$composePath = Join-Path $projectRoot $ComposeFile
$requiredVariables = @(
  "POSTGRES_PASSWORD",
  "JWT_SECRET",
  "SEED_ADMIN_PASSWORD",
  "SEED_POLICE_PASSWORD",
  "SEED_CITIZEN_PASSWORD",
  "AI_SERVICE_API_KEY"
)

function Write-Check([string]$Label, [bool]$Passed, [string]$Detail) {
  $state = if ($Passed) { "PASS" } else { "FAIL" }
  Write-Host "[$state] $Label - $Detail"
}

function Write-Info([string]$Label, [string]$Detail) {
  Write-Host "[INFO] $Label - $Detail"
}

function Read-EnvNames([string]$Path) {
  $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    if (-not [string]::IsNullOrWhiteSpace($Matches[2])) {
      [void]$names.Add($Matches[1])
    }
  }
  return $names
}

Write-Host "RakshakAI Docker preflight (read-only)"

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  Write-Check ".env.docker" $false "required file is missing"
  exit 1
}
Write-Check ".env.docker" $true "file exists"

$definedNames = Read-EnvNames $envPath
$missingVariables = @($requiredVariables | Where-Object { -not $definedNames.Contains($_) })
if ($missingVariables.Count) {
  Write-Check "required variables" $false ("missing names: " + ($missingVariables -join ", "))
} else {
  Write-Check "required variables" $true "all required names are present and non-empty; values were not printed"
}

$dockerAvailable = $false
try {
  docker info --format '{{.ServerVersion}}' *> $null
  $dockerAvailable = $LASTEXITCODE -eq 0
} catch {
  $dockerAvailable = $false
}
Write-Check "Docker daemon" $dockerAvailable $(if ($dockerAvailable) { "available" } else { "unavailable; Docker Desktop was not started" })

$occupiedPorts = @()
foreach ($port in 3000, 5000, 8000) {
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if (-not $listeners.Count) {
    Write-Check "port $port" $true "available"
    continue
  }
  $occupiedPorts += $port
  $owners = foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process) { "PID $($process.Id) ($($process.ProcessName))" } else { "PID $($listener.OwningProcess)" }
  }
  Write-Check "port $port" $false ("occupied by " + (($owners | Sort-Object -Unique) -join ", "))
}

if ($dockerAvailable) {
  $volumeNames = @(docker volume ls --format '{{.Name}}' 2>$null)
  $postgresVolumes = @($volumeNames | Where-Object { $_ -match '(^|_)postgres-data$' })
  Write-Check "PostgreSQL volume" ($postgresVolumes.Count -gt 0) $(if ($postgresVolumes.Count) { "persistent volume exists" } else { "no existing RakshakAI postgres-data volume found" })
} else {
  Write-Info "PostgreSQL volume" "not inspectable while Docker daemon is unavailable"
}

$osrmHostPath = Join-Path $projectRoot "docker\osrm-data"
$osrmBaseName = "region.osrm"
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^\s*OSRM_DATA_HOST_PATH\s*=(.+)\s*$') { $osrmHostPath = $Matches[1].Trim() }
  if ($line -match '^\s*OSRM_DATA_PATH\s*=(.+)\s*$') { $osrmBaseName = Split-Path -Leaf $Matches[1].Trim() }
}
$osrmRequired = @("", ".partition", ".cells", ".mldgr")
$osrmMissing = @($osrmRequired | Where-Object { -not (Test-Path -LiteralPath (Join-Path $osrmHostPath "$osrmBaseName$_") -PathType Leaf) })
if ($osrmMissing.Count) {
  Write-Info "OSRM regional data" "optional profile is not ready; prepared files are missing"
} else {
  Write-Check "OSRM regional data" $true "prepared MLD files found"
}

$composeValid = $false
try {
  docker compose --env-file $envPath -f $composePath config --quiet
  $composeValid = $LASTEXITCODE -eq 0
} catch {
  $composeValid = $false
}
Write-Check "Compose config" $composeValid $(if ($composeValid) { "valid" } else { "validation failed" })

if ($missingVariables.Count -or $occupiedPorts.Count -or -not $dockerAvailable -or -not $composeValid) { exit 1 }
