/**
 * The Explore Manual tutorial video. McLink sets `MANUAL_VIDEO_URL` (a server
 * environment variable) when the real video is ready; until then the page shows
 * "Tutorial video coming soon". Accepted values:
 *
 * - a video file: `/videos/tutorial.mp4` (a file in `public/`) or an https URL
 *   ending in .mp4, .webm or .ogg
 * - a YouTube, Vimeo, Loom or Google Drive share link
 *
 * Anything else is ignored rather than embedded, so a mistyped value can never
 * put an unknown site on the page. The video never autoplays.
 *
 * Kept free of imports so it can be unit tested directly.
 */

export type ManualVideo =
  | { kind: "file"; src: string; mimeType: string }
  | { kind: "embed"; src: string };

const FILE_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogg: "video/ogg", ogv: "video/ogg" };
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

function fileType(pathname: string): string | null {
  const extension = pathname.split("?")[0].split(".").pop()?.toLowerCase() || "";
  return FILE_TYPES[extension] || null;
}

export function resolveManualVideo(raw: string | undefined | null): ManualVideo | null {
  const value = raw?.trim();
  if (!value) return null;

  // A file shipped with the portal, e.g. /videos/tutorial.mp4.
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) {
    const mimeType = fileType(value);
    return mimeType ? { kind: "file", src: value, mimeType } : null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const mimeType = fileType(url.pathname);
  if (mimeType) return { kind: "file", src: url.toString(), mimeType };

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1];
    return id && ID_PATTERN.test(id) ? { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID_PATTERN.test(id) ? { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = /(\d{5,12})/.exec(url.pathname)?.[1];
    return id ? { kind: "embed", src: `https://player.vimeo.com/video/${id}` } : null;
  }
  if (host === "loom.com") {
    const id = /^\/(?:share|embed)\/([A-Za-z0-9]{8,64})/.exec(url.pathname)?.[1];
    return id ? { kind: "embed", src: `https://www.loom.com/embed/${id}` } : null;
  }
  if (host === "drive.google.com") {
    const id = /^\/file\/d\/([A-Za-z0-9_-]{10,80})/.exec(url.pathname)?.[1];
    return id ? { kind: "embed", src: `https://drive.google.com/file/d/${id}/preview` } : null;
  }
  return null;
}
