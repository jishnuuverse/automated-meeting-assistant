# Setup Guide for Automated Meeting Assistant

## Quick Start

### 1. Install Dependencies

**Automation Service:**
```powershell
cd automation-service
npm install
```

**Frontend:**
```powershell
cd frontend
npm install
```

### 2. Configure Brave Browser Paths

You need to update the browser paths in the frontend code to match your system.

**Edit:** `frontend\src\pages\SchedulerForm.jsx` (lines 27-28)

Replace these default paths:
```javascript
const braveExecutable = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const userDataDir = 'C:\\Users\\YourUsername\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Profile 1'
```

**To find your paths:**

1. **Brave Executable**: Usually at `C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`
   
2. **User Profile**: 
   - Type `brave://version` in Brave browser
   - Look for "Profile Path"
   - Example: `C:\Users\YourName\AppData\Local\BraveSoftware\Brave-Browser\User Data\Profile 1`

### 3. Start the Services

**Terminal 1 - Start Automation Service:**
```powershell
cd automation-service
npm start
```

You should see:
```
🚀 Automation Service Started
📡 Listening on: http://localhost:4001
```

**Terminal 2 - Start Frontend:**
```powershell
cd frontend
npm run dev
```

You should see:
```
Local: http://localhost:5173/
```

### 4. Test the Application

1. Open your browser and go to `http://localhost:5173`
2. Paste a Google Meet link (e.g., `https://meet.google.com/xxx-xxxx-xxx`)
3. Click "Join Meeting Now"
4. A Brave browser window should open and automatically join the meeting

## Testing Commands

### Check if Automation Service is Running
```powershell
curl http://localhost:4001/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-01-14T..."}
```

### Check if Frontend is Running
```powershell
curl http://localhost:5173
```

Should return HTML content.

### Test Join Meeting API Directly
```powershell
Invoke-WebRequest -Uri "http://localhost:4001/api/meetings" -Method POST -ContentType "application/json" -Body '{"url":"https://meet.google.com/test-link","braveExecutable":"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe","userDataDir":"C:\\Users\\YourName\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Profile 1"}'
```

Expected response:
```json
{"started":true,"pid":12345,"log":"logs\\join-...log"}
```

## Troubleshooting

### Issue: "Missing url/userDataDir/braveExecutable"
- Make sure you've updated the paths in `SchedulerForm.jsx`
- Verify the paths exist on your system

### Issue: Browser doesn't open
- Check that Brave is installed at the specified path
- Try opening Brave manually to ensure it works
- Check the logs in `automation-service/logs/` directory

### Issue: CORS errors
- Make sure automation service is running on port 4001
- Check that frontend is configured to use `http://localhost:4001`

### Issue: "Failed to join meeting"
- Check the browser console (F12) for detailed errors
- Check the automation service terminal for error messages
- Verify your Google account is logged into Brave

## How It Works

1. **Frontend** (`localhost:5173`): React app where you paste meeting links
2. **Automation Service** (`localhost:4001`): Express server that spawns browser automation
3. **Playwright**: Controls Brave browser to join Google Meet
4. **Flow**: 
   - User pastes link → Frontend sends to automation service → Service spawns Playwright → Browser joins meeting

## Next Steps

After successful setup:
- The browser will open with camera and mic off
- It will automatically click "Ask to join"
- You can manually approve from the meeting if needed
