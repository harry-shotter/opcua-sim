import { validateValueSource, type ValueSource } from "../value-sources/ValueSourceTypes";

export interface VariableConfig {
  name: string;
  type: "Boolean" | "DateTime" | "Double" | "Int32" | "String";
  source: ValueSource;
  minimumSamplingInterval: number;
  roles?: NodeRoleName[];
}

export interface DeviceConfig {
  name: string;
  variables: VariableConfig[];
  roles?: NodeRoleName[];
}

export interface FolderConfig {
  name: string;
  folders?: FolderConfig[];
  devices?: DeviceConfig[];
  roles?: NodeRoleName[];
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

export const userRoleNames = [
  "AuthenticatedUser",
  "ConfigureAdmin",
  "Engineer",
  "Observer",
  "Operator",
  "SecurityAdmin",
  "Supervisor"
] as const;

export type UserRoleName = (typeof userRoleNames)[number];

export const nodeRoleNames = ["Anonymous", ...userRoleNames] as const;

export type NodeRoleName = (typeof nodeRoleNames)[number];

export interface UserConfig {
  username: string;
  password?: string;
  passwordSha256?: string;
  role?: UserRoleName;
}

export interface SecurityConfig {
  allowAnonymous?: boolean;
  users?: UserConfig[];
}

export interface HierarchyRoot {
  serverCapabilities?: ServerCapabilitiesConfig;
  security?: SecurityConfig;
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

  if (hierarchyRoot.security !== undefined) {
    validateSecurity(hierarchyRoot.security);
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

const securityKeys = ["allowAnonymous", "users"];
const userKeys = ["username", "password", "passwordSha256", "role"];

function validateSecurity(security: SecurityConfig): void {
  if (typeof security !== "object" || Array.isArray(security)) {
    throw new Error("Invalid security: must be an object");
  }

  for (const key of Object.keys(security)) {
    if (!securityKeys.includes(key)) {
      throw new Error(
        `Invalid security: unknown setting '${key}' (expected one of ${securityKeys.join(
          ", "
        )})`
      );
    }
  }

  if (
    security.allowAnonymous !== undefined &&
    typeof security.allowAnonymous !== "boolean"
  ) {
    throw new Error("Invalid security: allowAnonymous must be a boolean");
  }

  if (security.users === undefined) {
    return;
  }

  if (!Array.isArray(security.users)) {
    throw new Error("Invalid security: users must be an array");
  }

  const usernames = new Set<string>();

  security.users.forEach((user) => {
    validateUser(user);

    if (usernames.has(user.username)) {
      throw new Error(`Invalid security: duplicate user '${user.username}'`);
    }

    usernames.add(user.username);
  });
}

function validateUser(user: UserConfig): void {
  if (typeof user !== "object" || user === null || Array.isArray(user)) {
    throw new Error("Invalid user: must be an object");
  }

  for (const key of Object.keys(user)) {
    if (!userKeys.includes(key)) {
      throw new Error(
        `Invalid user: unknown setting '${key}' (expected one of ${userKeys.join(
          ", "
        )})`
      );
    }
  }

  if (!user.username || typeof user.username !== "string") {
    throw new Error("Invalid user: missing or invalid username");
  }

  if (user.password !== undefined && user.passwordSha256 !== undefined) {
    throw new Error(
      `Invalid user '${user.username}': specify either password or passwordSha256, not both`
    );
  }

  if (user.password !== undefined) {
    if (typeof user.password !== "string" || user.password.length === 0) {
      throw new Error(
        `Invalid user '${user.username}': password must be a non-empty string`
      );
    }
  } else if (user.passwordSha256 !== undefined) {
    if (
      typeof user.passwordSha256 !== "string" ||
      !/^[0-9a-fA-F]{64}$/.test(user.passwordSha256)
    ) {
      throw new Error(
        `Invalid user '${user.username}': passwordSha256 must be a 64 character hex string`
      );
    }
  } else {
    throw new Error(
      `Invalid user '${user.username}': either password or passwordSha256 is required`
    );
  }

  if (
    user.role !== undefined &&
    !userRoleNames.includes(user.role as UserRoleName)
  ) {
    throw new Error(
      `Invalid user '${user.username}': unknown role '${
        user.role
      }' (expected one of ${userRoleNames.join(", ")})`
    );
  }
}

function validateNamespace(namespace: NamespaceConfig): void {  if (!namespace.id || typeof namespace.id !== "number") {
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

  validateRoles(folder.roles, `folder '${folder.name}'`);

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

  validateRoles(device.roles, `device '${device.name}'`);

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

  validateRoles(variable.roles, `variable '${variable.name}'`);

  validateValueSource(variable.source);
}

/**
 * Validates the optional list of roles used to restrict access to a node and
 * everything below it.
 */
function validateRoles(roles: NodeRoleName[] | undefined, context: string): void {
  if (roles === undefined) {
    return;
  }

  if (!Array.isArray(roles)) {
    throw new Error(`Invalid ${context}: roles must be an array`);
  }

  if (roles.length === 0) {
    throw new Error(
      `Invalid ${context}: roles cannot be empty, remove it to inherit access`
    );
  }

  const seen = new Set<string>();

  roles.forEach((role) => {
    if (!nodeRoleNames.includes(role as NodeRoleName)) {
      throw new Error(
        `Invalid ${context}: unknown role '${role}' (expected one of ${nodeRoleNames.join(
          ", "
        )})`
      );
    }

    if (seen.has(role)) {
      throw new Error(`Invalid ${context}: duplicate role '${role}'`);
    }

    seen.add(role);
  });
}
