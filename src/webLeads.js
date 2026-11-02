import { enqueueEmails } from './autoMailer.js';
import { selectedQueries, JOB_CATEGORIES } from './searchKeywords.js';
import { GROUP_NAME_RE } from './blocklist.js';
import { addManual } from './manualLeads.js';
import { tailorResume, minFit } from './tailor/index.js';
import { agencyPitch } from './tailor/agency.js';

// Web lead hunter: finds fresh public posts and pages that carry a contact email.
//  1. Google Custom Search (free 100 queries/day) when GOOGLE_CSE_KEY + GOOGLE_CSE_CX are set, results from the past week.
//  2. DuckDuckGo HTML search (no key) as the fallback, past week.
//  3. Brave Search API when BRAVE_API_KEY is set (free plan).
//  4. Public feeds: Mastodon hashtags (5 servers), HN comments, DEV.to, GitHub issues. Reddit blocks servers (403), so it is not used.
// Every page found is fetched, the emails are read from its text and queued with the text around the email,
// so the normal fit check, blocklist, 7-day rule and tailoring all apply. Nothing is mailed from here directly.
const UA = 'Mozilla/5.0 (compatible; jobhunting-bot; personal freelance search)';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
const BAD_EMAIL = /(no-?reply|do-?not-?reply|donotreply|example\.|sentry|wixpress|@2x|\.(png|jpe?g|gif|svg|webp|css|js)$|^user@|^name@|^email@|^you@|^your)/i;
const SKIP_HOST = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|youtube\.com|google\.[a-z.]+|twitter\.com|x\.com|pinterest\.com|tiktok\.com|upwork\.com|freelancer\.com|indeed\.com|glassdoor\.com|clutch\.co|goodfirms\.co|designrush\.com|sortlist\.com|crunchbase\.com|wikipedia\.org|yelp\.com|medium\.com|quora\.com)$/i;
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
  return new TextDecoder('utf-8').decode(json ? buf : buf.slice(0, 600 * 1024));
}

// ---- search engines ----
async function googleCse(q, fresh = true) {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return null; // not configured
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}${fresh ? '&dateRestrict=w1' : ''}&num=10`;
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

// Brave Search API: official, free plan, needs BRAVE_API_KEY
async function brave(q, fresh = true) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}${fresh ? '&freshness=pw' : ''}&count=20`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const d = await res.json();
  return (d.web?.results || []).map((r) => ({ url: r.url, snippet: `${r.title || ''} ${htmlToText(r.description || '')}` }));
}

async function search(q, fresh = true) {
  for (const engine of [googleCse, brave]) {
    try {
      const r = await engine(q, fresh);
      if (r) return r;
    } catch (e) {
      console.log(`Web hunt: ${engine.name} search failed (${e.message})`);
    }
  }
  return duckDuckGo(q);
}

// ---- public feeds and APIs (no scraping of protected pages) ----
const WEEK_MS = 7 * 24 * 3600 * 1000;
// people offering their own work are competitors, not clients
const SEEKER = /#getfedihired|#opentowork|open to work|available for (?:hire|work|freelance)|(?:i am|i'm|i’m) (?:a |an )?[\w .+/-]{0,40}(?:developer|engineer|designer)[^.]{0,80}(?:available|for hire|hire me|looking for)|hire me|seeking (?:work|employment|a job)|looking for (?:a )?(?:job|work|new role|opportunit)|my (?:portfolio|resume|cv)\b/i;

const MASTODON = ['mastodon.social', 'fosstodon.org', 'hachyderm.io', 'mastodon.online', 'techhub.social', 'mas.to', 'indieweb.social'];
const MASTODON_TAGS = ['hiring', 'freelance', 'devjobs', 'jobopening', 'remotework', 'webdev', 'jobs', 'freelancer', 'remotejobs', 'contractwork', 'hireadeveloper', 'wordpress'];

async function mastodon() {
  const out = [];
  for (const host of MASTODON) {
    for (const tag of MASTODON_TAGS) {
      try {
        const posts = JSON.parse(await fetchText(`https://${host}/api/v1/timelines/tag/${tag}?limit=40`, { json: true }));
        for (const p of posts) {
          if (!p.created_at || Date.now() - Date.parse(p.created_at) > WEEK_MS) continue;
          out.push({ url: p.url, text: htmlToText(p.content || ''), label: 'Mastodon' });
        }
      } catch (e) {
        console.log(`Web hunt: ${host} #${tag} skipped (${e.message})`);
      }
      await sleep(400);
    }
  }
  return out;
}

const HN_COMMENT_QUERIES = ['hiring freelance developer', 'looking for freelance developer', 'looking for a freelancer', 'need a developer contract', 'seeking freelancer', 'freelance react developer', 'freelance node developer', 'contract developer email'];
async function hnComments() {
  const out = [];
  const since = Math.floor((Date.now() - WEEK_MS) / 1000);
  for (const q of HN_COMMENT_QUERIES) {
    try {
      const d = JSON.parse(await fetchText(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=comment&numericFilters=created_at_i>${since}&hitsPerPage=50`, { json: true }));
      for (const h of d.hits || []) out.push({ url: `https://news.ycombinator.com/item?id=${h.objectID}`, text: htmlToText(h.comment_text || ''), label: 'HN comments' });
    } catch (e) {
      console.log(`Web hunt: HN "${q}" skipped (${e.message})`);
    }
    await sleep(300);
  }
  return out;
}

async function devTo() {
  const out = [];
  for (const tag of ['hiring', 'freelance', 'jobs', 'remotework']) {
    try {
      const list = JSON.parse(await fetchText(`https://dev.to/api/articles?tag=${tag}&per_page=15&top=7`, { json: true }));
      for (const a of list) {
        const art = JSON.parse(await fetchText(`https://dev.to/api/articles/${a.id}`, { json: true }));
        out.push({ url: a.url, text: htmlToText(`${a.title}. ${art.body_html || ''}`), label: 'DEV.to' });
        await sleep(1200);
      }
    } catch (e) {
      console.log(`Web hunt: DEV.to #${tag} skipped (${e.message})`);
      if (/429/.test(e.message)) break; // rate limited: stop and try again at the next run
    }
    await sleep(1500);
  }
  return out;
}

// GitHub issues and discussions asking for a freelance developer (public search API, 10 requests/min without a token)
async function github() {
  const out = [];
  const since = new Date(Date.now() - WEEK_MS).toISOString().slice(0, 10);
  for (const q of ['"looking for" freelance developer', 'hiring freelance developer', 'need developer contract paid']) {
    try {
      const d = JSON.parse(await fetchText(`https://api.github.com/search/issues?q=${encodeURIComponent(`${q} in:title,body created:>${since} is:open`)}&per_page=30&sort=created`, { json: true }));
      for (const i of d.items || []) out.push({ url: i.html_url, text: `${i.title}. ${i.body || ''}`, label: 'GitHub' });
    } catch (e) {
      console.log(`Web hunt: GitHub "${q}" skipped (${e.message})`);
    }
    await sleep(7000);
  }
  return out;
}

async function feeds() {
  const settled = await Promise.allSettled([mastodon(), hnComments(), devTo(), github()]);
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).filter((i) => i.url && i.text && !SEEKER.test(i.text));
}


// ---- company website: a post with a link but no email ----
const LINK_RE = /https?:\/\/[^\s<>"')\]]+/g;
const SOCIAL = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|github|reddit|medium|t|wa|discord|bit|lnkd|goo|forms\.gle|docs\.google|notion|calendly|mastodon|news\.ycombinator)\./i;
const SITE_PAGES = ['', '/contact', '/contact-us', '/about', '/careers'];
const PREFERRED = /^(hr|jobs?|careers?|hiring|talent|recruit\w*|work|contact|hello|hi|info|team|office|admin|support)@/i;

function companySite(text) {
  for (const raw of text.match(LINK_RE) || []) {
    const u = safeUrl(raw.replace(/[.,;]+$/, ''));
    if (!u) continue;
    const host = new URL(u).hostname.replace(/^www\./, '');
    if (SOCIAL.test(host) || /\.(pdf|png|jpe?g)$/i.test(u)) continue;
    return { origin: new URL(u).origin, host };
  }
  return null;
}

// Public contact addresses of the company that wrote the post: its own domain, from the home, contact, about and careers pages.
// At most 3 are returned, role mailboxes (hr@, careers@, contact@, info@) first.
export async function siteEmails(text) {
  const site = companySite(text);
  if (!site) return [];
  const found = new Set();
  for (const page of SITE_PAGES) {
    try {
      const html = await fetchText(site.origin + page);
      const mailto = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]));
      for (const e of [...mailto, ...(htmlToText(html).match(EMAIL_RE) || [])]) {
        const email = e.toLowerCase();
        if (!BAD_EMAIL.test(email) && email.split('@')[1]?.endsWith(site.host.split('.').slice(-2).join('.'))) found.add(email);
      }
    } catch {
      /* page missing or blocked: try the next one */
    }
    if (found.size >= 3) break;
    await sleep(400);
  }
  return [...found].sort((a, b) => Number(PREFERRED.test(b)) - Number(PREFERRED.test(a))).slice(0, 3);
}

// A post that fits but has no email at all goes to the owner's "reach out by hand" list
export function offerManual(url, source, text, state) {
  const fit = tailorResume(text).analysis.fit;
  if (fit >= minFit() && addManual({ url, source, text })) state.manual = (state.manual || 0) + 1;
}

// Emails of a post, else of the company website (max 12 website lookups per run), else the manual list
export async function emailsForPost(text, url, source, state) {
  const direct = pickEmails(text);
  if (direct.length) return direct;
  if ((state.siteLookups || 0) < 12 && companySite(text) && tailorResume(text).analysis.fit >= minFit()) {
    state.siteLookups = (state.siteLookups || 0) + 1;
    const viaSite = await siteEmails(text);
    if (viaSite.length) return viaSite;
  }
  offerManual(url, source, text, state);
  return [];
}


// ---- agency outreach: companies that may need a freelancer but have posted nothing ----
// Once a day (first hunt after midnight India time): search web design / software agencies and startups in the focus regions,
// read the public contact emails from their own website, and queue one short offer each. Off with AGENCY_OUTREACH=false.
const AGENCY_QUERIES = [
  'web development agency dubai', 'software development company dubai', 'digital agency abu dhabi', 'web design company uae',
  'web development agency toronto', 'software company vancouver', 'digital agency calgary', 'web design agency canada',
  'web development company tokyo', 'software development company japan english', 'digital agency osaka',
  'web development agency singapore', 'software company sydney', 'web design agency melbourne',
  'web development agency london', 'software development company berlin', 'digital agency amsterdam',
  'web development agency doha qatar', 'software company riyadh saudi arabia', 'startup studio dubai',
];
let agencyDay = '';

export async function huntAgencies(state) {
  if (process.env.AGENCY_OUTREACH === 'false') return;
  const day = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  if (day === agencyDay) return;
  const cap = Number(process.env.AGENCY_PER_DAY) || 10;
  const queries = [...AGENCY_QUERIES].sort(() => Math.random() - 0.5).slice(0, 5);
  const sites = new Map();
  for (const q of queries) {
    try {
      for (const h of await search(q, false)) {
        const url = safeUrl(h.url);
        if (!url) continue;
        const origin = new URL(url).origin;
        if (!sites.has(origin)) sites.set(origin, q);
      }
    } catch (e) {
      console.log(`Agency hunt: search "${q}" failed (${e.message})`);
    }
    await sleep(1500);
  }
  if (!sites.size) return; // no search key or no results: try again at the next hunt
  agencyDay = day;
  const pitch = agencyPitch();
  let queued = 0;
  for (const [origin, q] of sites) {
    if (queued >= cap) break;
    try {
      const emails = await siteEmails(origin);
      if (!emails.length) continue;
      state.scanned++;
      state.matched++;
      const r = enqueueEmails(emails.slice(0, 1), `Agency outreach: ${q}`, origin, '', {}, { subject: pitch.subject, body: pitch.body });
      if (r.error) throw new Error(r.error);
      queued += r.accepted || 0;
      state.queued += r.accepted || 0;
    } catch (e) {
      if (/Sender Gmail/.test(e.message)) throw e;
    }
  }
  console.log(`Agency hunt: ${sites.size} sites looked at, ${queued} queued`);
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
  for (const r of await feeds()) if (!pages.has(r.url)) pages.set(r.url, { text: r.text, label: r.label });

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
          const emails = await emailsForPost(text, url, info.label, state);
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

// Counts only, nothing is queued: which sources give pages with a contact email right now
export async function previewFeeds() {
  const items = await feeds();
  const by = {};
  for (const i of items) {
    const b = (by[i.label] ||= { items: 0, withEmail: 0 });
    b.items++;
    if (pickEmails(i.text).length && HIRING_WORDS.test(i.text)) b.withEmail++;
  }
  return by;
}
