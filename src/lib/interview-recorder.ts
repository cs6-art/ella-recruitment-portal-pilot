"use client";

// Browser-side interview recorder. LiveAvatar/HeyGen offers no recording API,
// so, with the applicant's consent, the page records the applicant's camera
// together with a mix of both audio sides (applicant microphone + the avatar's
// voice) and streams it to the portal in 256 KiB-aligned chunks while the
// interview runs. Every failure is contained here: recording problems are
// reported to the server and never interrupt the interview itself.

const ALIGN = 256 * 1024;
const UPLOAD_THRESHOLD = 8 * ALIGN; // 2 MiB per request, under Vercel's body limit
const TIMESLICE_MS = 4000;

export type RecorderStatus = "idle" | "recording" | "finishing" | "done" | "failed";

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export class InterviewRecorder {
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private buffer = new Uint8Array(0);
  private offset = 0;
  private uploading: Promise<void> = Promise.resolve();
  private appending: Promise<void> = Promise.resolve();
  private failed = false;
  private mimeType = "";
  private avatarSourceTrackId = "";
  private destination: MediaStreamAudioDestinationNode | null = null;
  status: RecorderStatus = "idle";

  constructor(private readonly avatarToken: string, private readonly onStatus?: (status: RecorderStatus, message?: string) => void) {}

  /** Starts recording the camera plus the applicant microphone. */
  start(camera: MediaStream, microphone: MediaStream) {
    try {
      this.mimeType = pickMimeType();
      if (!this.mimeType) throw new Error("This browser cannot record video (MediaRecorder unsupported).");
      const videoTrack = camera.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No camera track is available to record.");
      this.audioContext = new AudioContext();
      void this.audioContext.resume().catch(() => {});
      this.destination = this.audioContext.createMediaStreamDestination();
      const micTrack = microphone.getAudioTracks()[0];
      if (micTrack) this.audioContext.createMediaStreamSource(new MediaStream([micTrack])).connect(this.destination);
      const stream = new MediaStream([videoTrack, ...this.destination.stream.getAudioTracks()]);
      this.recorder = new MediaRecorder(stream, { mimeType: this.mimeType, videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 });
      // Serialize appends so recorded bytes can never be reordered.
      this.recorder.ondataavailable = (event) => { if (event.data.size > 0) this.appending = this.appending.then(() => this.accept(event.data)).catch(() => {}); };
      this.recorder.onerror = () => void this.fail("The browser stopped the interview recording unexpectedly.");
      this.recorder.start(TIMESLICE_MS);
      this.setStatus("recording");
    } catch (error) {
      void this.fail(error instanceof Error ? error.message : "The interview recording could not start.");
    }
  }

  /** Mixes the avatar's voice into the recording once its track is available. */
  addAvatarAudio(stream: MediaStream | null) {
    const track = stream?.getAudioTracks()[0];
    if (!track || !this.audioContext || !this.destination || track.id === this.avatarSourceTrackId) return;
    try {
      this.avatarSourceTrackId = track.id;
      this.audioContext.createMediaStreamSource(new MediaStream([track])).connect(this.destination);
    } catch {
      // The applicant's side is still recorded; the avatar is in the transcript.
    }
  }

  private setStatus(status: RecorderStatus, message?: string) {
    this.status = status;
    this.onStatus?.(status, message);
  }

  private async accept(blob: Blob) {
    if (this.failed) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const merged = new Uint8Array(this.buffer.byteLength + bytes.byteLength);
    merged.set(this.buffer);
    merged.set(bytes, this.buffer.byteLength);
    this.buffer = merged;
    if (this.buffer.byteLength >= UPLOAD_THRESHOLD) this.queueUpload(false);
  }

  private queueUpload(final: boolean) {
    this.uploading = this.uploading.then(async () => {
      if (this.failed) return;
      const size = final ? this.buffer.byteLength : Math.floor(this.buffer.byteLength / ALIGN) * ALIGN;
      if (!final && size === 0) return;
      // Never exceed the server's per-request cap; a full-size slice is aligned.
      const chunk = this.buffer.slice(0, Math.min(size, UPLOAD_THRESHOLD));
      await this.send(chunk, final && chunk.byteLength === this.buffer.byteLength);
      this.buffer = this.buffer.slice(chunk.byteLength);
      this.offset += chunk.byteLength;
      if (final && this.buffer.byteLength > 0) this.queueUpload(true);
    });
  }

  private async send(chunk: Uint8Array, final: boolean) {
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch("/api/live-avatar/recording", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Avatar-Token": this.avatarToken,
            "X-Recording-Offset": String(this.offset),
            "X-Recording-Final": final ? "1" : "0",
            "X-Recording-Mime-Type": this.mimeType,
          },
          body: chunk as unknown as BodyInit,
        });
        if (response.ok) return;
        const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
        // A retried final chunk whose first attempt already closed the file.
        if (final && body.code === "recording_closed") return;
        lastError = body.error || `Upload failed (${response.status}).`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 409) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Network error while uploading the recording.";
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
    await this.fail(lastError || "The recording could not be uploaded.");
    throw new Error(lastError);
  }

  private async fail(reason: string) {
    if (this.failed) return;
    this.failed = true;
    try { if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop(); } catch { /* already stopped */ }
    this.setStatus("failed", reason);
    await fetch("/api/live-avatar/recording/failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarToken: this.avatarToken, reason }),
      keepalive: true,
    }).catch(() => {});
  }

  /** Stops recording and uploads the remainder; resolves within `timeoutMs`. */
  async finish(timeoutMs = 45_000) {
    if (this.failed || !this.recorder) return this.status;
    this.setStatus("finishing");
    const stopped = new Promise<void>((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") return resolve();
      this.recorder.addEventListener("stop", () => resolve(), { once: true });
      try { this.recorder.stop(); } catch { resolve(); }
    });
    const work = (async () => {
      await stopped;
      // Let the final dataavailable handler append its bytes.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await this.appending;
      this.queueUpload(true);
      await this.uploading;
    })();
    const timedOut = await Promise.race([
      work.then(() => false).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
    ]);
    void this.audioContext?.close().catch(() => {});
    if (timedOut) {
      await this.fail("The recording upload did not finish in time.");
      return this.status;
    }
    if (!this.failed) this.setStatus("done");
    return this.status;
  }
}
