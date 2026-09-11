import type { ServerCapabilitiesOptions } from "node-opcua";
import {
  serverCapabilityKeys,
  type HierarchyRoot,
  type ServerCapabilityKey
} from "./ConfigLoader";

const envVariableNames: Record<ServerCapabilityKey, string> = {
  maxSessions: "UA_MAX_SESSIONS",
  maxSubscriptions: "UA_MAX_SUBSCRIPTIONS",
  maxMonitoredItems: "UA_MAX_MONITORED_ITEMS",
  maxMonitoredItemsPerSubscription: "UA_MAX_MONITORED_ITEMS_PER_SUBSCRIPTION",
  maxSubscriptionsPerSession: "UA_MAX_SUBSCRIPTIONS_PER_SESSION"
};

/**
 * Builds the serverCapabilities options passed to the OPCUAServer constructor.
 *
 * Precedence is environment variable > configuration file > node-opcua default.
 * Only explicitly configured settings are returned so that unset ones keep
 * their node-opcua defaults.
 */
export default function resolveServerCapabilities(
  config: HierarchyRoot,
  env: Record<string, string | undefined> = process.env
): ServerCapabilitiesOptions {
  const capabilities: ServerCapabilitiesOptions = {};

  for (const key of serverCapabilityKeys) {
    const value =
      parseEnvValue(envVariableNames[key], env[envVariableNames[key]]) ??
      config.serverCapabilities?.[key];

    if (value !== undefined) {
      capabilities[key] = value;
    }
  }

  return capabilities;
}

function parseEnvValue(
  name: string,
  rawValue: string | undefined
): number | undefined {
  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 1) {
    console.warn(
      `Invalid ${name} value '${rawValue}', expected a positive integer - ignoring`
    );
    return undefined;
  }

  return value;
}
