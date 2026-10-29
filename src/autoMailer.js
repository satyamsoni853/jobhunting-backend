import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { isBlocked, isBlockedAuthor, mentionsGroup } from './blocklist.js';
import { PROFILE, subjectAtCompany } from './profile.js';
import { tailorResume, renderPdf, minFit } from './tailor/index.js';
import { store } from './store.js';
import { getSmtp } from './smtp.js';
import { verifyEmail } from './emailCheck.js';
import { companyFromPost, personFromEmail, greeting, timezoneFromPost, inBusinessHours } from './company.js';
import { dueForFollowUp, followUpContent, followUpDays, maxFollowUps, followUpsEnabled } from './followup.js';

// Auto-mailer: the LinkedIn extension and the hunter push addresses here, a background queue sends them one by one.
// All config comes from env so nothing sensitive lives in the extension.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfg = () => ({
  user: getSmtp().user, // set from the website, env is the fallback
  pass: getSmtp().pass,
  apiKey: process.env.AUTO_API_KEY,
  enabled: process.env.AUTO_SEND_ENABLED !== 'false',
  dryRun: process.env.MAIL_DRY_RUN === 'true', // build the mails and log them, send nothing
  subject: process.env.AUTO_SUBJECT || PROFILE.subject,
  body: process.env.AUTO_BODY ? process.env.AUTO_BODY.replace(/\\n/g, '\n') : PROFILE.body,
  resumePath: process.env.RESUME_PATH || path.join(process.cwd(), 'resume', 'resume.pdf'),
  tailor: process.env.TAILOR_RESUME !== 'false', // per-post resume and note, set false to always send the default
  tzAware: process.env.SEND_TZ_AWARE !== 'false', // send in the recruiter's business hours when the time zone is known
  dailyLimit: Number(process.env.DAILY_LIMIT || 300), // Gmail free cap is ~500/day, stay below it
  minDelay: Number(process.env.MIN_DELAY_MS || 30000),
  maxDelay: Number(process.env.MAX_DELAY_MS || 60000),
});

const queue = []; // jobs: { type: 'first' | 'followup', email, query, postUrl, postText, company, tz, queuedAt }
const queued = new Set(); // "first:a@b.com"
let working = false;
let transporter = null;
const history = []; // last 50 results, for /api/auto-status

const note = (entry) => {
  history.unshift({ at: new Date().toISOString(), ...entry });
  history.length = Math.min(history.length, 50);
};

let transporterKey = '';
const getTransporter = (c) => {
  // rebuilt whenever the login changes (new password from the website)
  const key = c.dryRun ? 'dry' : `${c.user}:${c.pass}`;
  if (!transporter || transporterKey !== key) {
    transporter = c.dryRun
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({ service: 'gmail', auth: { user: c.user, pass: c.pass } });
    transporterKey = key;
  }
  return transporter;
};

function personalize(text, lead) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => lead[k.toLowerCase()] ?? '');
}

const resumeAttachment = (c) => {
  const name = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
  if (process.env.RESUME_BASE64) return [{ filename: name, content: Buffer.from(process.env.RESUME_BASE64, 'base64') }];
  if (fs.existsSync(c.resumePath)) return [{ filename: name, path: c.resumePath }];
  return [];
};

// Returns true when a mail was really sent, so the worker knows whether to wait before the next one
async function sendFirst(job, c) {
  const { email } = job;
  if (store.has(email)) return false;
  if (isBlocked(email)) {
    console.log(`⛔ Skipped blocked address ${email}`);
    return false;
  }

  const check = await verifyEmail(email);
  if (!check.ok) {
    store.update(email, { status: 'invalid', reason: check.reason });
    note({ email, status: 'skipped', reason: check.reason });
    console.log(`🚫 Skipped ${email}: ${check.reason}`);
    return false;
  }

  const lead = { email, query: job.query || '', link: job.postUrl || '' };
  const name = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
  let subject = personalize(c.subject, lead);
  let text = personalize(c.body, lead);
  let attachments = resumeAttachment(c);
  let tailored = null;
  let role = '';
  const who = { company: job.company, person: job.person };
  text = text.replace(/^Dear Hiring Team,/, greeting(who));
  subject = subjectAtCompany(subject, job.company);

  // With the recruiter's post available, build the resume and note for that role (rules only, no AI)
  if (job.postText && c.tailor) {
    const t = tailorResume(job.postText, who);
    const a = t.analysis;
    if (a.fit < minFit()) {
      const reason = `low fit (${a.fit}) for ${a.roleLabel}${a.reasons.length ? `: ${a.reasons.join(', ')}` : ''}`;
      note({ email, status: 'skipped', reason });
      console.log(`⏭️ Skipped ${email}: ${reason}`);
      return false;
    }
    subject = t.subject;
    text = t.body;
    attachments = [{ filename: name, content: await renderPdf(t.content) }];
    tailored = { role: a.roleLabel, fit: a.fit, matched: a.matched.slice(0, 6) };
    role = a.roleLabel;
  }

  const info = await getTransporter(c).sendMail({
    from: `"${(c.user || 'me').split('@')[0]}" <${c.user || 'me@localhost'}>`,
    to: email,
    subject,
    text,
    attachments,
  });
  store.recordSend(email, {
    status: 'sent',
    subject,
    role,
    company: job.company || '',
    person: job.person || '',
    tz: job.tz ?? null,
    postUrl: job.postUrl || '',
    messageId: info.messageId,
  });
  note({ email, status: c.dryRun ? 'dry-run' : 'success', id: info.messageId, subject, tailored, company: job.company || undefined, person: job.person || undefined });
  console.log(`${c.dryRun ? '🧪 Dry run' : '✔️ Auto-sent'} to ${email}`);
  return true;
}

async function sendFollowUp(job, c) {
  const rec = store.get(job.email);
  if (!rec || !dueForFollowUp(rec)) return false;
  if (isBlocked(job.email)) return false;

  const mail = followUpContent(rec, PROFILE.name);
  const info = await getTransporter(c).sendMail({
    from: `"${(c.user || 'me').split('@')[0]}" <${c.user || 'me@localhost'}>`,
    to: job.email,
    subject: mail.subject,
    text: mail.text,
    inReplyTo: rec.messageId, // threads it under the first mail
    references: rec.messageId,
  });
  store.recordSend(job.email, { followUps: (rec.followUps || 0) + 1, lastFollowUpAt: new Date().toISOString() });
  note({ email: job.email, status: c.dryRun ? 'dry-run' : 'followup', id: info.messageId, subject: mail.subject });
  console.log(`${c.dryRun ? '🧪 Dry run' : '🔁 Follow-up sent'} to ${job.email}`);
  return true;
}

async function work() {
  if (working) return;
  working = true;
  const c = cfg();
  // a job waits for the recruiter's business hours, but never longer than 3 days
  const ready = (j) => !c.tzAware || inBusinessHours(j.tz) || Date.now() - j.queuedAt > 72 * HOUR;

  while (queue.length) {
    if (store.sentToday() >= c.dailyLimit) {
      console.log(`⏸️ Daily limit (${c.dailyLimit}) reached, ${queue.length} mails wait for tomorrow.`);
      await sleep(30 * 60 * 1000);
      continue;
    }
    // first mails go before follow-ups
    let idx = queue.findIndex((j) => j.type === 'first' && ready(j));
    if (idx === -1) idx = queue.findIndex((j) => j.type === 'followup' && ready(j));
    if (idx === -1) {
      await sleep(10 * 60 * 1000); // everything left is outside business hours
      continue;
    }
    const job = queue.splice(idx, 1)[0];
    queued.delete(`${job.type}:${job.email}`);

    let didSend = false;
    try {
      didSend = job.type === 'followup' ? await sendFollowUp(job, c) : await sendFirst(job, c);
    } catch (e) {
      note({ email: job.email, status: 'failed', error: e.message });
      console.error(`❌ Auto-send failed for ${job.email}:`, e.message);
    }
    if (didSend && queue.length) await sleep(c.minDelay + Math.random() * (c.maxDelay - c.minDelay));
  }
  working = false;
}

export const requireKey = (req, res, next) => {
  const c = cfg();
  if (!c.apiKey || req.get('X-API-Key') !== c.apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Shared by the extension endpoint and the server-side hunter. Skips invalid, already-mailed and already-queued addresses.
export function enqueueEmails(emails, query = '', postUrl = '', postText = '', author = {}) {
  const c = cfg();
  if (!c.enabled) return { accepted: 0, message: 'Auto-send disabled' };
  if (!c.dryRun && (!c.user || !c.pass)) return { error: 'Sender Gmail is not connected. Open the Sender card on the website and connect it.' };

  let accepted = 0;
  let blocked = 0;
  const text = String(postText || '').slice(0, 6000);
  // a post written by a blocked person is skipped whole, even if it carries an unrelated email
  if (mentionsGroup(text)) return { accepted: 0, blocked: (Array.isArray(emails) ? emails : [emails]).length, queueLength: queue.length, reason: 'post names the Kapoor Wealth group' };
  if (isBlockedAuthor(author)) return { accepted: 0, blocked: (Array.isArray(emails) ? emails : [emails]).length, queueLength: queue.length, reason: 'blocked author' };
  for (const raw of Array.isArray(emails) ? emails : [emails]) {
    const email = String(raw).trim().toLowerCase();
    if (!EMAIL_RE.test(email) || store.has(email) || queued.has(`first:${email}`)) continue;
    if (isBlocked(email)) {
      blocked++;
      continue;
    }
    queued.add(`first:${email}`);
    queue.push({
      type: 'first',
      email,
      query,
      postUrl,
      postText: text,
      company: companyFromPost(text, email),
      person: personFromEmail(email, text),
      tz: timezoneFromPost(text, email),
      queuedAt: Date.now(),
    });
    accepted++;
  }
  work();
  return { accepted, blocked, queueLength: queue.length };
}

// Called by the scheduler: queue a follow-up for everyone who is due
export function queueFollowUps() {
  const c = cfg();
  if (!c.enabled || !followUpsEnabled()) return 0;
  let n = 0;
  for (const rec of store.all()) {
    if (!dueForFollowUp(rec) || isBlocked(rec.email) || queued.has(`followup:${rec.email}`)) continue;
    queued.add(`followup:${rec.email}`);
    queue.push({ type: 'followup', email: rec.email, tz: rec.tz ?? null, queuedAt: Date.now() });
    n++;
  }
  if (n) work();
  return n;
}

export const mailerConfig = cfg;

// A plain system mail (for example the login code). Not part of the queue, no resume, no limits.
export async function sendSystemMail(to, subject, text) {
  const c = cfg();
  if (!c.dryRun && (!c.user || !c.pass)) throw new Error('Sender Gmail is not connected on the server.');
  return getTransporter(c).sendMail({ from: `"Job Hunter" <${c.user || 'me@localhost'}>`, to, subject, text });
}

export function registerAutoMailer(app) {
  const auth = requireKey;

  app.post('/api/auto-enqueue', auth, (req, res) => {
    const { emails = [], query = '', postUrl = '', postText = '', author = {} } = req.body;
    const result = enqueueEmails(emails, query, postUrl, postText, author);
    res.status(result.error ? 500 : 200).json(result);
  });

  app.get('/api/auto-status', auth, (req, res) => {
    const c = cfg();
    res.json({
      queueLength: queue.length,
      queuedFollowUps: queue.filter((j) => j.type === 'followup').length,
      sentToday: store.sentToday(),
      dailyLimit: c.dailyLimit,
      totalContacted: store.stats().contacted,
      stats: store.stats(),
      settings: {
        dryRun: c.dryRun,
        tzAware: c.tzAware,
        followUps: followUpsEnabled() ? `${maxFollowUps()} after ${followUpDays()} days` : 'off',
        minFit: minFit(),
      },
      recent: history,
    });
  });
}
