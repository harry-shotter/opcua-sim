import { describe, expect, test } from "bun:test";
import { DataType, DataValue, StatusCodes, Variant } from "node-opcua";
import { getInterval } from "node-opcua-aggregates";
import {
  calculateIntervalStandardDeviationSampleValue,
  calculateIntervalStartValue,
  calculateIntervalTotalValue,
  supportedAggregates
} from "../src/ua-config/Aggregates";

function dataValue(time: number, value: number, good = true): DataValue {
  return new DataValue({
    sourceTimestamp: new Date(time),
    statusCode: good ? StatusCodes.Good : StatusCodes.Bad,
    value: new Variant({ dataType: DataType.Double, value })
  });
}

function interval(
  dataValues: DataValue[],
  startTime: number,
  processingInterval: number
) {
  return getInterval(new Date(startTime), processingInterval, 0, dataValues);
}

const defaultOptions = {
  percentDataBad: 100,
  percentDataGood: 100,
  stepped: false,
  treatUncertainAsBad: false,
  useSlopedExtrapolation: false
};

describe("supported aggregates", () => {
  test("advertises the expected aggregate function node ids", () => {
    expect(supportedAggregates).toEqual([
      2341, // Interpolative
      2342, // Average
      2344, // Total
      2346, // Minimum
      2347, // Maximum
      2357, // Start
      2360, // DurationGood
      2361, // DurationBad
      11426, // StandardDeviationSample
      2352, // Count
      2362, // PercentGood
      2363 // PercentBad
    ]);
  });
});

describe("Total", () => {
  // 0 -> 10 over the first second, then 10 held for the second second
  const dataValues = [dataValue(0, 0), dataValue(1000, 10), dataValue(2000, 20)];

  test("integrates using trapezoidal regions when not stepped", () => {
    const result = calculateIntervalTotalValue(
      interval(dataValues, 0, 2000),
      defaultOptions
    );

    expect(result.value.value).toBeCloseTo(15, 6);
    expect(result.statusCode.isGoodish()).toBe(true);
    expect(result.statusCode.name).toContain("HistorianCalculated");
  });

  test("integrates using rectangular regions when stepped", () => {
    const result = calculateIntervalTotalValue(interval(dataValues, 0, 2000), {
      ...defaultOptions,
      stepped: true
    });

    expect(result.value.value).toBeCloseTo(10, 6);
  });

  test("reports uncertain when the interval contains bad values", () => {
    const withBad = [dataValue(0, 0), dataValue(1000, 10, false)];

    const result = calculateIntervalTotalValue(
      interval(withBad, 0, 2000),
      defaultOptions
    );

    expect(result.statusCode.name).toContain("UncertainDataSubNormal");
  });

  test("returns BadNoData when the interval has no usable values", () => {
    const noData = [dataValue(0, 0, false), dataValue(1000, 10, false)];

    const result = calculateIntervalTotalValue(
      interval(noData, 0, 2000),
      defaultOptions
    );

    expect(result.statusCode).toEqual(StatusCodes.BadNoData);
  });
});

describe("StandardDeviationSample", () => {
  test("uses the sample (n - 1) denominator", () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const dataValues = values.map((value, index) =>
      dataValue(index * 1000, value)
    );

    const result = calculateIntervalStandardDeviationSampleValue(
      interval(dataValues, 0, 8000),
      defaultOptions
    );

    // mean 5, sum of squared deviations 32, 32 / 7 => sqrt = 2.13809...
    expect(result.value.value).toBeCloseTo(Math.sqrt(32 / 7), 6);
  });

  test("returns BadNoData with fewer than two good values", () => {
    const dataValues = [dataValue(0, 5), dataValue(1000, 7, false)];

    const result = calculateIntervalStandardDeviationSampleValue(
      interval(dataValues, 0, 2000),
      defaultOptions
    );

    expect(result.statusCode).toEqual(StatusCodes.BadNoData);
  });
});

describe("Start", () => {
  const dataValues = [dataValue(0, 10), dataValue(2000, 30)];

  test("interpolates the bounding value at the start of the interval", () => {
    const result = calculateIntervalStartValue(
      interval(dataValues, 1000, 1000),
      defaultOptions
    );

    expect(result.value.value).toBeCloseTo(20, 6);
    expect(result.sourceTimestamp?.getTime()).toBe(1000);
  });

  test("carries the previous value forward when stepped", () => {
    const result = calculateIntervalStartValue(interval(dataValues, 1000, 1000), {
      ...defaultOptions,
      stepped: true
    });

    expect(result.value.value).toBe(10);
  });
});
