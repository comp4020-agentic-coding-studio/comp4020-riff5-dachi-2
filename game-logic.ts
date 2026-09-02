// Pure game rules --- no DOM, no canvas, no timers. A wall-crawler climbs a
// skyscraper facade (continuous horizontal position, not lanes) trying not
// to be seen through its windows.

export const WORLD_W = 300;
// Sky peeks past the building on both sides --- also doubles as the player's
// horizontal travel bounds.
export const BUILDING_MARGIN = 26;
export const BUILDING_LEFT = BUILDING_MARGIN;
export const BUILDING_RIGHT = WORLD_W - BUILDING_MARGIN;

export const WINDOW_COLUMNS = 5;
export const WINDOW_COL_W = (BUILDING_RIGHT - BUILDING_LEFT) / WINDOW_COLUMNS;
// The hitbox a window actually kills you through is smaller than its drawn
// frame --- grazing the sill isn't the same as being seen through the glass.
export const WINDOW_HITBOX_INSET = 8;

// The player's hitbox is narrower than the sprite drawn around it, so a
// near-miss reads as a near-miss instead of a cheap death.
export const PLAYER_HALF_WIDTH = 7;

export type WindowLight = "dark" | "lit";
export type Lane = number; // kept for spec continuity; here, a column index

export interface WindowSlot {
  col: number;
  light: WindowLight;
  /** Already caused an alarm once --- doesn't re-trigger while it scrolls by. */
  triggered: boolean;
}

export interface WindowRow {
  slots: WindowSlot[];
}

/** Lit windows always form one contiguous run, which guarantees the *other*
 * side is one contiguous safe gap wide enough to fit through --- never a
 * scatter of gaps each individually too narrow. Same fairness invariant as
 * the original dodge game's generateRow, generalised from 3 lanes to N
 * columns. */
export function generateWindowRow(random: () => number, difficulty: number): WindowRow {
  const maxLit = Math.max(1, Math.min(WINDOW_COLUMNS - 1, 1 + Math.floor(difficulty * (WINDOW_COLUMNS - 2))));
  const litCount = 1 + Math.floor(random() * maxLit);
  const start = Math.floor(random() * WINDOW_COLUMNS);
  const slots: WindowSlot[] = [];
  for (let col = 0; col < WINDOW_COLUMNS; col++) {
    const offset = (col - start + WINDOW_COLUMNS) % WINDOW_COLUMNS;
    slots.push({ col, light: offset < litCount ? "lit" : "dark", triggered: false });
  }
  return { slots };
}

export function windowXRange(col: number): [left: number, right: number] {
  const left = BUILDING_LEFT + col * WINDOW_COL_W + WINDOW_HITBOX_INSET;
  const right = BUILDING_LEFT + (col + 1) * WINDOW_COL_W - WINDOW_HITBOX_INSET;
  return [left, right];
}

/** True if the player's hitbox overlaps this window's (inset) hitbox. */
export function overlapsWindow(playerX: number, col: number): boolean {
  const [left, right] = windowXRange(col);
  return playerX + PLAYER_HALF_WIDTH > left && playerX - PLAYER_HALF_WIDTH < right;
}

export function clampPlayerX(x: number): number {
  const min = BUILDING_LEFT + PLAYER_HALF_WIDTH;
  const max = BUILDING_RIGHT - PLAYER_HALF_WIDTH;
  return Math.max(min, Math.min(max, x));
}

export interface PlayerPhysics {
  x: number;
  vx: number;
}

const MAX_SPEED = 230; // world units/sec
const ACCEL = 1100;
const FRICTION = 900;

/** One physics tick of continuous horizontal movement: accelerate toward
 * max speed while `axis` is held, decelerate to a clean stop (never
 * overshoots past zero) when it's released, and clamp to the building's
 * edges without leaving residual velocity pinned against the wall. */
export function stepPlayer(p: PlayerPhysics, axis: -1 | 0 | 1, dt: number): PlayerPhysics {
  let vx = p.vx;
  if (axis !== 0) {
    vx += axis * ACCEL * dt;
  } else if (vx !== 0) {
    const decel = FRICTION * dt;
    vx = vx > 0 ? Math.max(0, vx - decel) : Math.min(0, vx + decel);
  }
  vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vx));
  let x = p.x + vx * dt;
  const min = BUILDING_LEFT + PLAYER_HALF_WIDTH;
  const max = BUILDING_RIGHT - PLAYER_HALF_WIDTH;
  if (x < min) {
    x = min;
    vx = 0;
  } else if (x > max) {
    x = max;
    vx = 0;
  }
  return { x, vx };
}

export interface AlarmState {
  active: boolean;
  timerMs: number;
}

export const ALARM_DURATION_MS = 3200;

export function triggerAlarm(): AlarmState {
  return { active: true, timerMs: ALARM_DURATION_MS };
}

/** Counts an active alarm down and clears it at zero; a no-op otherwise. */
export function tickAlarm(state: AlarmState, dtMs: number): AlarmState {
  if (!state.active) return state;
  const timerMs = state.timerMs - dtMs;
  return timerMs <= 0 ? { active: false, timerMs: 0 } : { active: true, timerMs };
}

/** Climb speed (world units/sec) climbs with score, capped so it stays
 * playable. */
export function climbSpeedForScore(score: number): number {
  return Math.min(9, 3 + score * 0.08);
}

/** Difficulty (0..1) feeds generateWindowRow's lit-column count. */
export function difficultyForScore(score: number): number {
  return Math.min(1, score / 40);
}
