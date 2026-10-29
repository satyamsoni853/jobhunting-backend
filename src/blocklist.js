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
  // Dr. Anmol Kapoor's other companies (domains as listed on his LinkedIn profile)
  'albertacardiology.ca',
  'southernalbertamedical.ca',
  'advancedcardiology.ca',
];

import { getSmtp } from './smtp.js';

const GROUP_EMAILS = ['satya.soni@kapoorwealth.com', 'satyam.soni1312@gmail.com', 'satyamsoni853@gmail.com'];

// Company and owner names. A hiring post that mentions one of these is skipped by the hunter.
export const GROUP_NAME_RE =
  /kapoor\s*wealth|\bkwp\b|bio\s?aro\b|golden\s*sands|cardi\s?ai\b|anryton|biochain|panomiq|vautra|biongevity|genelio|xevyo|dil\s*walk|anmol\s*kapoor|panaum|antisocial\s*talks|alberta\s*cardiology|southern\s*alberta\s*medical|advanced\s*cardiology\s*consultants/i;

const list = (v) =>
  (v || '')
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// Posts written by these people are skipped, whatever email they contain. Set BLOCK_AUTHORS=profile-slug,Full Name
// (a LinkedIn profile slug such as jane-doe-123abc, or the exact name). Kept in env, not in code, because it names people.
export function isBlockedAuthor(author = {}) {
  const profile = String(author.profile || '').toLowerCase();
  const name = String(author.name || '').trim().toLowerCase();
  // split on commas only: a full name contains spaces
  const authors = (process.env.BLOCK_AUTHORS || '').split(/[,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  return authors.some((a) => (profile && profile.includes(a)) || (name && name === a));
}

// Env can add more: BLOCK_DOMAINS=a.com,b.com  BLOCK_EMAILS=x@y.com
export function isBlocked(email) {
  const e = String(email).trim().toLowerCase();
  const domain = e.split('@')[1] || '';
  const domains = [...GROUP_DOMAINS, ...list(process.env.BLOCK_DOMAINS)];
  const emails = [...GROUP_EMAILS, ...list(process.env.BLOCK_EMAILS), getSmtp().user.toLowerCase()];

  if (emails.includes(e)) return true;
  // matches the domain itself and any subdomain (mail.kapoorwealth.com)
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}
