$ErrorActionPreference = "Stop"

docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml up --build -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw "RakshakAI startup failed. Check container health and logs." }

$ports = @{
  FRONTEND_PORT = "3001"
  BACKEND_HOST_PORT = "5000"
  AI_SERVICE_HOST_PORT = "8000"
}
foreach ($line in Get-Content -LiteralPath ".env.docker") {
  if ($line -match '^\s*(FRONTEND_PORT|BACKEND_HOST_PORT|AI_SERVICE_HOST_PORT)\s*=\s*(\d{1,5})\s*$') {
    $ports[$Matches[1]] = $Matches[2]
  }
}

Write-Host ""
Write-Host "RakshakAI is running:"
Write-Host "  App:            http://localhost:$($ports.FRONTEND_PORT)"
Write-Host "  Backend health: http://localhost:$($ports.BACKEND_HOST_PORT)/api/health"
Write-Host "  AI health:      http://localhost:$($ports.AI_SERVICE_HOST_PORT)/health"
Write-Host ""
Write-Host "Check containers:"
Write-Host "  docker compose --env-file .env.docker ps"
