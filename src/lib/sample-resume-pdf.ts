/**
 * Renders a built-in sample resume as a small, text-based PDF.
 *
 * The file is generated from the catalog instead of being shipped as an
 * asset, so the server route and the intake API always produce the same bytes
 * (no timestamps), and the normal PDF parser reads it like any uploaded resume.
 * Identical bytes also let the existing screening reuse rules recognise a
 * resubmitted sample.
 *
 * Dependency-free: standard Helvetica fonts, WinAnsi text, US Letter pages.
 */

import type { SampleResume } from "./sample-catalog.ts";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 60;

type Line = { text: string; font: "F1" | "F2"; size: number; gapBefore: number };

/** Keep to printable ASCII so the WinAnsi string is exactly what the parser reads back. */
function ascii(value: string) {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "");
}

function escapePdf(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Greedy wrap by an average Helvetica glyph width; conservative so lines never overflow. */
function wrap(text: string, size: number, indent = ""): string[] {
  const maxChars = Math.max(20, Math.floor((PAGE_WIDTH - MARGIN_X * 2) / (size * 0.53)));
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = `${indent}${word}`;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function layout(resume: SampleResume): Line[] {
  const { candidate } = resume;
  const lines: Line[] = [
    { text: ascii(candidate.name), font: "F2", size: 20, gapBefore: 0 },
    { text: ascii(candidate.headline), font: "F1", size: 12, gapBefore: 6 },
    { text: ascii(`${candidate.location} | ${candidate.email} | ${candidate.phone}`), font: "F1", size: 9.5, gapBefore: 4 },
    { text: "SAMPLE RESUME - fictional candidate created for Smile Recruitment Portal demonstrations.", font: "F1", size: 8.5, gapBefore: 4 },
  ];
  for (const section of resume.sections) {
    lines.push({ text: ascii(section.heading.toUpperCase()), font: "F2", size: 11.5, gapBefore: 14 });
    for (const raw of section.lines) {
      if (!raw.trim()) { lines.push({ text: "", font: "F1", size: 10, gapBefore: 2 }); continue; }
      const isRoleLine = / \| /.test(raw) && !raw.startsWith("- ");
      const size = 10;
      wrap(raw, size, raw.startsWith("- ") ? "  " : "").forEach((text, index) => {
        lines.push({ text, font: isRoleLine ? "F2" : "F1", size, gapBefore: index === 0 ? 3 : 1 });
      });
    }
  }
  return lines;
}

function paginate(lines: Line[]): Line[][] {
  const pages: Line[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN_TOP;
  for (const line of lines) {
    const height = line.size * 1.25 + line.gapBefore;
    if (y - height < MARGIN_BOTTOM && pages[pages.length - 1].length > 0) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
    pages[pages.length - 1].push(line);
    y -= height;
  }
  return pages;
}

function contentStream(lines: Line[], pageNumber: number, pageCount: number) {
  let y = PAGE_HEIGHT - MARGIN_TOP;
  const parts: string[] = [];
  lines.forEach((line, index) => {
    y -= (index === 0 ? 0 : line.gapBefore) + (index === 0 ? 0 : line.size * 1.25);
    if (!line.text) return;
    parts.push(`BT /${line.font} ${line.size} Tf 1 0 0 1 ${MARGIN_X} ${y.toFixed(2)} Tm (${escapePdf(line.text)}) Tj ET`);
  });
  parts.push(`BT /F1 8 Tf 1 0 0 1 ${MARGIN_X} 32 Tm (${escapePdf(`Sample resume - fictional data - page ${pageNumber} of ${pageCount}`)}) Tj ET`);
  return parts.join("\n");
}

/** A deterministic PDF for the sample resume. */
export function renderSampleResumePdf(resume: SampleResume): Uint8Array {
  const pages = paginate(layout(resume));
  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 6 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title (${escapePdf(ascii(`Sample resume - ${resume.candidate.name}`))}) /Producer (Smile Recruitment Portal) >>`;
  pages.forEach((lines, index) => {
    const stream = contentStream(lines, index + 1, pages.length);
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = output.length;
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  // Every character is ASCII, so string length equals byte length (xref offsets stay exact).
  return new TextEncoder().encode(output);
}
