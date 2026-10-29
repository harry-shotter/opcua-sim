import { describe, expect, test } from "bun:test";
import { DataType, DataValue, StatusCodes, Variant } from "node-opcua";
import { computeAtTimeValues } from "../src/ua-config/ReadAtTime";

function dataValue(time: number, value: number, good = true): DataValue {
  return new DataValue({
    sourceTimestamp: new Date(time),
    statusCode: good ? StatusCodes.Good : StatusCodes.Bad,
    value: new Variant({ dataType: DataType.Double, value })
  });
}

const defaultOptions = {
  percentDataBad: 100,
  percentDataGood: 100,
  stepped: false,
  treatUncertainAsBad: false,
  useSlopedExtrapolation: false
};

describe("computeAtTimeValues", () => {
  const dataValues = [dataValue(0, 0), dataValue(2000, 20)];

  test("returns the raw value when a timestamp matches exactly", () => {
    const [result] = computeAtTimeValues(dataValues, [new Date(0)], defaultOptions);

    expect(result!.value.value).toBe(0);
    expect(result!.statusCode.isGoodish()).toBe(true);
  });

  test("interpolates between surrounding raw values", () => {
    const [result] = computeAtTimeValues(dataValues, [new Date(1000)], defaultOptions);

    expect(result!.value.value).toBeCloseTo(10, 6);
    expect(result!.statusCode.name).toContain("HistorianInterpolated");
  });

  test("holds the previous value when stepped", () => {
    const [result] = computeAtTimeValues(dataValues, [new Date(1000)], {
      ...defaultOptions,
      stepped: true
    });

    expect(result!.value.value).toBe(0);
  });

  test("returns BadNoData before the start of the history", () => {
    const [result] = computeAtTimeValues(dataValues, [new Date(-1000)], defaultOptions);

    expect(result!.statusCode).toEqual(StatusCodes.BadNoData);
  });

  test("extrapolates after the end of the history", () => {
    const [result] = computeAtTimeValues(dataValues, [new Date(5000)], defaultOptions);

    expect(result!.value.value).toBe(20);
    expect(result!.statusCode.name).toContain("UncertainDataSubNormal");
  });

  test("preserves the request order across multiple timestamps", () => {
    const results = computeAtTimeValues(
      dataValues,
      [new Date(2000), new Date(0), new Date(1000)],
      defaultOptions
    );

    expect(results.map((r) => r.value.value)).toEqual([20, 0, 10]);
  });

  test("returns BadNoData for every timestamp when there is no history", () => {
    const results = computeAtTimeValues([], [new Date(0), new Date(1000)], defaultOptions);

    expect(results.every((r) => r.statusCode.equals(StatusCodes.BadNoData))).toBe(true);
  });
});
