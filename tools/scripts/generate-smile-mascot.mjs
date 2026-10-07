// Draws the Smile Bot mascot sprite sheets used by the page-mascot launcher.
//
//   node tools/scripts/generate-smile-mascot.mjs
//
// page-mascot needs two 3x3 sheets: nine head directions (up-left … down-right)
// and nine reactions (blink, heart, sparkle, surprised, wink, bashful, sleepy,
// dizzy, delighted), in that row-major order. The robot is drawn in code so it
// stays on-brand (portal navy/blue) and can be regenerated after a tweak.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const CELL = 256;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "mascot");

const COLORS = {
  shell: "#2d8cff",
  shellDark: "#0e4471",
  shellLight: "#7fbaff",
  visor: "#0b2a4a",
  glow: "#7fe3ff",
  cheek: "rgba(255, 128, 160, 0.55)",
  white: "#ffffff",
};

const DIRECTIONS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const REACTIONS = ["blink", "heart", "sparkle", "surprised", "wink", "bashful", "sleepy", "dizzy", "delighted"];
const REACTION_POSES = ["down", "cheer", "cheer", "out", "wave", "shy", "slump", "out", "cheer"];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Full-body robot: legs, body with a chest light, arms, neck, head, antenna,
 * ears and visor. (dx, dy) turns the head toward the pointer; `pose` moves the
 * arms. Returns where to draw the face (the visor centre).
 */
const HAND = { down: [[-62, 40], [62, 40]], wave: [[-62, 40], [74, -34]], cheer: [[-70, -30], [70, -30]], out: [[-82, 6], [82, 6]], shy: [[-24, 24], [24, 24]], slump: [[-60, 46], [60, 46]] };

function limb(ctx, x1, y1, x2, y2) {
  ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.shellDark;
  ctx.lineWidth = 19;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = COLORS.shellLight;
  ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function drawRobot(ctx, ox, oy, dx, dy, pose = "down") {
  const cx = ox + CELL / 2;
  const top = oy;
  const slump = pose === "slump" ? 8 : 0;

  // Ground shadow.
  ctx.fillStyle = "rgba(14, 68, 113, 0.16)";
  ctx.beginPath(); ctx.ellipse(cx, top + 242, 56, 8, 0, 0, Math.PI * 2); ctx.fill();

  // Legs and feet.
  for (const side of [-1, 1]) {
    limb(ctx, cx + side * 21, top + 208, cx + side * 21, top + 226);
    ctx.fillStyle = COLORS.shell;
    ctx.strokeStyle = COLORS.shellDark;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(cx + side * 24, top + 233, 19, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Arms behind the body edge, hands in front.
  const [[lx, ly], [rx, ry]] = HAND[pose] || HAND.down;
  const shoulderY = top + 168 + slump;
  limb(ctx, cx - 44, shoulderY, cx + lx, shoulderY + ly + 14);
  limb(ctx, cx + 44, shoulderY, cx + rx, shoulderY + ry + 14);
  ctx.fillStyle = COLORS.white;
  ctx.strokeStyle = COLORS.shellDark;
  ctx.lineWidth = 4;
  for (const [hx, hy] of [[lx, ly], [rx, ry]]) {
    ctx.beginPath(); ctx.arc(cx + hx, shoulderY + hy + 14, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Body with a glowing chest light.
  const bodyGradient = ctx.createLinearGradient(cx, top + 148, cx, top + 214);
  bodyGradient.addColorStop(0, "#5aa9ff");
  bodyGradient.addColorStop(1, "#1a6fe0");
  ctx.fillStyle = bodyGradient;
  ctx.strokeStyle = COLORS.shellDark;
  ctx.lineWidth = 6;
  roundRect(ctx, cx - 43, top + 148 + slump, 86, 66 - slump, 30);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath(); ctx.ellipse(cx - 18, top + 162 + slump, 15, 6, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.fillStyle = COLORS.glow;
  ctx.shadowColor = "rgba(127, 227, 255, 0.9)";
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(cx, top + 186 + slump, 10, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = COLORS.shellDark; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, top + 186 + slump, 10, 0, Math.PI * 2); ctx.stroke();

  // Head (turns a little toward the pointer; drops when sleepy).
  const hx = cx + dx * 5;
  const hy = top + 90 + dy * 3 + slump;
  ctx.fillStyle = COLORS.shellDark;
  roundRect(ctx, cx - 12, hy + 38, 24, 22, 6); ctx.fill();

  ctx.strokeStyle = COLORS.shellDark;
  ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(hx, hy - 50); ctx.lineTo(hx + dx * 8, hy - 72); ctx.stroke();
  ctx.fillStyle = COLORS.glow;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(hx + dx * 8, hy - 78, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  for (const side of [-1, 1]) {
    ctx.fillStyle = COLORS.shell;
    ctx.strokeStyle = COLORS.shellDark; ctx.lineWidth = 5;
    roundRect(ctx, hx + side * 62 - 9 - dx * 2 * side * 0, hy - 20, 18, 42, 9); ctx.fill(); ctx.stroke();
  }

  const headGradient = ctx.createLinearGradient(hx, hy - 52, hx, hy + 52);
  headGradient.addColorStop(0, "#ffffff");
  headGradient.addColorStop(1, "#c6d7ee");
  ctx.fillStyle = headGradient;
  ctx.strokeStyle = COLORS.shellDark; ctx.lineWidth = 6;
  roundRect(ctx, hx - 62, hy - 52, 124, 104, 42); ctx.fill(); ctx.stroke();

  const vx = hx + dx * 8;
  const vy = hy + 2 + dy * 5;
  ctx.fillStyle = COLORS.visor;
  roundRect(ctx, vx - 49, vy - 33, 98, 66, 28); ctx.fill();
  return { fx: vx, fy: vy };
}

function glowStyle(ctx) {
  ctx.fillStyle = COLORS.glow;
  ctx.strokeStyle = COLORS.glow;
  ctx.shadowColor = "rgba(127, 227, 255, 0.85)";
  ctx.shadowBlur = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function eye(ctx, x, y) {
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 12, 0, 0, Math.PI * 2);
  ctx.fill();
}

function closedEye(ctx, x, y, up = true) {
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (up) ctx.arc(x, y + 5, 10, Math.PI * 1.1, Math.PI * 1.9);
  else ctx.arc(x, y - 6, 10, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
}

function smile(ctx, x, y, width = 22, open = false) {
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (open) {
    ctx.moveTo(x - width, y);
    ctx.quadraticCurveTo(x, y + width * 1.3, x + width, y);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.arc(x, y - 6, width * 0.75, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
}

function heart(ctx, x, y, s) {
  ctx.fillStyle = "#ff6b9a";
  ctx.shadowColor = "rgba(255, 107, 154, 0.8)";
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.2, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.35;
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

function spiral(ctx, x, y) {
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let t = 0; t < Math.PI * 4; t += 0.2) {
    const r = 1.2 * t;
    ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
  }
  ctx.stroke();
}

function cheeks(ctx, fx, fy) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.fillStyle = COLORS.cheek;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(fx + side * 40, fy + 14, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFace(ctx, fx, fy, reaction) {
  ctx.save();
  // The visor is smaller than on the head-only robot: scale the face about its centre.
  ctx.translate(fx, fy); ctx.scale(0.78, 0.78); ctx.translate(-fx, -fy);
  glowStyle(ctx);
  const lx = fx - 24;
  const rx = fx + 24;
  const ey = fy - 10;
  const my = fy + 18;
  switch (reaction) {
    case "blink":
      closedEye(ctx, lx, ey, false); closedEye(ctx, rx, ey, false); smile(ctx, fx, my); break;
    case "heart":
      heart(ctx, lx, ey, 11); heart(ctx, rx, ey, 11); glowStyle(ctx); smile(ctx, fx, my, 18, true); break;
    case "sparkle":
      star(ctx, lx, ey, 14); star(ctx, rx, ey, 14); smile(ctx, fx, my, 18, true); break;
    case "surprised":
      ctx.lineWidth = 5;
      for (const x of [lx, rx]) { ctx.beginPath(); ctx.arc(x, ey, 11, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.ellipse(fx, my + 4, 7, 9, 0, 0, Math.PI * 2); ctx.fill(); break;
    case "wink":
      eye(ctx, lx, ey); closedEye(ctx, rx, ey); smile(ctx, fx, my); break;
    case "bashful":
      closedEye(ctx, lx, ey); closedEye(ctx, rx, ey); smile(ctx, fx, my, 14); cheeks(ctx, fx, fy); break;
    case "sleepy":
      ctx.lineWidth = 6;
      for (const x of [lx, rx]) { ctx.beginPath(); ctx.moveTo(x - 10, ey + 2); ctx.lineTo(x + 10, ey + 2); ctx.stroke(); }
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(fx - 8, my + 2); ctx.lineTo(fx + 8, my + 2); ctx.stroke();
      ctx.font = "bold 22px sans-serif"; ctx.fillText("z", fx + 66, fy - 52); ctx.font = "bold 16px sans-serif"; ctx.fillText("z", fx + 82, fy - 68); break;
    case "dizzy":
      spiral(ctx, lx, ey); spiral(ctx, rx, ey);
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(fx - 14, my + 2);
      ctx.bezierCurveTo(fx - 6, my - 6, fx + 6, my + 10, fx + 14, my + 2); ctx.stroke(); break;
    case "delighted":
      closedEye(ctx, lx, ey); closedEye(ctx, rx, ey); smile(ctx, fx, my, 22, true); cheeks(ctx, fx, fy); break;
    default:
      eye(ctx, lx, ey); eye(ctx, rx, ey); smile(ctx, fx, my);
  }
  ctx.restore();
}

async function sheet(name, draw) {
  const canvas = createCanvas(CELL * 3, CELL * 3);
  const ctx = canvas.getContext("2d");
  for (let index = 0; index < 9; index += 1) draw(ctx, (index % 3) * CELL, Math.floor(index / 3) * CELL, index);
  await writeFile(path.join(OUT, name), await canvas.encode("webp", 90));
}

await mkdir(OUT, { recursive: true });
await sheet("smile-directions.webp", (ctx, ox, oy, index) => {
  const [dx, dy] = DIRECTIONS[index];
  const { fx, fy } = drawRobot(ctx, ox, oy, dx, dy);
  // Eyes look toward the pointer a little further than the visor moves.
  drawFace(ctx, fx + dx * 4, fy + dy * 3, "idle");
});
await sheet("smile-reactions.webp", (ctx, ox, oy, index) => {
  const { fx, fy } = drawRobot(ctx, ox, oy, 0, 0, REACTION_POSES[index]);
  drawFace(ctx, fx, fy, REACTIONS[index]);
});
// A single static frame for places that need a plain image (manual, previews).
const still = createCanvas(CELL, CELL);
const stillCtx = still.getContext("2d");
const face = drawRobot(stillCtx, 0, 0, 0, 0);
drawFace(stillCtx, face.fx, face.fy, "idle");
await writeFile(path.join(OUT, "smile-mascot.png"), await still.encode("png"));
console.log(`Wrote mascot sprites to ${OUT}`);
