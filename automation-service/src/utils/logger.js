'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

/**
 * Create a structured logger scoped to a component name.
 * Sensitive fields (tokens, passwords, keys) are automatically redacted.
 *
 * @param {string} component - Tag for the log source (e.g. "GoogleMeetAdapter").
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
function createLogger(component) {
  const SENSITIVE_KEYS = /token|password|secret|key|authorization|credential/i;

  function redact(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) return obj.map(redact);

    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      clean[k] = SENSITIVE_KEYS.test(k) ? '***REDACTED***' : redact(v);
    }
    return clean;
  }

  function format(level, message, meta) {
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}] [${component}]`;
    if (meta !== undefined) {
      const safe = redact(meta);
      return `${prefix} ${message} ${typeof safe === 'string' ? safe : JSON.stringify(safe)}`;
    }
    return `${prefix} ${message}`;
  }

  return {
    debug(msg, meta) {
      if (LOG_LEVEL <= LEVELS.debug) console.debug(format('debug', msg, meta));
    },
    info(msg, meta) {
      if (LOG_LEVEL <= LEVELS.info) console.info(format('info', msg, meta));
    },
    warn(msg, meta) {
      if (LOG_LEVEL <= LEVELS.warn) console.warn(format('warn', msg, meta));
    },
    error(msg, meta) {
      if (LOG_LEVEL <= LEVELS.error) console.error(format('error', msg, meta));
    },
  };
}

module.exports = { createLogger };
