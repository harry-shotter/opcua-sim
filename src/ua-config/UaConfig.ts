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
import { join } from "node:path";
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
import createEventTypes, { type EventTypeDefinition } from "./EventTypes";
import installEventHistory, { type EventSource } from "./EventHistory";
import loadEventHistory from "./EventHistoryLoader";
import installHistoryManager, { LastReadRanges } from "./HistoryManager";
import ValueSourceHandler from "../value-sources/ValueSourceHandler";
import type { HomeAssistant } from "../home-assistant/HomeAssistant";

export default async function ConfigureServer(
  hierarchy: HierarchyRoot,
  server: OPCUAServer,
  haClient?: HomeAssistant,
  configDirectory = "."
): Promise<OPCUAServer> {
  const valueHandler = new ValueSourceHandler(haClient);

  await createOpcUaHierarchy(hierarchy, server, valueHandler, configDirectory);

  return server;
}

async function createOpcUaHierarchy(
  hierarchyRoot: HierarchyRoot,
  server: OPCUAServer,
  valueHandler: ValueSourceHandler,
  configDirectory: string
) {
  try {
    const addressSpace = server.engine.addressSpace;
    if (!addressSpace) {
      throw new Error("Address space not available");
    }

    // Enable aggregation support
    installAggregates(addressSpace);

    let eventTypes = new Map<string, EventTypeDefinition>();
    let eventNamespace: Namespace | undefined;
    const ranges = new LastReadRanges();
    const allSources: EventSource[] = [];

    for (const namespaceConfig of hierarchyRoot.namespaces) {
      // Register the namespace with OPC UA server
      const namespace = addressSpace.registerNamespace(namespaceConfig.uri);

      // The event type system is built once, in the first configured namespace
      if (eventNamespace === undefined) {
        eventNamespace = namespace;
        eventTypes = createEventTypes(hierarchyRoot, namespace);
      }

      // Create a folder for this namespace
      const namespaceFolder = namespace.addFolder(
        addressSpace.rootFolder.objects,
        {
          browseName: namespaceConfig.name,
          nodeId: `ns=${namespace.index};s=${namespaceConfig.name}`
        }
      );

      // Process the folders recursively
      const sources = await processFolders(
        namespaceConfig.folders,
        namespaceFolder,
        namespace,
        addressSpace,
        valueHandler,
        undefined,
        eventTypes,
        configDirectory,
        ranges
      );

      if (sources.length > 0) {
        installEventHistory(namespaceFolder, sources, namespace, ranges);
        allSources.push(...sources);
      }
    }

    // The Server object is the conventional place to read every event at once
    if (allSources.length > 0 && eventNamespace) {
      installEventHistory(
        addressSpace.rootFolder.objects.server,
        allSources,
        eventNamespace,
        ranges
      );

      installHistoryManager(eventNamespace, addressSpace, ranges);
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
  inheritedRoles: NodeRoleName[] | undefined,
  eventTypes: Map<string, EventTypeDefinition>,
  configDirectory: string,
  ranges: LastReadRanges
): Promise<EventSource[]> {
  const collected: EventSource[] = [];

  for (const folder of folders) {
    // Create folder node
    const folderNode = namespace.addFolder(parentNode, {
      browseName: folder.name,
      nodeId: `ns=${namespace.index};s=${folder.name}`
    });

    // Roles cascade down the hierarchy unless a node declares its own
    const folderRoles = folder.roles ?? inheritedRoles;
    applyRolePermissions(folderNode, folderRoles);

    // Everything beneath this folder is readable from the folder itself
    const folderSources: EventSource[] = [];

    const own = await loadEventSource(
      folder,
      folderNode,
      eventTypes,
      configDirectory
    );

    if (own) {
      folderSources.push(own);
    }

    // Process nested folders recursively
    if (folder.folders) {
      folderSources.push(
        ...(await processFolders(
          folder.folders,
          folderNode,
          namespace,
          addressSpace,
          valueHandler,
          folderRoles,
          eventTypes,
          configDirectory,
          ranges
        ))
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

        const deviceSource = await loadEventSource(
          device,
          deviceNode,
          eventTypes,
          configDirectory
        );

        if (deviceSource) {
          installEventHistory(deviceNode, [deviceSource], namespace, ranges);
          folderSources.push(deviceSource);
        }

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

    if (folderSources.length > 0) {
      installEventHistory(folderNode, folderSources, namespace, ranges);
      collected.push(...folderSources);
    }
  }

  return collected;
}

/**
 * Reads the event history a node declares, if any. Validation has already
 * guaranteed the pair is complete and the type is known.
 */
async function loadEventSource(
  config: FolderConfig | DeviceConfig,
  node: any,
  eventTypes: Map<string, EventTypeDefinition>,
  configDirectory: string
): Promise<EventSource | undefined> {
  if (config.eventType === undefined || config.eventHistory === undefined) {
    return undefined;
  }

  const eventType = eventTypes.get(config.eventType)!;
  const records = await loadEventHistory(
    join(configDirectory, config.eventHistory),
    eventType
  );

  return { node, eventType, records };
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

