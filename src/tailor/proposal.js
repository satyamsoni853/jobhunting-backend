import { analyzePost } from './analyze.js';
import { SKILL_BY_ID } from './kb.js';
import { MASTER } from './master.js';

// A short bid / proposal text for a freelance project, built from the project description (rules only, no AI).
// The owner copies it and pastes it into the bid box of the site himself.
export function buildProposal({ title = '', text = '', budget = '' } = {}) {
  const a = analyzePost(`${title}. ${text}`);
  const skills = a.matched
    .filter((id) => !['html', 'css', 'git', 'sql', 'rest', 'responsive'].includes(id))
    .slice(0, 4)
    .map((id) => SKILL_BY_ID[id].name);
  const stack = skills.length ? skills.join(', ') : 'React.js, Next.js, Node.js';
  const frontendish = ['frontend', 'react', 'nextjs', 'angular'].includes(a.roleId);
  const proof = a.matched.includes('websockets')
    ? 'I have built real-time chat and activity updates with WebSockets for a job portal and a social platform.'
    : frontendish
    ? 'I recently built the Next.js frontend of a travel booking platform with responsive layouts, and animated React interfaces before that.'
    : 'I recently delivered a travel booking website end to end, from the Next.js frontend to the REST API integration and booking flows.';
  const cleanTitle = String(title).replace(/\s+/g, ' ').trim().slice(0, 90);
  return [
    'Hello,',
    '',
    `I read your project${cleanTitle ? ` "${cleanTitle}"` : ''} and I can help. I work with ${stack}, and I deliver full stack projects remotely.`,
    '',
    proof,
    '',
    `Portfolio: https://${MASTER.portfolio}`,
    '',
    `I can start right away. Please share any details I should know (scope, timeline, existing code or designs). I will reply with a clear plan and an estimate${budget ? `, and confirm whether your budget of ${budget} works` : ''}.`,
    '',
    'Best regards,',
    MASTER.name,
  ].join('\n');
}
