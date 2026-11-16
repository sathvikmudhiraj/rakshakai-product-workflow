# Prepares trusted, LAN-only HTTPS for a physical-device GIS field test.
# Generates a local mkcert certificate for this workstation's LAN address and prints
# the exact command to start the HTTPS dev server and the URL to open on the phone.
# Private keys and the local CA stay OUTSIDE this repository.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\prepare-device-https.ps1
# Requires: mkcert on PATH (https://github.com/FiloSottile/mkcert/releases)

$ErrorActionPreference = "Stop"

$certDir = "D:\rakshak-gis\device-https"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
  Write-Error @"
mkcert was not found on PATH. Install it (one-time, local machine only):
  1. Download the Windows binary from https://github.com/FiloSottile/mkcert/releases
  2. Place it in a folder on PATH (for example C:\Tools), rename to mkcert.exe
  3. Run this script again.
No public tunnel, port-forwarding, or internet exposure is used at any point.
"@
}

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual |
  Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
  Select-Object -First 1).IPAddress
if (-not $lanIp) { Write-Error "No LAN IPv4 address found; connect this workstation to the authorized test Wi-Fi/LAN first." }

Write-Host "Installing mkcert local CA on this workstation (required once)..."
& mkcert -install

$key = Join-Path $certDir "rakshakai-device-key.pem"
$cert = Join-Path $certDir "rakshakai-device-cert.pem"
Write-Host "Issuing certificate for LAN address $lanIp ..."
& mkcert -cert-file $cert -key-file $key "$lanIp" "rakshakai.device.local"

Write-Host ""
Write-Host "=================================================="
Write-Host "Certificate:  $cert"
Write-Host "Private key:  $key   (keep outside the repository; do not commit)"
Write-Host ""
Write-Host "Start the HTTPS dev server (PowerShell):"
Write-Host ('  $env:VITE_DEV_HTTPS_KEY="' + $key + '"')
Write-Host ('  $env:VITE_DEV_HTTPS_CERT="' + $cert + '"')
Write-Host "  npm --prefix frontend run dev"
Write-Host ""
Write-Host "On the phone (same authorized Wi-Fi/LAN), open:"
Write-Host "  https://$lanIp`:3000"
Write-Host ""
Write-Host "One-time phone step: install the mkcert root CA (mkcert -install shows its"
Write-Host "location; copy rootCA.pem to the phone and trust it), or accept nothing -"
Write-Host "never bypass a certificate warning. Verify the certificate shows as valid"
Write-Host "before granting location permission."
Write-Host "=================================================="
