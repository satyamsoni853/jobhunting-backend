import { enqueueEmails, satyamStatus } from './autoMailer.js';

// The simple send screen: after the login code the owner pastes recipients and presses Send.
// The sender Gmail and the resume stay on the server. Everything goes through the normal queue, so the blocklist,
// email check, 30 to 60 second gap between mails and the daily limit all still apply.
const MAX_PER_BATCH = 200;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

export function registerSatyamSend(app, guard) {
  app.post('/api/satyam/send', guard, (req, res) => {
    const raw = String(req.body.recipients || '');
    const emails = [...new Set((raw.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
    if (!emails.length) return res.status(400).json({ error: 'No valid email address found. Paste one address per line.' });
    if (emails.length > MAX_PER_BATCH) return res.status(400).json({ error: `Send at most ${MAX_PER_BATCH} addresses at a time.` });

    const subject = String(req.body.subject || '').trim().slice(0, 300);
    const body = String(req.body.body || '').trim().slice(0, 8000);
    const override = subject && body ? { subject, body } : null; // empty: the default Satyam message is used
    const r = enqueueEmails(emails, 'Satyam send', '', '', {}, override);
    if (r.error) return res.status(503).json({ error: 'The sender Gmail is not set up on the server yet. Add SMTP_PASS in the server settings.' });
    res.json({ total: emails.length, queued: r.accepted, blockedOrSkipped: emails.length - r.accepted, queueLength: r.queueLength });
  });

  app.get('/api/satyam/status', guard, (req, res) => res.json(satyamStatus()));
}
