const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  try {
    // Arguments from server.js
    const meetUrl = process.argv[2];
    const braveExecutable = process.argv[3];
    const userDataDir = process.argv[4];

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Starting Meeting Join Process');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⏰ Time:', new Date().toISOString());

    if (!meetUrl || !braveExecutable || !userDataDir) {
      console.error('❌ Missing required arguments:');
      console.error('   meetUrl:', meetUrl ? '✓' : '✗');
      console.error('   braveExecutable:', braveExecutable ? '✓' : '✗');
      console.error('   userDataDir:', userDataDir ? '✓' : '✗');
      process.exit(1);
    }

    // Verify paths exist
    if (!fs.existsSync(braveExecutable)) {
      console.error('❌ Brave executable not found at:', braveExecutable);
      process.exit(1);
    }

    if (!fs.existsSync(userDataDir)) {
      console.error('❌ User data directory not found at:', userDataDir);
      process.exit(1);
    }

    console.log('✅ Configuration validated');
    console.log('🔗 Meeting URL:', meetUrl);
    console.log('📁 Profile:', userDataDir);
    console.log('🌐 Browser:', braveExecutable);
    console.log('');

    console.log('🚀 Launching browser...');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath: braveExecutable,
      permissions: ['camera', 'microphone'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--use-fake-ui-for-media-stream'
      ]
    });
    console.log('✅ Browser launched successfully');

    const page = await context.newPage();
    console.log('📄 New page created');

    console.log('🌐 Navigating to meeting:', meetUrl);
    await page.goto(meetUrl, { waitUntil: 'domcontentloaded' });
    console.log('✅ Page loaded');

    // Give Meet time to load
    console.log('⏳ Waiting for Google Meet to initialize...');
    await page.waitForTimeout(5000);

    console.log('🎤📹 Disabling camera and microphone...');
    
    // Turn off camera - using exact selector from Playwright codegen
    try {
      const cameraButton = page.getByRole('button', { name: 'Turn off camera' });
      await cameraButton.click({ timeout: 3000 });
      console.log('✅ Camera turned off');
      await page.waitForTimeout(500);
    } catch (err) {
      console.log('⚠️  Camera button not found or already off:', err.message);
      // Try keyboard shortcut as backup
      try {
        await page.keyboard.press('Control+KeyE');
        console.log('✅ Used Ctrl+E for camera');
        await page.waitForTimeout(500);
      } catch (e) {
        console.log('⚠️  Camera control failed');
      }
    }

    // Turn off microphone - using exact selector from Playwright codegen
    try {
      const micButton = page.getByRole('button', { name: 'Turn off microphone' });
      await micButton.click({ timeout: 3000 });
      console.log('✅ Microphone turned off');
      await page.waitForTimeout(500);
    } catch (err) {
      console.log('⚠️  Microphone button not found or already off:', err.message);
      // Try keyboard shortcut as backup
      try {
        await page.keyboard.press('Control+KeyD');
        console.log('✅ Used Ctrl+D for microphone');
        await page.waitForTimeout(500);
      } catch (e) {
        console.log('⚠️  Microphone control failed');
      }
    }

    // Ask to join - using exact selector from Playwright codegen
    console.log('🚪 Clicking "Ask to join"...');
    try {
      const joinButton = page.getByRole('button', { name: 'Ask to join' });
      await joinButton.click({ timeout: 5000 });
      console.log('✅ "Ask to join" button clicked');
    } catch (err) {
      console.log('⚠️  Join button not found:', err.message);
      // Try alternative text
      try {
        const altJoinButton = page.getByRole('button', { name: 'Join now' });
        await altJoinButton.click({ timeout: 3000 });
        console.log('✅ "Join now" button clicked');
      } catch (e) {
        console.log('⚠️  Could not click join button - you may need to click it manually');
      }
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Meeting join process completed');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⏰ Completed at:', new Date().toISOString());
    console.log('');
    console.log('💡 The browser window will remain open.');
    console.log('💡 You may need to wait for the host to admit you.');
    console.log('');

  } catch (err) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ FATAL ERROR');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(1);
  }
})();
