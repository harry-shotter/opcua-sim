import { OPCUAServer } from "node-opcua";
import { HomeAssistant } from "./src/home-assistant/HomeAssistant";
import ConfigureServer from "./src/ua-config/UaConfig";
import loadConfig from "./src/ua-config/ConfigLoader";
import resolveServerCapabilities from "./src/ua-config/ServerCapabilities";
import resolveSecurity from "./src/ua-config/UserManager";

let homeAssistant: HomeAssistant | undefined = undefined;

if (process.env.HASS_URL && process.env.HASS_PORT && process.env.HASS_TOKEN) {
  homeAssistant = new HomeAssistant({
    host: process.env.HASS_URL,
    port: parseInt(process.env.HASS_PORT),
    token: process.env.HASS_TOKEN,
    ignoreCert: false
  });

  console.info(
    "Home Assistant integration enabled",
    process.env.HASS_URL,
    process.env.HASS_PORT
  );
}

const configFile = process.argv[2];

if (!configFile) {
  throw new Error("No configuration file provided");
}

console.info("Loading configuration from", configFile);
const config = await loadConfig(configFile);
const security = resolveSecurity(config);

console.info(
  "Authentication:",
  security.allowAnonymous ? "anonymous allowed" : "anonymous denied",
  security.users.length > 0
    ? `- ${security.users.length} configured user(s)`
    : "- no configured users"
);

const server = new OPCUAServer({
  port: tryGetPort(4840),
  resourcePath: process.env.UA_RESOURCE_PATH ?? "/",
  alternateHostname: process.env.UA_ALTERNATE_HOST ?? "localhost",
  serverCapabilities: resolveServerCapabilities(config),
  allowAnonymous: security.allowAnonymous,
  userManager: security.userManager,
  buildInfo: {
    productName: process.env.UA_PRODUCT_NAME ?? "OPC UA Server",
    buildNumber: "1",
    buildDate: new Date()
  }
});

await server.initialize();
console.info("Initialized server");

await ConfigureServer(config, server, homeAssistant);

server.start(function () {
  console.info("Server is now listening ... ( press CTRL+C to stop)");
  console.info("port ", server.endpoints[0].port);
  const endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
  console.info(" the primary server endpoint url is ", endpointUrl);
});

function tryGetPort(fallback: number): number {
  const parsedPort = parseInt(process.env.UA_PORT ?? "");

  if (isNaN(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    console.warn("Invalid port number, falling back to default port");
    return fallback;
  }

  return parsedPort;
}
