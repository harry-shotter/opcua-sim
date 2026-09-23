import { describe, expect, test } from "bun:test";
import { validateRoot, type HierarchyRoot } from "../src/ua-config/ConfigLoader";

const eventTypes = [
  {
    name: "Process Alarms",
    fields: [
      { name: "Source", type: "String" as const },
      { name: "Severity", type: "Int32" as const }
    ]
  }
];

function config(overrides: Partial<HierarchyRoot> = {}): HierarchyRoot {
  return {
    eventTypes,
    namespaces: [
      {
        id: 1,
        name: "Simulation",
        uri: "urn:example:simulation",
        folders: []
      }
    ],
    ...overrides
  };
}

function withDevice(device: Record<string, unknown>): HierarchyRoot {
  return config({
    namespaces: [
      {
        id: 1,
        name: "Simulation",
        uri: "urn:example:simulation",
        folders: [{ name: "Plant", devices: [device as any] }]
      }
    ]
  });
}

const variables = [
  {
    name: "Flow",
    type: "Double" as const,
    minimumSamplingInterval: 1000,
    source: {
      type: "sinWave" as const,
      amplitude: 1,
      frequency: 1,
      offset: 0,
      phase: 0
    }
  }
];

describe("eventTypes validation", () => {
  test("accepts a valid block", () => {
    expect(() => validateRoot(config())).not.toThrow();
  });

  test("rejects duplicate type names", () => {
    expect(() =>
      validateRoot(config({ eventTypes: [...eventTypes, ...eventTypes] }))
    ).toThrow(/Duplicate event type found: Process Alarms/);
  });

  test("rejects unknown type settings", () => {
    expect(() =>
      validateRoot(
        config({ eventTypes: [{ ...eventTypes[0]!, id: 7 } as any] })
      )
    ).toThrow(/unknown setting 'id'/);
  });

  test("rejects an empty field list", () => {
    expect(() =>
      validateRoot(config({ eventTypes: [{ name: "Empty", fields: [] }] }))
    ).toThrow(/fields cannot be empty/);
  });

  test("rejects duplicate field names", () => {
    expect(() =>
      validateRoot(
        config({
          eventTypes: [
            {
              name: "Process Alarms",
              fields: [
                { name: "Source", type: "String" },
                { name: "Source", type: "String" }
              ]
            }
          ]
        })
      )
    ).toThrow(/duplicate field 'Source'/);
  });

  test("rejects unknown field types", () => {
    expect(() =>
      validateRoot(
        config({
          eventTypes: [
            {
              name: "Process Alarms",
              fields: [{ name: "Source", type: "ByteString" as any }]
            }
          ]
        })
      )
    ).toThrow(/unknown type 'ByteString'/);
  });

  test("accepts every supported field type", () => {
    const types = [
      "Boolean",
      "Int16",
      "UInt16",
      "Int32",
      "UInt32",
      "Float",
      "Double",
      "DateTime",
      "String"
    ] as const;

    expect(() =>
      validateRoot(
        config({
          eventTypes: [
            {
              name: "All",
              fields: types.map((type) => ({ name: type, type }))
            }
          ]
        })
      )
    ).not.toThrow();
  });
});

describe("event source validation", () => {
  test("accepts a node declaring both keys", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          eventType: "Process Alarms",
          eventHistory: "alarms/fic101.json",
          variables
        })
      )
    ).not.toThrow();
  });

  test("rejects eventHistory without eventType", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          eventHistory: "alarms/fic101.json",
          variables
        })
      )
    ).toThrow(/eventHistory requires a matching eventType/);
  });

  test("rejects eventType without eventHistory", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          eventType: "Process Alarms",
          variables
        })
      )
    ).toThrow(/eventType requires a matching eventHistory/);
  });

  test("rejects an undeclared event type", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          eventType: "Operator Actions",
          eventHistory: "alarms/fic101.json",
          variables
        })
      )
    ).toThrow(/unknown eventType 'Operator Actions'/);
  });

  test("applies to folders as well as devices", () => {
    expect(() =>
      validateRoot(
        config({
          namespaces: [
            {
              id: 1,
              name: "Simulation",
              uri: "urn:example:simulation",
              folders: [{ name: "Plant", eventType: "Process Alarms" }]
            }
          ]
        })
      )
    ).toThrow(/folder 'Plant': eventType requires a matching eventHistory/);
  });
});

describe("historyManager validation", () => {
  test("defaults to enabled when not configured", () => {
    expect(config().historyManager).toBeUndefined();
    expect(() => validateRoot(config())).not.toThrow();
  });

  test("accepts a boolean", () => {
    expect(() => validateRoot(config({ historyManager: false }))).not.toThrow();
    expect(() => validateRoot(config({ historyManager: true }))).not.toThrow();
  });

  test("rejects a non-boolean", () => {
    expect(() =>
      validateRoot(config({ historyManager: "no" as any }))
    ).toThrow(/historyManager must be a boolean/);
  });
});

describe("variable metadata validation", () => {
  test("accepts description, engineering range and units on numeric variables", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          variables: [
            {
              ...variables[0],
              description: "Feed flow",
              engineeringRange: { low: 0, high: 100 },
              units: "L/min"
            }
          ]
        })
      )
    ).not.toThrow();
  });

  test("accepts description on any variable type", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "Mode",
          variables: [
            {
              name: "State",
              type: "String",
              minimumSamplingInterval: 1000,
              description: "Current operating state",
              source: { type: "homeAssistant", entityId: "sensor.operating_state" }
            }
          ]
        })
      )
    ).not.toThrow();
  });

  test("rejects an engineering range on a non-numeric variable", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "Mode",
          variables: [
            {
              name: "State",
              type: "String",
              minimumSamplingInterval: 1000,
              engineeringRange: { low: 0, high: 1 },
              source: { type: "homeAssistant", entityId: "sensor.operating_state" }
            }
          ]
        })
      )
    ).toThrow(/engineeringRange is only supported for numeric variables/);
  });

  test("rejects invalid engineering ranges", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          variables: [
            { ...variables[0], engineeringRange: { low: 100, high: 0 } }
          ]
        })
      )
    ).toThrow(/engineeringRange must have finite low and high values/);
  });

  test("requires a range when units are configured", () => {
    expect(() =>
      validateRoot(
        withDevice({
          name: "FIC101",
          variables: [{ ...variables[0], units: "L/min" }]
        })
      )
    ).toThrow(/units requires an engineeringRange/);
  });
});
