import { describe, expect, test } from "bun:test";
import { validateRoot, type HierarchyRoot } from "../src/ua-config/ConfigLoader";
import resolveServerCapabilities from "../src/ua-config/ServerCapabilities";

const baseConfig: HierarchyRoot = {
  namespaces: [
    {
      id: 1,
      name: "Simulation",
      uri: "urn:example:simulation",
      folders: []
    }
  ]
};

describe("resolveServerCapabilities", () => {
  test("returns nothing when no capabilities are configured", () => {
    expect(resolveServerCapabilities(baseConfig, {})).toEqual({});
  });

  test("uses the values from the configuration file", () => {
    const config = {
      ...baseConfig,
      serverCapabilities: { maxSessions: 20, maxSubscriptionsPerSession: 5 }
    };

    expect(resolveServerCapabilities(config, {})).toEqual({
      maxSessions: 20,
      maxSubscriptionsPerSession: 5
    });
  });

  test("environment variables take precedence over the configuration file", () => {
    const config = { ...baseConfig, serverCapabilities: { maxSessions: 20 } };

    expect(
      resolveServerCapabilities(config, { UA_MAX_SESSIONS: "50" })
    ).toEqual({ maxSessions: 50 });
  });

  test("reads every supported environment variable", () => {
    expect(
      resolveServerCapabilities(baseConfig, {
        UA_MAX_SESSIONS: "1",
        UA_MAX_SUBSCRIPTIONS: "2",
        UA_MAX_MONITORED_ITEMS: "3",
        UA_MAX_MONITORED_ITEMS_PER_SUBSCRIPTION: "4",
        UA_MAX_SUBSCRIPTIONS_PER_SESSION: "5"
      })
    ).toEqual({
      maxSessions: 1,
      maxSubscriptions: 2,
      maxMonitoredItems: 3,
      maxMonitoredItemsPerSubscription: 4,
      maxSubscriptionsPerSession: 5
    });
  });

  test("ignores invalid environment variables and falls back", () => {
    const config = { ...baseConfig, serverCapabilities: { maxSessions: 20 } };

    expect(
      resolveServerCapabilities(config, {
        UA_MAX_SESSIONS: "not-a-number",
        UA_MAX_SUBSCRIPTIONS: "0",
        UA_MAX_MONITORED_ITEMS: "1.5",
        UA_MAX_SUBSCRIPTIONS_PER_SESSION: "-3"
      })
    ).toEqual({ maxSessions: 20 });
  });
});

describe("serverCapabilities validation", () => {
  test("accepts a valid block", () => {
    expect(() =>
      validateRoot({ ...baseConfig, serverCapabilities: { maxSessions: 20 } })
    ).not.toThrow();
  });

  test("rejects unknown settings", () => {
    expect(() =>
      validateRoot({
        ...baseConfig,
        serverCapabilities: { maxSession: 20 } as any
      })
    ).toThrow(/unknown setting 'maxSession'/);
  });

  test("rejects non positive integers", () => {
    expect(() =>
      validateRoot({ ...baseConfig, serverCapabilities: { maxSessions: 0 } })
    ).toThrow(/must be a positive integer/);

    expect(() =>
      validateRoot({
        ...baseConfig,
        serverCapabilities: { maxSubscriptions: "10" as any }
      })
    ).toThrow(/must be a positive integer/);
  });
});
