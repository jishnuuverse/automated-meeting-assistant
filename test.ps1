# Test Script for Automated Meeting Assistant
# Run this script to verify everything is working

Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Testing Automated Meeting Assistant" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if automation service is running
Write-Host "[Test 1] Checking Automation Service..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4001/health" -Method GET -UseBasicParsing
    $health = $response.Content | ConvertFrom-Json
    if ($health.status -eq "ok") {
        Write-Host "✅ Automation Service is running" -ForegroundColor Green
        Write-Host "   Status: $($health.status)" -ForegroundColor Gray
        Write-Host "   Timestamp: $($health.timestamp)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Automation Service returned unexpected status" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Automation Service is NOT running" -ForegroundColor Red
    Write-Host "   Please start it with: cd automation-service; npm start" -ForegroundColor Yellow
}
Write-Host ""

# Test 2: Check if frontend is running
Write-Host "[Test 2] Checking Frontend..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -Method GET -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Frontend is running" -ForegroundColor Green
        Write-Host "   URL: http://localhost:5173" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Frontend is NOT running" -ForegroundColor Red
    Write-Host "   Please start it with: cd frontend; npm run dev" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: Check automation service root endpoint
Write-Host "[Test 3] Checking Automation Service Info..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4001" -Method GET -UseBasicParsing
    $info = $response.Content | ConvertFrom-Json
    Write-Host "✅ Service Info Retrieved" -ForegroundColor Green
    Write-Host "   Service: $($info.service)" -ForegroundColor Gray
    Write-Host "   Status: $($info.status)" -ForegroundColor Gray
} catch {
    Write-Host "⚠️  Could not get service info" -ForegroundColor Yellow
}
Write-Host ""

# Test 4: Check if required files exist
Write-Host "[Test 4] Checking Required Files..." -ForegroundColor Yellow
$files = @(
    "automation-service\src\server.js",
    "automation-service\src\joinMeeting.js",
    "automation-service\package.json",
    "frontend\src\App.jsx",
    "frontend\src\pages\SchedulerForm.jsx",
    "frontend\src\api\meeting.js"
)

$allFilesExist = $true
foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "✅ $file" -ForegroundColor Green
    } else {
        Write-Host "❌ $file NOT FOUND" -ForegroundColor Red
        $allFilesExist = $false
    }
}
Write-Host ""

# Test 5: Check if node_modules exist
Write-Host "[Test 5] Checking Dependencies..." -ForegroundColor Yellow
if (Test-Path "automation-service\node_modules") {
    Write-Host "✅ Automation service dependencies installed" -ForegroundColor Green
} else {
    Write-Host "❌ Automation service dependencies NOT installed" -ForegroundColor Red
    Write-Host "   Run: cd automation-service; npm install" -ForegroundColor Yellow
}

if (Test-Path "frontend\node_modules") {
    Write-Host "✅ Frontend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "❌ Frontend dependencies NOT installed" -ForegroundColor Red
    Write-Host "   Run: cd frontend; npm install" -ForegroundColor Yellow
}
Write-Host ""

# Test 6: Check logs directory
Write-Host "[Test 6] Checking Logs Directory..." -ForegroundColor Yellow
if (Test-Path "automation-service\logs") {
    $logFiles = Get-ChildItem "automation-service\logs" -File
    Write-Host "✅ Logs directory exists" -ForegroundColor Green
    Write-Host "   Log files: $($logFiles.Count)" -ForegroundColor Gray
} else {
    Write-Host "⚠️  Logs directory doesn't exist yet (will be created on first run)" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan

if ($allFilesExist) {
    Write-Host "✅ All files present" -ForegroundColor Green
} else {
    Write-Host "❌ Some files are missing" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Make sure both services are running (see test results above)" -ForegroundColor White
Write-Host "2. Open http://localhost:5173 in your browser" -ForegroundColor White
Write-Host "3. Update browser paths in frontend\src\pages\SchedulerForm.jsx" -ForegroundColor White
Write-Host "4. Paste a Google Meet link and test!" -ForegroundColor White
Write-Host ""
