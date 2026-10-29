import { DataValue, StatusCodes, type UAVariable } from "node-opcua";
import type { CallbackT } from "node-opcua-status-code";
import type { ISessionContext, ContinuationData } from "node-opcua-address-space-base";
import type { NumericRange } from "node-opcua-numeric-range";
import type { QualifiedNameLike } from "node-opcua-data-model";
import {
  HistoryData,
  HistoryReadResult,
  ReadAtTimeDetails,
  ReadRawModifiedDetails
} from "node-opcua-service-history";
import {
  getAggregateConfiguration,
  getInterval,
  interpolatedValue,
  type AggregateConfigurationOptionsEx
} from "node-opcua-aggregates";

/**
 * node-opcua does not implement the ReadAtTimeDetails history read (OPC UA
 * Part 11 S6.4.3.4): its built-in _historyRead hard codes
 * BadHistoryOperationUnsupported for it. This wraps the per-node
 * _historyRead installed by installHistoricalDataNode so AtTime reads are
 * served the way the spec describes - following the same interpolation
 * rules as the Interpolative aggregate - reusing the raw history and
 * aggregate helpers node-opcua already ships.
 */
export default function installReadAtTime(variable: UAVariable): void {
  const node = variable as any;
  const originalHistoryRead = node._historyRead.bind(node);

  node._historyRead = (
    context: ISessionContext,
    historyReadDetails: unknown,
    indexRange: NumericRange | null,
    dataEncoding: QualifiedNameLike | null,
    continuationData: ContinuationData,
    callback: CallbackT<HistoryReadResult>
  ) => {
    if (!(historyReadDetails instanceof ReadAtTimeDetails)) {
      originalHistoryRead(
        context,
        historyReadDetails,
        indexRange,
        dataEncoding,
        continuationData,
        callback
      );
      return;
    }

    readAtTime(variable, context, historyReadDetails, callback);
  };
}

function readAtTime(
  variable: UAVariable,
  context: ISessionContext,
  details: ReadAtTimeDetails,
  callback: CallbackT<HistoryReadResult>
): void {
  const reqTimes = (details.reqTimes ?? []).filter((time): time is Date => time !== null);

  if (reqTimes.length === 0) {
    callback(
      null,
      new HistoryReadResult({
        historyData: new HistoryData({ dataValues: [] }),
        statusCode: StatusCodes.Good
      })
    );
    return;
  }

  const first = reqTimes.reduce((earliest, time) => (time < earliest ? time : earliest));
  const last = reqTimes.reduce((latest, time) => (time > latest ? time : latest));

  // interpolation needs raw values on both sides of the requested times, so
  // the raw read window is padded with the node's own sampling interval
  const margin = Math.max(variable.minimumSamplingInterval || 0, 1000) * 10;
  const rawDetails = new ReadRawModifiedDetails({
    startTime: new Date(first.getTime() - margin),
    endTime: new Date(last.getTime() + margin),
    isReadModified: false,
    numValuesPerNode: 0,
    returnBounds: false
  });

  variable.historyRead(
    context,
    rawDetails,
    null,
    null,
    { continuationPoint: null },
    (err, rawResult) => {
      if (err || !rawResult || rawResult.statusCode.isNotGood()) {
        callback(null, new HistoryReadResult({ statusCode: StatusCodes.BadNoData }));
        return;
      }

      const dataValues = ((rawResult.historyData as HistoryData).dataValues || [])
        .slice()
        .sort((a, b) => a.sourceTimestamp!.getTime() - b.sourceTimestamp!.getTime());

      const baseOptions = getAggregateConfiguration(variable);
      const options: AggregateConfigurationOptionsEx = details.useSimpleBounds
        ? { ...baseOptions, stepped: true }
        : baseOptions;

      callback(
        null,
        new HistoryReadResult({
          historyData: new HistoryData({
            dataValues: computeAtTimeValues(dataValues, reqTimes, options)
          }),
          statusCode: StatusCodes.Good
        })
      );
    }
  );
}

/**
 * Looks up one DataValue per requested timestamp, interpolating from the
 * surrounding raw values with the same rules as the Interpolative aggregate.
 * Exported separately from the node-opcua wiring so it can be unit tested
 * without a running address space.
 */
export function computeAtTimeValues(
  dataValues: DataValue[],
  reqTimes: Date[],
  options: AggregateConfigurationOptionsEx
): DataValue[] {
  if (dataValues.length === 0) {
    return reqTimes.map(
      (requestedTime) =>
        new DataValue({ sourceTimestamp: requestedTime, statusCode: StatusCodes.BadNoData })
    );
  }

  return reqTimes.map((requestedTime) =>
    interpolatedValue(getInterval(requestedTime, 1, 0, dataValues), options)
  );
}
