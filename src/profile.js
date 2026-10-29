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

// Same lookup the mailer uses: base64 from env (public repos), else a local file
export function loadResume() {
  const filename = process.env.RESUME_FILENAME || 'Satyam_Soni_Resume.pdf';
  if (process.env.RESUME_BASE64) return { filename, buffer: Buffer.from(process.env.RESUME_BASE64, 'base64') };
  const file = process.env.RESUME_PATH || path.join(process.cwd(), 'resume', 'resume.pdf');
  if (fs.existsSync(file)) return { filename, buffer: fs.readFileSync(file) };
  return null;
}

export function registerProfile(app, auth) {
  // Public: only the text that is sent in every mail anyway
  app.get('/api/profile/satyam', (req, res) => {
    const subject = process.env.AUTO_SUBJECT || PROFILE.subject;
    const body = process.env.AUTO_BODY ? process.env.AUTO_BODY.replace(/\\n/g, '\n') : PROFILE.body;
    res.json({ name: PROFILE.name, email: PROFILE.email, subject, body });
  });

  // Key protected: the resume PDF is not served to the public
  app.get('/api/profile/satyam/resume', auth, (req, res) => {
    const resume = loadResume();
    if (!resume) return res.status(404).json({ error: 'Resume not configured on the server' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${resume.filename}"`);
    res.send(resume.buffer);
  });
}
