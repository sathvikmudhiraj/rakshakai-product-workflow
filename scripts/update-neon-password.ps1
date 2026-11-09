param()

$ErrorActionPreference = "Stop"
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) "backend/.env"

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
  throw "backend/.env is missing; no file was changed."
}

$content = [System.IO.File]::ReadAllText($envPath)
$lines = [System.Text.RegularExpressions.Regex]::Split($content, "`r?`n")
$dbUrlLineIndexes = @()
for ($i = 0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '^\s*DATABASE_URL\s*=') { $dbUrlLineIndexes += $i }
}
if ($dbUrlLineIndexes.Count -ne 1) {
  throw "Expected exactly one DATABASE_URL assignment in backend/.env; no file was changed."
}

$lineIndex = $dbUrlLineIndexes[0]
if ($lines[$lineIndex] -notmatch '^(?<prefix>\s*DATABASE_URL\s*=\s*)(?<url>\S+)(?<suffix>\s*(?:#.*)?)$') {
  throw "DATABASE_URL format is not supported by this helper; no file was changed."
}

$currentUrl = $Matches.url
$linePrefix = $Matches.prefix
$lineSuffix = $Matches.suffix
$parsed = $null
if (-not [System.Uri]::TryCreate($currentUrl, [System.UriKind]::Absolute, [ref]$parsed) -or
    $parsed.Scheme -notin @("postgres", "postgresql") -or
    -not $parsed.Host.EndsWith(".neon.tech", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "DATABASE_URL does not identify a Neon PostgreSQL endpoint; no file was changed."
}

if ($currentUrl -notmatch '^(?<scheme>postgres(?:ql)?://)(?<userinfo>[^/@]+)@(?<rest>.+)$') {
  throw "DATABASE_URL authority format is unsupported; no file was changed."
}
$colon = $Matches.userinfo.IndexOf(':')
if ($colon -lt 1) {
  throw "DATABASE_URL has no username/password separator; no file was changed."
}
$scheme = $Matches.scheme
$username = $Matches.userinfo.Substring(0, $colon)
$rest = $Matches.rest

$securePassword = Read-Host "Enter the rotated Neon password (input is masked)" -AsSecureString
$bstr = [IntPtr]::Zero
$password = $null
try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrEmpty($password)) {
    throw "Password input was empty; no file was changed."
  }

  $encodedPassword = [System.Uri]::EscapeDataString($password)
  $updatedUrl = "$scheme$username`:$encodedPassword@$rest"
  $lines[$lineIndex] = "$linePrefix$updatedUrl$lineSuffix"
  $newContent = [string]::Join("`n", $lines)
  if ($content.Contains("`r`n")) { $newContent = $newContent.Replace("`n", "`r`n") }
  [System.IO.File]::WriteAllText($envPath, $newContent, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Updated backend/.env DATABASE_URL password. Credential value suppressed."
}
finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($securePassword) { $securePassword.Dispose() }
  $password = $null
  $encodedPassword = $null
  $updatedUrl = $null
}
