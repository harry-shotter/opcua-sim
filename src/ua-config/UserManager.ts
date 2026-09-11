import { createHash, timingSafeEqual } from "node:crypto";
import { makeRoles, WellKnownRoles, type NodeId } from "node-opcua";
import {
  type HierarchyRoot,
  type UserConfig,
  type UserRoleName
} from "./ConfigLoader";

export interface ResolvedUser {
  username: string;
  digest: Buffer;
  role?: UserRoleName;
}

export interface UserManager {
  isValidUser: (username: string, password: string) => boolean;
  getUserRoles: (username: string) => NodeId[];
}

export interface ResolvedSecurity {
  allowAnonymous: boolean;
  users: ResolvedUser[];
  userManager?: UserManager;
}

/**
 * Builds the authentication options passed to the OPCUAServer constructor.
 *
 * Precedence is environment variable > configuration file > default, where the
 * default is node-opcua's own behaviour: anonymous access allowed and no named
 * users. UA_USERS replaces the configured user list rather than adding to it.
 */
export default function resolveSecurity(
  config: HierarchyRoot,
  env: Record<string, string | undefined> = process.env
): ResolvedSecurity {
  const allowAnonymous =
    parseAllowAnonymous(env.UA_ALLOW_ANONYMOUS) ??
    config.security?.allowAnonymous ??
    true;

  const users = parseEnvUsers(env.UA_USERS) ?? resolveUsers(config.security?.users);

  if (!allowAnonymous && users.length === 0) {
    throw new Error(
      "Invalid security: anonymous access is disabled but no users are configured, nobody could connect"
    );
  }

  if (users.length === 0) {
    return { allowAnonymous, users };
  }

  return { allowAnonymous, users, userManager: createUserManager(users) };
}

function createUserManager(users: ResolvedUser[]): UserManager {
  const byUsername = new Map(users.map((user) => [user.username, user]));

  return {
    isValidUser: (username: string, password: string): boolean => {
      const user = byUsername.get(username);

      if (!user || typeof password !== "string") {
        console.warn(`Rejected login for unknown user '${username}'`);
        return false;
      }

      if (!timingSafeEqual(sha256(password), user.digest)) {
        console.warn(`Rejected login for user '${username}': invalid password`);
        return false;
      }

      return true;
    },
    getUserRoles: (username: string): NodeId[] => {
      const role = byUsername.get(username)?.role;

      // node-opcua always adds AuthenticatedUser on top of whatever is returned.
      return role ? makeRoles([WellKnownRoles[role]]) : [];
    }
  };
}

function resolveUsers(users: UserConfig[] | undefined): ResolvedUser[] {
  if (!users) {
    return [];
  }

  return users.map((user) => ({
    username: user.username,
    digest: user.passwordSha256
      ? Buffer.from(user.passwordSha256, "hex")
      : sha256(user.password as string),
    role: user.role
  }));
}

/**
 * Parses UA_USERS, a comma separated list of username:password pairs. Only the
 * first colon is treated as a separator so passwords may contain colons.
 */
function parseEnvUsers(rawValue: string | undefined): ResolvedUser[] | undefined {
  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }

  const users: ResolvedUser[] = [];

  for (const entry of rawValue.split(",")) {
    if (entry.trim() === "") {
      continue;
    }

    const separator = entry.indexOf(":");
    const username = separator === -1 ? "" : entry.slice(0, separator).trim();
    const password = separator === -1 ? "" : entry.slice(separator + 1);

    if (username === "" || password === "") {
      console.warn(
        `Invalid UA_USERS entry '${entry}', expected username:password - ignoring`
      );
      continue;
    }

    if (users.some((user) => user.username === username)) {
      console.warn(`Duplicate UA_USERS entry for '${username}' - ignoring`);
      continue;
    }

    users.push({ username, digest: sha256(password) });
  }

  if (users.length === 0) {
    console.warn("UA_USERS did not contain any valid entries - ignoring");
    return undefined;
  }

  return users;
}

function parseAllowAnonymous(rawValue: string | undefined): boolean | undefined {
  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }

  const value = rawValue.trim().toLowerCase();

  if (["true", "1", "yes"].includes(value)) {
    return true;
  }

  if (["false", "0", "no"].includes(value)) {
    return false;
  }

  console.warn(
    `Invalid UA_ALLOW_ANONYMOUS value '${rawValue}', expected true or false - ignoring`
  );

  return undefined;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
