// Addresses that must never be mailed: the user's own employer group, their own mailboxes and anything
// listed in env. Checked when an email is queued and again right before it is sent.

// Kapoor Wealth Partners ecosystem (same companies as the client's "Ecosystem Alert & Verifier")
const GROUP_DOMAINS = [
  'kapoorwealth.com',
  'kapoorwealthpartners.com',
  'bioaro.com',
  'goldensandsestate.com',
  'goldensands.com',
  'goldensandsrealestate.com',
  'cardiai.com',
  'anryton.com',
  'panomiq.com',
  'vautra.com',
  'biongevity.com',
  'genelio.com',
  'xevyo.com',
  'dilwalk.ca',
  'dilwalk.com',
];

const GROUP_EMAILS = ['satya.soni@kapoorwealth.com'];

// Company and owner names. A hiring post that mentions one of these is skipped by the hunter.
export const GROUP_NAME_RE =
  /kapoor\s*wealth|\bkwp\b|bio\s?aro\b|golden\s*sands|cardi\s?ai\b|anryton|biochain|panomiq|vautra|biongevity|genelio|xevyo|dil\s*walk|anmol\s*kapoor/i;

const list = (v) =>
  (v || '')
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// Env can add more: BLOCK_DOMAINS=a.com,b.com  BLOCK_EMAILS=x@y.com
export function isBlocked(email) {
  const e = String(email).trim().toLowerCase();
  const domain = e.split('@')[1] || '';
  const domains = [...GROUP_DOMAINS, ...list(process.env.BLOCK_DOMAINS)];
  const emails = [...GROUP_EMAILS, ...list(process.env.BLOCK_EMAILS), (process.env.SMTP_USER || '').toLowerCase()];

  if (emails.includes(e)) return true;
  // matches the domain itself and any subdomain (mail.kapoorwealth.com)
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}
