import { enqueueEmails } from './autoMailer.js';
import { loadSelection } from './searchKeywords.js';
import { GROUP_NAME_RE } from './blocklist.js';

// Server-side lead hunter. Source: the monthly Hacker News "Who is hiring?" thread (public Algolia API),
// where recruiters post an email to apply to. Job boards like RemoteOK/WWR only give apply links, no emails.
const HN_SEARCH =
  'https://hn.algolia.com/api/v1/search_by_date?query=who%20is%20hiring&tags=story,author_whoishiring&hitsPerPage=5';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SKIP_EMAIL = /\.(png|jpe?g|gif|svg|webp)$/i;

// Words that make a posting match a selected category
const CATEGORY_WORDS = {
  freelancing: /freelanc|contract(or)?\b|part[- ]time/i,
  frontend: /front[- ]?end|react|vue|angular|next\.?js|javascript|typescript|\bui\b/i,
  backend: /back[- ]?end|node(\.?js)?|express|python|django|golang|\bgo\b|java\b|php|laravel|\bapi\b/i,
  fullstack: /full[- ]?stack|mern|mean\b/i,
  remote: /remote/i,
  internship: /intern(ship)?\b|fresher|entry[- ]level|junior|graduate/i,
  mobile: /react[- ]native|flutter|mobile|android|\bios\b|swift|kotlin/i,
  python: /python|django|flask|fastapi/i,
  java: /\bjava\b|spring|kotlin/i,
  devops: /devops|\bsre\b|aws|kubernetes|docker|cloud|terraform|infrastructure/i,
  aiml: /machine learning|\bml\b|\bai\b|\bllm\b|data scien|deep learning/i,
  wordpress: /wordpress|shopify|woocommerce|webflow/i,
  mern: /\bmern\b|mongodb|react.{0,40}node|node.{0,40}react/i,
  reactjs: /react(\.?js)?\b/i,
  nextjs: /next\.?js/i,
  nodejs: /node(\.?js)?\b/i,
  angular: /angular/i,
  vue: /\bvue(\.?js)?\b|nuxt/i,
  javascript: /javascript|typescript|\bjs\b|\bts\b/i,
  php: /\bphp\b|laravel|symfony/i,
  dotnet: /\.net\b|dotnet|c#|asp\.net/i,
  golang: /golang|\bgo\s+(developer|engineer|backend|lang)/i,
  android: /android|kotlin/i,
  ios: /\bios\b|swift|objective-c/i,
  data: /data (analyst|engineer|scien)|\bsql\b|analytics|etl|bigquery|snowflake/i,
  qa: /\bqa\b|quality assurance|test(er|ing)|sdet|automation test/i,
  uiux: /ui\/?ux|product design|designer|figma/i,
  blockchain: /blockchain|web3|solidity|smart contract|crypto/i,
  webdev: /web developer|software engineer|software developer|\bswe\b|\bsde\b/i,
};

const state = { running: false, startedAt: null, finishedAt: null, scanned: 0, matched: 0, queued: 0, error: null };

const stripHtml = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'jobhunting-bot (personal job search)' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function runHunt() {
  const selected = loadSelection();
  const matchers = (selected.length ? selected : Object.keys(CATEGORY_WORDS)).map((k) => CATEGORY_WORDS[k]);

  const search = await getJson(HN_SEARCH);
  const thread = search.hits.find((h) => /^Ask HN: Who is hiring\?/i.test(h.title));
  if (!thread) throw new Error('No "Who is hiring?" thread found');

  const item = await getJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
  // Top level comments are the individual job postings
  for (const post of item.children || []) {
    if (!post.text) continue;
    state.scanned++;
    const text = stripHtml(post.text);
    if (GROUP_NAME_RE.test(text)) continue; // never apply to the user's own employer group
    if (!matchers.some((re) => re.test(text))) continue;
    const emails = (text.match(EMAIL_RE) || []).filter((e) => !SKIP_EMAIL.test(e));
    if (!emails.length) continue;
    state.matched++;
    const result = enqueueEmails(emails, 'HN Who is hiring', `https://news.ycombinator.com/item?id=${post.id}`);
    if (result.error) throw new Error(result.error);
    state.queued += result.accepted || 0;
  }
}

export function startHunt() {
  if (state.running) return { started: false, state };
  Object.assign(state, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    scanned: 0,
    matched: 0,
    queued: 0,
    error: null,
  });
  runHunt()
    .catch((e) => {
      state.error = e.message;
      console.error('Hunt failed:', e.message);
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });
  return { started: true, state };
}

export function registerHunter(app, auth) {
  app.post('/api/hunt/start', auth, (req, res) => res.json(startHunt()));
  app.get('/api/hunt/status', auth, (req, res) => res.json(state));
}
