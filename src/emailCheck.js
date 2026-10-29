import dns from 'dns/promises';

// Checks run right before a mail is sent. Fewer bounces keeps the Gmail account out of spam trouble.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

// Addresses that never read replies
const NOREPLY_RE = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|abuse|noreply)\b/i;

// Free throwaway inbox providers. A recruiter never uses these.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com',
  'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com',
  'fakeinbox.com', 'mintemail.com', 'mailnesia.com', 'tempail.com',
]);

// Obvious placeholders that show up in posts
const PLACEHOLDER_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test.com', 'domain.com', 'email.com', 'yourcompany.com', 'company.com']);

const mxCache = new Map(); // domain -> { ok, at }
const TTL = 24 * 3600 * 1000;

async function hasMail(domain) {
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < TTL) return hit.ok;

  let ok = true;
  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000)),
    ]);
    ok = mx.length > 0;
  } catch (e) {
    // Only a definite "no such domain / no records" counts as invalid. A timeout or DNS hiccup must not drop a good lead.
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      try {
        // some domains accept mail on the A record without an MX
        ok = (await dns.resolve4(domain)).length > 0;
      } catch {
        ok = false;
      }
    }
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

// Returns { ok: true } or { ok: false, reason }
export async function verifyEmail(email) {
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, reason: 'invalid format' };
  const [local, domain] = e.split('@');
  if (NOREPLY_RE.test(local)) return { ok: false, reason: 'no-reply address' };
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable domain' };
  if (PLACEHOLDER_DOMAINS.has(domain)) return { ok: false, reason: 'placeholder domain' };
  if (!(await hasMail(domain))) return { ok: false, reason: 'domain has no mail server' };
  return { ok: true };
}
