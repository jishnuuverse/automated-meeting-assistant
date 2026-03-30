/**
 * Configuration loader using dotenv.
 * Exports required credentials for Notion and Google Calendar.
 * Environment variables must be set in a .env file or the environment.
 */
require('dotenv').config();

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '';

// Google service account credentials for Calendar API.
// PRIVATE KEY in env should preserve newlines as literal `\n` sequences.
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || '';
let GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || '';
if (GOOGLE_PRIVATE_KEY && GOOGLE_PRIVATE_KEY.includes('\\n')) {
  GOOGLE_PRIVATE_KEY = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
}
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || '';

module.exports = {
  NOTION_API_KEY,
  NOTION_DATABASE_ID,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CALENDAR_ID,
};
