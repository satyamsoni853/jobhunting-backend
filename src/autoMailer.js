import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { isBlocked } from './blocklist.js';
import { PROFILE } from './profile.js';
import { tailorResume, renderPdf, minFit } from './tailor/index.js';

// Auto-mailer: the LinkedIn extension pushes captured emails here, a background queue sends them one by one.
// All config comes from env so nothing sensitive lives in the extension.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SENT_FILE = path.join(DATA_DIR, 'sent.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cfg = () => ({
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  apiKey: process.env.AUTO_API_KEY,
  enabled: process.env.AUTO_SEND_ENABLED !== 'false',
  subject: process.env.AUTO_SUBJECT || PROFILE.subject,
  body: process.env.AUTO_BODY ? process.env.AUTO_BODY.replace(/\\n/g, '\n') : PROFILE.body,
  resumePath: process.env.RESUME_PATH || path.join(process.cwd(), 'resume', 'resume.pdf'),
  tailor: process.env.TAILOR_RESUME !== 'false', // per-post resume and note, set false to always send the default
  dailyLimit: Number(process.env.DAILY_LIMIT || 300), // Gmail free cap is ~500/day, stay below it
  minDelay: Number(process.env.MIN_DELAY_MS || 30000),
  maxDelay: Number(process.env.MAX_DELAY_MS || 60000),
});

let sent = {}; // email -> ISO date
try {
  sent = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'));
} catch {
  sent = {};
}
const saveSent = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));
  } catch (e) {
    console.error('Could not persist sent log:', e.message);
  }
};

const queue = [];
const queued = new Set();
let working = false;
let transporter = null;
const history = []; // last 50 results, for /api/auto-status

const sentToday = () => {
  const today = new Date().toISOString().slice(0, 10);
  return Object.values(sent).filter((d) => d.startsWith(today)).length;
};

function personalize(text, lead) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => lead[k.toLowerCase()] ?? '');
}

async function work() {
  if (working) return;
  working = true;
  const c = cfg();
  while (queue.length) {
    if (sentToday() >= c.dailyLimit) {
      console.log(`⏸️ Daily limit (${c.dailyLimit}) reached, ${queue.length} mails wait for tomorrow.`);
      await new Promise((r) => setTimeout(r, 30 * 60 * 1000));
      continue;
    }
    const job = queue.shift();
    queued.delete(job.email);
    if (sent[job.email]) continue;
    if (isBlocked(job.email)) {
      console.log(`⛔ Skipped blocked address ${job.email}`);
      continue;
    }
    try {
      transporter ||= nodemailer.createTransport({ service: 'gmail', auth: { user: c.user, pass: c.pass } });
      const name = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
      const attachments = process.env.RESUME_BASE64
        ? [{ filename: name, content: Buffer.from(process.env.RESUME_BASE64, 'base64') }]
        : fs.existsSync(c.resumePath)
          ? [{ filename: name, path: c.resumePath }]
          : [];
      const lead = { email: job.email, query: job.query || '', link: job.postUrl || '' };
      let subject = personalize(c.subject, lead);
      let text = personalize(c.body, lead);
      let tailored = null;

      // With the recruiter's post available, build the resume and note for that role (rules only, no AI)
      let finalAttachments = attachments;
      if (job.postText && c.tailor) {
        const t = tailorResume(job.postText);
        const a = t.analysis;
        if (a.fit < minFit()) {
          history.unshift({
            email: job.email,
            status: 'skipped',
            at: new Date().toISOString(),
            reason: `low fit (${a.fit}) for ${a.roleLabel}${a.reasons.length ? `: ${a.reasons.join(', ')}` : ''}`,
          });
          history.length = Math.min(history.length, 50);
          console.log(`⏭️ Skipped ${job.email}: low fit ${a.fit} (${a.roleLabel})`);
          continue;
        }
        subject = t.subject;
        text = t.body;
        finalAttachments = [{ filename: name, content: await renderPdf(t.content) }];
        tailored = { role: a.roleLabel, fit: a.fit, matched: a.matched.slice(0, 6) };
      }

      const info = await transporter.sendMail({
        from: `"${c.user.split('@')[0]}" <${c.user}>`,
        to: job.email,
        subject,
        text,
        attachments: finalAttachments,
      });
      sent[job.email] = new Date().toISOString();
      saveSent();
      history.unshift({ email: job.email, status: 'success', at: sent[job.email], id: info.messageId, tailored });
      console.log(`✔️ Auto-sent to ${job.email}`);
    } catch (e) {
      history.unshift({ email: job.email, status: 'failed', at: new Date().toISOString(), error: e.message });
      console.error(`❌ Auto-send failed for ${job.email}:`, e.message);
    }
    history.length = Math.min(history.length, 50);
    if (queue.length) await new Promise((r) => setTimeout(r, c.minDelay + Math.random() * (c.maxDelay - c.minDelay)));
  }
  working = false;
}

export const requireKey = (req, res, next) => {
  const c = cfg();
  if (!c.apiKey || req.get('X-API-Key') !== c.apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Shared by the extension endpoint and the server-side hunter. Skips invalid, already-sent and already-queued emails.
export function enqueueEmails(emails, query = '', postUrl = '', postText = '') {
  const c = cfg();
  if (!c.enabled) return { accepted: 0, message: 'Auto-send disabled' };
  if (!c.user || !c.pass) return { error: 'SMTP_USER / SMTP_PASS not set on server' };

  let accepted = 0;
  let blocked = 0;
  for (const raw of Array.isArray(emails) ? emails : [emails]) {
    const email = String(raw).trim().toLowerCase();
    if (!EMAIL_RE.test(email) || sent[email] || queued.has(email)) continue;
    if (isBlocked(email)) {
      blocked++;
      continue;
    }
    queued.add(email);
    queue.push({ email, query, postUrl, postText: String(postText || '').slice(0, 6000) });
    accepted++;
  }
  work();
  return { accepted, blocked, queueLength: queue.length };
}

export function registerAutoMailer(app) {
  const auth = requireKey;

  app.post('/api/auto-enqueue', auth, (req, res) => {
    const { emails = [], query = '', postUrl = '', postText = '' } = req.body;
    const result = enqueueEmails(emails, query, postUrl, postText);
    res.status(result.error ? 500 : 200).json(result);
  });

  app.get('/api/auto-status', auth, (req, res) => {
    res.json({
      queueLength: queue.length,
      sentToday: sentToday(),
      totalSent: Object.keys(sent).length,
      dailyLimit: cfg().dailyLimit,
      recent: history,
    });
  });
}
