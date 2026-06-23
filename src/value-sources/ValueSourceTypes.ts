export interface HistoricalValue {
  timestamp: Date;
  value: number | string;
}

export enum ValueSourceType {
  Random = "random",
  RandomWalk = "randomWalk",
  PerlinNoise = "perlinNoise",
  SinWave = "sinWave",
  SquareWave = "squareWave",
  TriangleWave = "triangleWave",
  Sawtooth = "sawtooth",
  Step = "step",
  HomeAssistant = "homeAssistant"
}

// Base value source interface with discriminator
interface BaseValueSource {
  type: string;
}

// --- Random/Noise Functions ---
interface RandomSource extends BaseValueSource {
  type: ValueSourceType.Random;
  min: number;
  max: number;
  updateFrequency?: number; // Hz
}

interface RandomWalkSource extends BaseValueSource {
  type: ValueSourceType.RandomWalk;
  min: number;
  max: number;
  stepSize: number;
  updateFrequency?: number; // Hz
}

interface PerlinNoiseSource extends BaseValueSource {
  type: ValueSourceType.PerlinNoise;
  amplitude: number;
  frequency: number;
  offset?: number;
}

// --- Periodic Functions ---
interface SinWaveSource extends BaseValueSource {
  type: ValueSourceType.SinWave;
  amplitude?: number; // Default: 1
  frequency?: number; // Default: 1 Hz
  phase?: number; // Default: 0 radians
  offset?: number; // Default: 0
}

interface SquareWaveSource extends BaseValueSource {
  type: ValueSourceType.SquareWave;
  amplitude: number;
  frequency: number; // Hz
  dutyCycle?: number; // 0-1, default: 0.5
  offset?: number;
}

interface TriangleWaveSource extends BaseValueSource {
  type: ValueSourceType.TriangleWave;
  amplitude: number;
  frequency: number; // Hz
  offset?: number;
}

interface SawtoothSource extends BaseValueSource {
  type: ValueSourceType.Sawtooth;
  amplitude: number;
  frequency: number; // Hz
  offset?: number;
  rising?: boolean; // Default: true
}

// --- Step/Pattern Functions ---
interface StepSource extends BaseValueSource {
  type: ValueSourceType.Step;
  values: number[];
  interval: number; // Seconds
  loop?: boolean; // Default: true
}

// --- External Data Sources ---
interface HomeAssistantSource extends BaseValueSource {
  type: ValueSourceType.HomeAssistant;
  entityId: string;
}

// Updated ValueSource type union
type ValueSource =
  | RandomSource
  | RandomWalkSource
  | PerlinNoiseSource
  | SinWaveSource
  | SquareWaveSource
  | TriangleWaveSource
  | SawtoothSource
  | StepSource
  | HomeAssistantSource;

export type {
  ValueSource,
  BaseValueSource,
  HomeAssistantSource,
  StepSource,
  SawtoothSource,
  TriangleWaveSource,
  SquareWaveSource,
  SinWaveSource,
  PerlinNoiseSource,
  RandomWalkSource,
  RandomSource
};

export function validateValueSource(source: ValueSource): void {
  switch (source.type) {
    case ValueSourceType.Random:
      if (!isRandomSource(source))
        throw new Error("Invalid random source: missing min/max");
      break;
    case ValueSourceType.RandomWalk:
      if (!isRandomWalkSource(source))
        throw new Error("Invalid randomWalk source: missing min/max/stepSize");
      break;
    case ValueSourceType.PerlinNoise:
      if (!isPerlinNoiseSource(source))
        throw new Error("Invalid perlinNoise source: missing amplitude/frequency");
      break;
    case ValueSourceType.SinWave:
      if (!isSinWaveSource(source))
        throw new Error("Invalid sinWave source: invalid properties");
      break;
    case ValueSourceType.SquareWave:
      if (!isSquareWaveSource(source))
        throw new Error("Invalid squareWave source: missing amplitude/frequency");
      break;
    case ValueSourceType.TriangleWave:
      if (!isTriangleWaveSource(source))
        throw new Error("Invalid triangleWave source: missing amplitude/frequency");
      break;
    case ValueSourceType.Sawtooth:
      if (!isSawtoothSource(source))
        throw new Error("Invalid sawtooth source: missing amplitude/frequency");
      break;
    case ValueSourceType.Step:
      if (!isStepSource(source))
        throw new Error("Invalid step source: missing values/interval");
      break;
    case ValueSourceType.HomeAssistant:
      if (!isHomeAssistantSource(source))
        throw new Error("Invalid homeAssistant source: missing entityId");
      break;
    default:
      throw new Error(`Unknown source type: ${(source as any).type}`);
  }
}

// Type guard functions for each source type
function isRandomSource(source: any): source is RandomSource {
  return (
    source.type === ValueSourceType.Random &&
    typeof source.min === "number" &&
    typeof source.max === "number" &&
    (source.updateFrequency === undefined ||
      typeof source.updateFrequency === "number")
  );
}

function isRandomWalkSource(source: any): source is RandomWalkSource {
  return (
    source.type === ValueSourceType.RandomWalk &&
    typeof source.min === "number" &&
    typeof source.max === "number" &&
    typeof source.stepSize === "number" &&
    (source.updateFrequency === undefined ||
      typeof source.updateFrequency === "number")
  );
}

function isPerlinNoiseSource(source: any): source is PerlinNoiseSource {
  return (
    source.type === ValueSourceType.PerlinNoise &&
    typeof source.amplitude === "number" &&
    typeof source.frequency === "number" &&
    (source.offset === undefined || typeof source.offset === "number")
  );
}

function isSinWaveSource(source: any): source is SinWaveSource {
  return (
    source.type === ValueSourceType.SinWave &&
    (source.amplitude === undefined || typeof source.amplitude === "number") &&
    (source.frequency === undefined || typeof source.frequency === "number") &&
    (source.phase === undefined || typeof source.phase === "number") &&
    (source.offset === undefined || typeof source.offset === "number")
  );
}

function isSquareWaveSource(source: any): source is SquareWaveSource {
  return (
    source.type === ValueSourceType.SquareWave &&
    typeof source.amplitude === "number" &&
    typeof source.frequency === "number" &&
    (source.dutyCycle === undefined || typeof source.dutyCycle === "number") &&
    (source.offset === undefined || typeof source.offset === "number")
  );
}

function isTriangleWaveSource(source: any): source is TriangleWaveSource {
  return (
    source.type === ValueSourceType.TriangleWave &&
    typeof source.amplitude === "number" &&
    typeof source.frequency === "number" &&
    (source.offset === undefined || typeof source.offset === "number")
  );
}

function isSawtoothSource(source: any): source is SawtoothSource {
  return (
    source.type === ValueSourceType.Sawtooth &&
    typeof source.amplitude === "number" &&
    typeof source.frequency === "number" &&
    (source.offset === undefined || typeof source.offset === "number") &&
    (source.rising === undefined || typeof source.rising === "boolean")
  );
}

function isStepSource(source: any): source is StepSource {
  return (
    source.type === ValueSourceType.Step &&
    Array.isArray(source.values) &&
    source.values.every((v: any) => typeof v === "number") &&
    typeof source.interval === "number" &&
    (source.loop === undefined || typeof source.loop === "boolean")
  );
}

function isHomeAssistantSource(source: any): source is HomeAssistantSource {
  return (
    source.type === ValueSourceType.HomeAssistant &&
    typeof source.entityId === "string"
  );
}
