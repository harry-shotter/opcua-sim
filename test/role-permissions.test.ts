import { describe, expect, test } from "bun:test";
import { makePermissionFlag, PermissionType, resolveNodeId, WellKnownRoles } from "node-opcua";
import { validateRoot, type HierarchyRoot } from "../src/ua-config/ConfigLoader";
import { makeRolePermissions } from "../src/ua-config/RolePermissions";

function makeConfig(folder: any): HierarchyRoot {
  return {
    namespaces: [
      {
        id: 1,
        name: "Simulation",
        uri: "urn:simulation:test",
        folders: [folder]
      }
    ]
  } as HierarchyRoot;
}

const variable = {
  name: "Temperature",
  type: "Double",
  minimumSamplingInterval: 1000,
  source: { type: "sinWave", amplitude: 1, frequency: 1, offset: 0, phase: 0 }
};

describe("makeRolePermissions", () => {
  test("grants read style permissions to each role", () => {
    const permissions = makeRolePermissions(["Operator", "Anonymous"]);

    expect(permissions).toEqual([
      {
        roleId: resolveNodeId(WellKnownRoles.Operator),
        permissions: makePermissionFlag(
          "Browse | Read | ReadHistory | ReceiveEvents"
        )
      },
      {
        roleId: resolveNodeId(WellKnownRoles.Anonymous),
        permissions: makePermissionFlag(
          "Browse | Read | ReadHistory | ReceiveEvents"
        )
      }
    ]);
  });

  test("grants read but never write permissions", () => {
    const [operator] = makeRolePermissions(["Operator"]);
    const permissions = operator!.permissions as number;

    expect(permissions & PermissionType.Read).toBe(PermissionType.Read);
    expect(permissions & PermissionType.Write).toBe(0);
    expect(permissions & PermissionType.WriteAttribute).toBe(0);
  });
});

describe("roles validation", () => {
  test("accepts roles on folders, devices and variables", () => {
    expect(() =>
      validateRoot(
        makeConfig({
          name: "Restricted",
          roles: ["Operator"],
          devices: [
            {
              name: "Pump",
              roles: ["Engineer", "Anonymous"],
              variables: [{ ...variable, roles: ["AuthenticatedUser"] }]
            }
          ]
        })
      )
    ).not.toThrow();
  });

  test("accepts a hierarchy without roles", () => {
    expect(() =>
      validateRoot(
        makeConfig({
          name: "Open",
          devices: [{ name: "Pump", variables: [variable] }]
        })
      )
    ).not.toThrow();
  });

  test("rejects an unknown role", () => {
    expect(() =>
      validateRoot(makeConfig({ name: "Restricted", roles: ["Admin"] }))
    ).toThrow(/unknown role 'Admin'/);
  });

  test("rejects an empty role list", () => {
    expect(() =>
      validateRoot(makeConfig({ name: "Restricted", roles: [] }))
    ).toThrow(/cannot be empty/);
  });

  test("rejects duplicate roles", () => {
    expect(() =>
      validateRoot(
        makeConfig({ name: "Restricted", roles: ["Operator", "Operator"] })
      )
    ).toThrow(/duplicate role/);
  });

  test("rejects roles that are not an array", () => {
    expect(() =>
      validateRoot(makeConfig({ name: "Restricted", roles: "Operator" }))
    ).toThrow(/must be an array/);
  });

  test("reports the offending device", () => {
    expect(() =>
      validateRoot(
        makeConfig({
          name: "Restricted",
          devices: [{ name: "Pump", roles: ["Nope"], variables: [variable] }]
        })
      )
    ).toThrow(/device 'Pump'/);
  });

  test("reports the offending variable", () => {
    expect(() =>
      validateRoot(
        makeConfig({
          name: "Restricted",
          devices: [
            {
              name: "Pump",
              variables: [{ ...variable, roles: ["Nope"] }]
            }
          ]
        })
      )
    ).toThrow(/variable 'Temperature'/);
  });
});
