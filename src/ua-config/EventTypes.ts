import { DataType, type Namespace, type UAObjectType } from "node-opcua";
import type {
  EventFieldTypeName,
  EventTypeConfig,
  HierarchyRoot
} from "./ConfigLoader";

/**
 * Exaquantum stores event field types as ADO types which are exposed over OPC
 * UA using the equivalents below. `BSTR` is deliberately mapped to String
 * rather than the ByteString given in the server specification: ByteString is
 * an opaque byte array, which would render text fields as binary and make the
 * Like operator unusable in event filters.
 */
const dataTypes: Record<EventFieldTypeName, DataType> = {
  Boolean: DataType.Boolean,
  Int16: DataType.Int16,
  UInt16: DataType.UInt16,
  Int32: DataType.Int32,
  UInt32: DataType.UInt32,
  Float: DataType.Float,
  Double: DataType.Double,
  DateTime: DataType.DateTime,
  String: DataType.String
};

/**
 * Fields BaseEventType already declares. A configured field reusing one of
 * these names resolves against the inherited property instead of adding a
 * duplicate to the subtype.
 */
const baseEventFields = new Set([
  "EventId",
  "EventType",
  "SourceNode",
  "SourceName",
  "Time",
  "ReceiveTime",
  "LocalTime",
  "Message",
  "Severity"
]);

export interface EventTypeDefinition {
  name: string;
  fields: { name: string; type: EventFieldTypeName; dataType: DataType }[];
  objectType: UAObjectType;
}

export function toDataType(type: EventFieldTypeName): DataType {
  return dataTypes[type];
}

/**
 * Builds an OPC UA event type per configured type, mirroring the Exaquantum
 * type system constructed from the QConfig database.
 */
export default function createEventTypes(
  hierarchy: HierarchyRoot,
  namespace: Namespace
): Map<string, EventTypeDefinition> {
  const definitions = new Map<string, EventTypeDefinition>();

  for (const eventType of hierarchy.eventTypes ?? []) {
    definitions.set(eventType.name, createEventType(eventType, namespace));
  }

  return definitions;
}

function createEventType(
  eventType: EventTypeConfig,
  namespace: Namespace
): EventTypeDefinition {
  const objectType = namespace.addEventType({
    browseName: eventType.name,
    subtypeOf: "BaseEventType",
    isAbstract: false
  });

  const fields = eventType.fields.map((field) => ({
    name: field.name,
    type: field.type,
    dataType: dataTypes[field.type]
  }));

  for (const field of fields) {
    if (baseEventFields.has(field.name)) {
      continue;
    }

    namespace.addVariable({
      propertyOf: objectType,
      browseName: field.name,
      dataType: field.dataType,
      modellingRule: "Mandatory"
    });
  }

  return { name: eventType.name, fields, objectType };
}
