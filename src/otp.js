import crypto from 'crypto';
import { sendSystemMail } from './autoMailer.js';

// Login code for the "Satyam" profile. Pressing Satyam on the website mails a 6 digit code to the owner's mailbox;
// the profile text and resume are served only after the code is entered. Single owner, so limits are global:
// anybody can press the button, but they cannot read the code or flood the inbox.
const OTP_TO = () => process.env.OTP_EMAIL || 'satyamsoni853@gmail.com';
const CODE_TTL = 5 * 60 * 1000;
const TOKEN_TTL = 30 * 60 * 1000;
const COOLDOWN = Number(process.env.OTP_COOLDOWN_MS ?? 60000);
const HOURLY_MAX = 5;
const MAX_ATTEMPTS = 5;

let pending = null; // { hash, salt, expires, attempts }
let lastSent = 0;
let sentTimes = [];
const tokens = new Map(); // token -> expires

const hash = (code, salt) => crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
const mask = (email) => email.replace(/^(.{2})[^@]*(@.*)$/, (_, a, b) => `${a}${'*'.repeat(6)}${b}`);

const cleanTokens = () => {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t);
};

// Guard for the profile routes: a valid token from /verify, sent as X-Profile-Token
export function requireProfileToken(req, res, next) {
  cleanTokens();
  const exp = tokens.get(req.get('X-Profile-Token') || '');
  if (!exp || exp < Date.now()) return res.status(401).json({ error: 'Verification needed. Press Satyam and enter the code.' });
  next();
}

export function registerOtp(app) {
  app.post('/api/profile/satyam/otp', async (req, res) => {
    const now = Date.now();
    sentTimes = sentTimes.filter((t) => now - t < 3600 * 1000);
    if (now - lastSent < COOLDOWN) {
      return res.status(429).json({ error: `Wait ${Math.ceil((COOLDOWN - (now - lastSent)) / 1000)} seconds before asking for another code.` });
    }
    if (sentTimes.length >= HOURLY_MAX) return res.status(429).json({ error: 'Too many codes requested. Try again later.' });

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(8).toString('hex');
    try {
      await sendSystemMail(
        OTP_TO(),
        `Your Job Hunter code: ${code}`,
        `Your code is ${code}\n\nIt is valid for 5 minutes. Someone pressed the Satyam button on the Job Hunter website. If that was not you, ignore this mail, nothing is unlocked without the code.`
      );
    } catch (e) {
      console.error('OTP mail failed:', e.message);
      return res.status(503).json({ error: 'Could not send the code. The sender Gmail is not connected on the server.' });
    }
    pending = { hash: hash(code, salt), salt, expires: now + CODE_TTL, attempts: 0 };
    lastSent = now;
    sentTimes.push(now);

    const out = { sent: true, to: mask(OTP_TO()), expiresIn: CODE_TTL / 1000 };
    // Local testing only: in dry run nothing is mailed, so the code is returned. Never in production.
    if (process.env.MAIL_DRY_RUN === 'true' && process.env.NODE_ENV !== 'production') {
      out.devCode = code;
      console.log(`[dev only] login code: ${code}`);
    }
    res.json(out);
  });

  app.post('/api/profile/satyam/verify', (req, res) => {
    const code = String(req.body.code || '').trim();
    if (!pending || pending.expires < Date.now()) return res.status(400).json({ error: 'The code expired. Request a new one.' });
    pending.attempts += 1;
    if (pending.attempts > MAX_ATTEMPTS) {
      pending = null;
      return res.status(429).json({ error: 'Too many wrong tries. Request a new code.' });
    }
    const ok = crypto.timingSafeEqual(Buffer.from(hash(code, pending.salt)), Buffer.from(pending.hash));
    if (!ok) return res.status(401).json({ error: `Wrong code. ${MAX_ATTEMPTS - pending.attempts} ${MAX_ATTEMPTS - pending.attempts === 1 ? "try" : "tries"} left.` });

    pending = null; // a code works once
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + TOKEN_TTL);
    res.json({ token, expiresIn: TOKEN_TTL / 1000 });
  });
}
