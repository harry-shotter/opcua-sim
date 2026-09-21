import {
  DataType,
  StatusCodes,
  Variant,
  coerceLocalizedText,
  type UAObject
} from "node-opcua";
import { HistoryReadResult, ReadEventDetails } from "node-opcua-service-history";
import { HistoryEvent, HistoryEventFieldList } from "node-opcua-types";
import type { SimpleAttributeOperand } from "node-opcua-service-filter";
import type { EventRecord } from "./EventHistoryLoader";
import type { EventTypeDefinition } from "./EventTypes";

const SubscribeToEvents = 1;
const HistoryRead = 4;

/**
 * Fields inherited from BaseEventType keep their standard data types so that
 * the value returned from history matches what a client sees when browsing the
 * event type, even when the field was declared in configuration.
 */
const baseFieldDataTypes: Record<string, DataType> = {
  EventId: DataType.ByteString,
  EventType: DataType.NodeId,
  SourceNode: DataType.NodeId,
  SourceName: DataType.String,
  Time: DataType.DateTime,
  ReceiveTime: DataType.DateTime,
  Message: DataType.LocalizedText,
  Severity: DataType.UInt16
};

/**
 * Turns an object node into a historical event source backed by a fixed set of
 * records. node-opcua has no event history support of its own - Objects carry
 * no historyRead at all - so the handler is attached to the node directly.
 */
export default function installEventHistory(
  node: UAObject,
  eventType: EventTypeDefinition,
  records: EventRecord[]
): void {
  // eventNotifier exposes only a getter, so the backing field is set directly
  (node as any)._eventNotifier = SubscribeToEvents | HistoryRead;

  (node as any).historyRead = async (
    _context: unknown,
    details: unknown,
    _indexRange: unknown,
    _dataEncoding: unknown,
    _continuationData: unknown
  ): Promise<HistoryReadResult> => {
    if (!(details instanceof ReadEventDetails)) {
      return new HistoryReadResult({
        statusCode: StatusCodes.BadHistoryOperationUnsupported
      });
    }

    const selected = selectRecords(records, details);

    if (selected.length === 0) {
      return new HistoryReadResult({
        statusCode: StatusCodes.GoodNoData,
        historyData: new HistoryEvent({ events: [] })
      });
    }

    const selectClauses = details.filter?.selectClauses ?? [];

    const events = selected.map(
      ({ record, index }) =>
        new HistoryEventFieldList({
          eventFields: selectClauses.map((clause) =>
            resolveField(clause, record, index, eventType, node)
          )
        })
    );

    return new HistoryReadResult({
      statusCode: StatusCodes.Good,
      historyData: new HistoryEvent({ events })
    });
  };
}

interface SelectedRecord {
  record: EventRecord;
  index: number;
}

/**
 * Applies the time domain of the request. Records are stored in ascending time
 * order; time flows backwards when the end time precedes the start time, or
 * when only an end time is given.
 */
function selectRecords(
  records: EventRecord[],
  details: ReadEventDetails
): SelectedRecord[] {
  const startTime = toTime(details.startTime);
  const endTime = toTime(details.endTime);
  const reversed =
    (startTime !== undefined &&
      endTime !== undefined &&
      endTime < startTime) ||
    (startTime === undefined && endTime !== undefined);

  const [from, to] = reversed ? [endTime, startTime] : [startTime, endTime];

  let selected = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      const time = record.time.getTime();
      return (
        (from === undefined || time >= from) && (to === undefined || time <= to)
      );
    });

  if (reversed) {
    selected = selected.reverse();
  }

  const limit = details.numValuesPerNode ?? 0;

  return limit > 0 ? selected.slice(0, limit) : selected;
}

function toTime(value: Date | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const time = value.getTime();

  // an unset date arrives as the OPC UA minimum date rather than null
  return time <= 0 ? undefined : time;
}

function resolveField(
  clause: SimpleAttributeOperand,
  record: EventRecord,
  index: number,
  eventType: EventTypeDefinition,
  node: UAObject
): Variant {
  const name = (clause.browsePath ?? [])
    .map((element) => element.name?.toString() ?? "")
    .join("/");

  switch (name) {
    case "EventId":
      return new Variant({
        dataType: DataType.ByteString,
        value: Buffer.from(`${node.nodeId.toString()}#${index}`)
      });

    case "EventType":
      return new Variant({
        dataType: DataType.NodeId,
        value: eventType.objectType.nodeId
      });

    case "SourceNode":
      return new Variant({
        dataType: DataType.NodeId,
        value: node.nodeId
      });

    case "Time":
    case "ReceiveTime":
      return new Variant({ dataType: DataType.DateTime, value: record.time });
  }

  const value = record.fields.get(name);

  if (value === undefined) {
    return noData();
  }

  const field = eventType.fields.find((candidate) => candidate.name === name);
  const dataType = baseFieldDataTypes[name] ?? field?.dataType;

  if (dataType === undefined) {
    return noData();
  }

  if (dataType === DataType.LocalizedText) {
    return new Variant({
      dataType,
      value: coerceLocalizedText(String(value))
    });
  }

  return new Variant({ dataType, value });
}

// a field the historian cannot supply is reported as a StatusCode of BadNoData
// rather than being omitted, so select clause positions stay aligned
function noData(): Variant {
  return new Variant({
    dataType: DataType.StatusCode,
    value: StatusCodes.BadNoData
  });
}
