import { queueFollowUps, mailerConfig } from './autoMailer.js';
import { checkReplies } from './replies.js';
import { startHunt } from './hunter.js';

// Hourly: read the inbox first (so people who replied are not nagged), then queue the follow-ups that are due.
// Every 3 hours the Hacker News hunt runs by itself too, so new postings are picked up without pressing Start.
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

function autoHunt() {
  const r = startHunt();
  if (r.started) console.log('🔎 Auto-hunt started');
}

// Morning hunt: once every day from MORNING_HUNT_HOUR (India time, default 7) on, even if the server only wakes up later.
// Checked every 10 minutes, so a restart or a late wake-up cannot skip the day.
let lastMorning = '';
function morningHunt() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = ist.toISOString().slice(0, 10);
  const hour = Number(process.env.MORNING_HUNT_HOUR ?? 7);
  if (day === lastMorning || ist.getUTCHours() < hour) return;
  lastMorning = day;
  const r = startHunt();
  console.log(r.started ? '🌅 Morning hunt started' : '🌅 Morning hunt skipped, a hunt is already running');
}

export function startScheduler() {
  if (started) return;
  const c = mailerConfig();
  if (!c.enabled) return;
  started = true;
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
  setTimeout(autoHunt, 3 * 60 * 1000).unref();
  setInterval(autoHunt, 3 * 60 * 60 * 1000).unref();
  setTimeout(morningHunt, 4 * 60 * 1000).unref();
  setInterval(morningHunt, 10 * 60 * 1000).unref();
}

export const runTickNow = tick;
