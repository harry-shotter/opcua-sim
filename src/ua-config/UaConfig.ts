import {
  AddressSpace,
  DataType,
  DataValue,
  StatusCodes,
  Variant,
  type Namespace,
  type OPCUAServer
} from "node-opcua";
import { addAggregateSupport } from "node-opcua-aggregates";
import {
  validateValueSource,
  type ValueSource
} from "../value-sources/ValueSourceTypes";
import ValueSourceHandler from "../value-sources/ValueSourceHandler";
import type { HomeAssistant } from "../home-assistant/HomeAssistant";

// Updated Variable interface
interface VariableConfig {
  name: string;
  type: "Boolean" | "DateTime" | "Double" | "Int32" | "String";
  source: ValueSource;
  minimumSamplingInterval: number;
}

interface DeviceConfig {
  name: string;
  variables: VariableConfig[];
}

interface FolderConfig {
  name: string;
  folders?: FolderConfig[];
  devices?: DeviceConfig[];
}

interface NamespaceConfig {
  id: number;
  name: string;
  uri: string; // Added URI for OPC UA namespace identification
  folders: FolderConfig[];
}

interface HierarchyRoot {
  namespaces: NamespaceConfig[];
}

const validTypes = ["Boolean", "DateTime", "Double", "Int32", "String"];

export default async function ConfigureServer(
  configFile: string,
  server: OPCUAServer,
  haClient?: HomeAssistant
): Promise<OPCUAServer> {
  const valueHandler = new ValueSourceHandler(haClient);
  const hierarchy = await importHierarchy(configFile);

  await createOpcUaHierarchy(hierarchy, server, valueHandler);

  return server;
}

async function importHierarchy(filePath: string): Promise<HierarchyRoot> {
  try {
    const file = Bun.file(filePath);

    const data = await file.json();

    validateRoot(data);

    return data as HierarchyRoot;
  } catch (error: any) {
    throw new Error(`Error importing hierarchy: ${error.message}`);
  }
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

    // Enable aggregation support (Interpolative, Min, Max, Average)
    addAggregateSupport(addressSpace);

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
        valueHandler
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
  valueHandler: ValueSourceHandler
) {
  for (const folder of folders) {
    // Create folder node
    const folderNode = namespace.addFolder(parentNode, {
      browseName: folder.name,
      nodeId: `ns=${namespace.index};s=${folder.name}`
    });

    // Process nested folders recursively
    if (folder.folders) {
      await processFolders(
        folder.folders,
        folderNode,
        namespace,
        addressSpace,
        valueHandler
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

        // Add variables to device
        for (const variable of device.variables) {
          await createVariable(
            deviceNode,
            variable,
            namespace,
            addressSpace,
            valueHandler
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
  valueHandler: ValueSourceHandler
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
        const dataValues: DataValue[] = [];

        if (
          historyReadRawModifiedDetails.startTime == null ||
          historyReadRawModifiedDetails.endTime == null
        ) {
          callback(null, dataValues);
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

          callback(null, historyDataValues);
        } catch (error: any) {
          console.error(`Error getting history for ${nodeId}: ${error.message}`);
          callback(null, dataValues);
        }
      },
      push: (_newDataValue): Promise<void> => {
        return Promise.resolve();
      }
    }
  });

  return variableNode;
}

function getDefaultValue(type: VariableConfig["type"]): number | boolean | string | Date {
  switch (type) {
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

function validateRoot(hierarchyRoot: HierarchyRoot): void {
  if (!hierarchyRoot.namespaces || !Array.isArray(hierarchyRoot.namespaces)) {
    throw new Error("Invalid root: namespaces must be an array");
  }

  if (hierarchyRoot.namespaces.length === 0) {
    throw new Error("Invalid root: namespaces array cannot be empty");
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
