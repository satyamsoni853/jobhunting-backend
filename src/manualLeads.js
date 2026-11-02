import { getKv, setKv, dbEnabled } from './db.js';

// Posts that fit but carry no email, even after looking at the company website. They are kept here so the owner can
// reach out by hand (a DM, a comment, a contact form). Newest first, at most 300, saved to the database when there is one.
let list = [];
const MAX = 300;

export async function initManual() {
  if (!dbEnabled()) return;
  try {
    list = JSON.parse((await getKv('manual')) || '[]');
  } catch {
    list = [];
  }
}

const save = () => {
  if (dbEnabled()) setKv('manual', JSON.stringify(list));
};

export function addManual({ url, source, text }) {
  if (!url || list.some((m) => m.url === url)) return false;
  const title = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  list.unshift({ url, source: source || '', title, at: new Date().toISOString() });
  if (list.length > MAX) list.length = MAX;
  save();
  return true;
}

export function registerManual(app, auth) {
  app.get('/api/leads/manual', auth, (req, res) => res.json({ count: list.length, leads: list }));
  app.post('/api/leads/manual/done', auth, (req, res) => {
    const url = String((req.body || {}).url || '');
    list = list.filter((m) => m.url !== url);
    save();
    res.json({ count: list.length });
  });
}
