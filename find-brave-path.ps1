# Helper script to find Brave browser paths
# Run this to find the correct paths for your system

Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Brave Browser Path Finder" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Find Brave executable
Write-Host "[1] Looking for Brave executable..." -ForegroundColor Yellow
$possiblePaths = @(
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
)

$braveExe = $null
foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $braveExe = $path
        Write-Host "✅ Found Brave executable:" -ForegroundColor Green
        Write-Host "   $path" -ForegroundColor White
        break
    }
}

if (-not $braveExe) {
    Write-Host "❌ Could not find Brave executable" -ForegroundColor Red
    Write-Host "   Please install Brave browser or specify the path manually" -ForegroundColor Yellow
}
Write-Host ""

# Find Brave user data directories
Write-Host "[2] Looking for Brave user profiles..." -ForegroundColor Yellow
$userDataBase = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"

if (Test-Path $userDataBase) {
    Write-Host "✅ Found Brave User Data directory:" -ForegroundColor Green
    Write-Host "   $userDataBase" -ForegroundColor White
    Write-Host ""
    
    # List all profiles
    Write-Host "Available profiles:" -ForegroundColor Yellow
    $profiles = @()
    
    # Check default profile
    if (Test-Path "$userDataBase\Default") {
        $profiles += "Default"
        Write-Host "   - Default" -ForegroundColor White
    }
    
    # Check numbered profiles
    for ($i = 1; $i -le 10; $i++) {
        if (Test-Path "$userDataBase\Profile $i") {
            $profiles += "Profile $i"
            Write-Host "   - Profile $i" -ForegroundColor White
        }
    }
    
    if ($profiles.Count -eq 0) {
        Write-Host "   ⚠️  No profiles found" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "📝 Recommended profile to use:" -ForegroundColor Cyan
    if ($profiles.Count -gt 0) {
        $recommendedProfile = $profiles[0]
        $fullPath = "$userDataBase\$recommendedProfile"
        Write-Host "   $fullPath" -ForegroundColor White
    }
} else {
    Write-Host "❌ Could not find Brave User Data directory" -ForegroundColor Red
}
Write-Host ""

# Generate code snippet
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Copy this code to SchedulerForm.jsx" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

if ($braveExe -and $profiles.Count -gt 0) {
    $recommendedProfile = $profiles[0]
    $fullProfilePath = "$userDataBase\$recommendedProfile"
    
    # Escape backslashes for JavaScript
    $escapedExe = $braveExe -replace '\\', '\\'
    $escapedProfile = $fullProfilePath -replace '\\', '\\'
    
    Write-Host "// Update these lines in frontend\src\pages\SchedulerForm.jsx (around line 27-28):" -ForegroundColor Green
    Write-Host ""
    Write-Host "const braveExecutable = '$escapedExe'" -ForegroundColor White
    Write-Host "const userDataDir = '$escapedProfile'" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "⚠️  Could not generate code snippet. Please find paths manually." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Expected format:" -ForegroundColor Yellow
    Write-Host "const braveExecutable = 'C:\\\\Program Files\\\\BraveSoftware\\\\Brave-Browser\\\\Application\\\\brave.exe'" -ForegroundColor Gray
    Write-Host "const userDataDir = 'C:\\\\Users\\\\YourName\\\\AppData\\\\Local\\\\BraveSoftware\\\\Brave-Browser\\\\User Data\\\\Profile 1'" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "Additional Info" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To verify your profile path:" -ForegroundColor Yellow
Write-Host "1. Open Brave browser" -ForegroundColor White
Write-Host "2. Type 'brave://version' in the address bar" -ForegroundColor White
Write-Host "3. Look for 'Profile Path'" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  Important: Make sure you're logged into Google in Brave" -ForegroundColor Yellow
Write-Host "   The automation will use your logged-in session to join meetings" -ForegroundColor White
Write-Host ""
