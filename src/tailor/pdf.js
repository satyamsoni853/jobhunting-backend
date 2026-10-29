import PDFDocument from 'pdfkit';
import { MASTER } from './master.js';

// One page, single column, standard fonts, selectable text: parses cleanly in ATS.
const MARGIN = { top: 34, bottom: 30, left: 40, right: 40 };
const REG = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITAL = 'Helvetica-Oblique';

function draw(content, fs, cap) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: MARGIN,
      info: { Title: `${MASTER.name} - ${content.title.split('|')[0].trim()}`, Author: MASTER.name },
    });
    const chunks = [];
    let pages = 1;
    doc.on('data', (c) => chunks.push(c));
    doc.on('pageAdded', () => {
      pages += 1;
    });
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages }));
    doc.on('error', reject);

    const L = MARGIN.left;
    const W = doc.page.width - MARGIN.left - MARGIN.right;
    const lineGap = 1.2;

    const text = (str, font, size, opts = {}) => doc.font(font).fontSize(size).text(str, L, doc.y, { width: W, lineGap, ...opts });
    const heading = (str) => {
      doc.moveDown(0.5);
      doc.font(BOLD).fontSize(fs + 0.5).text(str.toUpperCase(), L, doc.y, { width: W, characterSpacing: 0.6 });
      const y = doc.y + 0.5;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.7).stroke('#000');
      doc.y = y + 3;
    };
    const row = (left, right, font) => {
      const y = doc.y;
      doc.font(font).fontSize(fs).text(left, L, y, { width: W - 130, lineBreak: false });
      doc.font(font).fontSize(fs).text(right, L, y, { width: W, align: 'right', lineBreak: false });
      doc.y = y + fs * 1.25;
    };
    const bullet = (str) => {
      const y = doc.y;
      // a plain hyphen extracts as text in every ATS, unlike the bullet glyph of the built-in font
      doc.font(REG).fontSize(fs).text('-', L + 3, y, { lineBreak: false });
      doc.font(REG).fontSize(fs).text(str, L + 14, y, { width: W - 14, lineGap });
      doc.y += 1.2;
    };

    // ---- header ----
    doc.font(BOLD).fontSize(19).text(MASTER.name, L, doc.y, { width: W });
    text(content.title, BOLD, fs + 1.5);
    text(`${MASTER.location} | ${MASTER.phone} | ${MASTER.email} | ${MASTER.linkedin} | ${MASTER.github}`, REG, fs - 1.3);

    heading('Summary');
    text(content.summary, REG, fs);

    heading('Skills');
    for (const g of content.groups) {
      doc.font(BOLD).fontSize(fs).text(`${g.group}: `, L, doc.y, { width: W, continued: true, lineGap: 0.8 });
      doc.font(REG).text(g.items.join(', '), { lineGap: 0.8 });
    }

    heading('Experience');
    for (const job of content.experience) {
      row(job.title, job.dates, BOLD);
      row(job.company, job.place, ITAL);
      for (const b of job.bullets.slice(0, cap)) bullet(b.text);
      doc.y += 2;
    }

    heading('Projects');
    for (const p of content.projects) {
      bullet(`${p.name} (${p.site}): ${p.text}`);
    }

    heading('Education');
    const e = MASTER.education;
    row(e.degree, e.dates, BOLD);
    row(e.school, e.place, ITAL);
    text(e.other, REG, fs - 0.5);

    doc.end();
  });
}

// Shrink the font, then drop the least relevant bullets, until it fits one page
export async function renderPdf(content) {
  const sizes = [9.8, 9.4, 9.0, 8.6, 8.2];
  for (const cap of [3, 2]) {
    for (const fs of sizes) {
      const out = await draw(content, fs, cap);
      if (out.pages === 1) return out.buffer;
    }
  }
  return (await draw(content, 8, 2)).buffer; // should not happen; better a small file than none
}
