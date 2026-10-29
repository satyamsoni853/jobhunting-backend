import { greeting } from './company.js';

// Follow-up mails: one polite reminder a few days after the first mail, only to people who have not replied.

export const followUpsEnabled = () => process.env.FOLLOWUP_ENABLED !== 'false';
// Nobody gets a second mail within a week of the last one, whatever FOLLOWUP_DAYS says
export const MIN_GAP_DAYS = 7;
export const followUpDays = () => Math.max(MIN_GAP_DAYS, Number(process.env.FOLLOWUP_DAYS || MIN_GAP_DAYS)); 
export const maxFollowUps = () => Number(process.env.MAX_FOLLOWUPS ?? 1);

const DAY = 24 * 3600 * 1000;

// rec: a store record. True when a follow-up should now be queued for it.
export function dueForFollowUp(rec, now = Date.now()) {
  if (!followUpsEnabled()) return false;
  if (rec.status !== 'sent' || rec.replied || rec.bounced || rec.unsubscribed) return false;
  if (!rec.messageId) return false; // needed to thread the follow-up under the first mail
  if ((rec.followUps || 0) >= maxFollowUps()) return false;
  const last = (rec.sends || []).at(-1);
  if (!last) return false;
  return now - new Date(last).getTime() >= followUpDays() * DAY;
}

export function followUpContent(rec, signature) {
  const role = rec.role || 'Full Stack Developer';
  return {
    subject: rec.subject?.startsWith('Re:') ? rec.subject : `Re: ${rec.subject || `Application for ${role}`}`,
    text: [
      greeting({ person: rec.person, company: rec.company }),
      '',
      `I wanted to follow up on my application for the ${role} role, in case it got buried. I remain very interested and am available to join immediately.`,
      '',
      'If the position has been filled or is no longer open, please let me know and I will not follow up again.',
      '',
      'Thank you for your time.',
      '',
      'Best regards,',
      signature,
    ].join('\n'),
  };
}
