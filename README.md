# OPC UA Simulation Server

A configurable OPC UA server for simulating industrial data. Define your tag hierarchy in JSON and generate realistic values using built-in functions or pull live data from Home Assistant.

> Built this for my own needs, but hopefully it's useful to someone else. Vibe coded and provided as-is.

## Features

- JSON-driven configuration for namespaces, folders, devices, and variables
- Multiple value source types for simulation
- Historical data access with aggregation support (Interpolative, Min, Max, Average)
- Optional Home Assistant integration for real sensor data
- Docker support

## Quick Start

```bash
bun install
bun run server.ts examples/multi-source.json
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

## Docker

```bash
docker build -t opcua-sim .
docker run -p 4840:4840 -v ./config.json:/usr/src/app/config/config.json opcua-sim
```

## History & Aggregation

All variables support historical data access. Clients can request:
- Raw historical values
- Aggregated values: Interpolative, Minimum, Maximum, Average

## Acknowledgments

Home Assistant API client adapted from [node-home-assistant](https://github.com/AYapejian/node-home-assistant) by AYapejian.

## License

MIT - see [LICENSE](LICENSE).
