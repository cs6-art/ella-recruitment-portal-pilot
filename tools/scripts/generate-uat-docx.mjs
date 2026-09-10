import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourcePath = path.join(projectRoot, "docs", "UAT-Ella-Recruitment-Portal-Pilot.md");
const outputPath = path.join(projectRoot, "docs", "UAT-Ella-Recruitment-Portal-Pilot.docx");

const xmlEscape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

function runs(text) {
  const result = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) result.push(`<w:r><w:t xml:space="preserve">${xmlEscape(text.slice(last, match.index))}</w:t></w:r>`);
    const token = match[0];
    const bold = token.startsWith("**");
    const italic = token.startsWith("*") && !bold;
    const code = token.startsWith("`");
    const value = token.slice(bold || italic || code ? (bold ? 2 : 1) : 0, bold || italic || code ? (bold ? -2 : -1) : undefined);
    const properties = `${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}${code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ""}`;
    result.push(`<w:r>${properties}<w:t xml:space="preserve">${xmlEscape(value)}</w:t></w:r>`);
    last = match.index + token.length;
  }
  if (last < text.length) result.push(`<w:r><w:t xml:space="preserve">${xmlEscape(text.slice(last))}</w:t></w:r>`);
  return result.join("");
}

function paragraph(text, style = "Normal", extra = "") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${runs(text)}</w:p>`;
}

function table(lines) {
  const rows = lines
    .filter((line) => !/^\|[\s:|-]+\|$/.test(line)) // drop the |---|---| separator row
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  const columns = rows[0].length;
  const grid = Array.from({ length: columns }, () => "<w:gridCol w:w=\"2000\"/>").join("");
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${rowIndex === 0 ? "<w:shd w:fill=\"E9F2F8\"/>" : ""}</w:tcPr>${paragraph(cell, rowIndex === 0 ? "TableHeader" : "TableText")}</w:tc>`).join("");
    return `<w:tr>${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C8D3"/><w:left w:val="single" w:sz="4" w:color="B8C8D3"/><w:bottom w:val="single" w:sz="4" w:color="B8C8D3"/><w:right w:val="single" w:sz="4" w:color="B8C8D3"/><w:insideH w:val="single" w:sz="4" w:color="B8C8D3"/><w:insideV w:val="single" w:sz="4" w:color="B8C8D3"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { output.push(paragraph(heading[2], `Heading${Math.min(heading[1].length, 3)}`)); index += 1; continue; }
    if (/^\|.*\|$/.test(line) && index + 1 < lines.length && /^\|\s*:?-{3,}/.test(lines[index + 1])) {
      const tableLines = [];
      while (index < lines.length && /^\|.*\|$/.test(lines[index])) tableLines.push(lines[index++]);
      output.push(table(tableLines));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      output.push(paragraph(quote.join(" "), "Quote"));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) output.push(paragraph(lines[index++].replace(/^[-*]\s+/, ""), "ListBullet"));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) output.push(paragraph(lines[index++].replace(/^\d+\.\s+/, ""), "ListNumber"));
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^#{1,6}\s+/.test(lines[index]) && !/^\||^>|^[-*]\s+|^\d+\.\s+/.test(lines[index])) paragraphLines.push(lines[index++]);
    output.push(paragraph(paragraphLines.join(" ")));
  }
  return output.join("");
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:color w:val="24364B"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="0B426B"/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="0B426B"/><w:sz w:val="27"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="175579"/><w:sz w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="0B426B"/><w:sz w:val="16"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="1A9A79"/></w:pBdr></w:pPr><w:rPr><w:color w:val="175579"/></w:rPr></w:style></w:styles>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${renderMarkdown(readFileSync(sourcePath, "utf8"))}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="960" w:right="850" w:bottom="1020" w:left="850"/></w:sectPr></w:body></w:document>`;
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>User Acceptance Test (UAT) — Ella Recruitment Portal (Pilot)</dc:title><dc:creator>Recruitment Portal Project Team</dc:creator><cp:lastModifiedBy>Recruitment Portal Project Team</cp:lastModifiedBy></cp:coreProperties>`;
const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>McLink Recruitment Portal</Application></Properties>`;
const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBuffer.length, 26);
    chunks.push(header, nameBuffer, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(nameBuffer.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBuffer);
    offset += header.length + nameBuffer.length + data.length;
  }
  const centralOffset = offset;
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, centralData, end]);
}

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "mclink-uat-docx-"));
try {
  const packageData = zip([
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["word/document.xml", documentXml],
    ["word/styles.xml", styles],
    ["word/numbering.xml", numbering],
    ["word/_rels/document.xml.rels", documentRels],
    ["docProps/core.xml", core],
    ["docProps/app.xml", app],
  ]);
  writeFileSync(outputPath, packageData);
  console.log(`Generated ${outputPath}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
