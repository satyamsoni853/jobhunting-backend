import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import nodemailer from 'nodemailer';
import { isBlocked, isBlockedAuthor, mentionsGroup } from './blocklist.js';
import { PROFILE, subjectAtCompany, loadResume } from './profile.js';
import { tailorResume, renderPdf, minFit } from './tailor/index.js';
import { store } from './store.js';
import { getSmtp } from './smtp.js';
import { dbEnabled, getKv, setKv, loadLeads, saveLead } from './db.js';
import { gmailApiConfigured, gmailApiTransport } from './gmailApi.js';
import { verifyEmail } from './emailCheck.js';
import { companyFromPost, personFromEmail, greeting, timezoneFromPost, inBusinessHours } from './company.js';
import { dueForFollowUp, followUpContent, followUpDays, maxFollowUps, followUpsEnabled } from './followup.js';

// Auto-mailer: the LinkedIn extension and the hunter push addresses here, a background queue sends them one by one.
// All config comes from env so nothing sensitive lives in the extension.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfg = () => ({
  user: getSmtp().user || (gmailApiConfigured() ? PROFILE.email : ''), // set from the website, env is the fallback
  pass: getSmtp().pass,
  gmailApi: gmailApiConfigured(), // sends over HTTPS, works where SMTP ports are blocked
  apiKey: (process.env.AUTO_API_KEY || '').trim(), // a space or newline pasted after the key must not break the login
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
// The waiting jobs are copied to the database, so a free server that falls asleep does not lose them.
// A job leaves the saved copy just before it is sent, so a crash can drop one mail but never sends one twice.
const persistQueue = () => {
  if (dbEnabled()) setKv('queue', JSON.stringify(queue));
};

// Every address ever found stays in the database for good: when it was first seen, where from, and what happened to it.
// (Without a database it lives in memory only, and is lost on a restart.)
const leads = new Map();
function track(email, patch = {}) {
  const now = new Date().toISOString();
  const old = leads.get(email);
  const rec = old ? { ...old, ...patch, seen: (old.seen || 1) + (patch.firstTime ? 0 : 1), lastSeen: now } : { firstSeen: now, seen: 1, lastSeen: now, ...patch };
  delete rec.firstTime;
  leads.set(email, rec);
  if (dbEnabled()) saveLead(email, rec);
}
// a status change on an address already known (no "seen again" count)
const mark = (email, patch) => track(email, { ...patch, firstTime: true });

// Addresses the owner cancelled on the website: never queued again, even if a post shows them once more
const cancelled = new Set();
const persistCancelled = () => {
  if (dbEnabled()) setKv('cancelled', JSON.stringify([...cancelled]));
};

export async function initQueue() {
  if (!dbEnabled()) return 0;
  try {
    for (const r of await loadLeads()) leads.set(r.email, r.data);
    // addresses mailed before the leads book existed are added to it once
    for (const r of store.all()) if (!leads.has(r.email) && (r.sends || []).length) track(r.email, { status: 'sent', firstSeen: r.at, sentAt: r.sends.at(-1), subject: r.subject, role: r.role, company: r.company, postUrl: r.postUrl, firstTime: true });
    for (const e of JSON.parse((await getKv('cancelled')) || '[]')) cancelled.add(e);
    history.push(...JSON.parse((await getKv('history')) || '[]'));
  } catch {
    /* an unreadable copy is just ignored */
  }
  const raw = await getKv('queue');
  let n = 0;
  for (const job of raw ? JSON.parse(raw) : []) {
    const key = `${job.type}:${job.email}`;
    if (queued.has(key) || (job.type === 'first' && store.has(job.email))) continue; // already mailed meanwhile
    queued.add(key);
    queue.push(job);
    n++;
  }
  if (n) {
    console.log(`📥 Restored ${n} waiting mail(s) from the database`);
    work();
  }
  return n;
}

// the worker's one-minute rest can be cut short, for example when the owner presses "send now"
let wake = null;
const idle = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

let working = false;
let transporter = null;
const history = []; // last 50 results, for /api/auto-status

let historyTimer = null;
const note = (entry) => {
  history.unshift({ at: new Date().toISOString(), ...entry });
  history.length = Math.min(history.length, 100);
  // the skipped and failed list survives a restart too (written at most once every 2 seconds)
  if (dbEnabled() && !historyTimer) {
    historyTimer = setTimeout(() => {
      historyTimer = null;
      setKv('history', JSON.stringify(history));
    }, 2000);
  }
};

let transporterKey = '';
const getTransporter = (c) => {
  // rebuilt whenever the way of sending or the login changes
  const key = c.dryRun ? 'dry' : c.gmailApi ? 'api' : `${c.user}:${c.pass}`;
  if (!transporter || transporterKey !== key) {
    transporter = c.dryRun
      ? nodemailer.createTransport({ jsonTransport: true })
      : c.gmailApi
        ? gmailApiTransport()
        : nodemailer.createTransport({ service: 'gmail', auth: { user: c.user, pass: c.pass } });
    transporterKey = key;
  }
  return transporter;
};

function personalize(text, lead) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => lead[k.toLowerCase()] ?? '');
}

const resumeAttachment = async () => {
  const r = await loadResume();
  return r ? [{ filename: r.filename, content: r.buffer }] : [];
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
    mark(email, { status: 'skipped', reason: check.reason });
    note({ email, status: 'skipped', reason: check.reason });
    console.log(`🚫 Skipped ${email}: ${check.reason}`);
    return false;
  }

  const lead = { email, query: job.query || '', link: job.postUrl || '' };
  const name = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
  let subject = personalize(job.override?.subject || c.subject, lead);
  let text = personalize(job.override?.body || c.body, lead);
  let attachments = await resumeAttachment();
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
      mark(email, { status: 'skipped', reason });
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
    threadId: info.threadId || '',
  });
  mark(email, { status: 'sent', sentAt: new Date().toISOString(), subject, role, company: job.company || '' });
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
    threadId: rec.threadId || undefined, // Gmail API: keeps it in the same conversation
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
  const ready = (j) => j.force || !c.tzAware || inBusinessHours(j.tz) || Date.now() - j.queuedAt > 72 * HOUR;

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
      await idle(60 * 1000); // everything left is outside business hours, look again in a minute
      continue;
    }
    const job = queue.splice(idx, 1)[0];
    queued.delete(`${job.type}:${job.email}`);
    persistQueue();

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
  const sent = (req.get('X-API-Key') || '').trim();
  const a = Buffer.from(sent);
  const b = Buffer.from(c.apiKey);
  if (!c.apiKey || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Shared by the extension endpoint and the server-side hunter. Skips invalid, already-mailed and already-queued addresses.
export function enqueueEmails(emails, query = '', postUrl = '', postText = '', author = {}, override = null) {
  const c = cfg();
  if (!c.enabled) return { accepted: 0, message: 'Auto-send disabled' };
  if (!c.dryRun && !c.gmailApi && (!c.user || !c.pass)) return { error: 'Sender Gmail is not connected. Open the Sender card on the website and connect it.' };

  let accepted = 0;
  let blocked = 0;
  const text = String(postText || '').slice(0, 6000);
  // a post written by a blocked person is skipped whole, even if it carries an unrelated email
  if (mentionsGroup(text)) return { accepted: 0, blocked: (Array.isArray(emails) ? emails : [emails]).length, queueLength: queue.length, reason: 'post names the Kapoor Wealth group' };
  if (isBlockedAuthor(author)) return { accepted: 0, blocked: (Array.isArray(emails) ? emails : [emails]).length, queueLength: queue.length, reason: 'blocked author' };
  for (const raw of Array.isArray(emails) ? emails : [emails]) {
    const email = String(raw).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    if (store.has(email) || queued.has(`first:${email}`)) {
      track(email); // seen again: already mailed or already waiting, so nothing more is sent
      continue;
    }
    if (isBlocked(email) || cancelled.has(email)) {
      track(email, { status: cancelled.has(email) ? 'cancelled' : 'blocked', query, postUrl });
      blocked++;
      continue;
    }
    // The fit is judged now, so the list on the website only shows mails that will really be sent
    let fit = null;
    let role = '';
    if (text && c.tailor) {
      const a = tailorResume(text, {}).analysis;
      if (a.fit < minFit()) {
        const reason = `low fit (${a.fit}) for ${a.roleLabel}${a.reasons.length ? `: ${a.reasons.join(', ')}` : ''}`;
        const prev = leads.get(email);
        if (!(prev && prev.status === 'skipped' && prev.fit === a.fit)) note({ email, status: 'skipped', reason, query, postUrl }); // not again on every hunt
        track(email, { status: 'skipped', reason, query, postUrl, role: a.roleLabel, fit: a.fit });
        continue;
      }
      fit = a.fit;
      role = a.roleLabel;
    }
    queued.add(`first:${email}`);
    const company = companyFromPost(text, email);
    track(email, { status: 'queued', query, postUrl, company, role, fit });
    queue.push({
      type: 'first',
      email,
      query,
      postUrl,
      postText: text,
      company,
      override, // { subject, body } typed by the owner for this batch
      fit,
      role,
      person: personFromEmail(email, text),
      tz: timezoneFromPost(text, email),
      queuedAt: Date.now(),
    });
    accepted++;
  }
  persistQueue();
  if (wake) wake();
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
  if (n) {
    persistQueue();
    work();
  }
  return n;
}

export const mailerConfig = cfg;

// What the Satyam screen shows after the login code: queue, today's count and the latest results
export function satyamStatus() {
  const c = cfg();
  return { queueLength: queue.length, sentToday: store.sentToday(), dailyLimit: c.dailyLimit, connected: Boolean(c.user && c.pass) || c.gmailApi || c.dryRun, recent: history.slice(0, 15) };
}

// A plain system mail (for example the login code). Not part of the queue, no resume, no limits.
export async function sendSystemMail(to, subject, text) {
  const c = cfg();
  if (!c.dryRun && !c.gmailApi && (!c.user || !c.pass)) throw new Error('Sender Gmail is not connected on the server.');
  return getTransporter(c).sendMail({ from: `"Job Hunter" <${c.user || 'me@localhost'}>`, to, subject, text });
}

export function registerAutoMailer(app) {
  const auth = requireKey;

  app.post('/api/auto-enqueue', auth, (req, res) => {
    const { emails = [], query = '', postUrl = '', postText = '', author = {} } = req.body;
    const result = enqueueEmails(emails, query, postUrl, postText, author);
    res.status(result.error ? 500 : 200).json(result);
  });

  // Counts only, no addresses and no names: lets the owner (or Claude) check how the hunt is doing without the Access Key.
  // Shows how the LinkedIn agent, Hacker News and the rest are doing, and why leads were skipped.
  app.get('/api/mail/counts', (req, res) => {
    const c = cfg();
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = (t) => Boolean(t) && new Date(t).getTime() >= since;
    const sourceOf = (l) => (/linkedin\.com/i.test(l.postUrl || '') ? 'linkedin' : /^HN\b/i.test(l.query || '') ? 'hackernews' : 'other');
    const WHY = [
      ['role not a match', /not a match/],
      ['senior or lead level', /senior or lead/],
      ['asks more years', /asks \d+\+ years/],
      ['region locked', /region that does not include/],
      ['on-site only', /on-site or hybrid/],
      ['no matching skills', /no matching skills/],
      ['work authorization', /work authorization/],
    ];
    const sources = {};
    const skipReasons = { linkedin: {}, all: {} };
    let nearMiss = 0;
    let lastLinkedInLeadAt = '';
    for (const l of leads.values()) {
      const src = sourceOf(l);
      const s = (sources[src] ||= { leads: 0, new24h: 0, queued: 0, sent: 0, skipped: 0, blocked: 0, cancelled: 0, failed: 0 });
      s.leads++;
      if (recent(l.firstSeen)) s.new24h++;
      if (l.status in s) s[l.status]++;
      if (src === 'linkedin' && String(l.lastSeen || '') > lastLinkedInLeadAt) lastLinkedInLeadAt = l.lastSeen;
      if (l.status === 'skipped') {
        const r = String(l.reason || '');
        const hits = WHY.filter(([, re]) => re.test(r)).map(([label]) => label);
        for (const label of hits.length ? hits : ['other']) {
          skipReasons.all[label] = (skipReasons.all[label] || 0) + 1;
          if (src === 'linkedin') skipReasons.linkedin[label] = (skipReasons.linkedin[label] || 0) + 1;
        }
        if (typeof l.fit === 'number' && l.fit >= 0.35 && l.fit < minFit()) nearMiss++;
      }
    }
    res.json({
      updatedAt: new Date().toISOString(),
      queueLength: queue.length,
      waitingForOfficeHours: queue.filter((j) => !(j.force || !c.tzAware || inBusinessHours(j.tz))).length,
      sentToday: store.sentToday(),
      dailyLimit: c.dailyLimit,
      sentTotal: store.all().filter((r) => (r.sends || []).length > 0).length,
      leadsTotal: leads.size,
      minFit: minFit(),
      tzAware: c.tzAware,
      sources,
      skipReasons,
      skippedJustBelowLimit: nearMiss,
      lastLinkedInLeadAt,
    });
  });

  // Everything the website's mail list shows: waiting, sent, skipped and failed
  app.get('/api/mail/overview', auth, (req, res) => {
    const c = cfg();
    const waitingFor = (j) => (j.force || !c.tzAware || inBusinessHours(j.tz) ? '' : "waiting for the recruiter's office hours");
    res.json({
      now: Date.now(),
      queue: queue.map((j) => ({
        email: j.email,
        type: j.type,
        company: j.company || '',
        person: j.person || '',
        role: j.role || '',
        fit: j.fit,
        query: j.query || '',
        postUrl: j.postUrl || '',
        queuedAt: j.queuedAt,
        waiting: waitingFor(j),
      })),
      sent: store
        .all()
        .filter((r) => (r.sends || []).length > 0)
        .map((r) => ({
          email: r.email,
          company: r.company || '',
          role: r.role || '',
          subject: r.subject || '',
          at: r.sends[r.sends.length - 1],
          followUps: r.followUps || 0,
          replied: Boolean(r.replied),
          bounced: Boolean(r.bounced),
          postUrl: r.postUrl || '',
        }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 200),
      skipped: history.filter((h) => h.status === 'skipped' || h.status === 'failed').slice(0, 100),
      cancelledCount: cancelled.size,
      leadsTotal: leads.size,
    });
  });

  // Every address ever found, as a CSV for download (the website fetches it with the key)
  app.get('/api/mail/leads.csv', auth, (req, res) => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [...leads.entries()].sort((a, b) => String(b[1].lastSeen).localeCompare(String(a[1].lastSeen)));
    const csv = [
      'email,status,first_seen,last_seen,times_seen,company,role,fit,keyword,post_url,reason',
      ...rows.map(([e, r]) => [e, r.status || '', r.firstSeen, r.lastSeen, r.seen, r.company, r.role, r.fit, r.query, r.postUrl, r.reason].map(q).join(',')),
    ].join('\n');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="all-emails.csv"' }).send(csv);
  });

  // Take mails out of the waiting list. { emails: [...] } or { all: true }
  app.post('/api/mail/cancel', auth, (req, res) => {
    const { emails = [], all = false } = req.body || {};
    const pick = new Set(emails.map((e) => String(e).trim().toLowerCase()));
    let n = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i];
      if (j.type !== 'first' && !all) continue; // follow-ups are cancelled only with "all"
      if (!all && !pick.has(j.email)) continue;
      queue.splice(i, 1);
      queued.delete(`${j.type}:${j.email}`);
      if (j.type === 'first') {
        cancelled.add(j.email);
        mark(j.email, { status: 'cancelled' });
      }
      note({ email: j.email, status: 'skipped', reason: 'cancelled by you' });
      n++;
    }
    persistQueue();
    persistCancelled();
    res.json({ cancelled: n, queueLength: queue.length });
  });

  // Skip the wait for the recruiter's office hours for one mail
  app.post('/api/mail/sendnow', auth, (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const job = queue.find((j) => j.email === email);
    if (!job) return res.status(404).json({ error: 'Not in the queue any more.' });
    job.force = true;
    persistQueue();
    if (wake) wake();
    work();
    res.json({ ok: true });
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
        enabled: c.enabled,
        dryRun: c.dryRun,
        tzAware: c.tzAware,
        followUps: followUpsEnabled() ? `${maxFollowUps()} after ${followUpDays()} days` : 'off',
        minFit: minFit(),
        storage: dbEnabled() ? 'database' : 'files',
        sendVia: c.dryRun ? 'dry run' : c.gmailApi ? 'Gmail API (HTTPS)' : 'SMTP',
      },
      recent: history,
    });
  });
}
