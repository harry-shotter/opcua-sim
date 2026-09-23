import { afterEach, describe, expect, test } from "bun:test";
import { OPCUAServer } from "node-opcua";
import type { HierarchyRoot } from "../src/ua-config/ConfigLoader";
import ConfigureServer from "../src/ua-config/UaConfig";
import { ValueSourceType } from "../src/value-sources/ValueSourceTypes";

const servers: OPCUAServer[] = [];

interface VariableWithProperties {
  description?: { text?: string };
  getPropertyByName(browseName: string): {
    readValue(): { value: { value: unknown } };
  } | null;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.shutdown()));
});

test("publishes tag metadata as OPC UA properties", async () => {
  const server = new OPCUAServer({ port: 0 });
  servers.push(server);
  await server.initialize();

  const config: HierarchyRoot = {
    namespaces: [
      {
        id: 1,
        name: "Simulation",
        uri: "urn:simulation:metadata",
        folders: [
          {
            name: "Plant",
            devices: [
              {
                name: "FIC101",
                variables: [
                  {
                    name: "Flow",
                    type: "Double",
                    minimumSamplingInterval: 1000,
                    description: "Feed flow",
                    engineeringRange: { low: 0, high: 100 },
                    units: "L/min",
                    source: {
                      type: ValueSourceType.SinWave,
                      amplitude: 1,
                      frequency: 1,
                      offset: 0,
                      phase: 0
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  await ConfigureServer(config, server);

  const addressSpace = server.engine.addressSpace!;
  const namespaceIndex = addressSpace.getNamespaceIndex(
    "urn:simulation:metadata"
  );
  const variable = addressSpace.findNode(
    `ns=${namespaceIndex};s=${namespaceIndex}:FIC101.Flow`
  ) as VariableWithProperties | null;

  if (!variable) {
    throw new Error("Expected the Flow variable to exist");
  }
  expect(variable.description?.text).toBe("Feed flow");

  const range = variable.getPropertyByName("EURange")!.readValue().value
    .value as { low: number; high: number };
  expect(range).toEqual({ low: 0, high: 100 });

  const units = variable.getPropertyByName("EngineeringUnits")!.readValue()
    .value.value as { displayName: { text: string } };
  expect(units.displayName.text).toBe("L/min");
});
