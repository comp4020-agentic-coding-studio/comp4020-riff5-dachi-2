import {
  BUILDING_LEFT,
  BUILDING_RIGHT,
  WINDOW_COL_W,
  climbSpeedForScore,
  difficultyForScore,
  generateWindowRow,
  overlapsWindow,
  stepPlayer,
  tickAlarm,
  triggerAlarm,
  type AlarmState,
  type PlayerPhysics,
  type WindowRow,
} from "./game-logic.ts";

const WORLD_W = 300;
const WORLD_H = 500;
const ROW_H = 56;
const PLAYER_Y = WORLD_H - 90;
const ROW_SPACING_PX = 150;
const SPEED_SCALE = 46;
// A beat before the first row spawns, so a fresh load gives a stranger time
// to find the controls before there's anything to dodge.
const START_GRACE_PX = 110;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const live = document.querySelector<HTMLElement>("#live")!;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- 8-bit sprite art -------------------------------------------------
// One grid, mirrored left/right at draw time for the climb cycle --- see
// drawPlayer --- rather than hand-authoring a second frame.
const SPIDER_SPRITE = [
  "..RRRR..",
  ".RWWWRR.",
  ".RRRRRR.",
  "BRRRRRRB",
  ".RRKRRR.",
  ".RRRRRR.",
  "B.RRRR.B",
  "BB....BB",
  "B......B",
  "K......K",
];
const SPIDER_PALETTE: Record<string, string> = {
  R: "#e8293f",
  B: "#2e6bd6",
  W: "#f1faee",
  K: "#0a0a0a",
};
const SPR_PX = 3;
const SPIDER_COLS = SPIDER_SPRITE[0].length;
const SPIDER_ROWS = SPIDER_SPRITE.length;

function drawPlayer(x: number, y: number, mirrored: boolean): void {
  const w = SPIDER_COLS * SPR_PX;
  const h = SPIDER_ROWS * SPR_PX;
  ctx.save();
  ctx.translate(x, y);
  if (mirrored) ctx.scale(-1, 1);
  // A dark silhouette one pixel larger all round, drawn first, so the sprite
  // pops against brick, window glass and sky alike instead of blending in.
  ctx.fillStyle = "#0a0a0a";
  for (let ry = 0; ry < SPIDER_ROWS; ry++) {
    const row = SPIDER_SPRITE[ry];
    for (let rx = 0; rx < SPIDER_COLS; rx++) {
      if (row[rx] === ".") continue;
      ctx.fillRect(-w / 2 + rx * SPR_PX - 1, -h / 2 + ry * SPR_PX - 1, SPR_PX + 2, SPR_PX + 2);
    }
  }
  for (let ry = 0; ry < SPIDER_ROWS; ry++) {
    const row = SPIDER_SPRITE[ry];
    for (let rx = 0; rx < SPIDER_COLS; rx++) {
      const c = row[rx];
      if (c === ".") continue;
      ctx.fillStyle = SPIDER_PALETTE[c];
      ctx.fillRect(-w / 2 + rx * SPR_PX, -h / 2 + ry * SPR_PX, SPR_PX, SPR_PX);
    }
  }
  ctx.restore();
}

// --- Building facade, drawn once to a tile and repeated ---------------
function buildBrickTile(): HTMLCanvasElement {
  const w = BUILDING_RIGHT - BUILDING_LEFT;
  const rowH = 12;
  const tile = document.createElement("canvas");
  tile.width = w;
  tile.height = rowH * 2;
  const tctx = tile.getContext("2d")!;
  tctx.fillStyle = "#9c8f7a";
  tctx.fillRect(0, 0, w, rowH * 2);
  const cols = 10;
  const brickW = w / cols;
  const shades = ["#7a4a3a", "#875339", "#6e4433"];
  for (let row = 0; row < 2; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col <= cols; col++) {
      const x = col * brickW + offset;
      const shade = shades[Math.abs(col * 3 + row * 5) % shades.length];
      tctx.fillStyle = shade;
      tctx.fillRect(x + 1, row * rowH + 1, brickW - 2, rowH - 2);
    }
  }
  return tile;
}
const brickTile = buildBrickTile();
const buildingPattern = ctx.createPattern(brickTile, "repeat-y")!;
const TILE_H = brickTile.height;

const skyGrad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
skyGrad.addColorStop(0, "#0d1330");
skyGrad.addColorStop(1, "#2a1f4d");

function drawWindow(x: number, y: number, w: number, h: number, lit: boolean, alarmActive: boolean, now: number): void {
  ctx.fillStyle = "#caa972";
  ctx.fillRect(x, y, w, h);
  const pad = 3;
  const ix = x + pad;
  const iy = y + pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  let interior: string;
  if (alarmActive) {
    const flashOn = reducedMotion || Math.floor(now / 150) % 2 === 0;
    interior = flashOn ? "#ff3b3b" : "#590000";
  } else if (lit) {
    interior = "#ffd166";
  } else {
    interior = "#0d1b2a";
  }
  ctx.fillStyle = interior;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = "rgba(30,20,10,0.5)";
  ctx.fillRect(ix + iw / 2 - 1, iy, 2, ih);
  ctx.fillRect(ix, iy + ih / 2 - 1, iw, 2);
}

// --- Ambient background: clouds behind the building, birds in front ---
interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
}
const clouds: Cloud[] = Array.from({ length: 4 }, (_, i) => ({
  x: (i / 4) * WORLD_W * 1.4 - 40,
  y: 24 + i * 90,
  scale: 0.7 + (i % 3) * 0.25,
  speed: 4 + (i % 3) * 3,
}));

function updateClouds(dt: number): void {
  if (reducedMotion) return;
  for (const c of clouds) {
    c.x += c.speed * dt;
    if (c.x > WORLD_W + 40) c.x = -40;
  }
}

function drawCloud(c: Cloud): void {
  const w = 26 * c.scale;
  const h = 10 * c.scale;
  ctx.fillStyle = "rgba(224,231,242,0.55)";
  ctx.fillRect(c.x, c.y, w, h);
  ctx.fillRect(c.x + w * 0.2, c.y - h * 0.6, w * 0.6, h * 0.7);
  ctx.fillRect(c.x - w * 0.15, c.y + h * 0.3, w * 0.5, h * 0.5);
}

interface Bird {
  x: number;
  y: number;
  speed: number;
}
let birds: Bird[] = [];
let birdSpawnTimer = 4;

function updateBirds(dt: number): void {
  if (reducedMotion) return;
  birdSpawnTimer -= dt;
  if (birdSpawnTimer <= 0) {
    birdSpawnTimer = 5 + Math.random() * 6;
    const goingRight = Math.random() < 0.5;
    birds.push({
      x: goingRight ? -10 : WORLD_W + 10,
      y: 20 + Math.random() * 120,
      speed: (goingRight ? 1 : -1) * (30 + Math.random() * 20),
    });
  }
  for (const b of birds) b.x += b.speed * dt;
  birds = birds.filter((b) => b.x > -20 && b.x < WORLD_W + 20);
}

function drawBird(b: Bird, now: number): void {
  const wing = Math.sin(now / 90 + b.x) > 0 ? 3 : 1;
  ctx.strokeStyle = "rgba(20,20,30,0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(b.x - 5, b.y + wing);
  ctx.lineTo(b.x, b.y - wing);
  ctx.lineTo(b.x + 5, b.y + wing);
  ctx.stroke();
}

// --- Game state ---------------------------------------------------------
let player: PlayerPhysics = { x: (BUILDING_LEFT + BUILDING_RIGHT) / 2, vx: 0 };
let score = 0;
let best = 0;
let rows: { row: WindowRow; y: number; scored: boolean }[] = [];
let spawnAccumulator = -START_GRACE_PX;
let climbDistance = 0;
let alarm: AlarmState = { active: false, timerMs: 0 };
let lastTime = 0;
let gameOver = false;

const keysDown = new Set<string>();
let pointerAxis: -1 | 0 | 1 = 0;

function computeAxis(): -1 | 0 | 1 {
  if (pointerAxis !== 0) return pointerAxis;
  const left = keysDown.has("ArrowLeft") || keysDown.has("a") || keysDown.has("A");
  const right = keysDown.has("ArrowRight") || keysDown.has("d") || keysDown.has("D");
  if (left === right) return 0;
  return left ? -1 : 1;
}

function resetGame(): void {
  player = { x: (BUILDING_LEFT + BUILDING_RIGHT) / 2, vx: 0 };
  score = 0;
  rows = [];
  spawnAccumulator = 0;
  climbDistance = 0;
  alarm = { active: false, timerMs: 0 };
  gameOver = false;
  live.textContent = "";
}

function endGame(): void {
  gameOver = true;
  best = Math.max(best, score);
  live.textContent = `Spotted after climbing ${score} floor${score === 1 ? "" : "s"}.`;
}

/** A row that reaches the player is resolved once: a lit window you haven't
 * hit before sets off the alarm (a warning, not a death) unless the alarm
 * was already running when you touched it --- then every window is a
 * search light, and being in front of any of them ends the climb. */
function resolveRow(r: { row: WindowRow; y: number; scored: boolean }): void {
  if (r.scored || r.y < PLAYER_Y - ROW_H / 2) return;
  r.scored = true;
  const alarmWasActive = alarm.active;
  let caught = false;
  let newlyTriggered = false;
  for (const slot of r.row.slots) {
    if (!overlapsWindow(player.x, slot.col)) continue;
    if (alarmWasActive) {
      caught = true;
    } else if (slot.light === "lit" && !slot.triggered) {
      slot.triggered = true;
      newlyTriggered = true;
    }
  }
  if (caught) {
    endGame();
    return;
  }
  if (newlyTriggered) alarm = triggerAlarm();
  score += 1;
}

function update(dt: number): void {
  player = stepPlayer(player, computeAxis(), dt);

  const speed = climbSpeedForScore(score) * SPEED_SCALE;
  climbDistance += speed * dt;
  spawnAccumulator += dt * speed;
  if (spawnAccumulator >= ROW_SPACING_PX) {
    spawnAccumulator -= ROW_SPACING_PX;
    rows.push({ row: generateWindowRow(Math.random, difficultyForScore(score)), y: -ROW_H, scored: false });
  }

  alarm = tickAlarm(alarm, dt * 1000);

  for (const r of rows) {
    r.y += speed * dt;
    resolveRow(r);
  }
  rows = rows.filter((r) => r.y < WORLD_H + ROW_H);

  updateClouds(dt);
  updateBirds(dt);
}

function render(now: number): void {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  for (const c of clouds) drawCloud(c);

  const offsetY = climbDistance % TILE_H;
  buildingPattern.setTransform(new DOMMatrix().translate(BUILDING_LEFT, offsetY));
  ctx.fillStyle = buildingPattern;
  ctx.fillRect(BUILDING_LEFT, 0, BUILDING_RIGHT - BUILDING_LEFT, WORLD_H);

  for (const r of rows) {
    for (const slot of r.row.slots) {
      const colLeft = BUILDING_LEFT + slot.col * WINDOW_COL_W;
      drawWindow(colLeft + 4, r.y + 8, WINDOW_COL_W - 8, ROW_H - 16, slot.light === "lit", alarm.active, now);
    }
  }

  const mirrored = Math.floor(climbDistance / 14) % 2 === 1;
  drawPlayer(player.x, PLAYER_Y, mirrored);

  for (const b of birds) drawBird(b, now);

  ctx.fillStyle = "#f1faee";
  ctx.font = "20px 'Courier New', monospace";
  ctx.textAlign = "left";
  ctx.fillText(`${score}`, 14, 32);

  if (alarm.active) {
    const flashOn = reducedMotion || Math.floor(now / 150) % 2 === 0;
    ctx.fillStyle = flashOn ? "#ff3b3b" : "rgba(255,59,59,0.4)";
    ctx.font = "bold 13px 'Courier New', monospace";
    ctx.fillText("ALARM", 14, 50);
  }

  if (gameOver) {
    ctx.fillStyle = "rgba(4,6,16,0.75)";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5f5fa";
    ctx.font = "16px 'Courier New', monospace";
    ctx.fillText("SPOTTED", WORLD_W / 2, WORLD_H / 2 - 30);
    ctx.font = "32px 'Courier New', monospace";
    ctx.fillText(`${score}`, WORLD_W / 2, WORLD_H / 2 + 8);
    if (best > 0) {
      ctx.font = "13px 'Courier New', monospace";
      ctx.fillStyle = "rgba(245,245,250,0.7)";
      ctx.fillText(`best climb ${best}`, WORLD_W / 2, WORLD_H / 2 + 32);
    }
    ctx.textAlign = "left";
  }
}

function frame(t: number): void {
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.05, (t - lastTime) / 1000);
  lastTime = t;
  if (!gameOver) update(dt);
  render(t);
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
  // A keyboard user tabbed to another focusable element (the header's Home
  // link) is using this key for that element's own native behaviour, not
  // the game --- don't swallow it.
  if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
  const key = e.key;
  if (key === "ArrowLeft" || key === "ArrowRight" || key === "a" || key === "A" || key === "d" || key === "D") {
    // Arrow keys scroll the page by default --- guard unconditionally, the
    // same way Space/Enter are guarded below, not just when the game is
    // actually running.
    e.preventDefault();
    keysDown.add(key);
  } else if (key === " " || key === "Enter") {
    e.preventDefault();
    if (gameOver) resetGame();
  }
});

window.addEventListener("keyup", (e) => {
  keysDown.delete(e.key);
});

// A key released while the window is unfocused (alt-tab mid-hold) never
// fires keyup --- clear on blur so movement doesn't get stuck on.
window.addEventListener("blur", () => keysDown.clear());

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (gameOver) {
    resetGame();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const relX = (e.clientX - rect.left) / rect.width;
  pointerAxis = relX < 0.5 ? -1 : 1;
});

function releasePointerAxis(): void {
  pointerAxis = 0;
}
canvas.addEventListener("pointerup", releasePointerAxis);
canvas.addEventListener("pointercancel", releasePointerAxis);
canvas.addEventListener("pointerleave", releasePointerAxis);

requestAnimationFrame(frame);

(window as any).__debug = () => ({
  x: player.x,
  vx: player.vx,
  score,
  gameOver,
  alarmActive: alarm.active,
  alarmTimerMs: alarm.timerMs,
  rows: rows.map((r) => ({ y: r.y, scored: r.scored, lit: r.row.slots.filter((s) => s.light === "lit").map((s) => s.col) })),
});
(window as any).__setScore = (s: number) => {
  score = s;
};
