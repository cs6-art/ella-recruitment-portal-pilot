"use client";

import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

export type BridgeTurn = { id: string; role: "user" | "assistant"; text: string; done: boolean };

export interface BridgeSocketHandlers {
  onReady: () => void;
  onTurn: (turn: BridgeTurn) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export interface BridgeSocket {
  sendMicAudio: (base64: string) => void;
  close: () => void;
}

export interface MicCapture {
  stop: () => void;
}

export async function joinBridgeRoom(url: string, token: string, video: HTMLVideoElement): Promise<() => Promise<void>> {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const attach = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) track.attach(video);
    if (track.kind === Track.Kind.Audio) {
      const audio = track.attach();
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
  };
  room.on(RoomEvent.TrackSubscribed, attach);
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach());
  await room.connect(url, token);
  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      if (publication.track) attach(publication.track as RemoteTrack);
    });
  });
  try { await room.startAudio(); } catch { /* the next user interaction can unlock playback */ }
  return async () => {
    room.removeAllListeners();
    await room.disconnect();
  };
}

export function openBridgeSocket(wsUrl: string, handlers: BridgeSocketHandlers): BridgeSocket {
  const ws = new WebSocket(wsUrl);
  let closedByUs = false;
  ws.onmessage = (event: MessageEvent<string>) => {
    let message: { type?: string; message?: string; id?: string; role?: "user" | "assistant"; text?: string; done?: boolean };
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "ready") handlers.onReady();
    else if (message.type === "turn" && message.id && message.role && typeof message.text === "string") handlers.onTurn({ id: message.id, role: message.role, text: message.text, done: Boolean(message.done) });
    else if (message.type === "error") handlers.onError(message.message || "The live avatar bridge reported an error.");
  };
  ws.onerror = () => handlers.onError("Lost connection to the live avatar bridge.");
  ws.onclose = () => { if (!closedByUs) handlers.onClose(); };
  const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  return {
    sendMicAudio: (audio) => send({ type: "mic_audio", audio }),
    close: () => {
      closedByUs = true;
      send({ type: "stop" });
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

export async function stopBridgeSession(stopUrl: string, sessionId: string): Promise<void> {
  await fetch(stopUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
    keepalive: true,
  }).catch(() => {});
}

const WORKLET_CODE = `
class PCMDownsampler extends AudioWorkletProcessor {
  constructor(options) { super(); this.ratio = sampleRate / ((options.processorOptions && options.processorOptions.targetRate) || 24000); this.pos = 0; }
  process(inputs) {
    const input = inputs[0]; const ch = input && input[0]; if (!ch) return true;
    const out = [];
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const start = Math.floor(this.pos); const end = Math.min(ch.length, Math.ceil(this.pos + this.ratio));
      let sum = 0; let count = 0; for (let i = start; i < end; i++) { sum += ch[i]; count++; }
      out.push(count ? sum / count : (ch[start] || 0));
    }
    this.pos -= ch.length; const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) { const s = Math.max(-1, Math.min(1, out[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    this.port.postMessage(pcm.buffer, [pcm.buffer]); return true;
  }
}
registerProcessor("pcm-downsampler", PCMDownsampler);
`;

export async function startBridgeMicCapture(onAudio: (base64Pcm24k: string) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();
  const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
  try { await audioContext.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, "pcm-downsampler", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { targetRate: 24000 } });
  worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    const bytes = new Uint8Array(event.data); if (!bytes.length) return;
    let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    onAudio(btoa(binary));
  };
  source.connect(worklet);
  const mute = audioContext.createGain(); mute.gain.value = 0; worklet.connect(mute); mute.connect(audioContext.destination);
  return {
    stop: () => { worklet.port.onmessage = null; worklet.disconnect(); mute.disconnect(); source.disconnect(); stream.getTracks().forEach((track) => track.stop()); void audioContext.close(); },
  };
}
