<# =========================
   havn-debug.ps1
   Usage:  pwsh ./havn-debug.ps1
   ========================= #>

# ---- Config ----
$BaseUrl  = "https://api.havn.ie/api"
$AdminKey = "havn_8c1d6e0e5b9e4d7f"   # must match server ADMIN_KEY

# Use a raw .NET dictionary so headers don’t get mangled by PS
$Headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"
$Headers.Add("x-admin-key", $AdminKey)

# ---- Helpers ----
function Show-ErrorBody($ex) {
  $resp = $ex.Response
  if ($resp -and $resp.GetResponseStream()) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body   = $reader.ReadToEnd()
    Write-Host "❌ Error body:" $body -ForegroundColor Red
  } else {
    throw $ex
  }
}

function Get-Api($Path) {
  try {
    Invoke-RestMethod -Uri "$BaseUrl/$Path" -Headers $Headers
  } catch {
    Show-ErrorBody $_.Exception
  }
}

function Post-Api($Path, $Payload = @{}) {
  try {
    $json = ($Payload | ConvertTo-Json -Depth 10)
    Invoke-RestMethod -Uri "$BaseUrl/$Path" -Method POST -Headers $Headers -ContentType "application/json" -Body $json
  } catch {
    Show-ErrorBody $_.Exception
  }
}

# ---- 0) Sanity checks (public + auth) ----
Write-Host "`n=== Health ==="
Invoke-RestMethod -Uri "$BaseUrl/health" | ConvertTo-Json -Depth 5

Write-Host "`n=== Auth check (/debug/ping-db) ==="
Get-Api "debug/ping-db" | ConvertTo-Json -Depth 5

# ---- 1) Current DB state ----
Write-Host "`n=== List properties (before) ==="
Invoke-RestMethod -Uri "$BaseUrl/properties" | ConvertTo-Json -Depth 5

# ---- 2) Seed ONE record (server provides safe defaults) ----
Write-Host "`n=== Seed ONE ==="
# empty object is fine; server fills defaults (slug,title,price required server-side)
Post-Api "debug/seed-one" @{} | ConvertTo-Json -Depth 6

# ---- 3) Verify after seed ----
Write-Host "`n=== List properties (after) ==="
Invoke-RestMethod -Uri "$BaseUrl/properties" | ConvertTo-Json -Depth 6

# ---- 4) Optional: seed many (idempotent-ish demo data) ----
# Write-Host "`n=== Seed MANY (optional) ==="
# Post-Api "debug/seed" @{} | ConvertTo-Json -Depth 6

# ---- 5) Inspect columns for a table (to debug Prisma schema) ----
Write-Host "`n=== Columns for Property (debug) ==="
Get-Api "debug/columns/Property" | ConvertTo-Json -Depth 6

# ---- 6) Clear seeded data (cleanup) ----
Write-Host "`n=== Clear seed data ==="
Post-Api "debug/seed-clear" @{} | ConvertTo-Json -Depth 6

# ---- 7) Final state ----
Write-Host "`n=== List properties (final) ==="
Invoke-RestMethod -Uri "$BaseUrl/properties" | ConvertTo-Json -Depth 6
