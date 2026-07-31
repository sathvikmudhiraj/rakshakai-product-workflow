$ErrorActionPreference = "Stop"

docker compose --env-file .env.docker up --build -d

Write-Host ""
Write-Host "RakshakAI is running:"
Write-Host "  App:            http://localhost:3000"
Write-Host "  Backend health: http://localhost:5000/api/health"
Write-Host "  AI health:      http://localhost:8000/health"
Write-Host ""
Write-Host "Check containers:"
Write-Host "  docker compose --env-file .env.docker ps"
