$ErrorActionPreference = "Stop"

$path = Join-Path $PSScriptRoot "prisma/schema.prisma"
$backup = Join-Path $PSScriptRoot "prisma/schema.prisma.before-expiry-email-fields"

if (-not (Test-Path $path)) {
  throw "Cannot find prisma/schema.prisma. Put this script in the havn-new project folder."
}

$content = [System.IO.File]::ReadAllText($path)
[System.IO.File]::WriteAllText($backup, $content, [System.Text.UTF8Encoding]::new($false))

if (-not $content.Contains("expiryWarningSentAt")) {
  $fieldAnchor = "  listingExpiresAt        DateTime?"
  if (-not $content.Contains($fieldAnchor)) {
    throw "Could not find listingExpiresAt in the Property model. No changes were written."
  }

  $newFields = $fieldAnchor + [Environment]::NewLine +
    "  expiryWarningSentAt    DateTime?" + [Environment]::NewLine +
    "  expiredEmailSentAt     DateTime?"
  $content = $content.Replace($fieldAnchor, $newFields)
}

if (-not $content.Contains("@@index([expiryWarningSentAt])")) {
  $indexAnchor = "  @@index([listingExpiresAt])"
  if (-not $content.Contains($indexAnchor)) {
    throw "Could not find the listingExpiresAt index. No changes were written."
  }

  $newIndexes = $indexAnchor + [Environment]::NewLine +
    "  @@index([expiryWarningSentAt])" + [Environment]::NewLine +
    "  @@index([expiredEmailSentAt])"
  $content = $content.Replace($indexAnchor, $newIndexes)
}

[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host "Success: expiry email tracking fields were added to prisma/schema.prisma." -ForegroundColor Green
Write-Host "Backup created at prisma/schema.prisma.before-expiry-email-fields"
Write-Host "Next run: npx prisma migrate dev --name add_listing_expiry_email_tracking"
