import { describe, expect, it } from "vitest";
import {
  LANE_COUNT,
  buildRow,
  clampLane,
  difficultyForScore,
  generateRow,
  isCollision,
  pickAiTarget,
  speedForScore,
  type Lane,
} from "../game-logic.ts";

// The one rule the brief asks for a focused test on: a row that reaches the
// player ends the round if and only if it blocks the lane the player is in.
describe("isCollision: the rule that ends a round", () => {
  it("collides when the row blocks the player's lane", () => {
    expect(isCollision(1, { blocked: [1] })).toBe(true);
    expect(isCollision(0, { blocked: [0, 2] })).toBe(true);
  });

  it("does not collide when the player's lane is open", () => {
    expect(isCollision(1, { blocked: [0, 2] })).toBe(false);
    expect(isCollision(2, { blocked: [] })).toBe(false);
  });
});

describe("generateRow: a wrong move is possible, but never every move", () => {
  // A row that blocks every lane would make a round unwinnable no matter
  // what the player does --- that's a fairness bug, not a difficulty spike.
  it("always leaves at least one lane open, across difficulties and rolls", () => {
    for (let i = 0; i < 500; i++) {
      const difficulty = (i % 10) / 9;
      const row = generateRow(Math.random, difficulty);
      const openLanes = [0, 1, 2].filter((lane) => !row.blocked.includes(lane as Lane));
      expect(row.blocked.length).toBeLessThan(LANE_COUNT);
      expect(openLanes.length).toBeGreaterThan(0);
    }
  });

  it("blocks at least one lane, so play can end", () => {
    const row = generateRow(() => 0, 0);
    expect(row.blocked.length).toBeGreaterThan(0);
  });
});

describe("buildRow: a trapper's picks, same fairness invariant", () => {
  it("never blocks every lane, even if all three are picked", () => {
    const row = buildRow([0, 1, 2]);
    expect(row.blocked.length).toBeLessThan(LANE_COUNT);
  });

  it("keeps distinct picks in order, up to the cap", () => {
    expect(buildRow([2, 0]).blocked).toEqual([2, 0]);
    expect(buildRow([1, 1, 0]).blocked).toEqual([1, 0]);
  });
});

describe("pickAiTarget: the dodger's reflex", () => {
  it("stays put when already safe", () => {
    expect(pickAiTarget(1, { blocked: [0] })).toBe(1);
  });

  it("heads for the nearest open lane when caught", () => {
    expect(pickAiTarget(1, { blocked: [1, 0] })).toBe(2);
    expect(pickAiTarget(1, { blocked: [1, 2] })).toBe(0);
  });
});

describe("clampLane", () => {
  it("keeps the player inside the lanes that exist", () => {
    expect(clampLane(-1)).toBe(0);
    expect(clampLane(3)).toBe(2);
    expect(clampLane(1)).toBe(1);
  });
});

describe("difficulty and speed ramps", () => {
  it("never exceeds their caps as score climbs", () => {
    expect(speedForScore(1000)).toBeLessThanOrEqual(9);
    expect(difficultyForScore(1000)).toBeLessThanOrEqual(1);
  });

  it("increases with score", () => {
    expect(speedForScore(20)).toBeGreaterThan(speedForScore(0));
    expect(difficultyForScore(20)).toBeGreaterThan(difficultyForScore(0));
  });
});
