# getTotalRecords - client implementation spec

How an OPC UA client obtains the total record count for a historical Alarms & Conditions read
against this simulator, in order to paginate at a page size of its own choosing.

`getTotalRecords` is not part of OPC UA. It is a server extension. Everything else described here is
standard `HistoryRead` of events.

## Nodes

| Node | NodeId | Notes |
| --- | --- | --- |
| HistoryManager | `ns=<n>;s=HistoryManager` | Organised by the Objects folder |
| getTotalRecords | `ns=<n>;s=getTotalRecords` | A method of HistoryManager |

`<n>` is the index of the configured namespace, which is `2` by default. Resolve it by namespace URI
rather than hard coding the index.

The object is absent entirely when the server is configured with `historyManager: false`, which is
how a pure OPC UA path is tested. A client should treat `BadNodeIdUnknown` on either node as "this
server does not offer the extension" and fall back to counting what it reads.

## Signature

| Direction | Name | Type | Description |
| --- | --- | --- | --- |
| Input | RequestId | UInt32 | Identifies the read to report on. `0` means the calling session's most recent read. |
| Output | Result | String | XML, described below. Empty when the request is unknown. |

The method always returns `Good`. An unknown or expired request is reported as an empty string, not
as a bad status code.

## Obtaining a RequestId

OPC UA has no request handle a client can quote after the fact: `HistoryRead` returns no identifier,
and the server cannot see the `RequestHeader` of the call. The **continuation point is the request
id**.

- Continuation points issued by this server are exactly four bytes.
- Those four bytes are a big endian UInt32, and that value is the request id.
- The id is stable for the whole read. Every page of one read carries the same continuation point
  value, so a client reads it once and keeps it.

```csharp
uint requestId = BinaryPrimitives.ReadUInt32BigEndian(result.ContinuationPoint);
```

A read whose results fit in a single page is never issued a continuation point, and therefore has no
id. Its total is simply the number of events returned, and it remains reachable as request `0` until
the session performs another read.

This is the only aspect of the extension that depends on the server's continuation point format. A
client that cannot rely on it can always pass `0`, at the cost of not being able to tell concurrent
reads apart.

## Result

```xml
<HistoryReadResult>
  <TotalRecords>5</TotalRecords>
  <ReturnedRange>
    <FirstTimestamp>2026-08-07T10:15:23.123Z</FirstTimestamp>
    <LastTimestamp>2026-08-07T10:31:44.000Z</LastTimestamp>
  </ReturnedRange>
</HistoryReadResult>
```

| Element | Meaning |
| --- | --- |
| `TotalRecords` | Every record matching the read's time window and where clause. Not the page size, and not the number of events returned so far. Constant for the life of the read. |
| `ReturnedRange` | The time span of the page the identified read most recently returned. Moves as the client follows continuation points. |

Timestamps are UTC, ISO 8601, to millisecond precision.

The page count a client displays is its own concern:
`pageCount = ceil(TotalRecords / clientPageSize)`. The server's `numValuesPerNode` and the client's
page size are unrelated.

### Schema

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="HistoryReadResult">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="TotalRecords" type="xs:long"/>
        <xs:element name="ReturnedRange" type="ReturnedRangeType"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="ReturnedRangeType">
    <xs:sequence>
      <xs:element name="FirstTimestamp" type="xs:dateTime"/>
      <xs:element name="LastTimestamp" type="xs:dateTime"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
```

## Sequence

1. Call `HistoryRead` with `ReadEventDetails`, setting `NumValuesPerNode` to the server side page
   size. Read from the Server object (`i=2253`) for everything, or from a folder or device node for
   a subset.
2. If `ContinuationPoint` is set on the result, decode it as a big endian UInt32 to get the request
   id. If it is not set, the read is complete and the total is the number of events returned; stop.
3. Call `getTotalRecords(requestId)` and parse `TotalRecords`.
4. Continue paging by passing the continuation point back in `HistoryRead`. The id does not change.
5. `getTotalRecords(requestId)` may be called again at any point during or after the read. The total
   stays the same, while `ReturnedRange` tracks the latest page.

## Concurrency and lifetime

- Request ids distinguish reads within one session, which is what allows several queries with
  different filters to be in flight at once against the same node.
- Ids are unique across the server, so one session cannot read another session's totals. A request
  id belonging to a different session returns an empty string.
- The sixteen most recent identified reads per session are retained; older ones return an empty
  string.
- All state is discarded with the session.

## Empty results

A read matching no records returns `GoodNoData` with no events and no continuation point.
`getTotalRecords(0)` then returns an empty string rather than a `TotalRecords` of zero, so a client
should treat an empty string as "nothing to page through".
