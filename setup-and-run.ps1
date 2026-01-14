# Complete Setup and Verification Script
# Run this to set up and test everything in one go

Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Automated Meeting Assistant Setup" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Find Brave paths
Write-Host "[Step 1/5] Finding Brave Browser..." -ForegroundColor Yellow
Write-Host ""

$possiblePaths = @(
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
)

$braveExe = $null
foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $braveExe = $path
        break
    }
}

if ($braveExe) {
    Write-Host "✅ Found Brave: $braveExe" -ForegroundColor Green
} else {
    Write-Host "❌ Brave not found. Please install Brave browser." -ForegroundColor Red
    exit 1
}

$userDataBase = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"
$profilePath = $null

if (Test-Path $userDataBase) {
    if (Test-Path "$userDataBase\Default") {
        $profilePath = "$userDataBase\Default"
    } elseif (Test-Path "$userDataBase\Profile 1") {
        $profilePath = "$userDataBase\Profile 1"
    }
}

if ($profilePath) {
    Write-Host "✅ Found profile: $profilePath" -ForegroundColor Green
} else {
    Write-Host "❌ No Brave profile found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 2: Install dependencies
Write-Host "[Step 2/5] Installing Dependencies..." -ForegroundColor Yellow
Write-Host ""

Write-Host "Installing automation-service dependencies..." -ForegroundColor Gray
Push-Location automation-service
npm install --silent
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Automation service dependencies installed" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to install automation service dependencies" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "Installing frontend dependencies..." -ForegroundColor Gray
Push-Location frontend
npm install --silent
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Frontend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to install frontend dependencies" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host ""

# Step 3: Update configuration
Write-Host "[Step 3/5] Updating Configuration..." -ForegroundColor Yellow
Write-Host ""

$schedulerFile = "frontend\src\pages\SchedulerForm.jsx"
$content = Get-Content $schedulerFile -Raw

# Escape backslashes for JavaScript
$escapedExe = $braveExe -replace '\\', '\\'
$escapedProfile = $profilePath -replace '\\', '\\'

# Update the paths in the file
$pattern = "const braveExecutable = '[^']*'"
$replacement = "const braveExecutable = '$escapedExe'"
$content = $content -replace $pattern, $replacement

$pattern = "const userDataDir = '[^']*'"
$replacement = "const userDataDir = '$escapedProfile'"
$content = $content -replace $pattern, $replacement

Set-Content -Path $schedulerFile -Value $content

Write-Host "✅ Configuration updated in $schedulerFile" -ForegroundColor Green
Write-Host "   Brave: $braveExe" -ForegroundColor Gray
Write-Host "   Profile: $profilePath" -ForegroundColor Gray
Write-Host ""

# Step 4: Start services
Write-Host "[Step 4/5] Starting Services..." -ForegroundColor Yellow
Write-Host ""

Write-Host "Starting automation service..." -ForegroundColor Gray
Push-Location automation-service
$autoJob = Start-Job -ScriptBlock { 
    Set-Location $using:PWD
    npm start 
}
Pop-Location
Start-Sleep -Seconds 3

Write-Host "Starting frontend..." -ForegroundColor Gray
Push-Location frontend
$frontJob = Start-Job -ScriptBlock { 
    Set-Location $using:PWD
    npm run dev 
}
Pop-Location
Start-Sleep -Seconds 5

# Step 5: Verify services
Write-Host ""
Write-Host "[Step 5/5] Verifying Services..." -ForegroundColor Yellow
Write-Host ""

$autoRunning = $false
$frontRunning = $false

try {
    $response = Invoke-WebRequest -Uri "http://localhost:4001/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Automation Service: Running on port 4001" -ForegroundColor Green
        $autoRunning = $true
    }
} catch {
    Write-Host "❌ Automation Service: Not responding" -ForegroundColor Red
}

try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Frontend: Running on port 5173" -ForegroundColor Green
        $frontRunning = $true
    }
} catch {
    Write-Host "❌ Frontend: Not responding" -ForegroundColor Red
}

Write-Host ""

# Summary
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if ($autoRunning -and $frontRunning) {
    Write-Host "✅ All services are running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎉 Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Open http://localhost:5173 in your browser" -ForegroundColor White
    Write-Host "2. Paste a Google Meet link" -ForegroundColor White
    Write-Host "3. Click 'Join Meeting Now'" -ForegroundColor White
    Write-Host "4. Watch the magic happen! ✨" -ForegroundColor White
    Write-Host ""
    Write-Host "📝 Services are running in background jobs" -ForegroundColor Gray
    Write-Host "   To stop: Get-Job | Stop-Job | Remove-Job" -ForegroundColor Gray
} else {
    Write-Host "⚠️  Some services failed to start" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Manual start commands:" -ForegroundColor Yellow
    Write-Host "Terminal 1: cd automation-service; npm start" -ForegroundColor White
    Write-Host "Terminal 2: cd frontend; npm run dev" -ForegroundColor White
    
    # Clean up jobs
    Get-Job | Stop-Job | Remove-Job
}

Write-Host ""
Write-Host "📚 Documentation:" -ForegroundColor Cyan
Write-Host "   - README.md: Overview and quick start" -ForegroundColor White
Write-Host "   - TESTING.md: Testing commands" -ForegroundColor White
Write-Host "   - SETUP.md: Detailed setup guide" -ForegroundColor White
Write-Host ""
