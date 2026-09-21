# OPC UA Simulation Server

A configurable OPC UA server for simulating industrial data. Define your tag hierarchy in JSON and generate realistic values using built-in functions or pull live data from Home Assistant.

> Built this for my own needs, but hopefully it's useful to someone else. Vibe coded and provided as-is.

## Features

- JSON-driven configuration for namespaces, folders, devices, and variables
- Multiple value source types for simulation
- Historical data access with aggregation support
- Historical alarms & conditions from a fixed set of event records
- Configurable server capabilities (session, subscription and monitored item limits)
- Username authentication with role based access control per part of the hierarchy
- Optional Home Assistant integration for real sensor data
- Docker support

## Quick Start

```bash
bun install
bun run server.ts examples/multi-source.json
```

Or, to start straight from a ready-made config:

```bash
bun run start:example
```

Ready-made configs live in [`examples/`](examples). Connect with any OPC UA client (e.g., UaExpert) at `opc.tcp://localhost:4840`

## Configuration

Create a JSON file defining your OPC UA hierarchy:

```json
{
  "namespaces": [
    {
      "id": 1,
      "name": "Simulation",
      "uri": "urn:example:simulation",
      "folders": [
        {
          "name": "Sensors",
          "devices": [
            {
              "name": "TemperatureSensor",
              "variables": [
                {
                  "name": "Temperature",
                  "type": "Double",
                  "minimumSamplingInterval": 1000,
                  "source": {
                    "type": "sinWave",
                    "amplitude": 5,
                    "frequency": 0.1,
                    "offset": 20
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Variable Types

`Boolean`, `DateTime`, `Double`, `Int32`, `String`

### Value Sources

| Type | Description | Key Parameters |
|------|-------------|----------------|
| `random` | Random values in range | `min`, `max` |
| `randomWalk` | Brownian motion within bounds | `min`, `max`, `stepSize` |
| `perlinNoise` | Smooth noise | `amplitude`, `frequency` |
| `sinWave` | Sine wave | `amplitude`, `frequency`, `phase`, `offset` |
| `squareWave` | Square wave | `amplitude`, `frequency`, `dutyCycle` |
| `triangleWave` | Triangle wave | `amplitude`, `frequency` |
| `sawtooth` | Sawtooth wave | `amplitude`, `frequency`, `rising` |
| `step` | Cycle through values | `values[]`, `interval`, `loop` |
| `homeAssistant` | Live Home Assistant entity | `entityId` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UA_PORT` | `4840` | Server port |
| `UA_RESOURCE_PATH` | `/` | Endpoint resource path |
| `UA_ALTERNATE_HOST` | `localhost` | Alternate hostname |
| `UA_PRODUCT_NAME` | `OPC UA Server` | Server product name |
| `HASS_URL` | - | Home Assistant URL |
| `HASS_PORT` | - | Home Assistant port |
| `HASS_TOKEN` | - | Home Assistant long-lived access token |
| `UA_ALLOW_ANONYMOUS` | `true` | Allow anonymous sessions |
| `UA_USERS` | - | Comma separated `username:password` pairs, replaces configured users |

See [Server Capabilities](#server-capabilities) for the limit related environment variables and
[Authentication](#authentication) for user configuration.

## Docker

```bash
docker build -t opcua-sim .
docker run -p 4840:4840 -v ./config.json:/usr/src/app/config/config.json opcua-sim
```

## Server Capabilities

Optional limits, published under `Server/ServerCapabilities` and enforced by the server. Set them in
the configuration file alongside `namespaces`:

```json
{
  "serverCapabilities": {
    "maxSessions": 20,
    "maxSubscriptions": 200,
    "maxMonitoredItems": 50000,
    "maxMonitoredItemsPerSubscription": 5000,
    "maxSubscriptionsPerSession": 5
  },
  "namespaces": [ ... ]
}
```

| Setting | Environment variable | Default |
|---------|----------------------|---------|
| `maxSessions` | `UA_MAX_SESSIONS` | `10` |
| `maxSubscriptions` | `UA_MAX_SUBSCRIPTIONS` | `100` |
| `maxMonitoredItems` | `UA_MAX_MONITORED_ITEMS` | `1000000` |
| `maxMonitoredItemsPerSubscription` | `UA_MAX_MONITORED_ITEMS_PER_SUBSCRIPTION` | `100000` |
| `maxSubscriptionsPerSession` | `UA_MAX_SUBSCRIPTIONS_PER_SESSION` | `10` |

Environment variables take precedence over the configuration file. Every value must be a positive
integer; invalid environment variables are ignored with a warning, while invalid or unknown settings
in the configuration file are rejected at startup.

## Authentication

By default the server accepts anonymous sessions and has no users, matching the previous behaviour.
Add a `security` block alongside `namespaces` to define users:

```json
{
  "security": {
    "allowAnonymous": false,
    "users": [
      { "username": "operator", "password": "s3cret", "role": "Operator" },
      { "username": "auditor", "passwordSha256": "2bb80d537b1d...", "role": "Observer" }
    ]
  },
  "namespaces": [ ... ]
}
```

Each user needs either `password` (plaintext) or `passwordSha256` (SHA-256 hex digest), never both.
Passwords are compared as digests in constant time, so a hash is preferable when the configuration
file is committed. `role` is optional and must be one of `AuthenticatedUser`, `ConfigureAdmin`,
`Engineer`, `Observer`, `Operator`, `SecurityAdmin` or `Supervisor`; every authenticated session
holds `AuthenticatedUser` in addition to its configured role.

| Setting | Environment variable | Default |
|---------|----------------------|---------|
| `allowAnonymous` | `UA_ALLOW_ANONYMOUS` | `true` |
| `users` | `UA_USERS` | none |

`UA_USERS` takes the form `alice:secret,bob:hunter2` and **replaces** the configured users rather
than adding to them. Only the first colon separates the pair, so passwords may contain colons, but
they cannot contain commas; use the configuration file for anything more involved. Roles cannot be
set through `UA_USERS`. Disabling anonymous access without any users is rejected at startup, since
nobody could connect.

> [!WARNING]
> On a `None` security policy endpoint, passwords are sent in clear text. Use a `Sign & Encrypt`
> endpoint when authentication matters.

### Restricting Access

Folders, devices and variables accept an optional `roles` list. A node with `roles` can only be
browsed and read by sessions holding one of those roles, and the restriction cascades to everything
below it unless a descendant declares its own `roles`:

```json
{
  "name": "Restricted",
  "roles": ["Operator"],
  "devices": [ ... ]
}
```

Nodes without `roles` anywhere above them stay readable by everyone, including anonymous sessions.
Use `Anonymous` in a list to grant access to unauthenticated sessions, and `AuthenticatedUser` to
grant it to any logged in user.

Denied nodes are hidden from browse results and return `BadUserAccessDenied` on read and history
read. Note that browse is resolved per node: a variable that widens access relative to its parent is
readable directly by node id, but cannot be reached by browsing through the restricted parent.

[`examples/secure.json`](examples/secure.json) demonstrates both, and can be started with
`bun run start:secure`.

## History & Aggregation

All variables support historical data access. Clients can request raw historical values or any of
the following aggregates:

| Aggregate | NodeId | Aggregate | NodeId |
|-----------|--------|-----------|--------|
| Interpolative | `i=2341` | DurationGood | `i=2360` |
| Average | `i=2342` | DurationBad | `i=2361` |
| Total | `i=2344` | StandardDeviationSample | `i=11426` |
| Minimum | `i=2346` | Count | `i=2352` |
| Maximum | `i=2347` | PercentGood | `i=2362` |
| Start | `i=2357` | PercentBad | `i=2363` |

`Total` is the time integral over the interval, expressed in value-seconds. `Total` and
`StandardDeviationSample` return `BadAggregateNotSupported` for non numeric variables, and `Start`
carries the previous value forward for them rather than interpolating.

## Historical Alarms & Conditions

The server can answer `HistoryRead` for events from a fixed set of records. No alarms are generated
and no conditions are evaluated - the history is read straight from JSON, in the same spirit as the
faked historical data above.

Declare the event types at the root of the configuration, then point a folder or device at one along
with a file of records:

```json
{
  "eventTypes": [
    {
      "name": "Process Alarms",
      "fields": [
        { "name": "Source", "type": "String" },
        { "name": "Message", "type": "String" },
        { "name": "Severity", "type": "Int32" },
        { "name": "ConditionName", "type": "String" }
      ]
    }
  ],
  "namespaces": [
    {
      "id": 1,
      "name": "Simulation",
      "uri": "urn:simulation:hac",
      "folders": [
        {
          "name": "Plant",
          "devices": [
            {
              "name": "FIC101",
              "eventType": "Process Alarms",
              "eventHistory": "alarms/fic101.json",
              "variables": []
            }
          ]
        }
      ]
    }
  ]
}
```

`eventHistory` is resolved relative to the configuration file and holds an array of records:

```json
[
  {
    "time": "2026-08-07T10:15:23.123Z",
    "fields": {
      "Source": "FIC101",
      "Message": "High flow",
      "Severity": 700,
      "ConditionName": "HI"
    }
  }
]
```

Field types are `Boolean`, `Int16`, `UInt16`, `Int32`, `UInt32`, `Float`, `Double`, `DateTime` and
`String`. Records are validated against the declared type at startup, so a typo fails fast rather
than producing an empty read.

### Reading the history

Events are readable at every level of the hierarchy. A parent returns everything beneath it, merged
into time order, so the Server object (`i=2253`) exposes the whole plant:

| Node | Returns |
|------|---------|
| `i=2253` | every configured source |
| `ns=2;s=Plant` | every source in that folder and below |
| `ns=2;s=FIC101` | that device only |

Each notifier publishes a `HistoricalEventFilter` property listing the fields it can return, which
is how clients such as UaExpert discover the configured fields. `EventId`, `EventType`, `SourceNode`,
`SourceName`, `Time` and `ReceiveTime` are always available; `SourceName` falls back to the browse
name of the originating node when it is not a configured field. A selected field the historian
cannot supply comes back as `BadNoData` rather than shifting the remaining fields along.

Where clauses support `Equals`, `LessThan`, `GreaterThan`, `LessThanOrEqual`, `GreaterThanOrEqual`,
`Like`, `Not`, `And`, `Or`, `InList`, `IsNull` and `OfType`. Anything else is rejected with
`BadEventFilterInvalid`. Results larger than `numValuesPerNode` are paged with continuation points,
capped at 16 outstanding points per session.

String comparison is **case-insensitive** throughout, including `Like` patterns. This deviates from
OPC UA, which defines `Equals` and `Like` as case-sensitive, and matches the `ci` behaviour of the
query language the server stands in for.

### getTotalRecords

A `HistoryManager` object exposes a `getTotalRecords` method that reports the time span the calling
session's most recent event read returned, which clients use to paginate:

```
Object: ns=2;s=HistoryManager
Method: ns=2;s=getTotalRecords
```

It takes no arguments and returns a string:

```xml
<HistoryReadResult><ReturnedRange><FirstTimestamp>2026-08-07T10:15:23.123Z</FirstTimestamp><LastTimestamp>2026-08-07T11:42:18.456Z</LastTimestamp></ReturnedRange></HistoryReadResult>
```

The string is empty when the session has not yet read any events, or when the last read returned
nothing.

`getTotalRecords` is not part of OPC UA. Set `historyManager` to `false` at the root of the
configuration to leave it out entirely, which is useful for testing a client against nothing but the
standard historical event services:

```json
{
  "historyManager": false,
  "eventTypes": [],
  "namespaces": []
}
```

Event history itself is unaffected - only the `HistoryManager` object and its method disappear.

## Acknowledgments

Home Assistant API client adapted from [node-home-assistant](https://github.com/AYapejian/node-home-assistant) by AYapejian.

## License

MIT - see [LICENSE](LICENSE).
