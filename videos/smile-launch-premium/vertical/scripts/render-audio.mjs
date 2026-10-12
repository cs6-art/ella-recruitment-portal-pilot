import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? "assets/audio");
const sampleRate = 48_000;
mkdirSync(out, { recursive: true });

function writeWav(path, channels) {
  const frameCount = channels[0].length;
  const channelCount = channels.length;
  const dataBytes = frameCount * channelCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
  buffer.writeUInt16LE(channelCount * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      buffer.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }
  writeFileSync(path, buffer);
}

function stereo(duration, render) {
  const n = Math.round(sampleRate * duration);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const [l, r] = render(t, i, n);
    left[i] = l;
    right[i] = r;
  }
  return [left, right];
}

const tau = Math.PI * 2;
const bpm = 112;
const beat = 60 / bpm;
const progression = [
  [146.83, 174.61, 220.0],
  [116.54, 146.83, 174.61],
  [130.81, 164.81, 196.0],
  [98.0, 130.81, 164.81],
];
const scale = [146.83, 174.61, 196.0, 220.0, 261.63, 220.0, 196.0, 174.61];

const music = stereo(25, (t) => {
  const barIndex = Math.floor(t / (beat * 4)) % progression.length;
  const chord = progression[barIndex];
  const barTime = t % (beat * 4);
  const attack = Math.min(1, t / 0.38);
  const tail = Math.min(1, (25 - t) / 1.55);
  const bedEnv = Math.max(0, Math.min(attack, tail));
  let pad = 0;
  for (let i = 0; i < chord.length; i++) {
    const detune = i === 2 ? 1.0015 : 0.999;
    pad += Math.sin(tau * chord[i] * detune * t + i * 0.5) * (i === 1 ? 0.12 : 0.105);
    pad += Math.sin(tau * chord[i] * 0.5 * t + i * 0.8) * 0.025;
  }

  const eighth = beat / 2;
  const step = Math.floor(t / eighth) % scale.length;
  const stepTime = t % eighth;
  const pluckEnv = Math.exp(-stepTime * 7.8) * Math.min(1, stepTime / 0.008);
  const pluck = Math.sin(tau * scale[step] * t) * pluckEnv * 0.12;
  const bassHz = chord[0] / 2;
  const bass = Math.sin(tau * bassHz * t) * (0.09 + 0.025 * Math.sin(tau * 0.18 * t));

  const beatTime = t % beat;
  const kickEnv = Math.exp(-beatTime * 17) * Math.min(1, beatTime / 0.005);
  const kick = Math.sin(tau * (73 - 27 * (beatTime / beat)) * beatTime) * kickEnv * 0.16;
  const offBeat = (t + beat * 0.5) % beat;
  const tickEnv = Math.exp(-offBeat * 33) * (offBeat < 0.035 ? 1 : 0);
  const tick = Math.sin(tau * 3800 * offBeat) * tickEnv * 0.025;
  const shimmer = Math.sin(tau * 523.25 * t) * (0.012 + 0.01 * Math.sin(tau * 0.1 * t));
  const mono = (pad * 0.72 + pluck + bass + kick + tick + shimmer) * bedEnv;
  const pan = Math.sin(tau * (barTime / (beat * 4)) * 0.5) * 0.035;
  return [mono * (1 - pan), mono * (1 + pan)];
});
writeWav(resolve(out, "smile-original-score.wav"), music);

function sfx(name, duration, synth) {
  const data = stereo(duration, (t, i, n) => {
    const x = t / duration;
    const value = synth(t, x, i, n);
    const fade = Math.min(1, t / 0.008, (duration - t) / 0.035);
    const v = value * Math.max(0, fade) * 0.75;
    return [v, v * 0.94];
  });
  writeWav(resolve(out, `${name}.wav`), data);
}

function noise(i, seed = 1) {
  return Math.sin((i + seed) * 12.9898) * Math.sin((i + seed) * 78.233);
}

sfx("paper-flick", 0.42, (t, x, i) => {
  const envelope = Math.sin(Math.PI * x) ** 0.7;
  const airy = noise(i, 18) * Math.exp(-x * 3.3) * 0.22;
  return airy * envelope + Math.sin(tau * (330 - 180 * x) * t) * envelope * 0.12;
});

sfx("impact-soft", 0.34, (t) => {
  const env = Math.exp(-t * 13);
  return (Math.sin(tau * 62 * t) * 0.42 + Math.sin(tau * 124 * t) * 0.12 + Math.sin(tau * 930 * t) * 0.025) * env;
});

sfx("sweep-short", 0.58, (t, x, i) => {
  const env = Math.sin(Math.PI * x) ** 1.25;
  const tone = Math.sin(tau * (180 + 520 * x) * t) * 0.13;
  return (noise(i, 39) * 0.16 + tone) * env;
});

sfx("ui-tick", 0.12, (t) => {
  const env = Math.exp(-t * 46);
  return (Math.sin(tau * 1560 * t) * 0.16 + Math.sin(tau * 2480 * t) * 0.06) * env;
});

sfx("phone-tone", 0.24, (t) => {
  const env = Math.min(1, t / 0.025) * Math.exp(-t * 4.4);
  return (Math.sin(tau * 660 * t) * 0.1 + Math.sin(tau * 880 * t) * 0.07) * env;
});

sfx("consent-click", 0.2, (t) => {
  const env = Math.exp(-t * 35);
  return (Math.sin(tau * 1180 * t) * 0.12 + Math.sin(tau * 1770 * t) * 0.05) * env;
});

sfx("cta-confirm", 0.62, (t) => {
  const notes = t < 0.18 ? 523.25 : t < 0.36 ? 659.25 : 783.99;
  const local = t < 0.18 ? t : t < 0.36 ? t - 0.18 : t - 0.36;
  const env = Math.exp(-local * 5.5) * Math.min(1, local / 0.008);
  return Math.sin(tau * notes * t) * env * 0.17;
});

console.log(`Original score and seven generated SFX written to ${out}`);
