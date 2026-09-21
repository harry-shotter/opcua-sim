import {
  AttributeIds,
  DataType,
  StatusCodes,
  Variant,
  coerceLocalizedText,
  coerceNodeId,
  type Namespace,
  type UAObject
} from "node-opcua";
import { HistoryReadResult, ReadEventDetails } from "node-opcua-service-history";
import { HistoryEvent, HistoryEventFieldList } from "node-opcua-types";
import { EventFilter, SimpleAttributeOperand } from "node-opcua-service-filter";
import ContinuationPoints from "./EventContinuationPoints";
import { isWhereClauseSupported, matchesWhereClause } from "./EventFilter";
import type { LastReadRanges } from "./HistoryManager";
import type { EventRecord } from "./EventHistoryLoader";
import type { EventTypeDefinition } from "./EventTypes";

const SubscribeToEvents = 1;
const HistoryRead = 4;

/** DataType of the HistoricalEventFilter property. */
const eventFilterDataType = coerceNodeId("i=725");

/** BaseEventType, the type select clauses are expressed against. */
const baseEventType = coerceNodeId("i=2041");

/**
 * Standard fields the historian can always supply, regardless of how the event
 * type was configured.
 */
const alwaysAvailable = [
  "EventId",
  "EventType",
  "SourceNode",
  "SourceName",
  "Time",
  "ReceiveTime"
];

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

/** One configured origin of historical events. */
export interface EventSource {
  node: UAObject;
  eventType: EventTypeDefinition;
  records: EventRecord[];
}

interface Entry {
  source: EventSource;
  record: EventRecord;
  index: number;
}

interface PendingRead {
  entries: Entry[];
  offset: number;
  selectClauses: SimpleAttributeOperand[];
}

/**
 * Turns an object node into a historical event source backed by a fixed set of
 * records. node-opcua has no event history support of its own - Objects carry
 * no historyRead at all - so the handler is attached to the node directly.
 *
 * A node may aggregate several sources, which is how parent folders and the
 * Server object expose the events of everything beneath them.
 */
export default function installEventHistory(
  node: UAObject,
  sources: EventSource[],
  namespace: Namespace,
  ranges: LastReadRanges
): void {
  // eventNotifier exposes only a getter, so the backing field is set directly
  (node as any)._eventNotifier = SubscribeToEvents | HistoryRead;

  addHistoricalEventFilter(node, sources, namespace);

  const entries = sources
    .flatMap((source) =>
      source.records.map((record, index) => ({ source, record, index }))
    )
    .sort((a, b) => a.record.time.getTime() - b.record.time.getTime());

  const points = new ContinuationPoints<PendingRead>();

  (node as any).historyRead = async (
    context: any,
    details: unknown,
    _indexRange: unknown,
    _dataEncoding: unknown,
    continuationData: any
  ): Promise<HistoryReadResult> => {
    const session = context?.session as object | undefined;
    const previousPoint: Buffer | null =
      continuationData?.continuationPoint ?? null;

    if (continuationData?.releaseContinuationPoints) {
      if (previousPoint) {
        points.release(session, previousPoint);
      }

      return new HistoryReadResult({ statusCode: StatusCodes.Good });
    }

    if (!(details instanceof ReadEventDetails)) {
      return new HistoryReadResult({
        statusCode: StatusCodes.BadHistoryOperationUnsupported
      });
    }

    let pending: PendingRead;

    if (previousPoint && previousPoint.length > 0) {
      const resumed = points.take(session, previousPoint);

      if (resumed === undefined) {
        return new HistoryReadResult({
          statusCode: StatusCodes.BadContinuationPointInvalid
        });
      }

      pending = resumed;
    } else {
      const whereClause = details.filter?.whereClause;

      if (!isWhereClauseSupported(whereClause)) {
        return new HistoryReadResult({
          statusCode: StatusCodes.BadEventFilterInvalid
        });
      }

      pending = {
        entries: selectEntries(entries, details).filter((entry) =>
          matchesWhereClause(
            whereClause,
            (operand) => resolveField(operand, entry),
            entry.source.eventType.objectType
          )
        ),
        offset: 0,
        selectClauses: details.filter?.selectClauses ?? []
      };
    }

    const limit = details.numValuesPerNode ?? 0;
    const size = limit > 0 ? limit : pending.entries.length;
    const page = pending.entries.slice(pending.offset, pending.offset + size);
    const offset = pending.offset + page.length;

    let nextPoint: Buffer | null = null;

    if (offset < pending.entries.length) {
      nextPoint = points.register(session, { ...pending, offset });

      if (nextPoint === null) {
        return new HistoryReadResult({
          statusCode: StatusCodes.BadNoContinuationPoints
        });
      }
    }

    if (page.length === 0) {
      ranges.clear(session);

      return new HistoryReadResult({
        statusCode: StatusCodes.GoodNoData,
        historyData: new HistoryEvent({ events: [] })
      });
    }

    ranges.record(
      session,
      page[0]!.record.time,
      page[page.length - 1]!.record.time
    );

    const events = page.map(
      (entry) =>
        new HistoryEventFieldList({
          eventFields: pending.selectClauses.map((clause) =>
            resolveField(clause, entry)
          )
        })
    );

    return new HistoryReadResult({
      statusCode: StatusCodes.Good,
      continuationPoint: nextPoint ?? undefined,
      historyData: new HistoryEvent({ events })
    });
  };
}

/**
 * Advertises the fields this node can return from history, which is how clients
 * discover the configured event fields without guessing at browse paths.
 */
function addHistoricalEventFilter(
  node: UAObject,
  sources: EventSource[],
  namespace: Namespace
): void {
  const names = new Set(alwaysAvailable);

  for (const source of sources) {
    for (const field of source.eventType.fields) {
      names.add(field.name);
    }
  }

  const selectClauses = [...names].map(
    (name) =>
      new SimpleAttributeOperand({
        typeDefinitionId: baseEventType,
        browsePath: [{ namespaceIndex: 0, name }],
        attributeId: AttributeIds.Value
      })
  );

  namespace.addVariable({
    propertyOf: node,
    browseName: "HistoricalEventFilter",
    dataType: eventFilterDataType,
    minimumSamplingInterval: 0,
    value: new Variant({
      dataType: DataType.ExtensionObject,
      value: new EventFilter({ selectClauses })
    })
  });
}

/**
 * Applies the time domain of the request. Entries are held in ascending time
 * order; time flows backwards when the end time precedes the start time, or
 * when only an end time is given.
 */
function selectEntries(entries: Entry[], details: ReadEventDetails): Entry[] {
  const startTime = toTime(details.startTime);
  const endTime = toTime(details.endTime);
  const reversed =
    (startTime !== undefined && endTime !== undefined && endTime < startTime) ||
    (startTime === undefined && endTime !== undefined);

  const [from, to] = reversed ? [endTime, startTime] : [startTime, endTime];

  const selected = entries.filter(({ record }) => {
    const time = record.time.getTime();

    return (
      (from === undefined || time >= from) && (to === undefined || time <= to)
    );
  });

  return reversed ? selected.reverse() : selected;
}

function toTime(value: Date | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const time = value.getTime();

  // an unset date arrives as the OPC UA minimum date rather than null
  return time <= 0 ? undefined : time;
}

function resolveField(clause: SimpleAttributeOperand, entry: Entry): Variant {
  const { record, source, index } = entry;
  const name = (clause.browsePath ?? [])
    .map((element) => element.name?.toString() ?? "")
    .join("/");

  switch (name) {
    case "EventId":
      return new Variant({
        dataType: DataType.ByteString,
        value: Buffer.from(`${source.node.nodeId.toString()}#${index}`)
      });

    case "EventType":
      return new Variant({
        dataType: DataType.NodeId,
        value: source.eventType.objectType.nodeId
      });

    case "SourceNode":
      return new Variant({
        dataType: DataType.NodeId,
        value: source.node.nodeId
      });

    case "Time":
    case "ReceiveTime":
      return new Variant({ dataType: DataType.DateTime, value: record.time });
  }

  const value = record.fields.get(name);

  if (value === undefined) {
    // the originating node names the source when configuration does not
    if (name === "SourceName") {
      return new Variant({
        dataType: DataType.String,
        value: source.node.browseName.name ?? ""
      });
    }

    return noData();
  }

  const field = source.eventType.fields.find(
    (candidate) => candidate.name === name
  );
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
