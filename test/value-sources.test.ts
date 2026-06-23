import { describe, expect, test } from "bun:test";
import ValueSourceHandler from "../src/value-sources/ValueSourceHandler";
import { validateValueSource } from "../src/value-sources/ValueSourceTypes";

// getValue is deterministic when both startTime and timestamp are supplied:
//   elapsedSeconds = (timestamp - startTime) / 1000
const start = new Date(0);
const at = (seconds: number) => new Date(seconds * 1000);

// Sources omit the unused `minimumSampleRate` field, so cast through `any`.
const handler = new ValueSourceHandler();
const value = (source: any, seconds: number) =>
  handler.getValue("test", source, start, at(seconds));

describe("deterministic value sources", () => {
  test("sinWave: offset at t=0, peak at quarter period", async () => {
    const source = {
      type: "sinWave",
      amplitude: 10,
      frequency: 1,
      phase: 0,
      offset: 50
    };
    expect(await value(source, 0)).toBeCloseTo(50);
    expect(await value(source, 0.25)).toBeCloseTo(60);
  });

  test("squareWave: high during duty cycle, low after", async () => {
    const source = {
      type: "squareWave",
      amplitude: 5,
      frequency: 1,
      dutyCycle: 0.5,
      offset: 0
    };
    expect(await value(source, 0)).toBeCloseTo(5);
    expect(await value(source, 0.75)).toBeCloseTo(-5);
  });

  test("triangleWave: peaks at half period", async () => {
    const source = { type: "triangleWave", amplitude: 15, frequency: 1, offset: 25 };
    expect(await value(source, 0.5)).toBeCloseTo(40);
  });

  test("sawtooth: midpoint (offset) at half period when rising", async () => {
    const source = {
      type: "sawtooth",
      amplitude: 20,
      frequency: 1,
      offset: 30,
      rising: true
    };
    expect(await value(source, 0.5)).toBeCloseTo(30);
  });

  test("step: advances by interval and loops", async () => {
    const source = { type: "step", values: [0, 25, 50, 75, 100], interval: 10, loop: true };
    expect(await value(source, 0)).toBe(0);
    expect(await value(source, 15)).toBe(25);
    // total cycle = 50s; 60s wraps back to the second step
    expect(await value(source, 60)).toBe(25);
  });

  test("perlinNoise: equals offset at t=0", async () => {
    const source = { type: "perlinNoise", amplitude: 20, frequency: 1, offset: 10 };
    expect(await value(source, 0)).toBeCloseTo(10);
  });
});

describe("seeded random sources", () => {
  test("random: deterministic and within bounds for a fixed timestamp", async () => {
    const source = { type: "random", min: 5, max: 15, updateFrequency: 1 };
    const a = await value(source, 42);
    const b = await value(source, 42);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(5);
    expect(a).toBeLessThanOrEqual(15);
  });

  test("randomWalk: deterministic and within bounds for a fixed timestamp", async () => {
    const source = { type: "randomWalk", min: 0, max: 10, stepSize: 0.5, updateFrequency: 1 };
    const a = await value(source, 10);
    const b = await value(source, 10);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(10);
  });
});

describe("validateValueSource", () => {
  test("accepts a valid source", () => {
    expect(() =>
      validateValueSource({ type: "random", min: 0, max: 100 } as any)
    ).not.toThrow();
  });

  test("rejects a source missing required fields", () => {
    expect(() => validateValueSource({ type: "random", min: 0 } as any)).toThrow();
  });

  test("rejects homeAssistant without entityId", () => {
    expect(() => validateValueSource({ type: "homeAssistant" } as any)).toThrow();
  });

  test("rejects an unknown source type", () => {
    expect(() => validateValueSource({ type: "nope" } as any)).toThrow();
  });
});
