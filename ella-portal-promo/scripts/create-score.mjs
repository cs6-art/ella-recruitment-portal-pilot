import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../assets/ella-promo-score.wav');
const sampleRate = 48000;
const duration = 25;
const frames = sampleRate * duration;
const left = new Float32Array(frames);
const right = new Float32Array(frames);
const bpm = 120;
const beat = 60 / bpm;
const bar = beat * 4;
const chordMidi = [
  [55, 59, 62], // G major
  [50, 54, 57], // D major
  [52, 55, 59], // E minor
  [48, 52, 55], // C major
];
const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const tau = Math.PI * 2;

for (let i = 0; i < frames; i++) {
  const t = i / sampleRate;
  const barIndex = Math.floor(t / bar);
  const chord = chordMidi[barIndex % chordMidi.length];
  const beatPhase = t % beat;
  const barPhase = t % bar;
  const fadeIn = Math.min(1, t / 0.9);
  const fadeOut = Math.min(1, (duration - t) / 1.5);
  const master = Math.min(fadeIn, fadeOut) * 0.76;

  // Soft sustained triad with a warm octave layer.
  const padEnv = Math.min(1, barPhase / 0.34, (bar - barPhase) / 0.28);
  let sampleL = 0;
  let sampleR = 0;
  for (let n = 0; n < 3; n++) {
    const f = midiHz(chord[n] + 12);
    const phaseL = tau * f * t;
    const phaseR = tau * f * (t + 0.0025);
    const voiceL = Math.sin(phaseL) + 0.19 * Math.sin(phaseL * 2.005);
    const voiceR = Math.sin(phaseR) + 0.19 * Math.sin(phaseR * 1.995);
    sampleL += voiceL * 0.019 * padEnv;
    sampleR += voiceR * 0.019 * padEnv;
  }

  // Four-note arpeggio at half-second intervals, with a short pluck envelope.
  const arpIndex = Math.floor(barPhase / (beat / 2)) % 4;
  const arpStart = (barPhase - Math.floor(barPhase / (beat / 2)) * (beat / 2));
  const arpDt = arpStart;
  if (arpDt < 0.34) {
    const arpMidi = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24][arpIndex];
    const f = midiHz(arpMidi);
    const env = Math.exp(-7.2 * arpDt) * Math.min(1, arpDt / 0.008);
    const pluck = Math.sin(tau * f * arpDt) + 0.22 * Math.sin(tau * f * 2.01 * arpDt);
    sampleL += pluck * env * 0.095;
    sampleR += Math.sin(tau * f * 1.002 * arpDt) * env * 0.09;
  }

  // Rounded bass on each beat.
  const bassDt = beatPhase;
  const bassF = midiHz(chord[0] - 12);
  const bassEnv = Math.exp(-3.0 * bassDt);
  const bass = (Math.sin(tau * bassF * bassDt) + 0.22 * Math.sin(tau * bassF * 2 * bassDt)) * bassEnv * 0.12;
  sampleL += bass;
  sampleR += bass * 0.98;

  // Light kick on beats one and three; a soft tick marks the other beats.
  const beatNumber = Math.floor((t % bar) / beat);
  if (beatNumber === 0 || beatNumber === 2) {
    const kickDt = beatPhase;
    const kickEnv = Math.exp(-11 * kickDt);
    sampleL += Math.sin(tau * (46 + 34 * Math.exp(-25 * kickDt)) * kickDt) * kickEnv * 0.17;
    sampleR += Math.sin(tau * (46 + 34 * Math.exp(-25 * kickDt)) * kickDt) * kickEnv * 0.15;
  } else {
    const tick = Math.exp(-36 * beatPhase) * Math.sin(tau * 1650 * beatPhase) * 0.014;
    sampleL += tick;
    sampleR += tick * 0.82;
  }

  // Gentle offbeat sparkle keeps the bed moving without crowding the UI.
  const halfBeatPhase = (t + beat / 2) % beat;
  const sparkle = Math.exp(-28 * halfBeatPhase) * Math.sin(tau * 2450 * halfBeatPhase) * 0.009;
  sampleL += sparkle;
  sampleR += sparkle * 0.75;

  left[i] = Math.tanh(sampleL * master * 1.65);
  right[i] = Math.tanh(sampleR * master * 1.65);
}

const dataBytes = frames * 4;
const wav = Buffer.alloc(44 + dataBytes);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataBytes, 40);
for (let i = 0, p = 44; i < frames; i++, p += 4) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), p);
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), p + 2);
}
fs.writeFileSync(out, wav);
console.log(`Wrote original ${duration}s stereo score to ${out}`);
