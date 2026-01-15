# Complete Testing Commands - Quick Reference

## 🚀 Quick Setup (One Command)

```powershell
.\setup-and-run.ps1
```

This will:
- ✅ Find Brave browser automatically
- ✅ Install all dependencies
- ✅ Configure paths automatically
- ✅ Start both services
- ✅ Verify everything works

## 🔍 Manual Setup & Testing

### Step 1: Find Browser Paths
```powershell
.\find-brave-path.ps1
```
**Expected:** Shows your Brave executable and profile paths

### Step 2: Install Dependencies
```powershell
# Automation service
cd automation-service
npm install

# Frontend
cd ..\frontend
npm install
cd ..
```
**Expected:** No errors, `node_modules/` folders created

### Step 3: Start Services

**Terminal 1:**
```powershell
cd automation-service
npm start
```
**Expected output:**
```
═══════════════════════════════════════════════════════
🚀 Automation Service Started
═══════════════════════════════════════════════════════
📡 Listening on: http://localhost:4001
```

**Terminal 2:**
```powershell
cd frontend
npm run dev
```
**Expected output:**
```
VITE v5.0.0  ready in XXX ms
➜  Local:   http://localhost:5173/
```

## ✅ Verification Commands

### 1. Check Automation Service Health
```powershell
curl http://localhost:4001/health
```
**Expected:**
```json
{"status":"ok","timestamp":"2026-01-14T..."}
```

### 2. Check Automation Service Info
```powershell
(Invoke-WebRequest http://localhost:4001 -UseBasicParsing).Content | ConvertFrom-Json
```
**Expected:**
```json
{
  "status": "running",
  "service": "automation-service",
  "timestamp": "2026-01-14T..."
}
```

### 3. Check Frontend
```powershell
(Invoke-WebRequest http://localhost:5173 -UseBasicParsing).StatusCode
```
**Expected:** `200`

### 4. Run Full Test Suite
```powershell
.\test.ps1
```
**Expected:** All green checkmarks ✅

### 5. Test API Endpoint Directly
```powershell
# Replace paths with your actual paths from find-brave-path.ps1
$body = @{
    url = "https://meet.google.com/test-xxxx-xxx"
    braveExecutable = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
    userDataDir = "C:\Users\YourName\AppData\Local\BraveSoftware\Brave-Browser\User Data\Default"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:4001/api/meetings" -Method POST -ContentType "application/json" -Body $body
```
**Expected:**
```json
{
  "started": true,
  "pid": 12345,
  "log": "logs\\join-1737123456789-12345.log"
}
```
**And:** Brave browser window opens automatically

## 🧪 End-to-End Test

### Via Browser UI
1. Open browser: `http://localhost:5173`
2. Paste link: `https://meet.google.com/xxx-xxxx-xxx`
3. Click: "Join Meeting Now"
4. **Expected:**
   - Status shows "Joining meeting..."
   - Success message appears
   - Brave browser opens
   - Navigates to meeting
   - Camera/mic turn off
   - Clicks "Ask to join"

### Via PowerShell
```powershell
# Open the frontend
Start-Process "http://localhost:5173"
```

## 📊 Monitoring Commands

### Check if services are running
```powershell
# Check processes
Get-Process | Where-Object {$_.ProcessName -eq "node"} | Select-Object ProcessName, Id, StartTime

# Check ports
Get-NetTCPConnection -LocalPort 4001,5173 | Select-Object LocalPort, State
```

### View logs
```powershell
# List all log files
Get-ChildItem automation-service\logs

# View most recent log
Get-Content (Get-ChildItem automation-service\logs -Filter "join-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName

# Watch logs in real-time
Get-Content (Get-ChildItem automation-service\logs -Filter "join-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName -Wait
```

### Check request logs
```powershell
Get-Content automation-service\logs\requests.log -Tail 10
```

## 🐛 Troubleshooting Commands

### Issue: Port already in use
```powershell
# Find what's using port 4001
Get-NetTCPConnection -LocalPort 4001 | Select-Object OwningProcess | Get-Process

# Find what's using port 5173
Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess | Get-Process

# Kill process by ID
Stop-Process -Id <PID>
```

### Issue: Can't find Brave
```powershell
# Check if Brave exists
Test-Path "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"

# Try to open Brave manually
& "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"

# Search for Brave
Get-ChildItem "C:\Program Files" -Recurse -Filter "brave.exe" -ErrorAction SilentlyContinue
```

### Issue: Configuration not working
```powershell
# Check current configuration in SchedulerForm.jsx
Select-String -Path frontend\src\pages\SchedulerForm.jsx -Pattern "braveExecutable|userDataDir"
```

### Issue: Services won't start
```powershell
# Check for errors in automation service
cd automation-service
node src\server.js

# Check for errors in frontend
cd frontend
npm run dev
```

## 🔄 Restart Commands

### Stop all services
```powershell
# Stop all Node processes (careful - stops ALL Node processes)
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Or stop specific jobs if using setup-and-run.ps1
Get-Job | Stop-Job | Remove-Job
```

### Restart automation service
```powershell
# Stop existing
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {$_.Path -like "*automation-service*"} | Stop-Process

# Start new
cd automation-service
npm start
```

### Restart frontend
```powershell
# In the terminal running frontend, press Ctrl+C, then:
npm run dev
```

## 🧹 Cleanup Commands

### Clear logs
```powershell
Remove-Item automation-service\logs\*.log -Force
Remove-Item logs\*.log -Force -ErrorAction SilentlyContinue
```

### Clear node_modules (if reinstalling)
```powershell
Remove-Item automation-service\node_modules -Recurse -Force
Remove-Item frontend\node_modules -Recurse -Force
```

### Full reset
```powershell
# Stop services
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Clear dependencies
Remove-Item automation-service\node_modules -Recurse -Force
Remove-Item frontend\node_modules -Recurse -Force

# Clear logs
Remove-Item automation-service\logs\*.log -Force -ErrorAction SilentlyContinue

# Reinstall
cd automation-service; npm install; cd ..
cd frontend; npm install; cd ..
```

## 📈 Performance Testing

### Measure API response time
```powershell
Measure-Command {
    Invoke-WebRequest -Uri "http://localhost:4001/health" -UseBasicParsing
}
```
**Expected:** < 100ms

### Check memory usage
```powershell
Get-Process -Name node | Select-Object ProcessName, Id, @{Name="Memory(MB)";Expression={[math]::Round($_.WS/1MB,2)}}
```

## ✅ Success Checklist

Run these commands in order to verify everything works:

```powershell
# 1. Health check
Write-Host "1. Automation Service Health:" -ForegroundColor Yellow
(Invoke-WebRequest http://localhost:4001/health -UseBasicParsing).Content

# 2. Frontend check
Write-Host "`n2. Frontend Status:" -ForegroundColor Yellow
(Invoke-WebRequest http://localhost:5173 -UseBasicParsing).StatusCode

# 3. Run test suite
Write-Host "`n3. Running Tests:" -ForegroundColor Yellow
.\test.ps1

# 4. Check processes
Write-Host "`n4. Node Processes:" -ForegroundColor Yellow
Get-Process -Name node | Select-Object ProcessName, Id

# 5. Check ports
Write-Host "`n5. Active Ports:" -ForegroundColor Yellow
Get-NetTCPConnection -LocalPort 4001,5173 | Select-Object LocalPort, State

Write-Host "`n✅ If all above passed, you're ready to go!" -ForegroundColor Green
Write-Host "Open http://localhost:5173 and test with a real meeting link" -ForegroundColor White
```

## 🎯 One-Liner Commands

```powershell
# Quick health check
(Invoke-WebRequest http://localhost:4001/health -UseBasicParsing).Content; (Invoke-WebRequest http://localhost:5173 -UseBasicParsing).StatusCode

# View latest log
Get-Content (Get-ChildItem automation-service\logs -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName -Tail 20

# Check all services status
@{Automation=(Invoke-WebRequest http://localhost:4001/health -UseBasicParsing -ErrorAction SilentlyContinue).StatusCode; Frontend=(Invoke-WebRequest http://localhost:5173 -UseBasicParsing -ErrorAction SilentlyContinue).StatusCode}
```

---

**Pro Tip:** Bookmark this file for quick reference! 🔖
