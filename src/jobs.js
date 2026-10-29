import { analyzePost } from './tailor/analyze.js';
import { SKILL_BY_ID } from './tailor/kb.js';
import { minFit } from './tailor/index.js';
import { loadSelection } from './searchKeywords.js';

// Public job boards. They give an apply link, not a recruiter email, so these jobs are listed for the user
// to open and apply to by hand. Each job links back to its source (Remote OK asks for this in its API terms).
const UA = { 'User-Agent': 'jobhunting-bot (personal job search)' };
const TTL = 30 * 60 * 1000;
let cache = { at: 0, jobs: [], errors: [] };

const decode = (s) =>
  String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
const strip = (html) => decode(decode(html)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const getText = async (url) => {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
};

// ---- one fetcher per source, each returns [{ id, source, title, company, location, url, postedAt, text }] ----
async function remoteOk() {
  const data = JSON.parse(await getText('https://remoteok.com/api'));
  return data
    .filter((j) => j.position)
    .map((j) => ({
      id: `rok-${j.id}`,
      source: 'Remote OK',
      title: j.position,
      company: j.company,
      location: j.location || '',
      url: j.url || j.apply_url,
      postedAt: j.date,
      text: `${strip(j.description)} ${(j.tags || []).join(' ')}`,
    }));
}

async function remotive() {
  const data = JSON.parse(await getText('https://remotive.com/api/remote-jobs?category=software-dev&limit=100'));
  return (data.jobs || []).map((j) => ({
    id: `rem-${j.id}`,
    source: 'Remotive',
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || '',
    url: j.url,
    postedAt: j.publication_date,
    text: `${strip(j.description)} ${(j.tags || []).join(' ')}`,
  }));
}

async function himalayas() {
  const data = JSON.parse(await getText('https://himalayas.app/jobs/api?limit=100'));
  return (data.jobs || []).map((j) => ({
    id: `him-${j.guid || j.title}`,
    source: 'Himalayas',
    title: j.title,
    company: j.companyName,
    location: (j.locationRestrictions || []).join(', '),
    url: j.applicationLink || j.guid,
    postedAt: typeof j.pubDate === 'number' ? new Date(j.pubDate * 1000).toISOString() : j.pubDate,
    text: `${strip(j.description)} ${(j.categories || []).join(' ')} ${j.seniority || ''}`,
  }));
}

const WWR_FEEDS = ['remote-full-stack-programming-jobs', 'remote-front-end-programming-jobs', 'remote-back-end-programming-jobs', 'remote-programming-jobs', 'remote-devops-sysadmin-jobs'];
async function weWorkRemotely() {
  const out = [];
  for (const feed of WWR_FEEDS) {
    const xml = await getText(`https://weworkremotely.com/categories/${feed}.rss`);
    for (const item of xml.split('<item>').slice(1)) {
      const tag = (n) => (item.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1] || '';
      const full = decode(tag('title')); // "Company: Position"
      const i = full.indexOf(': ');
      out.push({
        id: `wwr-${tag('guid') || full}`,
        source: 'We Work Remotely',
        title: i > 0 ? full.slice(i + 2) : full,
        company: i > 0 ? full.slice(0, i) : '',
        location: decode(tag('region')),
        url: decode(tag('link') || tag('guid')),
        postedAt: tag('pubDate'),
        text: strip(tag('description')),
      });
    }
  }
  return out;
}

async function remotiveExtra() {
  // Remotive's own search finds freelance and contract work that the developer category misses
  const out = [];
  for (const term of ['freelance', 'contract']) {
    const data = JSON.parse(await getText(`https://remotive.com/api/remote-jobs?search=${term}&limit=60`));
    for (const j of data.jobs || []) {
      out.push({
        id: `rem-${j.id}`,
        source: 'Remotive',
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || '',
        url: j.url,
        postedAt: j.publication_date,
        text: `${strip(j.description)} ${(j.tags || []).join(' ')} ${j.job_type || ''}`,
      });
    }
  }
  return out;
}

async function jobicy() {
  const data = JSON.parse(await getText('https://jobicy.com/api/v2/remote-jobs?count=100'));
  return (data.jobs || []).map((j) => ({
    id: `jby-${j.id}`,
    source: 'Jobicy',
    title: decode(j.jobTitle),
    company: decode(j.companyName),
    location: Array.isArray(j.jobGeo) ? j.jobGeo.join(', ') : String(j.jobGeo || ''),
    url: j.url,
    postedAt: j.pubDate,
    text: `${strip(j.jobDescription)} ${[].concat(j.jobIndustry || [], j.jobType || []).join(' ')} ${j.jobLevel || ''}`,
  }));
}

async function arbeitnow() {
  const data = JSON.parse(await getText('https://www.arbeitnow.com/api/job-board-api'));
  return (data.data || [])
    .filter((j) => j.remote) // the rest are on-site jobs in Germany
    .map((j) => ({
      id: `arb-${j.slug}`,
      source: 'Arbeitnow',
      title: decode(j.title),
      company: decode(j.company_name),
      location: j.location || '',
      url: j.url,
      postedAt: typeof j.created_at === 'number' ? new Date(j.created_at * 1000).toISOString() : j.created_at,
      text: `${strip(j.description)} ${(j.tags || []).join(' ')} ${(j.job_types || []).join(' ')}`,
    }));
}

async function workingNomads() {
  const data = JSON.parse(await getText('https://www.workingnomads.com/api/exposed_jobs/'));
  return data.map((j) => ({
    id: `wn-${j.url}`,
    source: 'Working Nomads',
    title: decode(j.title),
    company: decode(j.company_name),
    location: j.location || '',
    url: j.url,
    postedAt: j.pub_date,
    text: `${strip(j.description)} ${j.tags || ''} ${j.category_name || ''}`,
  }));
}

const SOURCES = [remoteOk, remotive, remotiveExtra, himalayas, weWorkRemotely, jobicy, arbeitnow, workingNomads];

// The candidate works remotely from India: jobs limited to another region are out of reach
const OPEN_LOCATION = /worldwide|anywhere|global|international|\bindia\b|apac|asia|^remote$|^$/i;

// A job board lists every kind of job. Only developer type titles are worth matching.
const DEV_TITLE = /develop|engineer|programmer|\bsde\b|\bswe\b|software|front[- ]?end|back[- ]?end|full[- ]?stack|\breact\b|\bnode|\bpython\b|\bjava\b|web (?:dev|app)|coder/i;

// What each website category looks for. A job is shown for a chosen category when its title or tags match.
// A chosen category with no line here (Remote, Web / Software Engineer) accepts every developer job.
const CATEGORY_MATCH = {
  freelancing: /freelanc|contract(?:or)?\b|\bgig\b|part[- ]time|project[- ]based|short[- ]term|\bconsultant/i,
  frontend: /front[- ]?end|\breact|\bvue|angular|\bui\b|javascript|typescript|html|css/i,
  backend: /back[- ]?end|\bnode|python|\bjava\b|\bgo(?:lang)?\b|\bphp|\.net|\bapi\b|server[- ]side|ruby|rails/i,
  fullstack: /full[- ]?stack|\bmern\b|\bmean\b/i,
  internship: /intern(?:ship)?\b|fresher|graduate|entry[- ]level|junior|trainee/i,
  mobile: /mobile|react native|flutter|android|\bios\b|swift|kotlin/i,
  python: /python|django|flask|fastapi/i,
  java: /\bjava\b|spring/i,
  devops: /devops|\bsre\b|cloud|aws|kubernetes|infrastructure|platform engineer/i,
  aiml: /machine learning|\bml\b|\bai\b|artificial intelligence|llm|data scien|deep learning|nlp/i,
  wordpress: /wordpress|shopify|woocommerce|webflow|\bcms\b/i,
  mern: /\bmern\b|mongo|express|react|node/i,
  reactjs: /\breact(?:\.?js)?\b|next\.?js/i,
  nextjs: /next\.?js/i,
  nodejs: /node\.?js|\bnode\b|express|nest\.?js/i,
  angular: /angular/i,
  vue: /\bvue|nuxt/i,
  javascript: /javascript|typescript|\bjs\b|\bts\b/i,
  php: /\bphp\b|laravel|symfony|wordpress/i,
  dotnet: /\.net|c#|asp\.net|dotnet/i,
  golang: /golang|\bgo\b/i,
  android: /android|kotlin/i,
  ios: /\bios\b|swift|iphone/i,
  data: /data (?:analyst|engineer|analytics)|\bsql\b|\betl\b|analytics engineer|business intelligence/i,
  qa: /\bqa\b|quality assurance|test(?:er|ing)|sdet|automation engineer/i,
  uiux: /\bux\b|\bui\b|product designer|figma|web designer/i,
  blockchain: /blockchain|web3|solidity|smart contract|crypto|ethereum/i,
};

function matchesCategories(job, keys) {
  const rules = keys.map((k) => CATEGORY_MATCH[k]);
  if (rules.some((re) => !re)) return true; // a chosen category without a rule accepts everything
  const head = `${job.title} ${job.tags}`;
  return rules.some((re) => re.test(head) || (re === CATEGORY_MATCH.freelancing && re.test(job.blurb)));
}

function score(job) {
  const a = analyzePost(`${job.title}. ${job.title}. ${job.text}`);
  let fit = a.fit;
  const reasons = [...a.reasons];
  if (!DEV_TITLE.test(job.title)) {
    fit = Math.min(fit, 0.2);
    reasons.push('not a developer role');
  }
  const loc = (job.location || '').trim();
  if (loc && !OPEN_LOCATION.test(loc)) {
    fit = Math.max(0, fit - 0.35);
    reasons.push(`location: ${loc}`);
  }
  return {
    id: job.id,
    source: job.source,
    title: job.title,
    company: job.company,
    location: loc || 'Worldwide',
    url: job.url,
    postedAt: job.postedAt,
    role: a.roleLabel,
    fit: +fit.toFixed(2),
    skills: a.matched.slice(0, 6).map((id) => SKILL_BY_ID[id].name),
    gaps: a.gaps.slice(0, 4),
    reasons,
    tags: job.text.slice(-300),
    blurb: job.text.slice(0, 1200),
  };
}

async function refresh() {
  const errors = [];
  const results = await Promise.allSettled(SOURCES.map((s) => s()));
  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') jobs.push(...r.value);
    else errors.push(`${SOURCES[i].name}: ${r.reason.message}`);
  });
  const seen = new Set();
  const scored = jobs
    .filter((j) => j.url && j.title && !seen.has(j.url) && seen.add(j.url))
    .map(score);
  cache = { at: Date.now(), jobs: scored, errors, total: jobs.length };
}

export async function getJobs({ min = minFit(), limit = 60, q = '', source = '', categories = [] } = {}) {
  if (Date.now() - cache.at > TTL) await refresh();
  let list = cache.jobs.filter((j) => j.fit >= min);
  if (categories.length) list = list.filter((j) => matchesCategories(j, categories));
  if (source) list = list.filter((j) => j.source.toLowerCase() === source.toLowerCase());
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((j) => `${j.title} ${j.company} ${j.skills.join(' ')}`.toLowerCase().includes(needle));
  }
  list = list
    .sort((a, b) => b.fit - a.fit || String(b.postedAt).localeCompare(String(a.postedAt)))
    .slice(0, limit)
    .map(({ tags, blurb, ...job }) => job); // the matching text stays on the server
  return { updatedAt: new Date(cache.at).toISOString(), sources: [...new Set(cache.jobs.map((j) => j.source))].sort(), categories, scanned: cache.total, minFit: min, errors: cache.errors, jobs: list };
}

export function registerJobs(app) {
  // Public: job listings are public data. Cached for 30 minutes so the sources are not hammered.
  app.get('/api/jobs', async (req, res) => {
    try {
      const min = req.query.minFit !== undefined ? Number(req.query.minFit) : minFit();
      res.json(await getJobs({ min, limit: Math.min(Number(req.query.limit) || 60, 150), q: String(req.query.q || ''), source: String(req.query.source || ''), categories: req.query.selected === '1' ? loadSelection() : [] }));
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
}
