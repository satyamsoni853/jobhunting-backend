import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { PROFILE } from './profile.js';
import { dbEnabled, getKv, setKv, delKv } from './db.js';

// The sender Gmail login. It is set from the website (no SMTP values in the host's env), kept in memory and also
// written encrypted to disk so it survives a restart when the disk persists. On Render's free tier the disk is wiped
// on restart or redeploy, so the website sends the login again (if the user chose to remember it in their browser).
// SMTP_USER / SMTP_PASS env still work as a fallback.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'smtp.enc');

let current = null; // { user, pass }

// With a database connected the encrypted login is kept there instead of on disk (the disk is wiped on restart)
export async function initSmtp() {
  if (!dbEnabled()) return;
  const blob = await getKv('smtp');
  if (blob) {
    try {
      current = decrypt(blob);
    } catch {
      current = null; // AUTO_API_KEY changed: the stored login cannot be read any more
    }
  } else if (current) {
    setKv('smtp', encrypt(current)); // first run: carry over a login saved in the file
  }
}

// Encrypted with a key derived from AUTO_API_KEY: without that key the file is useless
const keyFor = () => crypto.scryptSync((process.env.AUTO_API_KEY || '').trim() || 'no-key', 'jobhunting-smtp', 32);

export function encrypt(obj, key = keyFor()) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt(b64, key = keyFor()) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
}

try {
  current = decrypt(fs.readFileSync(FILE, 'utf8'));
} catch {
  current = null; // no file, or AUTO_API_KEY changed
}

// The login the mailer should use right now
export function getSmtp() {
  if (current) return { user: current.user, pass: current.pass, source: 'website' };
  // Only SMTP_PASS is needed in the host's env: the user defaults to the Satyam profile address. App passwords are shown with spaces, they are dropped.
  if (process.env.SMTP_PASS) {
    return { user: (process.env.SMTP_USER || PROFILE.email).trim().toLowerCase(), pass: process.env.SMTP_PASS.replace(/\s+/g, ''), source: 'env' };
  }
  return { user: '', pass: '', source: 'none' };
}

export function setSmtp(user, pass) {
  current = { user: user.trim().toLowerCase(), pass: pass.replace(/\s+/g, '') }; // Google shows app passwords with spaces
  if (dbEnabled()) return setKv('smtp', encrypt(current));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, encrypt(current));
  } catch (e) {
    console.error('Could not persist the SMTP login:', e.message);
  }
}

export function clearSmtp() {
  current = null;
  if (dbEnabled()) delKv('smtp');
  try {
    fs.rmSync(FILE, { force: true });
  } catch {
    /* nothing to remove */
  }
}

// Real login test against Gmail. Skipped in dry-run mode.
export async function verifySmtp(user, pass) {
  if (process.env.MAIL_DRY_RUN === 'true') return { ok: true, dryRun: true };
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass: pass.replace(/\s+/g, '') }, connectionTimeout: 15000, greetingTimeout: 15000 });
  try {
    await t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: /Invalid login|Username and Password|535/i.test(e.message) ? 'Gmail rejected the login. Use a 16 character App Password (2-Step Verification must be on), not your normal password.' : e.message };
  } finally {
    t.close();
  }
}

export function registerSmtp(app, auth) {
  // What is connected. The password is never sent back.
  app.get('/api/smtp', auth, (req, res) => {
    const s = getSmtp();
    res.json({ configured: Boolean(s.user && s.pass), user: s.user || null, source: s.source, defaultUser: PROFILE.email });
  });

  app.post('/api/smtp', auth, async (req, res) => {
    const user = String(req.body.user || '').trim();
    const pass = String(req.body.pass || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || pass.replace(/\s+/g, '').length < 8) {
      return res.status(400).json({ error: 'Enter the Gmail address and its App Password.' });
    }
    const v = await verifySmtp(user, pass);
    if (!v.ok) return res.status(401).json({ error: v.error });
    setSmtp(user, pass);
    res.json({ configured: true, user: user.toLowerCase(), source: 'website', dryRun: Boolean(v.dryRun) });
  });

  app.delete('/api/smtp', auth, (req, res) => {
    clearSmtp();
    res.json({ configured: false });
  });
}
