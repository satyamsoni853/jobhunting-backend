import crypto from 'crypto';

// Password for the "Satyam" screen. Pressing Satyam asks for it, and the profile text and the send endpoints work only
// after it is entered. It is read from the host's env (SATYAM_PIN), never written in code: the repo is public.
// Anybody can try, so wrong tries are limited: 5 wrong ones lock the screen for 15 minutes (for everybody).
const TOKEN_TTL = 24 * 60 * 60 * 1000; // one day
const MAX_ATTEMPTS = 5;
const LOCK_MS = () => Number(process.env.PIN_LOCK_MS ?? 15 * 60 * 1000);

let wrong = 0;
let lockedUntil = 0;

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

// A token is "<expiry>.<signature>", signed with a key made from SATYAM_PIN and AUTO_API_KEY. Nothing is kept in memory,
// so a token stays valid for its whole day even when the free server restarts (every deploy). Changing the password
// or the key makes every old token invalid.
const sign = (exp) => crypto.createHmac('sha256', `${process.env.SATYAM_PIN || ''}:${process.env.AUTO_API_KEY || ''}`).update(String(exp)).digest('hex');
const issueToken = () => {
  const exp = Date.now() + TOKEN_TTL;
  return `${exp}.${sign(exp)}`;
};
const validToken = (token) => {
  if (!(process.env.SATYAM_PIN || '').trim()) return false;
  const [e, sig = ''] = String(token || '').split('.');
  const exp = Number(e);
  if (!exp || exp < Date.now() || !sig) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

// Guard for the Satyam routes: a valid token from /verify, sent as X-Profile-Token
export function requireProfileToken(req, res, next) {
  if (!validToken(req.get('X-Profile-Token'))) return res.status(401).json({ error: 'Enter your password to continue.' });
  next();
}

export function registerOtp(app) {
  app.post('/api/profile/satyam/verify', (req, res) => {
    const pin = (process.env.SATYAM_PIN || '').trim();
    if (!pin) return res.status(503).json({ error: 'The password is not set on the server yet. Add SATYAM_PIN in the server settings.' });

    const now = Date.now();
    if (lockedUntil > now) {
      return res.status(429).json({ error: `Too many wrong tries. Try again in ${Math.ceil((lockedUntil - now) / 60000)} minute(s).` });
    }

    const given = String(req.body.code ?? req.body.pin ?? '').trim();
    if (!crypto.timingSafeEqual(digest(given), digest(pin))) {
      wrong += 1;
      if (wrong >= MAX_ATTEMPTS) {
        wrong = 0;
        lockedUntil = now + LOCK_MS();
        return res.status(429).json({ error: 'Too many wrong tries. The screen is locked for 15 minutes.' });
      }
      return res.status(401).json({ error: `Wrong password. ${MAX_ATTEMPTS - wrong} ${MAX_ATTEMPTS - wrong === 1 ? 'try' : 'tries'} left.` });
    }

    wrong = 0;
    res.json({ token: issueToken(), expiresIn: TOKEN_TTL / 1000 });
  });
}
