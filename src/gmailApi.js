import MailComposer from 'nodemailer/lib/mail-composer/index.js';

// Sends mail through the Gmail API over HTTPS (port 443). Hosts like Render's free tier block SMTP ports but allow this.
// Login: an OAuth refresh token for the sender Gmail, kept only in the host's env:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN   (scope: gmail.send)
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// Client ids, secrets and tokens never contain whitespace. A value copied from a wrapped line (the Google dialog shows
// the client id on two lines) can carry a newline inside it, so every whitespace character is dropped.
const clean = (v) => (v || '').replace(/\s+/g, '');

const creds = () => ({
  id: clean(process.env.GOOGLE_CLIENT_ID),
  secret: clean(process.env.GOOGLE_CLIENT_SECRET),
  refresh: clean(process.env.GOOGLE_REFRESH_TOKEN),
});

export const gmailApiConfigured = () => {
  const c = creds();
  return Boolean(c.id && c.secret && c.refresh);
};

let cached = { token: '', exp: 0, scope: '' };

// Access tokens last about an hour, so one is reused until shortly before it ends
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60 * 1000) return cached.token;
  const c = creds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: c.refresh, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const why = j.error_description || j.error || `status ${res.status}`;
    throw Object.assign(new Error(`Google login failed (${why}). Create a new refresh token and update GOOGLE_REFRESH_TOKEN.`), { googleCode: j.error || `http_${res.status}` });
  }
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, scope: j.scope || '' };
  return cached.token;
}

// Same shape as a nodemailer transport, so the rest of the mailer does not care how a mail leaves
export function gmailApiTransport() {
  return {
    async sendMail(options) {
      const { threadId, ...mail } = options;
      const raw = await new Promise((resolve, reject) => new MailComposer(mail).compile().build((e, buf) => (e ? reject(e) : resolve(buf))));
      const messageId = (raw.toString('utf8', 0, 4000).match(/^Message-ID:\s*(<[^>]+>)/im) || [])[1];

      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: raw.toString('base64url'), ...(threadId ? { threadId } : {}) }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Gmail API: ${j.error?.message || `status ${res.status}`}`);
      return { messageId, gmailId: j.id, threadId: j.threadId };
    },
  };
}

// Only the shape and length of each value, never the value: enough to see a cut-off or swapped copy
export function gmailApiShape() {
  const c = creds();
  return {
    clientId: { length: c.id.length, looksRight: /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(c.id) },
    clientSecret: { length: c.secret.length, looksRight: /^GOCSPX-[\w-]{28}$/.test(c.secret) },
    refreshToken: { length: c.refresh.length, looksRight: /^1\/\/[\w-]{20,}$/.test(c.refresh) },
  };
}

// Asks Google for an access token without sending anything: proves the client id, secret and refresh token are valid
export async function checkGmailApi() {
  if (!gmailApiConfigured()) return { ok: false, error: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REFRESH_TOKEN is missing.', shape: gmailApiShape() };
  try {
    cached = { token: '', exp: 0, scope: '' }; // always a fresh exchange
    await accessToken();
    return { ok: true, canSend: cached.scope.includes('gmail.send'), scope: cached.scope };
  } catch (e) {
    return { ok: false, error: e.message, googleCode: e.googleCode, shape: gmailApiShape() };
  }
}
