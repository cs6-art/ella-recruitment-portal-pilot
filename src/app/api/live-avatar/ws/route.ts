import { experimental_upgradeWebSocket, type WebSocket } from "@vercel/functions";

import { readVercelBridgeTicket, VercelLiveAvatarBridge } from "@/lib/live-avatar-vercel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const ticket = new URL(request.url).searchParams.get("ticket") || "";
  const context = readVercelBridgeTicket(ticket);
  if (!context) return new Response("Invalid or expired live avatar ticket.", { status: 401 });

  return experimental_upgradeWebSocket((ws: WebSocket) => {
    const bridge = new VercelLiveAvatarBridge(ws, context);
    let started = false;
    ws.on("message", (raw) => {
      let message: { type?: string; audio?: string };
      try { message = JSON.parse(raw.toString()) as { type?: string; audio?: string }; } catch { return; }
      if (message.type === "mic_audio" && typeof message.audio === "string") bridge.sendMicAudio(message.audio);
      if (message.type === "stop") { void bridge.stop(); ws.close(); }
    });
    ws.on("close", () => { void bridge.stop(); });
    ws.on("error", () => { void bridge.stop(); });
    // Start only once, after listeners are installed so an immediate provider
    // greeting cannot race the browser's first frame.
    if (!started) { started = true; void bridge.start(); }
  }, { maxPayload: 8 * 1024 * 1024 });
}

