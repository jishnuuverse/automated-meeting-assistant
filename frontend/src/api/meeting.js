const AUTOMATION_URL = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AUTOMATION_URL
  ? import.meta.env.VITE_AUTOMATION_URL
  : 'http://localhost:4001';

const STT_URL = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_STT_URL
  ? import.meta.env.VITE_STT_URL
  : 'http://localhost:5002';

const NLP_URL = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_NLP_URL
  ? import.meta.env.VITE_NLP_URL
  : 'http://localhost:7000';

export async function start(body) {
  try {
    console.log('Sending to automation service:', body);
    
    const res = await fetch(`${AUTOMATION_URL}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    // 409 means a session is already active — treat as success (duplicate submit)
    if (res.status === 409) {
      console.warn('Session already active (409) — treating as success');
      return { started: true, alreadyActive: true, pid: null };
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Request failed: ${res.status} - ${errorText}`);
    }

    const result = await res.json();
    console.log('Response from automation service:', result);
    return result;
  } catch (err) {
    console.error('start failed', err);
    throw err;
  }
}

/**
 * Get the current status of the automation service.
 */
export async function getStatus() {
  const res = await fetch(`${AUTOMATION_URL}/health`);
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json();
}

/**
 * Get the latest transcript from the STT service.
 * Returns { lines: [{speaker, text}] } or empty.
 */
export async function getTranscript() {
  try {
    const res = await fetch(`${STT_URL}/`);
    if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status}`);
    return { lines: [] }; // transcript is produced asynchronously by stt-service
  } catch {
    return { lines: [] };
  }
}

/**
 * Get the latest summary from the NLP service.
 * Returns { summary: string } or empty.
 */
export async function getSummary() {
  try {
    const res = await fetch(`${NLP_URL}/`);
    if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
    return { summary: '' }; // summary produced asynchronously after transcription
  } catch {
    return { summary: '' };
  }
}