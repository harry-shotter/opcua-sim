import {
  DataType,
  DataValue,
  StatusCode,
  StatusCodes,
  Variant,
  type AddressSpace,
  type UAVariable
} from "node-opcua";
import { HistoryData, HistoryReadResult } from "node-opcua-service-history";
import {
  addAggregateSupport,
  adjustProcessingOptions,
  AggregateFunction,
  getAggregateData,
  interpolatedValue,
  isGoodish2,
  type AggregateConfigurationOptionsEx,
  type Interval
} from "node-opcua-aggregates";

type IntervalCalculator = (
  interval: Interval,
  options: AggregateConfigurationOptionsEx
) => DataValue;

/**
 * Aggregate functions advertised by the server.
 *
 * Interpolative, Average, Minimum, Maximum, DurationGood, DurationBad,
 * PercentGood, PercentBad and Count are implemented by node-opcua; Total,
 * Start and StandardDeviationSample are implemented below.
 */
export const supportedAggregates: AggregateFunction[] = [
  AggregateFunction.Interpolative,
  AggregateFunction.Average,
  AggregateFunction.Total,
  AggregateFunction.Minimum,
  AggregateFunction.Maximum,
  AggregateFunction.Start,
  AggregateFunction.DurationGood,
  AggregateFunction.DurationBad,
  AggregateFunction.StandardDeviationSample,
  AggregateFunction.Count,
  AggregateFunction.PercentGood,
  AggregateFunction.PercentBad
];

const numericDataTypes = new Set([
  DataType.Byte,
  DataType.SByte,
  DataType.Int16,
  DataType.UInt16,
  DataType.Int32,
  DataType.UInt32,
  DataType.Int64,
  DataType.UInt64,
  DataType.Float,
  DataType.Double
]);

/**
 * Enables aggregate support on the address space and adds the aggregate
 * functions that node-opcua does not implement itself.
 */
export default function installAggregates(addressSpace: AddressSpace): void {
  addAggregateSupport(addressSpace, supportedAggregates);

  const addressSpaceInternal = addressSpace as any;
  const readProcessedDetails = addressSpaceInternal._readProcessedDetails;

  if (typeof readProcessedDetails !== "function") {
    throw new Error(
      "addAggregateSupport did not install _readProcessedDetails - incompatible node-opcua version"
    );
  }

  addressSpaceInternal._readProcessedDetails = (
    variable: UAVariable,
    context: any,
    historyReadDetails: any,
    indexRange: any,
    dataEncoding: any,
    continuationData: any,
    callback: (err: Error | null, result?: HistoryReadResult) => void
  ) => {
    const aggregateTypes = historyReadDetails.aggregateType || [];
    const aggregateType = aggregateTypes.length === 1 ? aggregateTypes[0] : undefined;

    const calculator =
      aggregateType && aggregateType.namespace === 0
        ? getCalculator(aggregateType.value, variable)
        : undefined;

    if (!calculator) {
      return readProcessedDetails(
        variable,
        context,
        historyReadDetails,
        indexRange,
        dataEncoding,
        continuationData,
        callback
      );
    }

    const { startTime, endTime } = historyReadDetails;

    if (!startTime || !endTime || startTime.getTime() === endTime.getTime()) {
      return callback(
        null,
        new HistoryReadResult({ statusCode: StatusCodes.BadInvalidArgument })
      );
    }

    const processingInterval =
      historyReadDetails.processingInterval ||
      endTime.getTime() - startTime.getTime();

    getAggregateData(
      variable,
      processingInterval,
      startTime,
      endTime,
      calculator,
      (err, dataValues) => {
        if (err) {
          return callback(
            null,
            new HistoryReadResult({ statusCode: StatusCodes.BadInternalError })
          );
        }

        callback(
          null,
          new HistoryReadResult({
            historyData: new HistoryData({ dataValues }),
            statusCode: StatusCodes.Good
          })
        );
      }
    );
  };
}

function getCalculator(
  aggregateFunction: number,
  variable: UAVariable
): IntervalCalculator | undefined {
  const isNumeric = isNumericVariable(variable);

  switch (aggregateFunction) {
    case AggregateFunction.Start:
      return isNumeric
        ? calculateIntervalStartValue
        : // non numeric values cannot be interpolated, so the last known
          // value is carried forward instead
          (interval, options) =>
            calculateIntervalStartValue(interval, { ...options, stepped: true });

    case AggregateFunction.Total:
      return isNumeric ? calculateIntervalTotalValue : unsupportedAggregate;

    case AggregateFunction.StandardDeviationSample:
      return isNumeric
        ? calculateIntervalStandardDeviationSampleValue
        : unsupportedAggregate;

    default:
      return undefined;
  }
}

function isNumericVariable(variable: UAVariable): boolean {
  try {
    return numericDataTypes.has(
      variable.addressSpace.findCorrespondingBasicDataType(variable.dataType)
    );
  } catch {
    return false;
  }
}

function unsupportedAggregate(interval: Interval): DataValue {
  return new DataValue({
    sourceTimestamp: interval.startTime,
    statusCode: StatusCodes.BadAggregateNotSupported
  });
}

/**
 * Start: the value at the beginning of the interval, using interpolated
 * bounding values.
 */
export function calculateIntervalStartValue(
  interval: Interval,
  options: AggregateConfigurationOptionsEx
): DataValue {
  return interpolatedValue(interval, options);
}

/**
 * Total: the time integral of the data over the interval, expressed in
 * value-seconds.
 */
export function calculateIntervalTotalValue(
  interval: Interval,
  options: AggregateConfigurationOptionsEx
): DataValue {
  const adjustedOptions = adjustProcessingOptions({ ...options });
  const points: { time: number; value: number }[] = [];
  let hasBad = false;

  const startBound = interpolatedValue(interval, adjustedOptions);

  if (!startBound.statusCode.isBad() && typeof startBound.value?.value === "number") {
    points.push({
      time: interval.startTime.getTime(),
      value: startBound.value.value
    });
  }

  for (let i = interval.index; i >= 0 && i < interval.index + interval.count; i++) {
    const dataValue = interval.dataValues[i]!;

    if (!isGoodish2(dataValue.statusCode, adjustedOptions)) {
      hasBad = true;
      continue;
    }

    const time = dataValue.sourceTimestamp!.getTime();

    if (points.length > 0 && points[points.length - 1]!.time === time) {
      continue;
    }

    points.push({ time, value: dataValue.value.value });
  }

  if (points.length === 0) {
    return new DataValue({
      sourceTimestamp: interval.startTime,
      statusCode: StatusCodes.BadNoData
    });
  }

  const endTime = interval.getEffectiveEndTime();
  let total = 0;

  for (let i = 0; i < points.length; i++) {
    const current = points[i]!;
    const next = points[i + 1];
    const segmentEnd = next ? Math.min(next.time, endTime) : endTime;
    const duration = segmentEnd - current.time;

    if (duration <= 0) {
      continue;
    }

    // the trailing region has no following sample to interpolate towards, so
    // the last known value is held constant
    total +=
      adjustedOptions.stepped || !next
        ? current.value * duration
        : ((current.value + next.value) / 2) * duration;
  }

  return new DataValue({
    sourceTimestamp: interval.startTime,
    statusCode: calculatedStatusCode(hasBad),
    value: new Variant({ dataType: DataType.Double, value: total / 1000 })
  });
}

/**
 * StandardDeviationSample: the standard deviation of the interval values,
 * using the sample (n - 1) denominator.
 */
export function calculateIntervalStandardDeviationSampleValue(
  interval: Interval,
  options: AggregateConfigurationOptionsEx
): DataValue {
  const adjustedOptions = adjustProcessingOptions({ ...options });
  const values: number[] = [];
  let hasBad = false;

  for (let i = interval.index; i >= 0 && i < interval.index + interval.count; i++) {
    const dataValue = interval.dataValues[i]!;

    if (!isGoodish2(dataValue.statusCode, adjustedOptions)) {
      hasBad = true;
      continue;
    }

    values.push(dataValue.value.value);
  }

  if (values.length < 2) {
    return new DataValue({
      sourceTimestamp: interval.startTime,
      statusCode: StatusCodes.BadNoData
    });
  }

  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);

  return new DataValue({
    sourceTimestamp: interval.startTime,
    statusCode: calculatedStatusCode(hasBad),
    value: new Variant({ dataType: DataType.Double, value: Math.sqrt(variance) })
  });
}

function calculatedStatusCode(isSubNormal: boolean): StatusCode {
  return StatusCode.makeStatusCode(
    isSubNormal ? StatusCodes.UncertainDataSubNormal : StatusCodes.Good,
    "HistorianCalculated"
  );
}
