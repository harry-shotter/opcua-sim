import { describe, expect, test } from "bun:test";
import {
  AttributeIds,
  coerceNodeId,
  DataType,
  StatusCodes,
  Variant
} from "node-opcua";
import { ReadEventDetails } from "node-opcua-service-history";
import {
  FilterOperator,
  LiteralOperand,
  SimpleAttributeOperand
} from "node-opcua-service-filter";
import loadEventHistory from "../src/ua-config/EventHistoryLoader";
import installEventHistory from "../src/ua-config/EventHistory";
import { LastReadRanges } from "../src/ua-config/HistoryManager";
import type { EventTypeDefinition } from "../src/ua-config/EventTypes";

const eventType: EventTypeDefinition = {
  name: "Process Alarms",
  fields: [
    { name: "Source", type: "String", dataType: DataType.String },
    { name: "Message", type: "String", dataType: DataType.String },
    { name: "Severity", type: "Int32", dataType: DataType.Int32 },
    { name: "AckedState", type: "Boolean", dataType: DataType.Boolean }
  ],
  objectType: { nodeId: coerceNodeId("ns=2;i=1000") } as any
};

async function writeHistory(records: unknown): Promise<string> {
  const path = `${import.meta.dir}/.tmp-${crypto.randomUUID()}.json`;
  await Bun.write(path, JSON.stringify(records));
  return path;
}

async function load(records: unknown) {
  const path = await writeHistory(records);

  try {
    return await loadEventHistory(path, eventType);
  } finally {
    await Bun.file(path).delete();
  }
}

const sample = [
  {
    time: "2026-08-07T11:42:18.456Z",
    fields: { Source: "FIC101", Message: "Normal", Severity: 250 }
  },
  {
    time: "2026-08-07T10:15:23.123Z",
    fields: { Source: "FIC101", Message: "High", Severity: 700 }
  }
];

describe("loadEventHistory", () => {
  test("sorts records into ascending time order", async () => {
    const records = await load(sample);

    expect(records.map((record) => record.time.toISOString())).toEqual([
      "2026-08-07T10:15:23.123Z",
      "2026-08-07T11:42:18.456Z"
    ]);
  });

  test("rejects a file that is not an array", async () => {
    expect(load({})).rejects.toThrow(/must be an array of records/);
  });

  test("rejects a missing time", async () => {
    expect(load([{ fields: {} }])).rejects.toThrow(
      /missing or invalid time/
    );
  });

  test("rejects unknown record keys", async () => {
    expect(
      load([{ time: "2026-08-07T10:00:00Z", severity: 700 }])
    ).rejects.toThrow(/unknown setting 'severity'/);
  });

  test("rejects a field not declared on the event type", async () => {
    expect(
      load([{ time: "2026-08-07T10:00:00Z", fields: { Operator: "bob" } }])
    ).rejects.toThrow(/'Operator' is not declared on event type/);
  });

  test("rejects a value of the wrong type", async () => {
    expect(
      load([{ time: "2026-08-07T10:00:00Z", fields: { Severity: "high" } }])
    ).rejects.toThrow(/'Severity' must be a valid Int32 value/);
  });

  test("rejects an integer outside its range", async () => {
    expect(
      load([{ time: "2026-08-07T10:00:00Z", fields: { Severity: 1.5 } }])
    ).rejects.toThrow(/'Severity' must be a valid Int32 value/);
  });

  test("accepts booleans", async () => {
    const records = await load([
      { time: "2026-08-07T10:00:00Z", fields: { AckedState: false } }
    ]);

    expect(records[0]!.fields.get("AckedState")).toBe(false);
  });
});

function selectClauses(...names: string[]) {
  return names.map((name) => ({
    browsePath: name.split("/").map((part) => ({ name: part }))
  }));
}

// the namespace is only used to publish the HistoricalEventFilter property
const namespace = { addVariable: () => undefined } as any;

async function install(records?: Awaited<ReturnType<typeof load>>) {
  const node = {
    nodeId: coerceNodeId("ns=2;s=FIC101"),
    browseName: { name: "FIC101" }
  } as any;
  const ranges = new LastReadRanges();

  installEventHistory(
    node,
    [{ node, eventType, records: records ?? (await load(sample)) }],
    namespace,
    ranges
  );

  return { node, ranges };
}

async function historyRead(details: ReadEventDetails) {
  const { node } = await install();

  return await node.historyRead({}, details, null, null, {});
}

/** Builds a where clause of a single element over the given operands. */
function whereClause(filterOperator: FilterOperator, filterOperands: unknown[]) {
  return { elements: [{ filterOperator, filterOperands }] };
}

function field(name: string) {
  return new SimpleAttributeOperand({
    browsePath: [{ namespaceIndex: 0, name }],
    attributeId: AttributeIds.Value
  });
}

function literal(dataType: DataType, value: unknown) {
  return new LiteralOperand({ value: new Variant({ dataType, value }) });
}

const window = {
  startTime: new Date("2026-08-07T00:00:00Z"),
  endTime: new Date("2026-08-07T23:59:59Z")
};

function messages(result: any): string[] {
  return (result.historyData?.events ?? []).map(
    (event: any) => event.eventFields[0].value.text
  );
}

describe("event historyRead", () => {
  test("returns the selected fields for every record", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T00:00:00Z"),
        endTime: new Date("2026-08-07T23:59:59Z"),
        filter: { selectClauses: selectClauses("Message", "Severity") } as any
      })
    );

    expect(result.statusCode).toBe(StatusCodes.Good);

    const events = (result.historyData as any).events;
    expect(events).toHaveLength(2);
    expect(events[0].eventFields[0].value.text).toBe("High");
    expect(events[0].eventFields[1].value).toBe(700);
  });

  test("filters to the requested time window", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T11:00:00Z"),
        endTime: new Date("2026-08-07T12:00:00Z"),
        filter: { selectClauses: selectClauses("Message") } as any
      })
    );

    const events = (result.historyData as any).events;
    expect(events).toHaveLength(1);
    expect(events[0].eventFields[0].value.text).toBe("Normal");
  });

  test("returns time flowing backwards when the end precedes the start", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T23:59:59Z"),
        endTime: new Date("2026-08-07T00:00:00Z"),
        filter: { selectClauses: selectClauses("Message") } as any
      })
    );

    const events = (result.historyData as any).events;
    expect(
      events.map((event: any) => event.eventFields[0].value.text)
    ).toEqual(["Normal", "High"]);
  });

  test("caps the result at numValuesPerNode", async () => {
    const { node } = await install();

    const result = await node.historyRead(
      { session: {} },
      new ReadEventDetails({
        ...window,
        numValuesPerNode: 1,
        filter: { selectClauses: selectClauses("Message") } as any
      }),
      null,
      null,
      {}
    );

    expect((result.historyData as any).events).toHaveLength(1);
    expect(result.continuationPoint).toBeInstanceOf(Buffer);
  });

  test("cannot truncate silently when no continuation point is available", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        ...window,
        numValuesPerNode: 1,
        filter: { selectClauses: selectClauses("Message") } as any
      })
    );

    expect(result.statusCode).toBe(StatusCodes.BadNoContinuationPoints);
  });

  test("reports GoodNoData for an empty window", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2020-01-01T00:00:00Z"),
        endTime: new Date("2020-01-02T00:00:00Z"),
        filter: { selectClauses: selectClauses("Message") } as any
      })
    );

    expect(result.statusCode).toBe(StatusCodes.GoodNoData);
  });

  test("resolves the standard Time and EventType fields", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T00:00:00Z"),
        endTime: new Date("2026-08-07T23:59:59Z"),
        filter: { selectClauses: selectClauses("Time", "EventType") } as any
      })
    );

    const [first] = (result.historyData as any).events;
    expect(first.eventFields[0].value.toISOString()).toBe(
      "2026-08-07T10:15:23.123Z"
    );
    expect(first.eventFields[1].value.toString()).toBe("ns=2;i=1000");
  });

  test("reports BadNoData for a field the historian cannot supply", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T00:00:00Z"),
        endTime: new Date("2026-08-07T23:59:59Z"),
        filter: { selectClauses: selectClauses("Unknown") } as any
      })
    );

    const [first] = (result.historyData as any).events;
    expect(first.eventFields[0].dataType).toBe(DataType.StatusCode);
    expect(first.eventFields[0].value).toBe(StatusCodes.BadNoData);
  });

  test("gives every record a distinct EventId", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T00:00:00Z"),
        endTime: new Date("2026-08-07T23:59:59Z"),
        filter: { selectClauses: selectClauses("EventId") } as any
      })
    );

    const events = (result.historyData as any).events;
    const ids = events.map((event: any) =>
      event.eventFields[0].value.toString()
    );

    expect(new Set(ids).size).toBe(2);
  });
});

describe("continuation points", () => {
  const paged = new ReadEventDetails({
    ...window,
    numValuesPerNode: 1,
    filter: { selectClauses: selectClauses("Message") } as any
  });

  test("pages through the result and stops when exhausted", async () => {
    const { node } = await install();
    const session = {};

    const first = await node.historyRead({ session }, paged, null, null, {});
    expect(messages(first)).toEqual(["High"]);
    expect(first.continuationPoint).toBeInstanceOf(Buffer);

    const second = await node.historyRead({ session }, paged, null, null, {
      continuationPoint: first.continuationPoint
    });
    expect(messages(second)).toEqual(["Normal"]);
    expect(second.continuationPoint).toBeFalsy();
  });

  test("rejects a point that was never issued", async () => {
    const { node } = await install();

    const result = await node.historyRead({ session: {} }, paged, null, null, {
      continuationPoint: Buffer.alloc(16, 7)
    });

    expect(result.statusCode).toBe(StatusCodes.BadContinuationPointInvalid);
  });

  test("rejects a point belonging to another session", async () => {
    const { node } = await install();

    const first = await node.historyRead({ session: {} }, paged, null, null, {});
    const result = await node.historyRead({ session: {} }, paged, null, null, {
      continuationPoint: first.continuationPoint
    });

    expect(result.statusCode).toBe(StatusCodes.BadContinuationPointInvalid);
  });

  test("releasing a point discards it without returning data", async () => {
    const { node } = await install();
    const session = {};

    const first = await node.historyRead({ session }, paged, null, null, {});

    const released = await node.historyRead({ session }, paged, null, null, {
      continuationPoint: first.continuationPoint,
      releaseContinuationPoints: true
    });
    expect(released.statusCode).toBe(StatusCodes.Good);
    expect(released.historyData).toBeFalsy();

    const reused = await node.historyRead({ session }, paged, null, null, {
      continuationPoint: first.continuationPoint
    });
    expect(reused.statusCode).toBe(StatusCodes.BadContinuationPointInvalid);
  });
});

describe("where clause", () => {
  async function filtered(clause: unknown) {
    return await historyRead(
      new ReadEventDetails({
        ...window,
        filter: {
          selectClauses: selectClauses("Message"),
          whereClause: clause
        } as any
      })
    );
  }

  test("keeps only records greater than a literal", async () => {
    const result = await filtered(
      whereClause(FilterOperator.GreaterThan, [
        field("Severity"),
        literal(DataType.Int32, 500)
      ])
    );

    expect(messages(result)).toEqual(["High"]);
  });

  test("matches a Like pattern", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Like, [
        field("Message"),
        literal(DataType.String, "%orma%")
      ])
    );

    expect(messages(result)).toEqual(["Normal"]);
  });

  test("compares for equality on a string field", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Equals, [
        field("Source"),
        literal(DataType.String, "FIC101")
      ])
    );

    expect(messages(result)).toEqual(["High", "Normal"]);
  });

  test("ignores case when comparing strings", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Equals, [
        field("Source"),
        literal(DataType.String, "fic101")
      ])
    );

    expect(messages(result)).toEqual(["High", "Normal"]);
  });

  test("ignores case when matching a Like pattern", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Like, [
        field("Message"),
        literal(DataType.String, "%NORMAL%")
      ])
    );

    expect(messages(result)).toEqual(["Normal"]);
  });

  test("ignores case in an InList comparison", async () => {
    const result = await filtered(
      whereClause(FilterOperator.InList, [
        field("Message"),
        literal(DataType.String, "nope"),
        literal(DataType.String, "HIGH")
      ])
    );

    expect(messages(result)).toEqual(["High"]);
  });

  test("drops records whose field the historian cannot supply", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Equals, [
        field("Operator"),
        literal(DataType.String, "bob")
      ])
    );

    expect(result.statusCode).toBe(StatusCodes.GoodNoData);
  });

  test("treats an absent field as null", async () => {
    const result = await filtered(
      whereClause(FilterOperator.IsNull, [field("Operator")])
    );

    expect(messages(result)).toEqual(["High", "Normal"]);
  });

  test("rejects an operator it cannot evaluate", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Between, [
        field("Severity"),
        literal(DataType.Int32, 0),
        literal(DataType.Int32, 1000)
      ])
    );

    expect(result.statusCode).toBe(StatusCodes.BadEventFilterInvalid);
  });

  test("rejects an operator given the wrong number of operands", async () => {
    const result = await filtered(
      whereClause(FilterOperator.Equals, [field("Severity")])
    );

    expect(result.statusCode).toBe(StatusCodes.BadEventFilterInvalid);
  });
});

describe("aggregated sources", () => {
  test("merges records from several nodes in time order", async () => {
    const records = await load(sample);
    const parent = {
      nodeId: coerceNodeId("ns=2;s=Plant"),
      browseName: { name: "Plant" }
    } as any;
    const a = {
      nodeId: coerceNodeId("ns=2;s=FIC101"),
      browseName: { name: "FIC101" }
    } as any;
    const b = {
      nodeId: coerceNodeId("ns=2;s=FIC102"),
      browseName: { name: "FIC102" }
    } as any;

    installEventHistory(
      parent,
      [
        { node: a, eventType, records: [records[0]!] },
        { node: b, eventType, records: [records[1]!] }
      ],
      namespace,
      new LastReadRanges()
    );

    const result = await parent.historyRead(
      {},
      new ReadEventDetails({
        ...window,
        filter: { selectClauses: selectClauses("SourceName", "Time") } as any
      }),
      null,
      null,
      {}
    );

    expect(
      result.historyData.events.map((e: any) => e.eventFields[0].value)
    ).toEqual(["FIC101", "FIC102"]);
  });

  test("names the source from its node when not configured", async () => {
    const result = await historyRead(
      new ReadEventDetails({
        ...window,
        filter: { selectClauses: selectClauses("SourceName") } as any
      })
    );

    expect(result.historyData.events[0].eventFields[0].value).toBe("FIC101");
  });
});

describe("last read range", () => {
  test("records the span the read returned", async () => {
    const { node, ranges } = await install();
    const session = {};

    await node.historyRead(
      { session },
      new ReadEventDetails({
        ...window,
        filter: { selectClauses: selectClauses("Message") } as any
      }),
      null,
      null,
      {}
    );

    expect(ranges.get(session)!.first.toISOString()).toBe(
      "2026-08-07T10:15:23.123Z"
    );
    expect(ranges.get(session)!.last.toISOString()).toBe(
      "2026-08-07T11:42:18.456Z"
    );
  });

  test("clears the span when a read returns nothing", async () => {
    const { node, ranges } = await install();
    const session = {};

    const empty = new ReadEventDetails({
      startTime: new Date("2020-01-01T00:00:00Z"),
      endTime: new Date("2020-01-02T00:00:00Z"),
      filter: { selectClauses: selectClauses("Message") } as any
    });

    await node.historyRead({ session }, empty, null, null, {});

    expect(ranges.get(session)).toBeUndefined();
  });
});
