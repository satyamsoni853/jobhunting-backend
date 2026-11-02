import { MASTER } from './master.js';

// First mail to an agency or software company that has not posted anything: an offer of extra capacity, not a reply to a post.
// The default resume is attached by the mailer.
export function agencyPitch() {
  // No rate or price in this mail (the owner's rule).
  return {
    subject: `Freelance full stack developer for your projects - ${MASTER.name}`,
    body: [
      'Dear Hiring Team,',
      '',
      `I am ${MASTER.name}, a freelance Full Stack Developer working with React.js, Next.js, Node.js, Spring Boot and FastAPI. If your team ever needs extra development capacity on a project, I can take it on as a remote, project-based contractor.`,
      '',
      `My work: https://${MASTER.portfolio}`,
      '',
      `I can start quickly and align my working hours with your time zone. If it helps, I can send an estimate for a project you have in mind.`,
      '',
      'Best regards,',
      MASTER.name,
      `Portfolio: https://${MASTER.portfolio}`,
      `LinkedIn: https://www.${MASTER.linkedin}/`,
      `GitHub: https://${MASTER.github}`,
    ].join('\n'),
  };
}
