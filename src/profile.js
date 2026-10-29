import fs from 'fs';
import path from 'path';

// The "Satyam" profile: default subject and body written for the current resume. Used by the auto-mailer
// and served to the website, so both always send the same text. AUTO_SUBJECT / AUTO_BODY env can override it.
export const PROFILE = {
  name: 'Satyam Soni',
  email: 'satyam.soni1312@gmail.com',
  subject: 'Application for Full Stack Developer (Java, Python, React) - Satyam Soni',
  body: [
    'Dear Hiring Team,',
    '',
    'I am writing to apply for the Full Stack Developer role at your company. I am a Full Stack Developer based in Gurugram with experience in React.js and Next.js on the frontend, and Java (Spring Boot), Python (FastAPI) and Node.js (Express.js) on the backend, along with MySQL, PostgreSQL and MongoDB.',
    '',
    'Most recently I built a travel booking platform end to end, covering the Next.js frontend, REST API integration and the search and booking flows. Before that I built a job portal and social platform with real-time chat using WebSockets.',
    '',
    'My resume is attached. I am available to join immediately and happy to share more details or take a technical round at your convenience.',
    '',
    'Thank you for your time.',
    '',
    'Best regards,',
    'Satyam Soni',
    'LinkedIn: https://www.linkedin.com/in/satyam-soni-833873293/',
    'GitHub: https://github.com/satyamsoni853',
  ].join('\n'),
};

// "Application for Full Stack Developer (...) - Name" -> "Application for Full Stack Developer at Acme (...) - Name"
export const subjectAtCompany = (subject, company) =>
  company ? subject.replace(/^(Application for [^(]*?)( \(| - )/, `$1 at ${company}$2`) : subject;

// Same lookup the mailer uses: base64 from env (public repos), else a local file
// Order: RESUME_BASE64 env (an exact copy of the user's own PDF), then a resume file, then one built by the server
// from the master resume data (no setup needed, same one-page ATS layout as the tailored resumes).
let generated = null;
export async function loadResume() {
  const filename = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
  if (process.env.RESUME_BASE64) return { filename, buffer: Buffer.from(process.env.RESUME_BASE64.trim(), 'base64') };
  const file = process.env.RESUME_PATH || path.join(process.cwd(), 'resume', 'resume.pdf');
  if (fs.existsSync(file)) return { filename, buffer: fs.readFileSync(file) };
  if (!generated) {
    const { tailorResume, renderPdf } = await import('./tailor/index.js');
    generated = await renderPdf(tailorResume('').content); // an empty post gives the default full stack layout
  }
  return { filename, buffer: generated };
}

export function registerProfile(app, guard) {
  // Behind the login code (otp.js): the profile text and resume are not public
  app.get('/api/profile/satyam', guard, (req, res) => {
    const subject = process.env.AUTO_SUBJECT || PROFILE.subject;
    const body = process.env.AUTO_BODY ? process.env.AUTO_BODY.replace(/\\n/g, '\n') : PROFILE.body;
    res.json({ name: PROFILE.name, email: PROFILE.email, subject, body });
  });

  app.get('/api/profile/satyam/resume', guard, async (req, res) => {
    const resume = await loadResume();
    if (!resume) return res.status(404).json({ error: 'Resume not configured on the server' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${resume.filename}"`);
    res.send(resume.buffer);
  });
}
