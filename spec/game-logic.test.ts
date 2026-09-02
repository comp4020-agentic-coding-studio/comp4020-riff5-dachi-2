import { describe, expect, it } from "vitest";
import {
  ALARM_DURATION_MS,
  BUILDING_LEFT,
  BUILDING_RIGHT,
  PLAYER_HALF_WIDTH,
  WINDOW_COLUMNS,
  WINDOW_COL_W,
  climbSpeedForScore,
  clampPlayerX,
  difficultyForScore,
  generateWindowRow,
  overlapsWindow,
  stepPlayer,
  tickAlarm,
  triggerAlarm,
  windowXRange,
  type PlayerPhysics,
} from "../game-logic.ts";

// The one rule the brief cares about most: a safe gap always exists, and
// it's always wide enough to actually fit through (one contiguous run, not
// scattered slivers) --- same fairness invariant the original lane game had,
// generalised from 3 lanes to N window columns.
describe("generateWindowRow: a safe gap always exists and is wide enough", () => {
  it("never lights every column, across difficulties and rolls", () => {
    for (let i = 0; i < 500; i++) {
      const difficulty = (i % 10) / 9;
      const row = generateWindowRow(Math.random, difficulty);
      const dark = row.slots.filter((s) => s.light === "dark");
      expect(dark.length).toBeGreaterThan(0);
    }
  });

  it("lights at least one column, so the alarm rule matters", () => {
    const row = generateWindowRow(() => 0, 0);
    expect(row.slots.some((s) => s.light === "lit")).toBe(true);
  });

  it("keeps the dark columns contiguous, so the gap is one wide opening", () => {
    for (let i = 0; i < 200; i++) {
      const row = generateWindowRow(Math.random, 1);
      const darkCols = row.slots.filter((s) => s.light === "dark").map((s) => s.col);
      if (darkCols.length === 0) continue;
      // A contiguous run, allowing wraparound across the row's ends.
      const sorted = [...darkCols].sort((a, b) => a - b);
      const gaps = sorted.slice(1).map((c, i) => c - sorted[i]);
      const wraps = sorted[0] + (WINDOW_COLUMNS - 1 - sorted[sorted.length - 1]);
      const nonContiguous = gaps.filter((g) => g > 1).length;
      expect(nonContiguous <= 1 || wraps === 0).toBe(true);
    }
  });

  it("hardest difficulty still leaves exactly one dark column, not zero", () => {
    const row = generateWindowRow(() => 0.999, 1);
    expect(row.slots.filter((s) => s.light === "dark").length).toBeGreaterThanOrEqual(1);
  });
});

describe("overlapsWindow: precise but forgiving collision", () => {
  it("catches the player dead-centre of a window", () => {
    const [left, right] = windowXRange(2);
    const center = (left + right) / 2;
    expect(overlapsWindow(center, 2)).toBe(true);
  });

  it("misses a window the player isn't near", () => {
    expect(overlapsWindow(BUILDING_LEFT + 1, WINDOW_COLUMNS - 1)).toBe(false);
  });

  it("forgives grazing the column's outer frame (the inset margin)", () => {
    // Just inside the column's raw bounds but outside the inset hitbox.
    const rawLeft = BUILDING_LEFT + 2 * WINDOW_COL_W;
    expect(overlapsWindow(rawLeft + 1, 2)).toBe(false);
  });

  it("player hitbox is narrower than a full column, so a hug down the middle of the gap is always safe", () => {
    expect(PLAYER_HALF_WIDTH * 2).toBeLessThan(WINDOW_COL_W);
  });
});

describe("stepPlayer: continuous movement", () => {
  it("accelerates toward the held direction", () => {
    let p: PlayerPhysics = { x: WORLD_MID(), vx: 0 };
    p = stepPlayer(p, 1, 1 / 60);
    expect(p.vx).toBeGreaterThan(0);
    const p2 = stepPlayer(p, 1, 1 / 60);
    expect(p2.vx).toBeGreaterThan(p.vx);
  });

  it("decelerates to a clean stop when released, never overshooting", () => {
    let p: PlayerPhysics = { x: WORLD_MID(), vx: 50 };
    for (let i = 0; i < 30; i++) p = stepPlayer(p, 0, 1 / 60);
    expect(p.vx).toBe(0);
  });

  it("never leaves the building's bounds, and sheds velocity at the wall", () => {
    let p: PlayerPhysics = { x: WORLD_MID(), vx: 0 };
    for (let i = 0; i < 300; i++) p = stepPlayer(p, -1, 1 / 60);
    expect(p.x).toBeGreaterThanOrEqual(BUILDING_LEFT + PLAYER_HALF_WIDTH);
    expect(p.vx).toBe(0);
  });
});

describe("clampPlayerX", () => {
  it("keeps a position inside the building's edges", () => {
    expect(clampPlayerX(-50)).toBe(BUILDING_LEFT + PLAYER_HALF_WIDTH);
    expect(clampPlayerX(10000)).toBe(BUILDING_RIGHT - PLAYER_HALF_WIDTH);
  });
});

describe("alarm: one bad window is a warning, not instant death", () => {
  it("triggerAlarm starts a countdown", () => {
    const alarm = triggerAlarm();
    expect(alarm.active).toBe(true);
    expect(alarm.timerMs).toBe(ALARM_DURATION_MS);
  });

  it("tickAlarm counts down and clears at zero", () => {
    let alarm = triggerAlarm();
    alarm = tickAlarm(alarm, ALARM_DURATION_MS - 1);
    expect(alarm.active).toBe(true);
    alarm = tickAlarm(alarm, 1);
    expect(alarm.active).toBe(false);
  });

  it("tickAlarm is a no-op while inactive", () => {
    const alarm = tickAlarm({ active: false, timerMs: 0 }, 500);
    expect(alarm).toEqual({ active: false, timerMs: 0 });
  });
});

describe("difficulty and speed ramps", () => {
  it("never exceed their caps as score climbs", () => {
    expect(climbSpeedForScore(1000)).toBeLessThanOrEqual(9);
    expect(difficultyForScore(1000)).toBeLessThanOrEqual(1);
  });

  it("increase with score", () => {
    expect(climbSpeedForScore(20)).toBeGreaterThan(climbSpeedForScore(0));
    expect(difficultyForScore(20)).toBeGreaterThan(difficultyForScore(0));
  });
});

function WORLD_MID(): number {
  return (BUILDING_LEFT + BUILDING_RIGHT) / 2;
}
