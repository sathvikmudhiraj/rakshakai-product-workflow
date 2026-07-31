param(
  [string]$DataPath = $env:OSRM_DATA_HOST_PATH,
  [string]$PbfFile = "region.osm.pbf",
  [string]$Image = "osrm/osrm-backend:v5.27.1",
  [ValidateSet("car")]
  [string]$Profile = "car"
)

$ErrorActionPreference = "Stop"

if (-not $DataPath) {
  $DataPath = "D:\rakshak-gis\osrm-data"
}

$resolved = Resolve-Path -LiteralPath $DataPath -ErrorAction SilentlyContinue
if (-not $resolved) {
  throw "OSRM data folder does not exist: $DataPath"
}

$hostDataPath = $resolved.Path
$pbfPath = Join-Path $hostDataPath $PbfFile
if (-not (Test-Path -LiteralPath $pbfPath)) {
  throw "Regional .osm.pbf file not found: $pbfPath"
}

$containerPbf = "/data/$PbfFile"
$containerBase = $containerPbf -replace "\.osm\.pbf$", ".osrm"
if ($containerBase -eq $containerPbf) {
  throw "PBF file must end with .osm.pbf"
}

Write-Host "Preparing OSRM data in: $hostDataPath"
Write-Host "Using source extract: $PbfFile"

docker run --rm -v "${hostDataPath}:/data" $Image osrm-extract -p "/opt/$Profile.lua" $containerPbf
docker run --rm -v "${hostDataPath}:/data" $Image osrm-partition $containerBase
docker run --rm -v "${hostDataPath}:/data" $Image osrm-customize $containerBase

Write-Host ""
Write-Host "OSRM data prepared:"
Write-Host "  $($containerBase -replace '^/data/', '')"
Write-Host ""
Write-Host "Use in .env.docker:"
Write-Host "  OSRM_DATA_HOST_PATH=$hostDataPath"
Write-Host "  OSRM_DATA_PATH=$containerBase"
