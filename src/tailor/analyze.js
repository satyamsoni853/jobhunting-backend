import { SKILLS, SKILL_BY_ID, ROLES, SENIOR_RE, JUNIOR_RE, MY_YEARS, SIGNALS } from './kb.js';

// Generic skills say little about the role, so they count less when judging how well the candidate covers a post
const GENERIC = new Set(['rest', 'html', 'css', 'git', 'sql', 'linux', 'postman', 'responsive', 'websockets', 'docker', 'javascript']);

const countMatches = (re, text) => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return (text.match(g) || []).length;
};

// Clean a post: HN and LinkedIn text has urls, emails and bullets that only add noise
export function normalizePost(raw) {
  return String(raw || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/[•·|]/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

// Smallest number of years the post asks for, read only when "experience" is near the number
function requiredYears(text) {
  let min = null;
  const re = /(\d{1,2})\s*\+?\s*(?:-|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)/gi;
  let m;
  while ((m = re.exec(text))) {
    const around = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (!/experience|exp\b|relevant|professional|developing|development/i.test(around)) continue;
    const n = Number(m[1]);
    if (n > 20) continue;
    if (min === null || n > min) min = n; // the highest "minimum" mentioned is what screens candidates out
  }
  return min;
}

export function analyzePost(rawText) {
  const text = normalizePost(rawText);
  const head = text.slice(0, 300);

  // ---- skills the post mentions ----
  const found = {};
  for (const s of SKILLS) {
    const n = countMatches(s.re, text);
    if (n) found[s.id] = n + (s.re.test(head) ? 1 : 0); // the first lines are the title, they count more
  }

  // related skills get a small boost so they sort up, but are not treated as required
  const boost = {};
  for (const id of Object.keys(found)) {
    for (const rel of SKILL_BY_ID[id].implies) if (!found[rel]) boost[rel] = (boost[rel] || 0) + 0.3;
  }

  const have = Object.keys(found).filter((id) => SKILL_BY_ID[id].have);
  const gaps = Object.keys(found).filter((id) => !SKILL_BY_ID[id].have);

  // ---- role ----
  // Freelance and intern describe the terms, not the field, so a field role (react, backend...) wins when it is clear
  let best = null;
  let bestTerms = null;
  const scores = [];
  for (const r of ROLES) {
    let score = 0;
    if (r.title.test(head)) score += 3;
    else if (r.title.test(text)) score += 1.5;
    score += Math.min(countMatches(r.body, text), 3) * 0.5;
    score += r.skills.filter((id) => found[id]).length * 0.3;
    scores.push([r.id, +score.toFixed(2)]);
    const isTerms = r.id === 'freelance' || r.id === 'intern';
    if (score > 0 && isTerms && (!bestTerms || score > bestTerms.score)) bestTerms = { role: r, score };
    // on a tie the more cautious role (lower fit) is used
    if (score > 0 && !isTerms && (!best || score > best.score || (score === best.score && r.fit < best.role.fit))) {
      best = { role: r, score };
    }
  }
  if ((!best || best.score < 1.5) && bestTerms) best = bestTerms;

  // ---- seniority, years ----
  const signals = Object.fromEntries(Object.entries(SIGNALS).map(([k, re]) => [k, re.test(text)]));
  const senior = SENIOR_RE.test(head);
  // "junior" only counts when the title says so or the post welcomes freshers, not when a senior role mentions interns
  const junior = JUNIOR_RE.test(head) || /fresher|entry[- ]level|new grads?|graduates? welcome|0\s?-\s?[12]\s*(?:yrs?|years)/i.test(text);
  const years = requiredYears(text);

  // ---- coverage and fit ----
  const weight = (id) => (GENERIC.has(id) ? 0.4 : 1);
  const allW = Object.keys(found).reduce((a, id) => a + weight(id), 0);
  const haveW = have.reduce((a, id) => a + weight(id), 0);
  // A post that only mentions generic skills (REST, Git...) tells us nothing about a real match
  const coreFound = Object.keys(found).filter((id) => !GENERIC.has(id));
  let coverage = allW ? haveW / allW : null;
  if (coverage !== null && coreFound.length === 0) coverage = 0.25;

  const roleFit = best ? best.role.fit : 0.4; // no role found: the post may not be a job at all
  let fit = coverage === null ? roleFit * 0.5 : roleFit * 0.55 + coverage * 0.45;

  const reasons = [];
  if (best && best.role.fit === 0) reasons.push(`role is ${best.role.label}, not a match`);
  if (senior && !JUNIOR_RE.test(head)) {
    fit -= 0.45;
    reasons.push('senior or lead level');
  }
  // the candidate works remotely from India: an office or hybrid job with no remote option is out of reach
  if ((signals.onsite || signals.onsiteOnly) && !signals.remote) {
    fit -= 0.35;
    reasons.push('on-site or hybrid, no remote option');
  }
  if (years !== null && years > MY_YEARS) {
    const gap = years - MY_YEARS;
    fit -= gap >= 3 ? 0.4 : gap === 2 ? 0.2 : 0.08;
    reasons.push(`asks ${years}+ years, candidate has about ${MY_YEARS}`);
  }
  if (signals.regionLock) {
    fit -= 0.35;
    reasons.push('open only to a region that does not include India');
  }
  if (coreFound.length === 0) {
    fit = Math.min(fit, 0.3); // no real skill of the candidate is mentioned
    reasons.push('no matching skills in the post');
  }
  if (signals.visa) {
    fit -= 0.3;
    reasons.push('work authorization or citizenship restriction');
  }
  if (junior) fit += 0.08;
  if (best && best.role.fit === 0) fit = Math.min(fit, 0.15);
  fit = Math.max(0, Math.min(1, fit));

  // matched skills sorted by how strongly the post asks for them
  const matched = have
    .map((id) => [id, (found[id] || 0) + (boost[id] || 0)])
    .concat(Object.entries(boost).filter(([id]) => SKILL_BY_ID[id].have && !found[id]))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  return {
    roleId: best ? best.role.id : 'default',
    roleLabel: best ? best.role.label : 'Full Stack Developer',
    roleFit,
    fit: +fit.toFixed(2),
    matched: [...new Set(matched)],
    gaps: gaps.map((id) => SKILL_BY_ID[id].name),
    coverage: coverage === null ? null : +coverage.toFixed(2),
    yearsRequired: years,
    senior,
    junior,
    signals,
    reasons,
    scores: scores.filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}
