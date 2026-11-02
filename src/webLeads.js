import { enqueueEmails } from './autoMailer.js';
import { selectedQueries, JOB_CATEGORIES } from './searchKeywords.js';
import { GROUP_NAME_RE } from './blocklist.js';

// Web lead hunter: finds fresh public posts and pages that carry a contact email.
//  1. Google Custom Search (free 100 queries/day) when GOOGLE_CSE_KEY + GOOGLE_CSE_CX are set, results from the past week.
//  2. DuckDuckGo HTML search (no key) as the fallback, past week.
//  3. Reddit r/forhire and r/hiring new posts (public JSON).
// Every page found is fetched, the emails are read from its text and queued with the text around the email,
// so the normal fit check, blocklist, 7-day rule and tailoring all apply. Nothing is mailed from here directly.
const UA = 'Mozilla/5.0 (compatible; jobhunting-bot; personal freelance search)';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
const BAD_EMAIL = /(no-?reply|do-?not-?reply|donotreply|example\.|sentry|wixpress|@2x|\.(png|jpe?g|gif|svg|webp|css|js)$|^user@|^name@|^email@|^you@|^your)/i;
const SKIP_HOST = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|youtube\.com|google\.[a-z.]+|twitter\.com|x\.com|pinterest\.com|tiktok\.com|upwork\.com|freelancer\.com|indeed\.com|glassdoor\.com)$/i;
const PRIVATE_HOST = /^(localhost|127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\.(local|internal)$|:/i;
const HIRING_WORDS = /hiring|looking for|we need|i need|need(?:ed)? (?:a|an)\b|seeking|wanted|vacanc|opening|freelanc|contract|project|apply|send (?:your )?(?:resume|cv|portfolio)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_EMAILS_PER_PAGE = 5; // a page with dozens of addresses is a directory, not a post
const MAX_PAGES_PER_RUN = Number(process.env.WEB_MAX_PAGES) || 60;
const MAX_QUERIES_PER_RUN = Number(process.env.WEB_MAX_QUERIES) || 8;

const safeUrl = (u) => {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (PRIVATE_HOST.test(url.hostname) || SKIP_HOST.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const deobfuscate = (s) =>
  s
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.');

const htmlToText = (html) =>
  deobfuscate(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x2F;/g, '/')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
  );

async function fetchText(url, { json = false } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,*/*' }, signal: AbortSignal.timeout(9000), redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!json && !/text\/html|text\/plain|xml/i.test(type)) throw new Error('not a text page');
  const buf = await res.arrayBuffer();
  return new TextDecoder('utf-8').decode(buf.slice(0, 600 * 1024));
}

// ---- search engines ----
async function googleCse(q) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return null; // not configured
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&dateRestrict=w1&num=10`;
  const d = JSON.parse(await fetchText(url, { json: true }));
  return (d.items || []).map((i) => ({ url: i.link, snippet: `${i.title || ''} ${i.snippet || ''}` }));
}

async function duckDuckGo(q) {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&df=w`);
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].replace(/&amp;/g, '&');
    const u = href.match(/uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    out.push({ url: href, snippet: htmlToText(m[2] || '') });
  }
  return out;
}

async function search(q) {
  try {
    const g = await googleCse(q);
    if (g) return g;
  } catch (e) {
    console.log(`Web hunt: Google search failed (${e.message}), using DuckDuckGo`);
  }
  return duckDuckGo(q);
}

async function reddit() {
  const out = [];
  for (const sub of ['forhire', 'hiring']) {
    try {
      const d = JSON.parse(await fetchText(`https://www.reddit.com/r/${sub}/new.json?limit=100&raw_json=1`, { json: true }));
      for (const c of d.data?.children || []) {
        const p = c.data;
        if (!p || !/\[hiring\]|hiring/i.test(p.link_flair_text || p.title || '')) continue;
        out.push({ url: `https://www.reddit.com${p.permalink}`, text: `${p.title}. ${p.selftext || ''}` });
      }
    } catch (e) {
      console.log(`Web hunt: r/${sub} skipped (${e.message})`);
    }
  }
  return out;
}

// the text around the first email, enough for the tailor to judge the role
function windowAround(text, email) {
  const i = text.toLowerCase().indexOf(email.toLowerCase());
  const from = Math.max(0, i - 900);
  return text.slice(from, from + 1800);
}

function pickEmails(text) {
  const all = [...new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))].filter((e) => !BAD_EMAIL.test(e));
  return all.length > MAX_EMAILS_PER_PAGE ? [] : all;
}

// state: the hunter's counters. matchers: category regexes chosen on the site.
export async function huntWeb(matchers, state) {
  const chosen = selectedQueries();
  const pool = chosen.length ? chosen : JOB_CATEGORIES.freelancing.queries;
  const queries = [...pool].sort(() => Math.random() - 0.5).slice(0, MAX_QUERIES_PER_RUN);

  const pages = new Map(); // url -> {snippet, text}
  for (const r of await reddit()) pages.set(r.url, { text: r.text, label: 'Reddit hiring' });

  for (const q of queries) {
    try {
      const hits = await search(/@|email/i.test(q) ? q : `${q} email`);
      for (const h of hits) {
        const url = safeUrl(h.url);
        if (url && !pages.has(url)) pages.set(url, { snippet: h.snippet, label: 'Web search' });
      }
    } catch (e) {
      console.log(`Web hunt: search "${q}" failed (${e.message})`);
    }
    await sleep(1500);
  }

  let fetched = 0;
  const entries = [...pages.entries()];
  for (let i = 0; i < entries.length && fetched < MAX_PAGES_PER_RUN; i += 4) {
    const batch = entries.slice(i, i + 4);
    await Promise.all(
      batch.map(async ([url, info]) => {
        try {
          let text = info.text;
          if (!text) {
            fetched++;
            text = htmlToText(await fetchText(url));
            if (info.snippet) text = `${info.snippet} ${text}`;
          }
          state.scanned++;
          if (GROUP_NAME_RE.test(text)) return;
          if (!HIRING_WORDS.test(text) || !matchers.some((re) => re.test(text))) return;
          const emails = pickEmails(text);
          if (!emails.length) return;
          state.matched++;
          const result = enqueueEmails(emails, info.label, url, windowAround(text, emails[0]));
          if (result.error) throw new Error(result.error);
          state.queued += result.accepted || 0;
        } catch (e) {
          if (/Sender Gmail/.test(e.message)) throw e;
        }
      })
    );
    await sleep(500);
  }
}
