const AUTOMATION_URL = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AUTOMATION_URL
  ? import.meta.env.VITE_AUTOMATION_URL
  : 'http://localhost:4001';

export async function start(body) {
  try {
    console.log('Sending to automation service:', body); // ADD THIS
    
    const res = await fetch(`${AUTOMATION_URL}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text(); // Get error details
      throw new Error(`Request failed: ${res.status} - ${errorText}`);
    }

    const result = await res.json();
    console.log('Response from automation service:', result); // ADD THIS
    return result;
  } catch (err) {
    console.error('start failed', err);
    throw err;
  }
}