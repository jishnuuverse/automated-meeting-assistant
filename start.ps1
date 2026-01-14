# Quick Start Script
# This script helps you start both services easily

param(
    [switch]$AutomationOnly,
    [switch]$FrontendOnly,
    [switch]$Check
)

function Start-AutomationService {
    Write-Host "Starting Automation Service..." -ForegroundColor Cyan
    Push-Location automation-service
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm start"
    Pop-Location
    Start-Sleep -Seconds 2
}

function Start-Frontend {
    Write-Host "Starting Frontend..." -ForegroundColor Cyan
    Push-Location frontend
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev"
    Pop-Location
    Start-Sleep -Seconds 2
}

function Check-Services {
    Write-Host "`nChecking services..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    
    try {
        $autoResponse = Invoke-WebRequest -Uri "http://localhost:4001/health" -UseBasicParsing
        Write-Host "✅ Automation Service: Running" -ForegroundColor Green
    } catch {
        Write-Host "❌ Automation Service: Not responding" -ForegroundColor Red
    }
    
    try {
        $frontResponse = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
        Write-Host "✅ Frontend: Running (http://localhost:5173)" -ForegroundColor Green
    } catch {
        Write-Host "❌ Frontend: Not responding" -ForegroundColor Red
    }
}

# Main execution
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Automated Meeting Assistant Launcher" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if ($Check) {
    Check-Services
    exit
}

if ($AutomationOnly) {
    Start-AutomationService
    Check-Services
} elseif ($FrontendOnly) {
    Start-Frontend
    Check-Services
} else {
    # Start both
    Write-Host "Starting both services..." -ForegroundColor Yellow
    Write-Host ""
    
    Start-AutomationService
    Start-Frontend
    Check-Services
    
    Write-Host ""
    Write-Host "=======================================" -ForegroundColor Cyan
    Write-Host "Both services started!" -ForegroundColor Green
    Write-Host "=======================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Open http://localhost:5173 in your browser" -ForegroundColor White
    Write-Host "2. Make sure you've configured Brave paths (run .\find-brave-path.ps1)" -ForegroundColor White
    Write-Host "3. Paste a Google Meet link and test!" -ForegroundColor White
    Write-Host ""
    Write-Host "To stop services: Close the PowerShell windows that opened" -ForegroundColor Gray
    Write-Host ""
}
