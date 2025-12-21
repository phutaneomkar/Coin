# Script to update DATABASE_URL in .env file
# Usage: .\update_connection.ps1 "postgresql://postgres:password@host:5432/postgres"

param(
    [Parameter(Mandatory=$true)]
    [string]$ConnectionString,
    [Parameter(Mandatory=$false)]
    [string]$FallbackConnectionString
)

$envFile = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "❌ .env file not found at: $envFile"
    exit 1
}

Write-Host "📝 Updating DATABASE_URL in .env file..."
Write-Host ""

# Read current content
$content = Get-Content $envFile

# Update DATABASE_URL
$updated = $false
$newContent = $content | ForEach-Object {
    if ($_ -match '^DATABASE_URL=') {
        $updated = $true
        "DATABASE_URL=$ConnectionString"
    } else {
        $_
    }
}

if (-not $updated) {
    # DATABASE_URL not found, add it
    $newContent += "DATABASE_URL=$ConnectionString"
    Write-Host "✅ Added DATABASE_URL to .env file"
} else {
    Write-Host "✅ Updated DATABASE_URL in .env file"
}

if ($FallbackConnectionString -and $FallbackConnectionString.Trim().Length -gt 0) {
    $fallbackUpdated = $false
    $newContent = $newContent | ForEach-Object {
        if ($_ -match '^DATABASE_URL_FALLBACK=') {
            $fallbackUpdated = $true
            "DATABASE_URL_FALLBACK=$FallbackConnectionString"
        } else {
            $_
        }
    }

    if (-not $fallbackUpdated) {
        $newContent += "DATABASE_URL_FALLBACK=$FallbackConnectionString"
        Write-Host "✅ Added DATABASE_URL_FALLBACK to .env file"
    } else {
        Write-Host "✅ Updated DATABASE_URL_FALLBACK in .env file"
    }
}

# Write back to file
$newContent | Set-Content $envFile

Write-Host ""
Write-Host "✅ Done! Connection string updated."
Write-Host ""
Write-Host "Now test the connection:"
Write-Host "  cargo run --bin test_connection"
Write-Host ""
