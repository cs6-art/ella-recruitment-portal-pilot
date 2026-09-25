// Private storage for Live Avatar interview recordings.
//
// LiveAvatar (HeyGen) exposes no session-recording API, so the candidate's
// browser records the interview (camera + both sides of the audio) and sends
// it here in chunks. Chunks are forwarded to a Google Drive *resumable upload*
// using the same service account and Shared Drive approach as resume storage.
// Vercel caps request bodies at ~4.5 MB, which is why the browser never sends
// the whole file at once. Files are never shared publicly: HR playback streams
// through an authenticated portal route.

import { google } from "googleapis";

import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";

/** Drive requires every non-final resumable chunk to be a multiple of 256 KiB. */
export const RECORDING_CHUNK_ALIGNMENT = 256 * 1024;
/** Kept well below Vercel's request body limit. */
export const MAX_RECORDING_CHUNK_BYTES = 8 * RECORDING_CHUNK_ALIGNMENT;
/** Hard ceiling for one interview recording. */
export const MAX_RECORDING_BYTES = 400 * 1024 * 1024;

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,size,mimeType";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

let authClient: InstanceType<typeof google.auth.JWT> | null = null;

function auth() {
  if (authClient) return authClient;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = getGoogleServiceAccountPrivateKey();
  if (!email || !key) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not configured.");
  authClient = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  return authClient;
}

async function accessToken() {
  const { token } = await auth().getAccessToken();
  if (!token) throw new Error("Unable to obtain a Google Drive access token for recording storage.");
  return token;
}

export function recordingFolderId() {
  return process.env.INTERVIEW_RECORDING_DRIVE_FOLDER_ID?.trim() || process.env.RESUME_STORAGE_DRIVE_FOLDER_ID?.trim() || "";
}

export function isRecordingStorageConfigured() {
  return Boolean(recordingFolderId() && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && getGoogleServiceAccountPrivateKey());
}

export function isAllowedRecordingMimeType(value: string) {
  return /^video\/(webm|mp4)(;.*)?$/i.test(value.trim());
}

/** Opens a Drive resumable upload session and returns its (secret) session URI. */
export async function beginRecordingUpload(input: { organizationId: string; sessionId: string; mimeType: string }) {
  const folderId = recordingFolderId();
  if (!folderId) throw new Error("Interview recording storage is not configured (INTERVIEW_RECORDING_DRIVE_FOLDER_ID).");
  const baseMime = input.mimeType.split(";")[0].trim().toLowerCase();
  const extension = baseMime === "video/mp4" ? "mp4" : "webm";
  const response = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": baseMime,
    },
    body: JSON.stringify({
      // Opaque name: no applicant name or email in Drive metadata.
      name: `interview-${input.sessionId}.${extension}`,
      mimeType: baseMime,
      parents: [folderId],
      properties: { kind: "live_interview_recording", sessionId: input.sessionId, organizationId: input.organizationId },
    }),
    cache: "no-store",
  });
  const location = response.headers.get("location");
  if (!response.ok || !location) {
    const text = await response.text().catch(() => "");
    throw new Error(`Drive refused the recording upload session (${response.status}): ${text.slice(0, 200)}`);
  }
  return location;
}

export type ChunkResult = { complete: boolean; receivedBytes: number; fileId: string };

function receivedFromRange(range: string | null) {
  const match = range?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

/**
 * Sends one chunk to the resumable session. Non-final chunks must be aligned
 * to 256 KiB. The final call carries the total size so Drive can close the
 * file (an empty final chunk is allowed).
 */
export async function uploadRecordingChunk(sessionUri: string, chunk: Uint8Array, offset: number, final: boolean): Promise<ChunkResult> {
  const length = chunk.byteLength;
  if (!final && (length === 0 || length % RECORDING_CHUNK_ALIGNMENT !== 0)) throw new Error("Recording chunks must be aligned to 256 KiB until the final chunk.");
  const total = final ? String(offset + length) : "*";
  const contentRange = length > 0 ? `bytes ${offset}-${offset + length - 1}/${total}` : `bytes */${total}`;
  const response = await fetch(sessionUri, {
    method: "PUT",
    // An empty status/finalize PUT must declare a zero length explicitly.
    headers: length > 0 ? { "Content-Range": contentRange } : { "Content-Length": "0", "Content-Range": contentRange },
    body: length > 0 ? Buffer.from(chunk) : undefined,
    cache: "no-store",
  });
  if (response.status === 308) return { complete: false, receivedBytes: receivedFromRange(response.headers.get("range")), fileId: "" };
  if (response.ok) {
    const body = await response.json().catch(() => ({})) as { id?: string; size?: string };
    if (!body.id) throw new Error("Drive completed the recording upload without returning a file id.");
    return { complete: true, receivedBytes: Number(body.size) || offset + length, fileId: body.id };
  }
  const text = await response.text().catch(() => "");
  throw new Error(`Drive rejected the recording chunk (${response.status}): ${text.slice(0, 200)}`);
}

/** Fetch the recording from Drive, forwarding a Range header for seeking. */
export async function fetchInterviewRecording(fileId: string, range: string | null) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new Error("Invalid recording reference.");
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  return fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers, cache: "no-store" });
}

export async function deleteInterviewRecording(fileId: string) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return;
  const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${await accessToken()}` },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw new Error(`Drive refused to delete the recording (${response.status}).`);
}
