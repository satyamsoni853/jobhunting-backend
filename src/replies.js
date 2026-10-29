import { ImapFlow } from 'imapflow';
import { store } from './store.js';

// Reads the Gmail inbox (IMAP) to find who replied and which addresses bounced.
// Replied people get no follow-up, bounced addresses are never mailed again.

const BOUNCE_FROM = /mailer-daemon|postmaster/i;
const BOUNCE_SUBJECT = /undeliver|delivery status|delivery has failed|failure notice|returned mail|couldn'?t be delivered|address not found/i;
const UNSUBSCRIBE = /\b(?:unsubscribe|remove me|do not contact|don'?t contact|stop (?:emailing|mailing|contacting)|not interested)\b/i;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

const addr = (s) => String(s || '').toLowerCase().match(EMAIL_IN_TEXT)?.[0] || '';

// m: { from, subject, inReplyTo, references, autoSubmitted, body }
// records: store.all(). Returns { type: 'reply' | 'bounce', email, unsubscribe? } or null. Pure, so it can be tested.
export function classifyMessage(m, records) {
  const known = new Set(records.map((r) => r.email));
  const byId = new Map(records.filter((r) => r.messageId).map((r) => [r.messageId, r.email]));
  const from = addr(m.from);

  if (BOUNCE_FROM.test(m.from || '') || BOUNCE_SUBJECT.test(m.subject || '')) {
    const refId = [m.inReplyTo, ...(String(m.references || '').split(/\s+/))].find((id) => id && byId.has(id));
    if (refId) return { type: 'bounce', email: byId.get(refId) };
    // delivery reports quote the failed recipient in the body
    const failed = (String(m.body || '').match(EMAIL_IN_TEXT) || []).map((e) => e.toLowerCase()).find((e) => known.has(e));
    return failed ? { type: 'bounce', email: failed } : null;
  }

  // out-of-office and other automatic answers are not a human reply
  if (m.autoSubmitted && !/^no$/i.test(m.autoSubmitted.trim())) return null;

  const refs = [m.inReplyTo, ...String(m.references || '').split(/\s+/)].filter(Boolean);
  const hit = refs.find((id) => byId.has(id));
  const email = hit ? byId.get(hit) : known.has(from) ? from : '';
  if (!email) return null;
  return { type: 'reply', email, unsubscribe: UNSUBSCRIBE.test(String(m.body || '').slice(0, 600)) };
}

export function applyResult(r) {
  if (!r) return;
  if (r.type === 'bounce') store.update(r.email, { bounced: true, status: 'bounced' });
  else store.update(r.email, { replied: true, repliedAt: new Date().toISOString(), ...(r.unsubscribe ? { unsubscribed: true } : {}) });
}

const header = (buf, name) => {
  const m = String(buf || '').match(new RegExp(`^${name}:\\s*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, 'im'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};

let lastCheck = { at: null, checked: 0, replies: 0, bounces: 0, error: null };
export const lastReplyCheck = () => lastCheck;

export async function checkReplies() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass || process.env.MAIL_DRY_RUN === 'true') return { skipped: true };

  const records = store.all().filter((r) => (r.sends || []).length > 0);
  if (!records.length) return { skipped: true, reason: 'nothing sent yet' };

  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  const out = { at: new Date().toISOString(), checked: 0, replies: 0, bounces: 0, error: null };
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since: new Date(Date.now() - 14 * 24 * 3600 * 1000) });
      if (uids && uids.length) {
        // cheap pass first: sender, subject and threading headers only
        const candidates = [];
        for await (const msg of client.fetch(uids, { envelope: true, headers: ['in-reply-to', 'references', 'auto-submitted'] })) {
          const f = msg.envelope?.from?.[0];
          if (addr(f?.address) === user.toLowerCase()) continue; // our own mails
          const m = {
            from: f ? `${f.name || ''} <${f.address}>` : '',
            subject: msg.envelope?.subject || '',
            inReplyTo: header(msg.headers, 'in-reply-to'),
            references: header(msg.headers, 'references'),
            autoSubmitted: header(msg.headers, 'auto-submitted'),
            body: '',
          };
          out.checked++;
          if (classifyMessage(m, records)) candidates.push({ uid: msg.uid, m });
        }
        // second pass: read the body only for the few that matter (bounce reports, unsubscribe wording)
        for (const { uid, m } of candidates) {
          const full = await client.fetchOne(String(uid), { source: { maxLength: 8000 } }, { uid: true });
          m.body = full?.source ? full.source.toString('utf8') : '';
          const r = classifyMessage(m, records);
          applyResult(r);
          if (r?.type === 'bounce') out.bounces++;
          else if (r) out.replies++;
        }
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    out.error = e.message;
    console.error('Reply check failed:', e.message);
  } finally {
    await client.logout().catch(() => {});
  }
  lastCheck = out;
  return out;
}
