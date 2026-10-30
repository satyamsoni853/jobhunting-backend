import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { encrypt, decrypt } from './smtp.js';
import { dbEnabled, getKv, setKv } from './db.js';

// "Connect Gmail API": the server runs the Google sign-in itself, so the refresh token is created for the same client id
// and secret that use it, and nobody has to copy a token around. The token is kept encrypted (database, or a file),
// and it is never shown. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env, and the callback url
// (<server>/api/google/callback) listed as an authorised redirect URI on the Google OAuth client.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'google.enc');

let stored = ''; // the refresh token made by this flow
const states = new Map(); // state -> expires (one use, 10 minutes)

const clean = (v) => (v || '').replace(/\s+/g, '');
export const storedRefreshToken = () => stored;

const redirectUri = () => `${(process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '')}/api/google/callback`;

function persist() {
  const blob = encrypt({ refresh: stored });
  if (dbEnabled()) return setKv('google_refresh', blob);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, blob);
  } catch (e) {
    console.error('Could not persist the Google token:', e.message);
  }
}

export async function initGoogle() {
  try {
    const blob = dbEnabled() ? await getKv('google_refresh') : fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
    if (blob) stored = decrypt(blob).refresh || '';
  } catch {
    stored = ''; // AUTO_API_KEY changed: connect again
  }
}

const page = (ok, text) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gmail API</title>` +
  `<body style="font-family:system-ui,sans-serif;background:#0a0a0f;color:#f3f4f6;display:grid;place-items:center;min-height:100vh;margin:0">` +
  `<div style="max-width:420px;padding:24px;text-align:center"><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div><h2>${ok ? 'Gmail API connected' : 'Could not connect'}</h2><p>${text}</p></div>` +
  (ok ? `<script>setTimeout(function(){window.close()},2000)</script>` : '');

export function registerGoogleAuth(app, auth) {
  // Step 1 (key protected): returns the Google sign-in address for the website to open
  app.post('/api/google/connect', auth, (req, res) => {
    const id = clean(process.env.GOOGLE_CLIENT_ID);
    if (!id || !clean(process.env.GOOGLE_CLIENT_SECRET)) return res.status(503).json({ error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server.' });
    const now = Date.now();
    for (const [s, exp] of states) if (exp < now) states.delete(s);
    const state = crypto.randomBytes(16).toString('hex');
    states.set(state, now + 10 * 60 * 1000);
    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent', // forces a refresh token every time
      state,
    })}`;
    res.json({ url, redirectUri: redirectUri() });
  });

  // Step 2: Google sends the browser back here with a code, which is exchanged for the refresh token
  app.get('/api/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(page(false, `Google said: ${String(error).slice(0, 80)}.`));
    const exp = states.get(String(state));
    states.delete(String(state));
    if (!exp || exp < Date.now() || !code) return res.status(400).send(page(false, 'This link expired or is not valid. Press Connect again on the website.'));

    try {
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: clean(process.env.GOOGLE_CLIENT_ID),
          client_secret: clean(process.env.GOOGLE_CLIENT_SECRET),
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.refresh_token) {
        return res.status(400).send(page(false, `Google did not give a token (${j.error_description || j.error || r.status}). Press Connect again.`));
      }
      stored = j.refresh_token;
      persist();
      res.send(page(true, 'This tab closes by itself. Go back to the website and press "Test connection" there.'));
    } catch (e) {
      res.status(500).send(page(false, e.message));
    }
  });
}
