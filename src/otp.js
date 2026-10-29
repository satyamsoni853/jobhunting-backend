import crypto from 'crypto';

// Password for the "Satyam" screen. Pressing Satyam asks for it, and the profile text and the send endpoints work only
// after it is entered. It is read from the host's env (SATYAM_PIN), never written in code: the repo is public.
// Anybody can try, so wrong tries are limited: 5 wrong ones lock the screen for 15 minutes (for everybody).
const TOKEN_TTL = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = () => Number(process.env.PIN_LOCK_MS ?? 15 * 60 * 1000);

let wrong = 0;
let lockedUntil = 0;
const tokens = new Map(); // token -> expires

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

const cleanTokens = () => {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t);
};

// Guard for the Satyam routes: a valid token from /verify, sent as X-Profile-Token
export function requireProfileToken(req, res, next) {
  cleanTokens();
  const exp = tokens.get(req.get('X-Profile-Token') || '');
  if (!exp || exp < Date.now()) return res.status(401).json({ error: 'Enter your password to continue.' });
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
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, now + TOKEN_TTL);
    res.json({ token, expiresIn: TOKEN_TTL / 1000 });
  });
}
