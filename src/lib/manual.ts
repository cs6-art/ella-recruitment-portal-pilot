import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Explore Manual is the user manual in docs/, rendered inside the portal.
 * One file is the source for both the PDF handed to clients and this page, so
 * they cannot drift apart. `next.config.mjs` ships the file with the /manual
 * route.
 *
 * Relative-import friendly (no "@/" aliases) so tests can load it directly.
 */

export const MANUAL_FILE = "docs/Smile-Recruitment-Portal-User-Manual.md";

export type ManualSection = {
  id: string;
  /** Heading text, e.g. "A. Quick start". */
  title: string;
  /** Markdown after the heading. */
  body: string;
  /** Plain lowercase text used by the search box. */
  searchText: string;
};

export type ManualDocument = { title: string; intro: string; sections: ManualSection[] };

/** GitHub-style heading anchor, so the manual's own `[Section J](#j-...)` links keep working. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .trim()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>|#~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseManual(markdown: string): ManualDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = "Explore Manual";
  const introLines: string[] = [];
  const sections: ManualSection[] = [];
  let current: { title: string; body: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n").replace(/^\s*---\s*$/gm, "").trim();
    // The manual's own "Contents" list is replaced by the page's topic list.
    if (current.title.trim().toLowerCase() !== "contents") {
      sections.push({ id: slugifyHeading(current.title), title: current.title.trim(), body, searchText: plainText(`${current.title}\n${body}`) });
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    const h1 = !inFence && /^#\s+(.+)$/.exec(line);
    const h2 = !inFence && /^##\s+(.+)$/.exec(line);
    if (h1 && !current && sections.length === 0) {
      title = h1[1].trim();
      continue;
    }
    if (h2) {
      flush();
      current = { title: h2[1], body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else introLines.push(line);
  }
  flush();
  return { title, intro: introLines.join("\n").replace(/^\s*---\s*$/gm, "").trim(), sections };
}

export function loadManual(): ManualDocument {
  return parseManual(readFileSync(join(process.cwd(), MANUAL_FILE), "utf8"));
}
