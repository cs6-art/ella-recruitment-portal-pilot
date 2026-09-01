import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ella help-assistant knowledge base.
 *
 * The approved knowledge source is a single Markdown file
 * (`knowledge.md`, next to this module). It is small enough — a few thousand
 * words — that we do NOT need a vector database. Retrieval is plain keyword
 * overlap over the Markdown sections: split on `##` headings, score each
 * section against the question, and send the best few sections to the model as
 * grounding context.
 *
 * The file is read from disk at module load. `next.config.mjs` lists it under
 * `outputFileTracingIncludes` so the deployment bundle ships it alongside the
 * `/api/help-bot` route.
 */
const KNOWLEDGE_MARKDOWN = readFileSync(
  join(process.cwd(), "src/lib/help-bot/knowledge.md"),
  "utf8",
);

export type KnowledgeSection = {
  heading: string;
  body: string;
};

export type RetrievedContext = {
  sections: KnowledgeSection[];
  hasMatch: boolean;
  text: string;
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "how", "do", "does", "what", "when", "where", "who", "which", "can", "i",
  "my", "me", "we", "you", "your", "it", "this", "that", "with", "as", "be",
  "at", "by", "from", "about", "portal", "ella", "help",
]);

function parseSections(markdown: string): KnowledgeSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: KnowledgeSection[] = [];
  let heading = "Overview";
  let body: string[] = [];

  const flush = () => {
    const text = body.join("\n").trim();
    if (text) sections.push({ heading, body: text });
  };

  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
      body = [];
    } else if (!/^#\s/.test(line)) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

const SECTIONS = parseSections(KNOWLEDGE_MARKDOWN);

// The overview / rules sections are always useful as grounding and framing.
const ALWAYS_INCLUDE = new Set([
  "Overview: what the portal is for",
  "Who can access what: HR, Management, HOD, and Creator",
]);

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length > 2 && !STOP_WORDS.has(token),
  );
}

function scoreSection(section: KnowledgeSection, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const headingTokens = new Set(tokenize(section.heading));
  const bodyText = section.body.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (headingTokens.has(token)) score += 5;
    const occurrences = bodyText.split(token).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 4);
  }
  return score;
}

/**
 * Pick the knowledge sections most relevant to the question. Always returns the
 * framing sections plus up to `maxSections` scored matches. When nothing scores
 * above zero the caller still gets the framing sections, and the model is
 * instructed to say it does not know rather than guess.
 */
export function retrieveContext(question: string, maxSections = 4): RetrievedContext {
  const queryTokens = [...new Set(tokenize(question))];

  const scored = SECTIONS.map((section) => ({
    section,
    score: scoreSection(section, queryTokens),
  }))
    .filter((entry) => entry.score > 0 && !ALWAYS_INCLUDE.has(entry.section.heading))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSections)
    .map((entry) => entry.section);

  const framing = SECTIONS.filter((section) => ALWAYS_INCLUDE.has(section.heading));
  const ordered = [...framing, ...scored];

  const text = ordered
    .map((section) => `## ${section.heading}\n\n${section.body}`)
    .join("\n\n---\n\n");

  return { sections: ordered, hasMatch: scored.length > 0, text };
}

export function knowledgeHeadings(): string[] {
  return SECTIONS.map((section) => section.heading);
}
