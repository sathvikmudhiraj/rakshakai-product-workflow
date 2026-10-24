$ErrorActionPreference = "Stop"

docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml up --build -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw "RakshakAI startup failed. Check container health and logs." }

Write-Host ""
Write-Host "RakshakAI is running:"
Write-Host "  App:            http://localhost:3001"
Write-Host "  Backend health: http://localhost:5000/api/health"
Write-Host "  AI health:      http://localhost:8000/health"
Write-Host ""
Write-Host "Check containers:"
Write-Host "  docker compose --env-file .env.docker ps"
