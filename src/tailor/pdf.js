import PDFDocument from 'pdfkit';
import { MASTER } from './master.js';

// One page, single column, standard fonts, selectable text: parses cleanly in ATS.
const MARGIN = { top: 34, bottom: 30, left: 40, right: 40 };
const REG = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITAL = 'Helvetica-Oblique';
const BLUE = '#1F4E9E';

// extra: points of spacing added between sections and bullets, used to fill the rest of the page
function draw(content, fs, cap, projCap, extra = 0) {
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
    let endY = 0;
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages, endY }));
    doc.on('error', reject);

    const L = MARGIN.left;
    const W = doc.page.width - MARGIN.left - MARGIN.right;
    const lineGap = 1.2;

    const text = (str, font, size, opts = {}) => doc.font(font).fontSize(size).text(str, L, doc.y, { width: W, lineGap, ...opts });
    const heading = (str) => {
      doc.moveDown(0.5);
      doc.y += extra * 1.5;
      doc.fillColor(BLUE).font(BOLD).fontSize(fs + 0.5).text(str.toUpperCase(), L, doc.y, { width: W, characterSpacing: 0.6 });
      const y = doc.y + 0.5;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.7).stroke(BLUE);
      doc.fillColor('#000');
      doc.y = y + 3 + extra * 0.5;
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
      doc.y += 1.2 + extra * 0.6;
    };

    // ---- header ----
    doc.font(BOLD).fontSize(19).text(MASTER.name, L, doc.y, { width: W });
    text(content.title, BOLD, fs + 1.5);
    text(`${MASTER.phone} | ${MASTER.email} | ${MASTER.linkedin} | ${MASTER.github}`, REG, fs - 1.3);

    heading('Summary');
    text(content.summary, REG, fs);

    heading('Skills');
    for (const g of content.groups) {
      doc.font(BOLD).fontSize(fs).text(`${g.group}: `, L, doc.y, { width: W, continued: true, lineGap: 0.8 });
      doc.font(REG).text(g.items.join(', '), { lineGap: 0.8 });
      doc.y += extra * 0.5;
    }

    heading('Experience');
    for (const job of content.experience) {
      row(job.title, job.dates, BOLD);
      row(job.company, '', ITAL);
      for (const b of job.bullets.slice(0, cap)) bullet(b.text);
      doc.y += 2 + extra;
    }

    heading('Projects');
    for (const p of content.projects.slice(0, projCap)) {
      bullet(`${p.name}${p.site ? ` (${p.site})` : ''}: ${p.text}`);
    }

    heading('Education');
    const e = MASTER.education;
    row(e.degree, e.dates, BOLD);
    row(e.school, '', ITAL);
    text(e.other, REG, fs - 0.5);

    endY = doc.y;
    doc.end();
  });
}

// Always one page, and the page is filled: pick the largest readable font with the most content that fits,
// grow the font while it still fits, then spread what is left as spacing between sections and bullets.
export async function renderPdf(content) {
  const total = content.projects.length;
  let pick = null;
  search: for (const fs of [9.8, 9.4, 9.0, 8.6, 8.2, 8]) {
    for (let projCap = total; projCap >= 2; projCap -= 1) {
      for (const cap of [3, 2]) {
        const out = await draw(content, fs, cap, projCap);
        if (out.pages === 1) {
          pick = { fs, cap, projCap, out };
          break search;
        }
      }
    }
  }
  if (!pick) return (await draw(content, 8, 2, 2)).buffer; // should not happen; better a small file than none

  // grow the font a little while the page still holds it
  for (let fs = pick.fs + 0.2; fs <= 10.4; fs += 0.2) {
    const out = await draw(content, fs, pick.cap, pick.projCap);
    if (out.pages !== 1) break;
    pick = { ...pick, fs, out };
  }

  // spread the remaining space (binary search for the largest spacing that still fits one page)
  let lo = 0;
  let hi = 10;
  let best = pick.out;
  for (let i = 0; i < 7; i += 1) {
    const mid = (lo + hi) / 2;
    const out = await draw(content, pick.fs, pick.cap, pick.projCap, mid);
    if (out.pages === 1) {
      best = out;
      lo = mid;
    } else hi = mid;
  }
  return best.buffer;
}
