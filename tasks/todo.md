# Faked Historical Alarms & Conditions (HA&C)

## Tag Metadata

- [x] Add optional variable `description`, `engineeringRange`, and string `units` configuration.
- [x] Validate metadata types, finite ascending ranges, and numeric-type restrictions.
- [x] Publish standard OPC UA Description, EURange, and EngineeringUnits properties.
- [x] Add validation and address-space tests; document the JSON shape.

### Review

- [x] `bunx tsc --noEmit` and `bun test` pass (115 tests).

Stand-in for the Exaquantum HA&C server. Mirrors the existing HDA approach: no live
alarms, no event generation — history reads are answered from static config.

## Findings

- node-opcua has **no** event-history support:
  - `address_space_historical_data_node.js` → `ReadEventDetails` returns
    `BadHistoryOperationUnsupported` ("todo provide correct implementation").
  - `addressSpace_accessor.js#historyReadNode` throws for nodes without `historyRead`;
    Objects/Views have none ("todo implement historyRead for Object and View").
  - ⇒ we attach our own `historyRead` to notifier Objects. Unavoidable.
- Faked events mean we skip `extractEventFields` / `IEventData` and resolve select
  clauses straight against JSON records.
- Available: `namespace.addEventType()`, `namespace.addMethod()` + `bindMethod`,
  `context.session` for per-session state, `HistoricalEventFilter` (`i=11215`) and
  `HistoricalEventConfigurationType` (`i=32621`) in the standard nodeset.
- **Namespace index**: `server_engine.js` registers the server's own namespace at index 1
  during `initialize()`, so config namespaces start at 2. The spec wants the type system
  at index 1. See open questions.

## Corrections from the server spec (3.5)

Earlier drafts assumed the gateway's abstract model (5.1.1). The server spec differs:

- **Multiple event types**, not one. One per `EventStorage` row (A&E) or
  `EventCategories.FullName` (A&C). Each has its own field set.
- **No prescribed core fields.** `Source`, `Severity`, `Message` are ordinary event
  *fields* in the examples, and field sets differ per type (Discrete Alarm Type has
  `OPC Server Id` + `Source`; Progress Event Type has `Severity` + `Message`).
  The gateway maps these onto its 5.1.1 core structure — not our problem.
- **Richer types.** Fields can be "any of the OPC UA data types". The gateway's
  TEXT/NUMBER/BOOLEAN/DATETIME is a narrowing done gateway-side.
- **Category ≈ Event Type.** For A&C, the type name comes from `EventCategories.FullName`,
  which resolves the earlier "where does Category go" question.

Type mapping (Table 3‑6):

| ADO Type | OPC UA Type |
| --- | --- |
| Boolean | Boolean |
| SmallInt | Int16 |
| Unsigned SmallInt | UInt16 |
| Integer | Int32 |
| Unsigned Integer | UInt32 |
| Single | Float |
| Double | Double |
| Date | DateTime |
| BSTR | String (see note) |

**Note on `BSTR`.** Table 3‑6 says `BSTR` → `ByteString`; we map to `String` instead.
`BSTR` is the COM/OLE Automation string type (`adBSTR`) — Unicode text — whereas OPC UA
`ByteString` is an opaque byte array (the `varbinary` equivalent). Mapping as written
would render `Message`/`Source` as hex, and would break EQL pattern operators: OPC UA's
`Like` is defined over `String`, not `ByteString`, so the spec's own examples
(`message like '%alarm%'`, `source = 'FIC101'`) could not be evaluated. Raise with the
spec authors.

The two tables also use different naming conventions — Table 3‑9/3‑12 use Access-style
names (`Long Integer`, `String`), Table 3‑6 uses ADO enum names (`Integer`, `BSTR`).
They are consistent once aligned: `Long Integer` ≈ `Integer` → `Int32`,
`String` ≈ `BSTR` → `String`.

## Config shape

Event types declared once at root, mirroring the QConfig-derived type system:

```jsonc
{
  "eventTypes": [
    {
      "name": "Discrete Alarm Type",
      "fields": [
        { "name": "OPC Server Id", "type": "Int32" },
        { "name": "Source", "type": "String" }
      ]
    },
    {
      "name": "Progress Event Type",
      "fields": [
        { "name": "Severity", "type": "Int32" },
        { "name": "Message", "type": "String" }
      ]
    }
  ],
  "namespaces": [ ... ]
}
```

Event source nodes reference a history file and declare their single event type:

```jsonc
{
  "name": "Boiler",
  "eventType": "Progress Event Type",
  "eventHistory": "alarms/boiler.json",
  "variables": [ ... ]
}
```

Records supply that type's fields:

```jsonc
[
  {
    "time": "2026-08-07T10:15:23.123Z",
    "fields": { "Severity": 700, "Message": "High temperature" }
  }
]
```

`time` stays a record-level key (needed for the HistoryRead time window and
`getTotalRecords`) and is exposed as the standard `Time` field.

The `eventTypes` table is the single source of truth: it drives the OPC UA event types,
the `HistoricalEventFilter`, the select-clause mapper, the filter evaluator and record
validation, so they cannot drift.

## Tasks

### 1. Config

- [x] `ConfigLoader`: `eventTypes?: EventTypeConfig[]` on root;
      `eventHistory?: string` + `eventType: string` on `FolderConfig` + `DeviceConfig`
      (one event type per source node).
- [x] Validate type names unique, field names unique per type, `type` in the supported
      OPC UA type list.
- [x] `src/ua-config/EventHistoryLoader.ts`: load + validate records against the declared
      types (known `eventType`, required `time`, field values match declared OPC UA type,
      unknown field names rejected). Sort ascending by time.
- [x] Resolve `eventHistory` paths relative to the hierarchy config file.
- [x] Tests.

### 2. Event type system

- [x] For each configured type: `namespace.addEventType({ browseName, subtypeOf:
      "BaseEventType" })` plus one property per field with the mapped DataType.
- [x] Add `HistoricalEventFilter` (`i=11215`) to each historized notifier node, holding an
      `EventFilter` whose `selectClauses` enumerate the fields available from history.
- [x] Optionally instantiate `HistoricalEventConfigurationType` (`i=32621`) with its
      `EventTypes` folder referencing the configured types.
- [x] Tests: browsing yields the configured type/field structure and DataTypes.

### 3. Select-clause mapping

- [x] `SimpleAttributeOperand` (typeDefinitionId + browse path) → record field → Variant,
      using the declared OPC UA DataType.
- [x] Unknown path, or path on a type the record isn't → `StatusCodes.BadNoData` Variant.
- [x] Standard `Time` / `EventType` / `EventId` resolved from record metadata;
      `EventId` synthesised deterministically so repeat reads are stable.

### 4. HistoryRead hook

- [x] Attach `historyRead(context, details, indexRange, dataEncoding, continuationData)`
      to each notifier Object.
- [x] `ReadEventDetails` only; anything else → `BadHistoryOperationUnsupported`.
- [x] Time window `startTime`/`endTime`; `numValuesPerNode` cap; reverse order when
      `endTime < startTime` or only `endTime` supplied.
- [x] `HistoryReadResult({ historyData: new HistoryEvent({ events }) })`,
      `GoodNoData` when empty. Must satisfy `result.isValid()`.
- [x] `eventNotifier` = SubscribeToEvents | HistoryRead on those nodes.
- [x] `maxNodesPerHistoryReadEvents` operation limit > 0.

### 5. Continuation points

- [x] Per-session `Map<continuationPoint, { records, filter, offset }>`; opaque ByteString.
- [x] Return one when the filtered set exceeds `numValuesPerNode`; resume from `offset`.
- [x] Honour `releaseContinuationPoints`; state is held in a `WeakMap` keyed by session,
      so it is collected with the session rather than dropped explicitly.
- [x] Cap outstanding points per session → `BadNoContinuationPoints`.

### 6. whereClause (ContentFilter) evaluation

The frontend speaks EQL (5.1.3); the gateway translates it to an OPC UA `ContentFilter`.
node-opcua's `checkFilter` needs real `IEventData`, so we evaluate over JSON records.

- [x] Operators: `Equals`, `LessThan`, `GreaterThan`, `LessThanOrEqual`,
      `GreaterThanOrEqual`, `Like`, `Not`, `And`, `Or`, `InList`, `IsNull`, `OfType`.
- [x] `OfType` matters more now — it selects by event type, which is how the gateway
      scopes a query to one category.
- [x] Operands: `SimpleAttributeOperand`, `LiteralOperand`, `ElementOperand`.
- [x] `Like` uses `%` / `_` — same semantics as EQL `like` / `contains`.
- [x] Unevaluable filter → `BadEventFilterInvalid` as the read's status code.
      **Correction:** `HistoryReadResult` carries no `filterResult`, so there is nowhere
      to report per-element `BadFilterOperandInvalid`. An unknown *field* is not an error
      — it resolves to null and simply matches nothing.
- [x] Assumed EQL → ContentFilter shape: `<>` → `Not(Equals)`, `not like` → `Not(Like)`,
      `contains 'x'` → `Like '%x%'`, `is not null` → `Not(IsNull)`, `in [...]` → `InList`.

### 7. `getTotalRecords`

Hosted on a singleton object, per the spec's client example
(`session.Call(new NodeId("HistoryManager", 2), new NodeId("getTotalRecords", 2))`).

- [x] Object `HistoryManager` under `Objects`, nodeId `ns=N;s=HistoryManager`.
- [x] `addMethod` `getTotalRecords`, nodeId `ns=N;s=getTotalRecords`, no inputs,
      one String output. `bindMethod(fn)`.
- [x] Per-session `WeakMap<session, { first: Date; last: Date }>` written by the
      `historyRead` hook from the page actually returned.
- [x] XML per Appendix 4.3 — `ReturnedRange` occurs exactly once:

      <HistoryReadResult>
        <ReturnedRange>
          <FirstTimestamp>2026-08-07T10:15:23.123Z</FirstTimestamp>
          <LastTimestamp>2026-08-07T11:42:18.456Z</LastTimestamp>
        </ReturnedRange>
      </HistoryReadResult>

- [x] ISO 8601 UTC with milliseconds (`xs:dateTime`).
- [x] No prior read in session, or empty result → empty string (client tests
      `string.IsNullOrEmpty`).

Spec notes: the name says "TotalRecords" but the return carries timestamps, not a count;
the prose says "each page" while the XSD permits one `ReturnedRange`. Following the XSD.

### 8. Verify

- [x] Unit: type/field validation, record validation, select-clause mapping, all filter
      operators, `OfType` scoping, time filtering, ordering, `numValuesPerNode`,
      continuation points, empty → `GoodNoData`.
- [x] `getTotalRecords`: empty before any read, correct range after, updates on second
      read, isolated between sessions, validates against the Appendix 4.3 XSD.
- [x] Integration: client `historyReadEvent` against a source node, then `getTotalRecords`.
- [x] `examples/hac.json` + event history JSON + README section.

## Deferred

- **`order by`** — no OPC UA equivalent; `ReadEventDetails` has no ordering parameter.
  TBC with spec authors. Sim orders by time only for now.

## Unresolved questions

1. `getTotalRecords` returns first/last timestamp, which only makes sense under time
   ordering. Revisit once `order by` is settled.

## Resolved

- **Namespace index** — accept node-opcua's allocation; type system lands at ns=2.
  Gateway should resolve by namespace URI.
- **Event type per node** — one event type per event source node.
- **Category** — maps to the event type name (A&C uses `EventCategories.FullName`).
- **`BSTR`** — mapped to `String`, deviating from Table 3‑6. Flag to spec authors.
- **`ci`** — all string comparison is case-insensitive, including `Like`. Deviates from
  OPC UA, which defines `Equals`/`Like` as case-sensitive; a conformance test for case
  sensitivity would fail. Chosen so the sim answers `ci` and non-`ci` queries alike.

## Review

All eight steps are implemented and verified end to end against a running server with a
real OPC UA client.

### What was built

| Module | Role |
|--------|------|
| `ConfigLoader.ts` | `eventTypes` on the root, `eventType`/`eventHistory` on folders and devices, with validation |
| `EventTypes.ts` | ADO to OPC UA type mapping, one `addEventType` per configured type |
| `EventHistoryLoader.ts` | Loads and validates records against the declared type |
| `EventHistory.ts` | `historyRead` on notifier objects: aggregation, time window, filtering, paging, `HistoricalEventFilter` |
| `EventFilter.ts` | `ContentFilter` evaluator over JSON records |
| `EventContinuationPoints.ts` | Per-session continuation point store |
| `HistoryManager.ts` | `HistoryManager` object, `getTotalRecords`, per-session last read range |

### Changes to the original plan

- **Event history aggregates up the hierarchy.** Originally only configured source nodes
  were historized, which meant a read on the Server object or a folder failed - and it
  failed as a *serviceResult*, killing the whole request including valid nodes alongside
  it. Parents now merge everything beneath them in time order, matching the usual OPC UA
  convention that the Server object exposes all events.
- **`BadEventFilterInvalid` replaces per-element filter results** - `HistoryReadResult`
  has no `filterResult` field.
- **`SourceName` falls back to the source node browse name.** Without this, aggregated
  reads cannot tell you which device an event came from unless the field happens to be
  configured. UaExpert showed `BadNoData` for it.
- **`numValuesPerNode` no longer truncates silently.** It pages, and returns
  `BadNoContinuationPoints` if a point cannot be allocated.

### Verified

103 unit tests pass. End to end against `examples/hac.json` with two devices of different
event types: Server object and folder each returned all 5 merged events in time order,
the device returned its own 3, a where clause on `Operator` (a field only one event type
declares) correctly returned 1, paging with `numValuesPerNode=2` issued and resumed
continuation points, and `getTotalRecords` returned spec-shaped XML for the last page read.

### Still open

- `order by` remains deferred pending the spec authors.
- All string filtering is case-insensitive, deviating from OPC UA, to cover EQL's `ci`.
- `BSTR` to `String` is a deliberate deviation from Table 3-6 and needs flagging.
- Namespace index is 2, not the 1 the spec asks for; node-opcua claims 1 for itself.
