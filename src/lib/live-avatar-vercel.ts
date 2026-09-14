import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import type { WebSocket } from "@vercel/functions";

import { GptLiveBridge, type GptLiveEvents } from "../../bridge/server/src/gptlive";
import { MediaServerLeg } from "../../bridge/server/src/mediaServer";
import type { LiveInterviewContext } from "../../bridge/server/src/prompts";
import type { Turn } from "../../bridge/shared/messages";

const LIVEAVATAR_API_URL = (process.env.LIVEAVATAR_API_URL || "https://api.liveavatar.com").replace(/\/+$/, "");
const TICKET_TTL_MS = 5 * 60 * 1000;

type BridgeTicketPayload = {
  exp: number;
  context: LiveInterviewContext;
};

function secret(): string {
  const value = process.env.SESSION_SECRET?.trim() || process.env.INTERNAL_API_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return value;
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signature(data: string): string {
  return encode(createHmac("sha256", secret()).update(data).digest());
}

/** A compressed, signed, short-lived handoff from the validated POST route to the WebSocket route. */
export function createVercelBridgeTicket(context: LiveInterviewContext): string {
  const payload: BridgeTicketPayload = { exp: Date.now() + TICKET_TTL_MS, context };
  const data = encode(deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 }));
  return `${data}.${signature(data)}`;
}

export function readVercelBridgeTicket(ticket: string): LiveInterviewContext | null {
  const [data, provided] = ticket.split(".");
  if (!data || !provided) return null;
  let expected: string;
  try {
    expected = signature(data);
  } catch {
    return null;
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) return null;
  try {
    const payload = JSON.parse(inflateRawSync(decode(data)).toString("utf8")) as BridgeTicketPayload;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (!payload.context || typeof payload.context !== "object") return null;
    return payload.context;
  } catch {
    return null;
  }
}

type StartedLiveAvatar = {
  sessionId: string;
  livekitUrl: string;
  livekitClientToken: string;
  wsUrl: string;
};

async function liveAvatarPost(path: string, body: Record<string, unknown>, headers: Record<string, string>) {
  const response = await fetch(`${LIVEAVATAR_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LiveAvatar API returned ${response.status}: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
  return parsed.data ?? {};
}

async function startLiveAvatar(): Promise<StartedLiveAvatar> {
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  const avatarId = process.env.LIVEAVATAR_AVATAR_ID?.trim();
  if (!apiKey || !avatarId) throw new Error("LiveAvatar is not configured.");

  const token = await liveAvatarPost(
    "/v1/sessions/token",
    { mode: "LITE", avatar_id: avatarId },
    { "X-API-KEY": apiKey },
  );
  const sessionId = String(token.session_id ?? "");
  const sessionToken = String(token.session_token ?? "");
  if (!sessionId || !sessionToken) throw new Error("LiveAvatar did not return a session token.");

  try {
    const started = await liveAvatarPost("/v1/sessions/start", {}, { Authorization: `Bearer ${sessionToken}` });
    const result = {
      sessionId,
      livekitUrl: String(started.livekit_url ?? ""),
      livekitClientToken: String(started.livekit_client_token ?? ""),
      wsUrl: String(started.ws_url ?? ""),
    };
    if (!result.livekitUrl || !result.livekitClientToken || !result.wsUrl) throw new Error("LiveAvatar returned incomplete LITE session details.");
    return result;
  } catch (error) {
    await stopLiveAvatar(sessionId).catch(() => {});
    throw error;
  }
}

async function stopLiveAvatar(sessionId: string): Promise<void> {
  const apiKey = process.env.LIVEAVATAR_API_KEY?.trim();
  if (!apiKey || !sessionId) return;
  await liveAvatarPost("/v1/sessions/stop", { session_id: sessionId }, { "X-API-KEY": apiKey });
}

type BrowserMessage =
  | { type: "started"; session_id: string; livekit_url: string; livekit_client_token: string }
  | { type: "ready" }
  | ({ type: "turn" } & Turn)
  | { type: "error"; message: string };

function emit(ws: WebSocket, message: BrowserMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(message)); } catch { /* the close handler owns cleanup */ }
}

/** Runs both upstream legs inside the Vercel WebSocket function lifetime. */
export class VercelLiveAvatarBridge implements GptLiveEvents {
  private readonly media: MediaServerLeg;
  private readonly gpt: GptLiveBridge;
  private sessionId = "";
  private stopping = false;

  constructor(private readonly browser: WebSocket, private readonly context: LiveInterviewContext) {
    const log = (message: string) => console.log(`[vercel live bridge] ${message}`);
    this.media = new MediaServerLeg("", log);
    this.gpt = new GptLiveBridge(this, log, context);
  }

  async start(): Promise<void> {
    try {
      const started = await startLiveAvatar();
      this.sessionId = started.sessionId;
      this.media.setWsUrl(started.wsUrl);
      emit(this.browser, {
        type: "started",
        session_id: started.sessionId,
        livekit_url: started.livekitUrl,
        livekit_client_token: started.livekitClientToken,
      });
      if (this.stopping) {
        await stopLiveAvatar(this.sessionId).catch(() => {});
        return;
      }
      void this.media.run()
        .then(() => {
          if (!this.stopping) {
            this.onError("The avatar media connection dropped. Please start a new session.");
            void this.stop();
          }
        })
        .catch((error) => {
          this.onError(error instanceof Error ? error.message : "Avatar media connection failed.");
          void this.stop();
        });
      void this.runGptWhenMediaReady();
    } catch (error) {
      this.onError(error instanceof Error ? error.message : "Unable to start the live avatar.");
      await this.stop();
    }
  }

  private async runGptWhenMediaReady(): Promise<void> {
    if (!(await this.media.waitUntilReady(15_000))) {
      this.onError("The avatar could not be reached. Please start a new session.");
      await this.stop();
      return;
    }
    if (!this.stopping) {
      await this.gpt.run();
      if (!this.stopping) {
        this.onError("The GPT Live connection dropped. Please start a new session.");
        await this.stop();
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.gpt.close().catch(() => {});
    this.media.close();
    await stopLiveAvatar(this.sessionId).catch(() => {});
  }

  sendMicAudio(audio: string): void { if (!this.stopping) this.gpt.sendMicAudio(audio); }

  onReady(): void { emit(this.browser, { type: "ready" }); }

  onAudio(audioB64: string): void { this.media.speak(audioB64); }

  onTurn(turn: Turn): void { emit(this.browser, { type: "turn", ...turn }); }

  onUserTurnStarted(): void { this.media.interrupt(); }

  onToolCall(): Record<string, unknown> {
    return { shown: false, error: "This recruitment interview does not use visual tools." };
  }

  onError(message: string): void { emit(this.browser, { type: "error", message }); }

  get id(): string { return this.sessionId; }
}
