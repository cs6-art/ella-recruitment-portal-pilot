export function formatEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Turn a stored list value into readable items for the HR UI. The AI screening
 * pipeline persists strengths, gaps, and interview questions as a JSON array
 * string (e.g. `["a","b"]`); other sources use newline- or bullet-separated
 * text. Both collapse to a clean string[] with list markers stripped.
 */
export function parseTextList(value: string | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  let items: string[] = [raw];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) items = parsed.map((item) => String(item ?? ""));
    } catch {
      // Not valid JSON after all — fall back to plain-text splitting below.
    }
  }
  if (items.length === 1) items = items[0].split(/\r?\n+/);
  return items
    .map((item) => item.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}
