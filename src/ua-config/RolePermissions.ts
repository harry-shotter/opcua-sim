import {
  makePermissionFlag,
  resolveNodeId,
  WellKnownRoles,
  type BaseNode,
  type RolePermissionTypeOptions
} from "node-opcua";
import type { NodeRoleName } from "./ConfigLoader";

/**
 * Permissions granted to the roles a node is scoped to. The simulator only
 * serves data, so read style permissions are all that is needed.
 */
const readPermissions = makePermissionFlag(
  "Browse | Read | ReadHistory | ReceiveEvents"
);

/**
 * Restricts a node to the given roles. Sessions holding none of them are
 * refused browse, read and history read on it.
 *
 * Nodes without roles are left untouched so they stay readable by everyone,
 * which keeps unconfigured hierarchies working exactly as before.
 */
export default function applyRolePermissions(
  node: BaseNode,
  roles: NodeRoleName[] | undefined
): void {
  if (!roles) {
    return;
  }

  node.setRolePermissions(makeRolePermissions(roles));
}

export function makeRolePermissions(
  roles: NodeRoleName[]
): RolePermissionTypeOptions[] {
  return roles.map((role) => ({
    roleId: resolveNodeId(WellKnownRoles[role]),
    permissions: readPermissions
  }));
}
