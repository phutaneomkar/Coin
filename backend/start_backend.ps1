# Script to start the backend server
# This script stops any existing backend processes first

Write-Host "🛑 Stopping any existing backend processes..." -ForegroundColor Yellow

# Stop processes on port 3001
$connections = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($connections) {
    $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($processId in $processIds) {
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "  Stopping process $processId ($($proc.ProcessName))..." -ForegroundColor Yellow
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

# Stop any crypto-backend processes
$backendProcs = Get-Process -Name "crypto-backend" -ErrorAction SilentlyContinue
if ($backendProcs) {
    foreach ($proc in $backendProcs) {
        Write-Host "  Stopping crypto-backend process $($proc.Id)..." -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}

# Also try to stop by executable path (in case process name is different)
$exePath = Join-Path $PSScriptRoot "target\debug\crypto-backend.exe"
if (Test-Path $exePath) {
    $exeProcs = Get-Process | Where-Object { $_.Path -eq $exePath } -ErrorAction SilentlyContinue
    if ($exeProcs) {
        foreach ($proc in $exeProcs) {
            Write-Host "  Stopping process $($proc.Id) from $exePath..." -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

Start-Sleep -Seconds 1

Write-Host "✅ All existing processes stopped" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Starting backend server..." -ForegroundColor Cyan
Write-Host ""

# Add cargo to PATH if not already there
if ($env:Path -notlike "*\.cargo\bin*") {
    $env:Path = "$env:Path;C:\Users\$env:USERNAME\.cargo\bin"
}

# Change to backend directory
Set-Location $PSScriptRoot

# Start the backend
cargo run

