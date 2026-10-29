// Rule based extraction from a job post: the company name and the recruiter's time zone.

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'proton.me', 'protonmail.com', 'aol.com', 'rediffmail.com', 'zoho.com', 'gmx.com', 'mail.com',
]);

// Words that can look like a company name at the start of a post but are not one
const NOT_A_NAME = /^(?:we|our|the|a|an|my|i|hi|hello|hiring|looking|remote|onsite|on-site|hybrid|full[- ]?time|part[- ]?time|contract|location|apply|job|jobs|role|roles|position|senior|junior|lead|staff|principal|founding|software|frontend|backend|full[- ]?stack|developer|engineer|multiple|all|seeking|freelancer|urgent|new|new role|opening|openings|team|company|startup)\b/i;

const clean = (s) => s.replace(/\s+/g, ' ').replace(/[.,;:!]+$/, '').trim();

function plausible(name) {
  const n = clean(name);
  if (n.length < 2 || n.length > 40) return false;
  if (NOT_A_NAME.test(n)) return false;
  if (/https?:|@|\d{3,}|[$€£]/.test(n)) return false;
  if (!/^[A-Z0-9]/.test(n)) return false; // company names start with a capital in posts
  return n.split(' ').length <= 4;
}

function fromDomain(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain || FREE_MAIL.has(domain)) return '';
  const parts = domain.split('.');
  // acme-labs.co.uk -> acme-labs ; skip country second level (co, com, org)
  let sld = parts[parts.length - 2];
  if (['co', 'com', 'org', 'net', 'ac', 'gov'].includes(sld) && parts.length >= 3) sld = parts[parts.length - 3];
  const name = sld.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return name.length >= 2 ? name : '';
}

// Returns the company name, or '' when nothing reliable is found (the greeting then stays "Hiring Team")
export function companyFromPost(text, email = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();

  // 1. "Acme Labs | Senior Engineer | Remote": the first segment of a pipe separated headline
  const head = t.slice(0, 160);
  if (head.includes('|')) {
    const first = clean(head.split('|')[0]);
    if (plausible(first)) return first;
  }

  // 2. Sentences: "Acme is hiring", "join Acme", "hiring at Acme"
  const cap = '([A-Z][\\w&.-]*(?: [A-Z][\\w&.-]*){0,3})';
  const patterns = [
    new RegExp(`${cap} (?:is|are) (?:hiring|looking|seeking|growing)`),
    new RegExp(`\\b(?:join|joining) ${cap}`),
    new RegExp(`\\b(?:hiring|opening|role|position|job|jobs) (?:at|with) ${cap}`),
    new RegExp(`\\bwork(?:ing)? (?:at|for|with) ${cap}`),
    new RegExp(`^${cap} (?:\\(|-|–|—|:)`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && plausible(m[1])) return clean(m[1]);
  }

  // 3. The domain of a company email
  return fromDomain(email);
}

// ---- the person: first name from an address like ankit.sharma@acme.com ----
// Mailboxes that belong to a team, not a person
const GENERIC_LOCAL = new Set([
  'hr', 'jobs', 'job', 'career', 'careers', 'hiring', 'hire', 'recruit', 'recruiting', 'recruiter', 'recruiters', 'recruitment',
  'talent', 'team', 'info', 'contact', 'hello', 'hi', 'hey', 'admin', 'support', 'sales', 'apply', 'applications', 'application',
  'resume', 'resumes', 'cv', 'people', 'staff', 'office', 'mail', 'email', 'enquiry', 'inquiry', 'enquiries', 'work', 'join',
  'founders', 'founder', 'engineering', 'tech', 'dev', 'devs', 'marketing', 'press', 'help', 'general', 'opportunities',
  'openings', 'vacancies', 'humanresources', 'peopleops', 'talentacquisition', 'ta', 'internships', 'intern',
]);

// Returns a capitalised first name, or '' when the address does not clearly name a person.
// first.last / first_last / first-last is trusted. A single word (ankit@) is trusted only when the post writes that
// name with a capital letter, so "jobs@" or "lazarbukejlovic@" never become "Dear Jobs".
export function personFromEmail(email, text = '') {
  const local = String(email || '').split('@')[0].toLowerCase();
  if (!local || /\d/.test(local)) return '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const first = parts[0];
  if (!first || !/^[a-z]{2,14}$/.test(first) || GENERIC_LOCAL.has(first) || GENERIC_LOCAL.has(local.replace(/[._-]/g, ''))) return '';
  const name = first.charAt(0).toUpperCase() + first.slice(1);

  if (parts.length >= 2) {
    // "info.sales", "jobs.india" etc: skip when the second word is generic too
    return parts.slice(1).some((p) => !GENERIC_LOCAL.has(p)) ? name : '';
  }
  return first.length <= 10 && new RegExp(`\\b${name}\\b`).test(String(text)) ? name : '';
}

// "Dear Ankit," when a person is known, else "Dear Acme Labs Team,", else "Dear Hiring Team,"
export const greeting = ({ person, company } = {}) => (person ? `Dear ${person},` : company ? `Dear ${company} Team,` : 'Dear Hiring Team,');

// ---- time zone: UTC offset in hours of where the recruiter likely works, or null ----
const ZONES = [
  [/\bindia\b|bangalore|bengaluru|mumbai|delhi|gurgaon|gurugram|hyderabad|pune|chennai|noida|kolkata|\bist\b/i, 5.5],
  [/\bsydney\b|melbourne|australia|\baest\b/i, 10],
  [/singapore|hong kong|manila|\bsgt\b|philippines/i, 8],
  [/dubai|abu dhabi|\buae\b|\bgst\b|oman/i, 4],
  [/berlin|paris|amsterdam|madrid|rome|vienna|zurich|switzerland|germany|france|spain|italy|poland|croatia|\bcet\b|\bcest\b|europe|\beu\b/i, 1],
  [/london|\buk\b|united kingdom|ireland|dublin|lisbon|portugal|\bgmt\b|\bbst\b/i, 0],
  [/new york|\bnyc\b|boston|miami|atlanta|toronto|washington|\bdc\b|philadelphia|\best\b|\bedt\b|east coast/i, -5],
  [/chicago|austin|dallas|houston|texas|denver|\bcst\b|\bcdt\b|central time/i, -6],
  [/san francisco|\bsf\b|bay area|seattle|los angeles|\bla\b|portland|vancouver|california|silicon valley|\bpst\b|\bpdt\b|pacific/i, -8],
  [/\bus\b|usa|united states|north america|americas/i, -6], // generic US: assume central
];

export function timezoneFromPost(text, email = '') {
  const t = String(text || '').slice(0, 1500);
  for (const [re, off] of ZONES) if (re.test(t)) return off;
  // fall back to the email country code when it says something
  const tld = String(email).split('.').pop();
  const byTld = { in: 5.5, au: 10, uk: 0, de: 1, fr: 1, nl: 1, es: 1, it: 1, ae: 4, sg: 8, ca: -5 };
  return byTld[tld] ?? null;
}

// true when it is 09:00-18:00 on a weekday at the given offset. A null offset means "unknown": send any time.
export function inBusinessHours(offsetHours, now = new Date()) {
  if (offsetHours === null || offsetHours === undefined) return true;
  const local = new Date(now.getTime() + offsetHours * 3600 * 1000);
  const day = local.getUTCDay();
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}
