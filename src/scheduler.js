import { queueFollowUps, mailerConfig } from './autoMailer.js';
import { checkReplies } from './replies.js';

// Hourly: read the inbox first (so people who replied are not nagged), then queue the follow-ups that are due.
// Needs the server to stay awake: the Render keep-alive in server.js pings it every 10 minutes.
let started = false;

async function tick() {
  try {
    await checkReplies();
    const n = queueFollowUps();
    if (n) console.log(`🔁 Queued ${n} follow-up(s)`);
  } catch (e) {
    console.error('Scheduler tick failed:', e.message);
  }
}

export function startScheduler() {
  if (started) return;
  const c = mailerConfig();
  if (!c.enabled) return;
  started = true;
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

export const runTickNow = tick;
