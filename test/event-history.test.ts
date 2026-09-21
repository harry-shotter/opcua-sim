import { describe, expect, test } from "bun:test";
import { coerceNodeId, DataType, StatusCodes } from "node-opcua";
import { ReadEventDetails } from "node-opcua-service-history";
import loadEventHistory from "../src/ua-config/EventHistoryLoader";
import installEventHistory from "../src/ua-config/EventHistory";
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

async function historyRead(details: ReadEventDetails) {
  const records = await load(sample);
  const node = { nodeId: { toString: () => "ns=2;s=FIC101" } } as any;

  installEventHistory(node, eventType, records);

  return await node.historyRead(null, details, null, null, null);
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
    const result = await historyRead(
      new ReadEventDetails({
        startTime: new Date("2026-08-07T00:00:00Z"),
        endTime: new Date("2026-08-07T23:59:59Z"),
        numValuesPerNode: 1,
        filter: { selectClauses: selectClauses("Message") } as any
      })
    );

    expect((result.historyData as any).events).toHaveLength(1);
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
