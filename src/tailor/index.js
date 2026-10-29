import { analyzePost } from './analyze.js';
import { buildContent } from './build.js';
import { renderPdf } from './pdf.js';
import { SKILL_BY_ID } from './kb.js';

// Posts that fit worse than this are not mailed. Set MIN_FIT=0 to mail everything.
export const minFit = () => (process.env.MIN_FIT !== undefined ? Number(process.env.MIN_FIT) : 0.45);

// text: the recruiter's post. Returns the analysis plus the tailored subject, body and resume content.
export function tailorResume(text) {
  const analysis = analyzePost(text);
  const content = buildContent(analysis);
  return { analysis, content, subject: content.subject, body: content.body };
}

export { renderPdf };

export function registerTailor(app, auth) {
  // Preview what would be sent for a post: JSON with the analysis and the tailored text
  app.post('/api/tailor/preview', auth, (req, res) => {
    const text = String(req.body.text || '');
    if (text.trim().length < 20) return res.status(400).json({ error: 'Paste the job post text (at least a few words).' });
    const t = tailorResume(text);
    const a = t.analysis;
    res.json({
      role: a.roleLabel,
      fit: a.fit,
      wouldSend: a.fit >= minFit(),
      minFit: minFit(),
      matchedSkills: a.matched.map((id) => SKILL_BY_ID[id].name),
      gaps: a.gaps,
      yearsRequired: a.yearsRequired,
      reasons: a.reasons,
      subject: t.subject,
      body: t.body,
      title: t.content.title,
      summary: t.content.summary,
    });
  });

  // Same, as the actual PDF
  app.post('/api/tailor/pdf', auth, async (req, res) => {
    const text = String(req.body.text || '');
    if (text.trim().length < 20) return res.status(400).json({ error: 'Paste the job post text (at least a few words).' });
    const pdf = await renderPdf(tailorResume(text).content);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="Satyam_Soni_Resume.pdf"');
    res.send(pdf);
  });
}
