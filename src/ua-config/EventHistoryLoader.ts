import type { EventFieldTypeName } from "./ConfigLoader";
import type { EventTypeDefinition } from "./EventTypes";

export interface EventRecord {
  time: Date;
  fields: Map<string, boolean | number | string | Date>;
}

const integerRanges: Partial<Record<EventFieldTypeName, [number, number]>> = {
  Int16: [-32768, 32767],
  UInt16: [0, 65535],
  Int32: [-2147483648, 2147483647],
  UInt32: [0, 4294967295]
};

/**
 * Reads a faked event history file and validates every record against the
 * event type declared by the node that owns it. Records are returned in
 * ascending time order, which the HistoryRead implementation relies on.
 */
export default async function loadEventHistory(
  filePath: string,
  eventType: EventTypeDefinition
): Promise<EventRecord[]> {
  let data: unknown;

  try {
    data = await Bun.file(filePath).json();
  } catch (error: any) {
    throw new Error(
      `Error importing event history '${filePath}': ${error.message}`
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `Invalid event history '${filePath}': must be an array of records`
    );
  }

  const records = data.map((record, index) =>
    parseRecord(record, index, filePath, eventType)
  );

  return records.sort((a, b) => a.time.getTime() - b.time.getTime());
}

function parseRecord(
  record: any,
  index: number,
  filePath: string,
  eventType: EventTypeDefinition
): EventRecord {
  const context = `event ${index} in '${filePath}'`;

  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error(`Invalid ${context}: must be an object`);
  }

  for (const key of Object.keys(record)) {
    if (key !== "time" && key !== "fields") {
      throw new Error(
        `Invalid ${context}: unknown setting '${key}' (expected one of time, fields)`
      );
    }
  }

  const time = parseDate(record.time);

  if (time === undefined) {
    throw new Error(`Invalid ${context}: missing or invalid time`);
  }

  const rawFields = record.fields ?? {};

  if (
    typeof rawFields !== "object" ||
    rawFields === null ||
    Array.isArray(rawFields)
  ) {
    throw new Error(`Invalid ${context}: fields must be an object`);
  }

  const knownFields = new Map(
    eventType.fields.map((field) => [field.name, field.type])
  );
  const fields = new Map<string, boolean | number | string | Date>();

  for (const [name, value] of Object.entries(rawFields)) {
    const type = knownFields.get(name);

    if (type === undefined) {
      throw new Error(
        `Invalid ${context}: field '${name}' is not declared on event type '${eventType.name}'`
      );
    }

    fields.set(name, coerceValue(value, type, name, context));
  }

  return { time, fields };
}

function coerceValue(
  value: unknown,
  type: EventFieldTypeName,
  name: string,
  context: string
): boolean | number | string | Date {
  const invalid = () =>
    new Error(
      `Invalid ${context}: field '${name}' must be a valid ${type} value`
    );

  switch (type) {
    case "Boolean":
      if (typeof value !== "boolean") throw invalid();
      return value;

    case "String":
      if (typeof value !== "string") throw invalid();
      return value;

    case "DateTime": {
      const date = parseDate(value);
      if (date === undefined) throw invalid();
      return date;
    }

    case "Float":
    case "Double":
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
      return value;

    default: {
      const range = integerRanges[type]!;
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < range[0] ||
        value > range[1]
      ) {
        throw invalid();
      }
      return value;
    }
  }
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);

  return isNaN(date.getTime()) ? undefined : date;
}
