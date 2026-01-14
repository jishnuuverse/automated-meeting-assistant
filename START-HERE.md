# 🎯 QUICK START - Read This First!

## Want to test if everything works? Run these 3 commands:

### 1️⃣ Automatic Setup (Recommended)
```powershell
.\setup-and-run.ps1
```
This does everything for you! Then skip to step 3.

### 2️⃣ Manual Setup (If automatic fails)

**Find your browser paths:**
```powershell
.\find-brave-path.ps1
```
Copy the output and update `frontend\src\pages\SchedulerForm.jsx` lines 27-28

**Install & Start:**
```powershell
# Terminal 1
cd automation-service
npm install
npm start

# Terminal 2 (open new terminal)
cd frontend
npm install
npm run dev
```

### 3️⃣ Test It!
```powershell
.\test.ps1
```

If you see all ✅ green checkmarks, open http://localhost:5173 and paste a Google Meet link!

---

## 📚 Need More Help?

- **Setup Issues**: See [SETUP.md](SETUP.md)
- **Testing**: See [TESTING.md](TESTING.md) or [COMMANDS.md](COMMANDS.md)
- **Overview**: See [README.md](README.md)

## 🎯 What This Does

Paste any Google Meet link → Click button → Browser automatically joins meeting with camera/mic off

That's it! No scheduling, no account selection, no time checks. Just instant join.

---

**Still stuck? Check the logs:**
```powershell
Get-Content automation-service\logs\*.log | Select-Object -Last 50
```
