import {
  AddressSpace,
  DataType,
  DataValue,
  StatusCodes,
  Variant,
  type Namespace,
  type OPCUAServer
} from "node-opcua";
import { installAggregateConfigurationOptions } from "node-opcua-aggregates";
import installAggregates from "./Aggregates";
import type {
  DeviceConfig,
  FolderConfig,
  HierarchyRoot,
  NamespaceConfig,
  NodeRoleName,
  VariableConfig
} from "./ConfigLoader";
import applyRolePermissions from "./RolePermissions";
import ValueSourceHandler from "../value-sources/ValueSourceHandler";
import type { HomeAssistant } from "../home-assistant/HomeAssistant";

export default async function ConfigureServer(
  hierarchy: HierarchyRoot,
  server: OPCUAServer,
  haClient?: HomeAssistant
): Promise<OPCUAServer> {
  const valueHandler = new ValueSourceHandler(haClient);

  await createOpcUaHierarchy(hierarchy, server, valueHandler);

  return server;
}

async function createOpcUaHierarchy(
  hierarchyRoot: HierarchyRoot,
  server: OPCUAServer,
  valueHandler: ValueSourceHandler
) {
  try {
    const addressSpace = server.engine.addressSpace;
    if (!addressSpace) {
      throw new Error("Address space not available");
    }

    // Enable aggregation support
    installAggregates(addressSpace);

    for (const namespaceConfig of hierarchyRoot.namespaces) {
      // Register the namespace with OPC UA server
      const namespace = addressSpace.registerNamespace(namespaceConfig.uri);

      // Create a folder for this namespace
      const namespaceFolder = namespace.addFolder(
        addressSpace.rootFolder.objects,
        {
          browseName: namespaceConfig.name,
          nodeId: `ns=${namespace.index};s=${namespaceConfig.name}`
        }
      );

      // Process the folders recursively
      await processFolders(
        namespaceConfig.folders,
        namespaceFolder,
        namespace,
        addressSpace,
        valueHandler,
        undefined
      );
    }
  } catch (error: any) {
    throw new Error(`Failed to create OPC UA hierarchy: ${error.message}`);
  }
}

async function processFolders(
  folders: FolderConfig[],
  parentNode: any,
  namespace: Namespace,
  addressSpace: AddressSpace,
  valueHandler: ValueSourceHandler,
  inheritedRoles: NodeRoleName[] | undefined
) {
  for (const folder of folders) {
    // Create folder node
    const folderNode = namespace.addFolder(parentNode, {
      browseName: folder.name,
      nodeId: `ns=${namespace.index};s=${folder.name}`
    });

    // Roles cascade down the hierarchy unless a node declares its own
    const folderRoles = folder.roles ?? inheritedRoles;
    applyRolePermissions(folderNode, folderRoles);

    // Process nested folders recursively
    if (folder.folders) {
      await processFolders(
        folder.folders,
        folderNode,
        namespace,
        addressSpace,
        valueHandler,
        folderRoles
      );
    }

    // Process devices
    if (folder.devices) {
      for (const device of folder.devices) {
        const deviceNode = namespace.addObject({
          organizedBy: folderNode,
          browseName: device.name,
          nodeId: `ns=${namespace.index};s=${device.name}`
        });

        const deviceRoles = device.roles ?? folderRoles;
        applyRolePermissions(deviceNode, deviceRoles);

        // Add variables to device
        for (const variable of device.variables) {
          await createVariable(
            deviceNode,
            variable,
            namespace,
            addressSpace,
            valueHandler,
            deviceRoles
          );
        }
      }
    }
  }
}

async function createVariable(
  deviceNode: any,
  variable: VariableConfig,
  namespace: Namespace,
  addressSpace: AddressSpace,
  valueHandler: ValueSourceHandler,
  inheritedRoles: NodeRoleName[] | undefined
) {
  const dataType = mapDataType(variable.type);
  const nodeId = `ns=${namespace.index};s=${deviceNode.browseName.toString()}.${
    variable.name
  }`;

  await valueHandler.getValue(variable.name, variable.source);

  const variableNode = namespace.addVariable({
    componentOf: deviceNode,
    browseName: variable.name,
    dataType: dataType,
    nodeId: nodeId,
    // historizing: true,
    minimumSamplingInterval: variable.minimumSamplingInterval,
    value: {
      refreshFunc: async (callback) => {
        try {
          const value = await valueHandler.getValue(
            variable.name,
            variable.source
          );

          const variant = new Variant({
            dataType: dataType,
            value: value
          });

          const dataValue = new DataValue({
            value: variant,
            statusCode: StatusCodes.Good,
            sourceTimestamp: new Date()
          });
          callback(null, dataValue);
        } catch (error: any) {
          console.error(`Error getting value for ${nodeId}: ${error.message}`);
          const defaultValue = getDefaultValue(variable.type);
          const variant = new Variant({
            dataType: dataType,
            value: defaultValue
          });

          const dataValue = new DataValue({
            value: variant,
            statusCode: StatusCodes.BadDataUnavailable,
            sourceTimestamp: new Date()
          });
          callback(null, dataValue);
        }
      }
    }
  });

  applyRolePermissions(variableNode, variable.roles ?? inheritedRoles);

  addressSpace.installHistoricalDataNode(variableNode, {
    maxOnlineValues: 100000,
    historian: {
      extractDataValues: async (
        historyReadRawModifiedDetails,
        _maxNumberToExtract,
        _isReversed,
        _reverseDataValue,
        callback
      ) => {
        if (
          historyReadRawModifiedDetails.startTime == null ||
          historyReadRawModifiedDetails.endTime == null
        ) {
          callback(null, noHistoryData(new Date()));
          return;
        }

        try {
          const values = await valueHandler.getHistoryValues(
            variable.name,
            variable.source,
            historyReadRawModifiedDetails.startTime,
            historyReadRawModifiedDetails.endTime,
            variable.minimumSamplingInterval
          );

          const historyDataValues = values.map((v) => {
            const variant = new Variant({
              dataType: dataType,
              value: v.value
            });

            return new DataValue({
              value: variant,
              statusCode: StatusCodes.Good,
              sourceTimestamp: v.timestamp
            });
          });

          callback(
            null,
            historyDataValues.length > 0
              ? historyDataValues
              : noHistoryData(historyReadRawModifiedDetails.startTime)
          );
        } catch (error: any) {
          console.error(`Error getting history for ${nodeId}: ${error.message}`);
          callback(
            null,
            noHistoryData(historyReadRawModifiedDetails.startTime)
          );
        }
      },
      push: (_newDataValue): Promise<void> => {
        return Promise.resolve();
      }
    }
  });

  // advertise the supported aggregates on the variable itself so clients can
  // discover them without browsing the server capabilities
  installAggregateConfigurationOptions(variableNode, {});

  return variableNode;
}

// node-opcua cannot aggregate over an empty history, so an explicit BadNoData
// placeholder is returned instead of an empty array
function noHistoryData(sourceTimestamp: Date): DataValue[] {
  return [
    new DataValue({
      statusCode: StatusCodes.BadNoData,
      sourceTimestamp
    })
  ];
}

function getDefaultValue(type: VariableConfig["type"]): number | boolean | string | Date {  switch (type) {
    case "Boolean":
      return false;
    case "DateTime":
      return new Date();
    case "Double":
      return 0.0;
    case "Int32":
      return 0;
    case "String":
      return "";
  }
}

function mapDataType(type: string): DataType {
  switch (type) {
    case "Boolean":
      return DataType.Boolean;

    case "DateTime":
      return DataType.DateTime;

    case "Double":
      return DataType.Double;

    case "Int32":
      return DataType.Int32;

    case "String":
      return DataType.String;
    default:
      throw new Error(`Unsupported data type: ${type}`);
  }
}

