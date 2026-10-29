import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

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
  subject: process.env.AUTO_SUBJECT || 'Application for Software Engineer Position - Satyam Soni',
  body:
    (process.env.AUTO_BODY ||
      'Dear Hiring Team,\\n\\nI am writing to apply for the Software Engineer role. I am an expert in full-stack Javascript, React, and Node.js.\\n\\nI have attached my resume. Looking forward to hearing from you!\\n\\nBest,\\nSatyam Soni').replace(/\\n/g, '\n'),
  resumePath: process.env.RESUME_PATH || path.join(process.cwd(), 'resume', 'resume.pdf'),
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
    try {
      transporter ||= nodemailer.createTransport({ service: 'gmail', auth: { user: c.user, pass: c.pass } });
      const name = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
      const attachments = process.env.RESUME_BASE64
        ? [{ filename: name, content: Buffer.from(process.env.RESUME_BASE64, 'base64') }]
        : fs.existsSync(c.resumePath)
          ? [{ filename: name, path: c.resumePath }]
          : [];
      const lead = { email: job.email, query: job.query || '', link: job.postUrl || '' };
      const info = await transporter.sendMail({
        from: `"${c.user.split('@')[0]}" <${c.user}>`,
        to: job.email,
        subject: personalize(c.subject, lead),
        text: personalize(c.body, lead),
        attachments,
      });
      sent[job.email] = new Date().toISOString();
      saveSent();
      history.unshift({ email: job.email, status: 'success', at: sent[job.email], id: info.messageId });
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

export function registerAutoMailer(app) {
  const auth = requireKey;

  app.post('/api/auto-enqueue', auth, (req, res) => {
    const c = cfg();
    if (!c.enabled) return res.json({ accepted: 0, message: 'Auto-send disabled' });
    if (!c.user || !c.pass) return res.status(500).json({ error: 'SMTP_USER / SMTP_PASS not set on server' });

    const { emails = [], query = '', postUrl = '' } = req.body;
    let accepted = 0;
    for (const raw of Array.isArray(emails) ? emails : [emails]) {
      const email = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(email) || sent[email] || queued.has(email)) continue;
      queued.add(email);
      queue.push({ email, query, postUrl });
      accepted++;
    }
    work();
    res.json({ accepted, queueLength: queue.length });
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
