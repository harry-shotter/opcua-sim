# OPC UA Simulation Server

A configurable OPC UA server for simulating industrial data. Define your tag hierarchy in JSON and generate realistic values using built-in functions or pull live data from Home Assistant.

> Built this for my own needs, but hopefully it's useful to someone else. Vibe coded and provided as-is.

## Features

- JSON-driven configuration for namespaces, folders, devices, and variables
- Multiple value source types for simulation
- Historical data access with aggregation support
- Configurable server capabilities (session, subscription and monitored item limits)
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

See [Server Capabilities](#server-capabilities) for the limit related environment variables.

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

## Acknowledgments

Home Assistant API client adapted from [node-home-assistant](https://github.com/AYapejian/node-home-assistant) by AYapejian.

## License

MIT - see [LICENSE](LICENSE).
