import { validateValueSource, type ValueSource } from "../value-sources/ValueSourceTypes";

export interface VariableConfig {
  name: string;
  type: "Boolean" | "DateTime" | "Double" | "Int32" | "String";
  source: ValueSource;
  minimumSamplingInterval: number;
}

export interface DeviceConfig {
  name: string;
  variables: VariableConfig[];
}

export interface FolderConfig {
  name: string;
  folders?: FolderConfig[];
  devices?: DeviceConfig[];
}

export interface NamespaceConfig {
  id: number;
  name: string;
  uri: string; // Added URI for OPC UA namespace identification
  folders: FolderConfig[];
}

export interface ServerCapabilitiesConfig {
  maxSessions?: number;
  maxSubscriptions?: number;
  maxMonitoredItems?: number;
  maxMonitoredItemsPerSubscription?: number;
  maxSubscriptionsPerSession?: number;
}

export interface HierarchyRoot {
  serverCapabilities?: ServerCapabilitiesConfig;
  namespaces: NamespaceConfig[];
}

export const serverCapabilityKeys = [
  "maxSessions",
  "maxSubscriptions",
  "maxMonitoredItems",
  "maxMonitoredItemsPerSubscription",
  "maxSubscriptionsPerSession"
] as const;

export type ServerCapabilityKey = (typeof serverCapabilityKeys)[number];

const validTypes = ["Boolean", "DateTime", "Double", "Int32", "String"];

export default async function loadConfig(
  filePath: string
): Promise<HierarchyRoot> {
  try {
    const file = Bun.file(filePath);

    const data = await file.json();

    validateRoot(data);

    return data as HierarchyRoot;
  } catch (error: any) {
    throw new Error(`Error importing hierarchy: ${error.message}`);
  }
}

export function validateRoot(hierarchyRoot: HierarchyRoot): void {
  if (!hierarchyRoot.namespaces || !Array.isArray(hierarchyRoot.namespaces)) {
    throw new Error("Invalid root: namespaces must be an array");
  }

  if (hierarchyRoot.namespaces.length === 0) {
    throw new Error("Invalid root: namespaces array cannot be empty");
  }

  if (hierarchyRoot.serverCapabilities !== undefined) {
    validateServerCapabilities(hierarchyRoot.serverCapabilities);
  }

  // Check for duplicate namespace IDs
  const namespaceIds = new Set();
  hierarchyRoot.namespaces.forEach((namespace: NamespaceConfig) => {
    if (namespaceIds.has(namespace.id)) {
      throw new Error(`Duplicate namespace ID found: ${namespace.id}`);
    }
    namespaceIds.add(namespace.id);
  });

  // Check for duplicate URIs
  const namespaceUris = new Set();
  hierarchyRoot.namespaces.forEach((namespace: NamespaceConfig) => {
    if (namespaceUris.has(namespace.uri)) {
      throw new Error(`Duplicate namespace URI found: ${namespace.uri}`);
    }
    namespaceUris.add(namespace.uri);
  });

  hierarchyRoot.namespaces.forEach(validateNamespace);
}

function validateServerCapabilities(capabilities: ServerCapabilitiesConfig): void {
  if (typeof capabilities !== "object" || Array.isArray(capabilities)) {
    throw new Error("Invalid serverCapabilities: must be an object");
  }

  for (const key of Object.keys(capabilities)) {
    if (!serverCapabilityKeys.includes(key as ServerCapabilityKey)) {
      throw new Error(
        `Invalid serverCapabilities: unknown setting '${key}' (expected one of ${serverCapabilityKeys.join(
          ", "
        )})`
      );
    }

    const value = capabilities[key as ServerCapabilityKey];

    if (value === undefined) {
      continue;
    }

    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new Error(
        `Invalid serverCapabilities: '${key}' must be a positive integer`
      );
    }
  }
}

function validateNamespace(namespace: NamespaceConfig): void {
  if (!namespace.id || typeof namespace.id !== "number") {
    throw new Error("Invalid namespace: missing or invalid id");
  }
  if (!namespace.name || typeof namespace.name !== "string") {
    throw new Error("Invalid namespace: missing or invalid name");
  }
  if (!namespace.uri || typeof namespace.uri !== "string") {
    throw new Error("Invalid namespace: missing or invalid uri");
  }
  if (!Array.isArray(namespace.folders)) {
    throw new Error("Invalid namespace: folders must be an array");
  }

  // Validate URI format (basic check)
  try {
    new URL(namespace.uri);
  } catch {
    throw new Error(
      `Invalid namespace: uri '${namespace.uri}' is not a valid URI`
    );
  }

  namespace.folders.forEach(validateFolder);
}

function validateFolder(folder: FolderConfig): void {
  if (!folder.name || typeof folder.name !== "string") {
    throw new Error("Invalid folder: missing or invalid name");
  }

  if (folder.folders) {
    if (!Array.isArray(folder.folders)) {
      throw new Error("Invalid folder: folders must be an array");
    }
    folder.folders.forEach(validateFolder);
  }

  if (folder.devices) {
    if (!Array.isArray(folder.devices)) {
      throw new Error("Invalid folder: devices must be an array");
    }
    folder.devices.forEach(validateDevice);
  }
}

function validateDevice(device: DeviceConfig): void {
  if (!device.name || typeof device.name !== "string") {
    throw new Error("Invalid device: missing or invalid name");
  }

  if (!Array.isArray(device.variables)) {
    throw new Error("Invalid device: variables must be an array");
  }

  device.variables.forEach(validateVariable);
}

function validateVariable(variable: VariableConfig): void {
  if (!variable.name || typeof variable.name !== "string") {
    throw new Error("Invalid variable: missing or invalid Name");
  }

  if (!variable.type || !validTypes.includes(variable.type)) {
    throw new Error("Invalid variable: missing or invalid Type");
  }

  if (!variable.source || typeof variable.source !== "object") {
    throw new Error("Invalid variable: missing or invalid Source");
  }

  validateValueSource(variable.source);
}
