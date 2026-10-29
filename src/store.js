import fs from 'fs';
import path from 'path';

// One record per address we mailed. Old sent.json files (email -> ISO date) are upgraded on load.
// Note: on Render's free tier the disk is wiped on restart, so follow-up and reply state resets too.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'sent.json');

let records = {};
try {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const [email, v] of Object.entries(raw)) {
    records[email] = typeof v === 'string' ? { at: v, sends: [v], status: 'sent', followUps: 0 } : v;
  }
} catch {
  records = {};
}

const save = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error('Could not persist sent log:', e.message);
  }
};

export const store = {
  get: (email) => records[email],
  has: (email) => Boolean(records[email]),
  all: () => Object.entries(records).map(([email, r]) => ({ email, ...r })),

  // A mail was sent: remember it. patch can hold subject, role, company, postUrl, messageId...
  recordSend(email, patch = {}) {
    const now = new Date().toISOString();
    const r = records[email] || { at: now, sends: [], status: 'sent', followUps: 0 };
    r.sends = [...(r.sends || []), now];
    Object.assign(r, patch);
    records[email] = r;
    save();
    return r;
  },

  // Change state without sending: replied, bounced, invalid
  update(email, patch) {
    if (!records[email]) records[email] = { at: new Date().toISOString(), sends: [], status: 'sent', followUps: 0 };
    Object.assign(records[email], patch);
    save();
  },

  // Counts every mail sent today (first mails and follow-ups), used for the daily limit
  sentToday() {
    const today = new Date().toISOString().slice(0, 10);
    return Object.values(records).reduce((n, r) => n + (r.sends || []).filter((d) => d.startsWith(today)).length, 0);
  },

  stats() {
    const all = Object.values(records);
    const count = (fn) => all.filter(fn).length;
    return {
      contacted: count((r) => (r.sends || []).length > 0),
      replied: count((r) => r.replied),
      bounced: count((r) => r.bounced),
      invalid: count((r) => r.status === 'invalid'),
      followUpsSent: all.reduce((n, r) => n + (r.followUps || 0), 0),
    };
  },
};
