param(
  [string]$SourcePbf = (Join-Path $PSScriptRoot "..\docker\osrm-data\southern-zone-latest.osm.pbf"),
  [string]$StagePath = (Join-Path $PSScriptRoot "..\data\osrm-telangana-build"),
  [string]$OsrmImage = "ghcr.io/project-osrm/osrm-backend:v5.27.1",
  [string]$OsmiumImage = "ghcr.io/osmcode/osmium-tool:latest"
)

$ErrorActionPreference = "Stop"

# This box contains all of Telangana. It intentionally retains a small border
# around the state so roads near the boundary remain routable; it is not a
# claim that the source is a Telangana-only extract.
$telanganaBbox = "77.0,15.8,81.4,20.2"

if (-not (Test-Path -LiteralPath $SourcePbf -PathType Leaf)) {
  throw "OSM source PBF was not found: $SourcePbf"
}
if (Test-Path -LiteralPath $StagePath) {
  throw "Staging directory already exists and is preserved: $StagePath. Validate it or choose a new -StagePath; this script never overwrites a graph."
}

$stageParent = Split-Path -Parent $StagePath
New-Item -ItemType Directory -Force -Path $stageParent | Out-Null
$stageRoot = [IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $stageParent).Path)
$drive = Get-PSDrive -Name $stageRoot.TrimEnd(':', '\\')
if ($drive.Free -lt 6GB) {
  throw "At least 6 GB free disk space is required for a staged Telangana build; only $([math]::Round($drive.Free / 1GB, 2)) GB is free."
}

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker's Linux engine is unavailable. Start Docker Desktop, then rerun; no files were changed." }

$resolvedSource = (Resolve-Path -LiteralPath $SourcePbf).Path
$sourceDir = Split-Path -Parent $resolvedSource
$sourceName = Split-Path -Leaf $resolvedSource
New-Item -ItemType Directory -Path $StagePath | Out-Null
$resolvedStage = (Resolve-Path -LiteralPath $StagePath).Path

try {
  Write-Host "Creating a staged Telangana coverage extract from $sourceName"
  docker run --rm -v "${sourceDir}:/source:ro" -v "${resolvedStage}:/data" $OsmiumImage `
    osmium extract --bbox $telanganaBbox "/source/$sourceName" -o /data/telangana.osm.pbf
  if ($LASTEXITCODE -ne 0) { throw "osmium extract failed; the prior Hyderabad graph was not touched." }

  docker run --rm -v "${resolvedStage}:/data" $OsrmImage osrm-extract -p /opt/car.lua /data/telangana.osm.pbf
  if ($LASTEXITCODE -ne 0) { throw "osrm-extract failed; the prior Hyderabad graph was not touched." }
  docker run --rm -v "${resolvedStage}:/data" $OsrmImage osrm-partition /data/telangana.osrm
  if ($LASTEXITCODE -ne 0) { throw "osrm-partition failed; the prior Hyderabad graph was not touched." }
  docker run --rm -v "${resolvedStage}:/data" $OsrmImage osrm-customize /data/telangana.osrm
  if ($LASTEXITCODE -ne 0) { throw "osrm-customize failed; the prior Hyderabad graph was not touched." }

  $required = @("telangana.osrm.fileIndex", "telangana.osrm.edges", "telangana.osrm.geometry", "telangana.osrm.partition", "telangana.osrm.cells", "telangana.osrm.mldgr")
  foreach ($name in $required) {
    $file = Join-Path $resolvedStage $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -le 0) {
      throw "Required MLD artifact is missing or empty: $file"
    }
  }
} catch {
  Write-Error $_
  throw
}

Write-Host ""
Write-Host "Staged graph is ready; the working Hyderabad graph was not changed."
Write-Host "Validate it in an isolated container before switching Compose:"
Write-Host "  docker run --rm -p 127.0.0.1:5002:5000 -v `"${resolvedStage}:/data:ro`" $OsrmImage osrm-routed --algorithm mld /data/telangana.osrm"
Write-Host "  `$env:OSRM_URL='http://127.0.0.1:5002'; node scripts/osrm-telangana-acceptance.cjs"
Write-Host "After PASS, set OSRM_DATA_HOST_PATH=$resolvedStage and OSRM_DATA_PATH=/data/telangana.osrm in .env.docker, then start only the optional osrm profile."
