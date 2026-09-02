import {
  LANE_COUNT,
  type Lane,
  type Row,
  buildRow,
  isCollision,
  clampLane,
  pickAiTarget,
  speedForScore,
} from "./game-logic.ts";

const WORLD_W = 300;
const WORLD_H = 500;
const LANE_W = WORLD_W / LANE_COUNT;
const ROW_H = 56;
const PLAYER_Y = WORLD_H - 70;
const ROW_SPACING_PX = 170;
const SPEED_SCALE = 50;
// A beat before the first row spawns, so a fresh load gives you time to arm
// a trap before there's anything to spring it on. Only the first load gets
// this --- once you've caught the AI once, you already know the controls.
const START_GRACE_PX = 120;
// The AI can only shift one lane at a time, on this cooldown. A row that
// forces it two lanes over in one beat is what actually traps it --- see
// blockedSelection below.
const AI_REACTION_MS = 260;
// How far ahead (world units) the AI notices an incoming row at all.
const AI_LOOKAHEAD_PX = 260;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const live = document.querySelector<HTMLElement>("#live")!;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function laneCenter(lane: Lane): number {
  return lane * LANE_W + LANE_W / 2;
}

let aiLane: Lane = 1;
let aiX = laneCenter(aiLane);
let aiMoveCooldown = 0;
let score = 0;
let best = Infinity;
let rows: { row: Row; y: number; scored: boolean }[] = [];
let spawnAccumulator = -START_GRACE_PX;
let lastTime = 0;
let gameOver = false;
// The trap armed for the *next* spawn, not yet real --- see buildRow.
const blockedSelection = new Set<Lane>();

function resetGame(): void {
  aiLane = 1;
  aiX = laneCenter(aiLane);
  aiMoveCooldown = 0;
  score = 0;
  rows = [];
  spawnAccumulator = 0;
  gameOver = false;
  live.textContent = "";
}

function endGame(): void {
  gameOver = true;
  best = Math.min(best, score);
  live.textContent = `Trapped it after ${score} row${score === 1 ? "" : "s"}.`;
}

function toggleLane(lane: Lane): void {
  if (blockedSelection.has(lane)) {
    blockedSelection.delete(lane);
  } else if (blockedSelection.size < LANE_COUNT - 1) {
    // Arming every lane would make the next row an automatic catch, no
    // reflex involved --- the same fairness invariant generateRow enforced
    // for the dodger now protects the AI's chance to actually escape.
    blockedSelection.add(lane);
  }
}

function update(dt: number): void {
  const speed = speedForScore(score) * SPEED_SCALE;
  spawnAccumulator += dt * speed;
  if (spawnAccumulator >= ROW_SPACING_PX) {
    spawnAccumulator -= ROW_SPACING_PX;
    rows.push({ row: buildRow([...blockedSelection]), y: -ROW_H, scored: false });
  }

  aiMoveCooldown = Math.max(0, aiMoveCooldown - dt * 1000);
  // The AI only reacts once a row is within lookahead range --- otherwise a
  // trap only ever costs it lead time, never a real chance, since the full
  // spawn-to-player distance is always more than a two-lane dodge needs.
  const next = rows.find((r) => !r.scored && r.y >= PLAYER_Y - AI_LOOKAHEAD_PX);
  if (next) {
    const target = pickAiTarget(aiLane, next.row);
    if (target !== aiLane && aiMoveCooldown <= 0) {
      aiLane = clampLane(aiLane + Math.sign(target - aiLane));
      aiMoveCooldown = AI_REACTION_MS;
    }
  }

  for (const r of rows) {
    r.y += speed * dt;
    if (!r.scored && r.y >= PLAYER_Y - ROW_H / 2) {
      r.scored = true;
      if (isCollision(aiLane, r.row)) {
        endGame();
      } else {
        score += 1;
      }
    }
  }
  rows = rows.filter((r) => r.y < WORLD_H + ROW_H);
  aiX += (laneCenter(aiLane) - aiX) * Math.min(1, dt * 14);
}

function render(): void {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = "#0b1021";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  for (let i = 1; i < LANE_COUNT; i++) {
    ctx.beginPath();
    ctx.moveTo(i * LANE_W, 0);
    ctx.lineTo(i * LANE_W, WORLD_H);
    ctx.stroke();
  }

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    ctx.fillStyle = blockedSelection.has(lane as Lane) ? "rgba(255,159,67,0.65)" : "rgba(255,255,255,0.06)";
    ctx.fillRect(lane * LANE_W + 4, 4, LANE_W - 8, 6);
  }

  ctx.fillStyle = "#ff5d5d";
  for (const r of rows) {
    for (const lane of r.row.blocked) {
      ctx.fillRect(lane * LANE_W + 6, r.y, LANE_W - 12, ROW_H - 10);
    }
  }

  const pulse = !reducedMotion && !gameOver ? 1 + 0.04 * Math.sin(performance.now() / 220) : 1;
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(aiX, PLAYER_Y, 20 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e8e8f0";
  ctx.font = "20px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${score}`, 14, 32);

  if (gameOver) {
    ctx.fillStyle = "rgba(4,6,16,0.75)";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5f5fa";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("TRAPPED", WORLD_W / 2, WORLD_H / 2 - 30);
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText(`${score}`, WORLD_W / 2, WORLD_H / 2 + 8);
    if (Number.isFinite(best)) {
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillStyle = "rgba(245,245,250,0.7)";
      ctx.fillText(`fastest ${best}`, WORLD_W / 2, WORLD_H / 2 + 32);
    }
    ctx.textAlign = "left";
  }
}

function frame(t: number): void {
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.05, (t - lastTime) / 1000);
  lastTime = t;
  if (!gameOver) update(dt);
  render();
  requestAnimationFrame(frame);
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const availW = Math.min(window.innerWidth - 32, 480);
  const availH = window.innerHeight - canvas.getBoundingClientRect().top - 24;
  const scale = Math.max(0.5, Math.min(availW / WORLD_W, availH / WORLD_H));
  canvas.style.width = `${WORLD_W * scale}px`;
  canvas.style.height = `${WORLD_H * scale}px`;
  canvas.width = WORLD_W * dpr;
  canvas.height = WORLD_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // A keyboard user tabbed to another focusable element (here, the header's
  // Home link) is using this key for that element's own native behaviour,
  // not the game --- don't swallow it.
  if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
  if (e.key === "1" || e.key === "2" || e.key === "3") {
    e.preventDefault();
    const lane = (Number(e.key) - 1) as Lane;
    if (gameOver) resetGame();
    else toggleLane(lane);
  } else if (e.key === " " || e.key === "Enter") {
    // Prevent Space's default page-scroll unconditionally, even though it
    // does nothing in-game --- a short viewport can leave the canvas taller
    // than the window, and an unguarded Space scrolls it out of view.
    e.preventDefault();
    if (gameOver) resetGame();
  }
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (gameOver) {
    resetGame();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  toggleLane(clampLane(Math.floor(relX * LANE_COUNT)));
});

requestAnimationFrame(frame);
