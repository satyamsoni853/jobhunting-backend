import fs from 'fs';
import path from 'path';

// LinkedIn search queries per job category. The website lets the user multiselect categories,
// the extension then searches every query of the selected categories.
export const JOB_CATEGORIES = {
  freelancing: {
    label: 'Freelancing',
    queries: [
      'looking for freelancer',
      'hiring a freelancer',
      'freelancer in us',
      'need a freelance developer',
      'freelance developer needed',
      'hiring freelance web developer',
      'looking for freelance developer',
      'freelance project developer',
      'hiring freelancers for project',
      'contract developer needed',
      'hiring contract developer',
      'short term project developer',
      'need freelancer for website',
      'looking for freelance react developer',
      'looking for freelance full stack developer',
      'freelance software developer hiring',
      'hiring freelance mobile app developer',
      'freelance opportunity developer',
      'dm me freelance developer',
      'email resume freelance developer',
    ],
  },
  frontend: {
    label: 'Frontend Developer',
    queries: [
      'hiring frontend developer',
      'we are hiring frontend developer',
      'looking for frontend developer',
      'frontend developer opening',
      'hiring react developer',
      'looking for react developer',
      'react js developer vacancy',
      'hiring next.js developer',
      'hiring angular developer',
      'hiring vue js developer',
      'hiring ui developer',
      'frontend engineer hiring',
      'hiring javascript developer',
      'hiring typescript developer',
      'frontend developer send resume',
      'frontend developer email your resume',
      'react developer immediate joiner',
      'junior frontend developer hiring',
      'frontend developer opportunity',
      'we are looking for react frontend engineer',
    ],
  },
  backend: {
    label: 'Backend Developer',
    queries: [
      'hiring backend developer',
      'we are hiring backend developer',
      'looking for backend developer',
      'backend developer opening',
      'hiring node.js developer',
      'looking for node js developer',
      'hiring express js developer',
      'hiring python backend developer',
      'hiring django developer',
      'hiring java backend developer',
      'hiring golang developer',
      'hiring php laravel developer',
      'backend engineer hiring',
      'hiring api developer',
      'backend developer send resume',
      'backend developer email your resume',
      'node.js developer immediate joiner',
      'junior backend developer hiring',
      'backend developer opportunity',
      'we are looking for node backend engineer',
    ],
  },
  fullstack: {
    label: 'Full Stack Developer',
    queries: [
      'hiring full stack developer',
      'we are hiring full stack developer',
      'looking for full stack developer',
      'full stack developer opening',
      'hiring mern stack developer',
      'looking for mern developer',
      'hiring mean stack developer',
      'full stack engineer hiring',
      'hiring full stack javascript developer',
      'hiring react node developer',
      'hiring next.js full stack developer',
      'full stack developer send resume',
      'full stack developer email your resume',
      'fullstack developer immediate joiner',
      'junior full stack developer hiring',
      'full stack developer opportunity',
      'we are looking for full stack engineer',
      'hiring full stack python developer',
      'hiring full stack java developer',
      'full stack developer vacancy',
    ],
  },
  remote: {
    label: 'Remote Developer',
    queries: [
      'hiring remote developer',
      'remote developer position',
      'looking for remote developer',
      'remote software engineer hiring',
      'hiring remote react developer',
      'hiring remote node developer',
      'hiring remote full stack developer',
      'hiring remote frontend developer',
      'hiring remote backend developer',
      'work from home developer hiring',
      'work from home software developer',
      'fully remote developer role',
      'remote first company hiring developers',
      'remote developer send resume',
      'remote developer email your resume',
      'remote developer immediate joiner',
      'remote developer job india',
      'remote developer job us',
      'remote junior developer hiring',
      'we are hiring remote engineers',
    ],
  },
};

// Selected categories survive restarts (same DATA_DIR as the sent log)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SELECTION_FILE = path.join(DATA_DIR, 'search-selection.json');

export function loadSelection() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf8'));
    return parsed.filter((k) => JOB_CATEGORIES[k]);
  } catch {
    return [];
  }
}

export function saveSelection(categories) {
  const valid = [...new Set(categories)].filter((k) => JOB_CATEGORIES[k]);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SELECTION_FILE, JSON.stringify(valid));
  return valid;
}

export function selectedQueries() {
  const queries = loadSelection().flatMap((k) => JOB_CATEGORIES[k].queries);
  return [...new Set(queries)];
}

export function registerSearchRoutes(app, authMiddleware) {
  // Public: the website lists the categories and the user's current selection
  app.get('/api/job-categories', (req, res) => {
    res.json({
      categories: Object.entries(JOB_CATEGORIES).map(([key, c]) => ({
        key,
        label: c.label,
        queries: c.queries,
      })),
      selected: loadSelection(),
    });
  });

  app.put('/api/job-categories/selection', (req, res) => {
    const { selected } = req.body;
    if (!Array.isArray(selected)) return res.status(400).json({ error: 'selected must be an array' });
    res.json({ selected: saveSelection(selected) });
  });

  // Key protected: the extension fetches the queries it should search
  app.get('/api/search-queries', authMiddleware, (req, res) => {
    const queries = selectedQueries();
    res.json({ selected: loadSelection(), count: queries.length, queries });
  });
}
