import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolveNodeId, WellKnownRoles } from "node-opcua";
import { validateRoot, type HierarchyRoot } from "../src/ua-config/ConfigLoader";
import resolveSecurity from "../src/ua-config/UserManager";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function makeConfig(security?: HierarchyRoot["security"]): HierarchyRoot {
  return {
    security,
    namespaces: [
      {
        id: 1,
        name: "Simulation",
        uri: "urn:simulation:test",
        folders: []
      }
    ]
  };
}

describe("resolveSecurity", () => {
  test("allows anonymous access with no users by default", () => {
    const security = resolveSecurity(makeConfig(), {});

    expect(security.allowAnonymous).toBe(true);
    expect(security.users).toHaveLength(0);
    expect(security.userManager).toBeUndefined();
  });

  test("accepts a valid plaintext password", () => {
    const security = resolveSecurity(
      makeConfig({ users: [{ username: "alice", password: "s3cret" }] }),
      {}
    );

    expect(security.userManager?.isValidUser("alice", "s3cret")).toBe(true);
    expect(security.userManager?.isValidUser("alice", "wrong")).toBe(false);
    expect(security.userManager?.isValidUser("bob", "s3cret")).toBe(false);
  });

  test("accepts a valid hashed password", () => {
    const security = resolveSecurity(
      makeConfig({
        users: [{ username: "alice", passwordSha256: sha256("s3cret") }]
      }),
      {}
    );

    expect(security.userManager?.isValidUser("alice", "s3cret")).toBe(true);
    expect(security.userManager?.isValidUser("alice", "wrong")).toBe(false);
  });

  test("maps a configured role onto its well known role node", () => {
    const security = resolveSecurity(
      makeConfig({
        users: [{ username: "alice", password: "s3cret", role: "Operator" }]
      }),
      {}
    );

    expect(security.userManager?.getUserRoles("alice")).toEqual([
      resolveNodeId(WellKnownRoles.Operator)
    ]);
    expect(security.userManager?.getUserRoles("alice-unknown")).toEqual([]);
  });

  test("returns no roles when none are configured", () => {
    const security = resolveSecurity(
      makeConfig({ users: [{ username: "alice", password: "s3cret" }] }),
      {}
    );

    expect(security.userManager?.getUserRoles("alice")).toEqual([]);
  });

  test("denies anonymous access when configured", () => {
    const security = resolveSecurity(
      makeConfig({
        allowAnonymous: false,
        users: [{ username: "alice", password: "s3cret" }]
      }),
      {}
    );

    expect(security.allowAnonymous).toBe(false);
  });

  test("rejects denying anonymous access without any users", () => {
    expect(() =>
      resolveSecurity(makeConfig({ allowAnonymous: false }), {})
    ).toThrow(/nobody could connect/);
  });

  test("prefers UA_ALLOW_ANONYMOUS over the configuration file", () => {
    const security = resolveSecurity(
      makeConfig({
        allowAnonymous: true,
        users: [{ username: "alice", password: "s3cret" }]
      }),
      { UA_ALLOW_ANONYMOUS: "false" }
    );

    expect(security.allowAnonymous).toBe(false);
  });

  test("ignores an invalid UA_ALLOW_ANONYMOUS value", () => {
    const security = resolveSecurity(
      makeConfig({ allowAnonymous: false, users: [{ username: "alice", password: "s3cret" }] }),
      { UA_ALLOW_ANONYMOUS: "maybe" }
    );

    expect(security.allowAnonymous).toBe(false);
  });

  test("replaces configured users with UA_USERS", () => {
    const security = resolveSecurity(
      makeConfig({ users: [{ username: "alice", password: "s3cret" }] }),
      { UA_USERS: "bob:hunter2,carol:pa:ss" }
    );

    expect(security.users.map((user) => user.username)).toEqual([
      "bob",
      "carol"
    ]);
    expect(security.userManager?.isValidUser("alice", "s3cret")).toBe(false);
    expect(security.userManager?.isValidUser("bob", "hunter2")).toBe(true);
    expect(security.userManager?.isValidUser("carol", "pa:ss")).toBe(true);
  });

  test("ignores malformed UA_USERS entries", () => {
    const security = resolveSecurity(makeConfig(), {
      UA_USERS: "bob:hunter2,broken,:nouser,nopassword:"
    });

    expect(security.users.map((user) => user.username)).toEqual(["bob"]);
  });

  test("falls back to the configuration file when UA_USERS is unusable", () => {
    const security = resolveSecurity(
      makeConfig({ users: [{ username: "alice", password: "s3cret" }] }),
      { UA_USERS: "broken" }
    );

    expect(security.users.map((user) => user.username)).toEqual(["alice"]);
  });
});

describe("security validation", () => {
  const validate = (security: any) => () =>
    validateRoot(makeConfig(security) as HierarchyRoot);

  test("accepts a valid security block", () => {
    expect(
      validate({
        allowAnonymous: false,
        users: [
          { username: "alice", password: "s3cret", role: "Operator" },
          { username: "bob", passwordSha256: sha256("hunter2") }
        ]
      })
    ).not.toThrow();
  });

  test("rejects an unknown security setting", () => {
    expect(validate({ allowUsers: true })).toThrow(/unknown setting/);
  });

  test("rejects a non-boolean allowAnonymous", () => {
    expect(validate({ allowAnonymous: "false" })).toThrow(/must be a boolean/);
  });

  test("rejects a user without a password", () => {
    expect(validate({ users: [{ username: "alice" }] })).toThrow(
      /password or passwordSha256 is required/
    );
  });

  test("rejects a user with both password forms", () => {
    expect(
      validate({
        users: [
          { username: "alice", password: "s3cret", passwordSha256: sha256("x") }
        ]
      })
    ).toThrow(/not both/);
  });

  test("rejects an invalid password hash", () => {
    expect(
      validate({ users: [{ username: "alice", passwordSha256: "nothex" }] })
    ).toThrow(/64 character hex string/);
  });

  test("rejects an unknown role", () => {
    expect(
      validate({
        users: [{ username: "alice", password: "s3cret", role: "Admin" }]
      })
    ).toThrow(/unknown role/);
  });

  test("rejects duplicate usernames", () => {
    expect(
      validate({
        users: [
          { username: "alice", password: "s3cret" },
          { username: "alice", password: "other" }
        ]
      })
    ).toThrow(/duplicate user/);
  });
});
