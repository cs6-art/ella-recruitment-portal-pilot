import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourcePath = path.join(projectRoot, "docs", "USER-REQUIREMENTS-STUDY.md");
const outputPath = path.join(projectRoot, "docs", "USER-REQUIREMENTS-STUDY.pdf");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderTable(lines) {
  const rows = lines.map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  const header = rows[0];
  const body = rows.slice(2);
  return `<table><thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\|.*\|$/.test(line) && index + 1 < lines.length && /^\|\s*:?-{3,}/.test(lines[index + 1])) {
      const tableLines = [];
      while (index < lines.length && /^\|.*\|$/.test(lines[index])) tableLines.push(lines[index++]);
      output.push(renderTable(tableLines));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quoteLines.push(lines[index++].replace(/^>\s?/, ""));
      output.push(`<blockquote>${quoteLines.map(inlineMarkdown).join(" ")}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-*]\s+/, ""));
      output.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\d+\.\s+/, ""));
      output.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^#{1,6}\s+/.test(lines[index]) && !/^\||^>|^[-*]\s+|^\d+\.\s+/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return output.join("\n");
}

const markdown = readFileSync(sourcePath, "utf8");
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 17mm 15mm 18mm; }
* { box-sizing: border-box; }
body { color: #24364b; font-family: Arial, Helvetica, sans-serif; font-size: 10.2pt; line-height: 1.42; }
h1 { color: #0b426b; font-size: 24pt; line-height: 1.12; margin: 0 0 5pt; }
h2 { color: #0b426b; border-bottom: 1.5pt solid #1a9a79; font-size: 16pt; margin: 20pt 0 8pt; padding-bottom: 3pt; page-break-after: avoid; }
h3 { color: #175579; font-size: 12.2pt; margin: 14pt 0 5pt; page-break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 3pt 0 8pt 18pt; padding-left: 10pt; }
li { margin: 2pt 0; }
table { border-collapse: collapse; margin: 7pt 0 10pt; width: 100%; font-size: 8.2pt; page-break-inside: avoid; }
th { background: #e9f2f8; color: #0b426b; font-weight: 700; text-align: left; }
th, td { border: 0.5pt solid #b8c8d3; padding: 4pt 4.5pt; vertical-align: top; }
blockquote { background: #f1f8f6; border-left: 3pt solid #1a9a79; margin: 8pt 0; padding: 7pt 10pt; }
code { background: #eef2f5; border-radius: 2pt; padding: 1pt 2pt; font-family: Consolas, monospace; font-size: 90%; }
strong { color: #123f60; }
h1 + h2 { margin-top: 0; }
</style></head><body>${renderMarkdown(markdown)}</body></html>`;

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "mclink-urs-"));
const htmlPath = path.join(temporaryDirectory, "urs.html");
const profilePath = path.join(temporaryDirectory, "chrome-profile");
writeFileSync(htmlPath, html, "utf8");

try {
  execFileSync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    `--user-data-dir=${profilePath}`,
    `--print-to-pdf=${outputPath}`,
    `file://${htmlPath.replaceAll("\\", "/")}`,
  ], { stdio: "inherit", windowsHide: true });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Generated ${outputPath}`);
