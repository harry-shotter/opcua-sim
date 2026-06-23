import type { HomeAssistant } from "../home-assistant/HomeAssistant";
import type {
  HomeAssistantSource,
  StepSource,
  SawtoothSource,
  TriangleWaveSource,
  SquareWaveSource,
  SinWaveSource,
  PerlinNoiseSource,
  RandomWalkSource,
  RandomSource,
  ValueSource,
  HistoricalValue
} from "./ValueSourceTypes";

export default class ValueSourceHandler {
  private startTime: number;
  private lastUpdate: Map<string, { time: number; value: number }>;
  private haClient?: HomeAssistant; // Type would be specified based on HA client library

  constructor(haClient?: HomeAssistant) {
    this.startTime = Date.now();
    this.lastUpdate = new Map();
    this.haClient = haClient;
  }

  async getValue(
    variableName: string,
    source: ValueSource,
    startTime?: Date,
    timestamp?: Date
  ): Promise<number> {
    const deviceKey = `${variableName}_${source.type}`;

    let value: number;

    const actualStartTime = startTime?.getTime() ?? this.startTime;

    switch (source.type) {
      // Random/Noise Functions
      case "random":
        value = this.getRandomValue(source, timestamp);
        break;
      case "randomWalk":
        value = this.getRandomWalkValue(source, actualStartTime, timestamp);
        break;
      case "perlinNoise":
        value = this.getPerlinNoiseValue(source, actualStartTime, timestamp);
        break;
      // Periodic Functions
      case "sinWave":
        value = this.getSinWaveValue(source, actualStartTime, timestamp);
        break;
      case "squareWave":
        value = this.getSquareWaveValue(source, actualStartTime, timestamp);
        break;
      case "triangleWave":
        value = this.getTriangleWaveValue(source, actualStartTime, timestamp);
        break;
      case "sawtooth":
        value = this.getSawtoothValue(source, actualStartTime, timestamp);
        break;
      // Step/Pattern Functions
      case "step":
        value = this.getStepValue(source, actualStartTime, timestamp);
        break;
      // External Data Sources
      case "homeAssistant":
        value = await this.getHomeAssistantValue(source);
        break;
      default:
        throw new Error(`Unsupported source type: ${(source as any).type}`);
    }

    this.lastUpdate.set(deviceKey, { time: Date.now(), value });

    return value;
  }

  async getHistoryValues(
    variableName: string,
    source: ValueSource,
    start: Date,
    end: Date,
    minimumSamplingInterval: number
  ): Promise<HistoricalValue[]> {
    const results: HistoricalValue[] = [];
    let currentDate = new Date(start);

    if (source.type === "homeAssistant")
      return this.getHomeAssistantHistoryValues(source, start, end);

    // Random walk needs special handling - compute walk once, collect values along the way
    if (source.type === "randomWalk")
      return this.getRandomWalkHistoryValues(source, start, end, minimumSamplingInterval);

    while (currentDate <= end) {
      // For time-based sources, we need to adjust the start time
      // to simulate the correct historical state
      const value = await this.getValue(
        variableName,
        source,
        start,
        currentDate
      );

      results.push({
        timestamp: new Date(currentDate),
        value: value
      });

      currentDate = new Date(currentDate.getTime() + minimumSamplingInterval);
    }

    return results;
  }

  private getElapsedSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  private getElapsedSecondsFrom(startTime: number, timestamp?: Date): number {
    return timestamp
      ? (timestamp.getTime() - startTime) / 1000
      : this.getElapsedSeconds();
  }

  private bounceValue(value: number, min: number, max: number): number {
    if (value > max) return max - (value - max);
    if (value < min) return min + (min - value);
    return value;
  }

  // Helper function to generate a hash code from a string
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  // Helper function to generate a seeded random number between 0 and 1
  private seededRandom(seed: number): number {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  // --- Random/Noise Functions ---
  private getRandomValue(source: RandomSource, timestamp?: Date): number {
    const deviceKey = `random_${source.min}_${source.max}`;
    const targetTime = timestamp?.getTime() ?? Date.now();

    // For historical values, we want to generate a consistent random number
    // based on the timestamp and device key
    if (timestamp) {
      // Create a seeded random number using the timestamp and device key
      const seed = this.hashCode(
        `${deviceKey}_${Math.floor(
          targetTime / (1000 / (source.updateFrequency ?? 1))
        )}`
      );
      const randomValue = this.seededRandom(seed);
      return source.min + randomValue * (source.max - source.min);
    }

    // For current values, maintain the existing caching behavior
    const lastUpdate = this.lastUpdate.get(deviceKey);

    if (
      !lastUpdate ||
      (source.updateFrequency &&
        targetTime - lastUpdate.time > 1000 / source.updateFrequency)
    ) {
      const value = source.min + Math.random() * (source.max - source.min);
      this.lastUpdate.set(deviceKey, { time: targetTime, value });
      return value;
    }

    return lastUpdate.value;
  }

  private getRandomWalkValue(
    source: RandomWalkSource,
    startTime: number,
    timestamp?: Date
  ): number {
    const deviceKey = `randomWalk_${source.min}_${source.max}`;
    const targetTime = timestamp?.getTime() ?? Date.now();

    // For historical values, we need to reconstruct the walk up to that point
    if (timestamp) {
      const updateFrequency = source.updateFrequency ?? 1;
      const updateInterval = 1000 / updateFrequency;
      let currentTime = startTime;
      let currentValue = (source.max + source.min) / 2; // Start at midpoint

      while (currentTime < targetTime) {
        const seed = this.hashCode(
          `${deviceKey}_${Math.floor(currentTime / updateInterval)}`
        );
        const randomValue = this.seededRandom(seed);

        const step = (randomValue * 2 - 1) * source.stepSize;
        currentValue = this.bounceValue(
          currentValue + step,
          source.min,
          source.max
        );
        currentTime += updateInterval;
      }

      return currentValue;
    }

    // For current values, maintain existing behavior
    const lastUpdate = this.lastUpdate.get(deviceKey);

    if (!lastUpdate) {
      const value = (source.max + source.min) / 2;
      this.lastUpdate.set(deviceKey, { time: targetTime, value });
      return value;
    }

    const updateFrequency = source.updateFrequency ?? 1;
    if (targetTime - lastUpdate.time > 1000 / updateFrequency) {
      const step = (Math.random() * 2 - 1) * source.stepSize;
      const newValue = this.bounceValue(
        lastUpdate.value + step,
        source.min,
        source.max
      );

      this.lastUpdate.set(deviceKey, { time: targetTime, value: newValue });
      return newValue;
    }

    return lastUpdate.value;
  }

  private getRandomWalkHistoryValues(
    source: RandomWalkSource,
    start: Date,
    end: Date,
    minimumSamplingInterval: number
  ): HistoricalValue[] {
    const results: HistoricalValue[] = [];
    const deviceKey = `randomWalk_${source.min}_${source.max}`;
    const updateFrequency = source.updateFrequency ?? 1;
    const updateInterval = 1000 / updateFrequency;

    const startTime = start.getTime();
    const endTime = end.getTime();

    let walkTime = startTime;
    let currentValue = (source.max + source.min) / 2;
    let nextSampleTime = startTime;

    // Walk through time, collecting samples at the requested interval
    while (walkTime <= endTime) {
      // Collect a sample if we've reached the next sample time
      while (nextSampleTime <= walkTime && nextSampleTime <= endTime) {
        results.push({
          timestamp: new Date(nextSampleTime),
          value: currentValue
        });
        nextSampleTime += minimumSamplingInterval;
      }

      // Take a step in the random walk
      const seed = this.hashCode(
        `${deviceKey}_${Math.floor(walkTime / updateInterval)}`
      );
      const randomValue = this.seededRandom(seed);
      const step = (randomValue * 2 - 1) * source.stepSize;
      currentValue = this.bounceValue(
        currentValue + step,
        source.min,
        source.max
      );

      walkTime += updateInterval;
    }

    // Collect any remaining samples
    while (nextSampleTime <= endTime) {
      results.push({
        timestamp: new Date(nextSampleTime),
        value: currentValue
      });
      nextSampleTime += minimumSamplingInterval;
    }

    return results;
  }

  private getPerlinNoiseValue(
    source: PerlinNoiseSource,
    startTime: number,
    timestamp?: Date
  ): number {
    const elapsedSeconds = this.getElapsedSecondsFrom(startTime, timestamp);
    const frequency = source.frequency || 1;
    const x = elapsedSeconds * frequency;

    const value =
      Math.sin(x) * 0.5 + Math.sin(x * 2.1) * 0.25 + Math.sin(x * 4.3) * 0.125;

    return value * source.amplitude + (source.offset ?? 0);
  }

  // --- Periodic Functions ---
  private getSinWaveValue(
    source: SinWaveSource,
    startTime: number,
    timestamp?: Date
  ): number {
    const amplitude = source.amplitude ?? 1;
    const frequency = source.frequency || 1;
    const phase = source.phase ?? 0;
    const offset = source.offset ?? 0;
    const elapsedSeconds = this.getElapsedSecondsFrom(startTime, timestamp);

    return (
      amplitude * Math.sin(2 * Math.PI * frequency * elapsedSeconds + phase) +
      offset
    );
  }

  private getSquareWaveValue(
    source: SquareWaveSource,
    startTime: number,
    timestamp?: Date
  ): number {
    const elapsedSeconds = this.getElapsedSecondsFrom(startTime, timestamp);
    const frequency = source.frequency || 1;
    const period = 1 / frequency;
    const dutyCycle = source.dutyCycle ?? 0.5;

    const timeInPeriod = elapsedSeconds % period;
    const value = timeInPeriod < period * dutyCycle ? 1 : -1;

    return value * source.amplitude + (source.offset ?? 0);
  }

  private getTriangleWaveValue(
    source: TriangleWaveSource,
    startTime: number,
    timestamp?: Date
  ): number {
    const elapsedSeconds = this.getElapsedSecondsFrom(startTime, timestamp);
    const frequency = source.frequency || 1;
    const period = 1 / frequency;
    const timeInPeriod = elapsedSeconds % period;

    // Create triangle wave by using absolute value of sawtooth
    const normalizedTime = (timeInPeriod / period) * 4;
    const triangleValue = 1 - Math.abs(normalizedTime - 2);

    return triangleValue * source.amplitude + (source.offset ?? 0);
  }

  private getSawtoothValue(
    source: SawtoothSource,
    startTime: number,
    timestamp?: Date
  ): number {
    const elapsedSeconds = this.getElapsedSecondsFrom(startTime, timestamp);
    const frequency = source.frequency || 1;
    const period = 1 / frequency;
    const timeInPeriod = elapsedSeconds % period;

    // Calculate sawtooth value (0 to 1)
    let sawtoothValue = timeInPeriod / period;
    if (!(source.rising ?? true)) {
      sawtoothValue = 1 - sawtoothValue;
    }

    // Scale to amplitude and offset
    return (sawtoothValue * 2 - 1) * source.amplitude + (source.offset ?? 0);
  }

  private getStepValue(
    source: StepSource,
    startTime: number,
    timestamp?: Date
  ): number {
    if (source.values.length === 0) {
      throw new Error("Step source must have at least one value");
    }

    const elapsedSeconds = this.getElapsedSecondsFrom(startTime, timestamp);

    const totalDuration = source.interval * source.values.length;

    if (!source.loop && elapsedSeconds > totalDuration) {
      return source.values[source.values.length - 1];
    }

    const timeInCycle = source.loop
      ? elapsedSeconds % totalDuration
      : elapsedSeconds;
    const stepIndex = Math.floor(timeInCycle / source.interval);
    return source.values[stepIndex % source.values.length];
  }

  // --- External Data Sources ---
  private async getHomeAssistantValue(
    source: HomeAssistantSource
  ): Promise<number> {
    if (!this.haClient) {
      throw new Error("Home Assistant client not configured");
    }

    try {
      const state = await this.haClient.states.get(source.entityId);
      const value = Number(state.state);
      if (isNaN(value)) {
        throw new Error(`State '${state.state}' is not numeric`);
      }
      return value;
    } catch (error: any) {
      throw new Error(`Failed to get Home Assistant value: ${error.message}`);
    }
  }

  private async getHomeAssistantHistoryValues(
    source: HomeAssistantSource,
    start: Date,
    end: Date
  ): Promise<HistoricalValue[]> {
    if (!this.haClient) {
      throw new Error("Home Assistant client not configured");
    }

    try {
      const states = await this.haClient.history.period(
        start,
        source.entityId,
        end,
        true,
        true,
        false
      );

      if (states.length === 0) throw new Error("No results");

      const results: HistoricalValue[] = [];

      // take the first set of results as we're only ever passing a single entity id
      for (const state of states[0]) {
        results.push({
          timestamp: new Date(state.last_changed),
          value: Number(state.state)
        });
      }

      return results;

      // return Number(state.state);
    } catch (error: any) {
      throw new Error(`Failed to get Home Assistant value: ${error.message}`);
    }
  }
}
