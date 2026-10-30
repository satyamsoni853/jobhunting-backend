import { SKILL_BY_ID, ROLES } from './kb.js';
import { MASTER } from './master.js';
import { greeting } from '../company.js';

// Skills used to pad the title line when the post names fewer than three that the candidate has
const ROLE_DEFAULTS = {
  frontend: ['react', 'nextjs', 'typescript', 'javascript'],
  react: ['react', 'javascript', 'typescript', 'redux'],
  nextjs: ['nextjs', 'react', 'typescript', 'tailwind'],
  backend: ['nodejs', 'java', 'python', 'rest'],
  java: ['java', 'springboot', 'hibernate', 'mysql'],
  python: ['python', 'fastapi', 'rest', 'postgres'],
  node: ['nodejs', 'express', 'nestjs', 'mongodb'],
  mern: ['mongodb', 'express', 'react', 'nodejs'],
  angular: ['angular', 'typescript', 'javascript', 'react'],
  default: ['react', 'nextjs', 'java', 'python'],
};

const name = (id) => SKILL_BY_ID[id].name;
const list = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// Score of a bullet or project: how many of its tags the post asked for, earlier asks count more
const relevance = (tags, matched) =>
  tags.reduce((sum, t) => {
    const i = matched.indexOf(t);
    return sum + (i === -1 ? 0 : 1 + (matched.length - i) / (matched.length + 1));
  }, 0);

// who: { company, person }. The note greets the person (or the company team) and the subject and note name the company.
export function buildContent(a, who = {}) {
  const { company = '', person = '' } = typeof who === 'string' ? { company: who } : who;
  const matched = a.matched;
  const roleId = a.roleId;

  // ---- title line ----
  const defaults = ROLE_DEFAULTS[roleId] || ROLE_DEFAULTS.default;
  // the role's own skills lead (Next.js role: Next.js, React.js first), then the rest of what the post asked for
  const roleSkills = (ROLES.find((r) => r.id === roleId)?.skills || []).filter((id) => matched.includes(id) && SKILL_BY_ID[id].have);
  const top = [...new Set([...roleSkills, ...matched.filter((id) => !['html', 'css', 'git', 'sql', 'rest'].includes(id)), ...defaults])]
    .slice(0, 4)
    .map(name);
  const title = `${a.roleLabel} | ${top.join(', ')}`;

  // ---- summary ----
  let summary = MASTER.summaries[roleId] || MASTER.summaries.default;
  if (a.signals.remote) summary = summary.replace(/ Available immediately\.$/, ' Comfortable working remotely. Available immediately.');
  if (a.gaps.includes('ERP / SAP') && !/ERP/.test(summary)) {
    summary = summary.replace(/ Available immediately\.$/, ' Experience integrating ERP business workflows, with exposure to SAP environments. Available immediately.');
  }

  // ---- skills: groups with the most matches first, matched skills first inside a group ----
  const groups = MASTER.skillGroups
    .map((g, i) => ({
      group: g.group,
      order: i,
      hits: g.ids.filter((id) => matched.includes(id)).length,
      items: [...g.ids].sort((x, y) => {
        const ix = matched.indexOf(x);
        const iy = matched.indexOf(y);
        if (ix === -1 && iy === -1) return g.ids.indexOf(x) - g.ids.indexOf(y);
        if (ix === -1) return 1;
        if (iy === -1) return -1;
        return ix - iy;
      }).map(name),
    }))
    .sort((x, y) => y.hits - x.hits || x.order - y.order);

  // ---- experience and projects: most relevant first, nothing removed here ----
  const experience = MASTER.experience.map((job) => ({
    ...job,
    bullets: [...job.bullets]
      .map((b, i) => ({ ...b, i, score: relevance(b.tags, matched) }))
      .sort((x, y) => y.score - x.score || x.i - y.i),
  }));
  const projects = [...MASTER.projects]
    .map((p, i) => ({ ...p, i, score: relevance(p.tags, matched) }))
    .sort((x, y) => y.score - x.score || x.i - y.i);

  // ---- subject and cover note ----
  const subjectSkills = top.slice(0, 3).join(', ');
  const subject = company
    ? `Application for ${a.roleLabel} at ${company} (${top.slice(0, 2).join(', ')}) - ${MASTER.name}`
    : `Application for ${a.roleLabel} (${subjectSkills}) - ${MASTER.name}`;

  const backendRole = ['backend', 'java', 'python', 'node'].includes(roleId);
  const frontendRole = ['frontend', 'react', 'nextjs', 'mern', 'angular'].includes(roleId);
  let fact = MASTER.noteFacts.default;
  if (matched.includes('websockets') || /real[- ]time/i.test(a.reasonsText || '')) fact = MASTER.noteFacts.realtime;
  else if (roleId === 'freelance') fact = MASTER.noteFacts.freelance;
  else if (backendRole) fact = MASTER.noteFacts.backend;
  else if (frontendRole) fact = MASTER.noteFacts.frontend;

  const opening =
    roleId === 'freelance'
      ? `I am writing to offer my help on freelance and contract projects. I am a Full Stack Developer with hands-on experience in ${list(top)}.`
      : `I am writing to apply for the ${a.roleLabel} role${company ? ` at ${company}` : ''}. I am a Full Stack Developer with hands-on experience in ${list(top)}.`;
  const closing = `My resume is attached, arranged for this role. I am available to join immediately${a.signals.remote ? ' and comfortable working remotely' : ''}, and happy to share more details or take a technical round at your convenience.`;

  const body = [
    greeting({ person, company }),
    '',
    opening,
    '',
    fact,
    '',
    closing,
    '',
    'Thank you for your time.',
    '',
    'Best regards,',
    MASTER.name,
    `LinkedIn: https://www.${MASTER.linkedin}/`,
    `GitHub: https://${MASTER.github}`,
  ].join('\n');

  return { title, summary, groups, experience, projects, subject, body };
}
