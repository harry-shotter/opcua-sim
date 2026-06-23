import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

// Interfaces for the response types
interface StatusResponse {
  message: string;
  api_version: string;
}

interface ConfigResponse {
  components: string[];
  config_dir: string;
  elevation: number;
  latitude: number;
  longitude: number;
  location_name: string;
  time_zone: string;
  unit_system: {
    length: string;
    mass: string;
    temperature: string;
    volume: string;
  };
  version: string;
}

interface DiscoveryInfoResponse {
  base_url: string;
  location_name: string;
  requires_api_password: boolean;
  version: string;
}

interface BootstrapResponse {
  config: ConfigResponse;
  states: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  services: Array<Record<string, unknown>>;
}

class Config extends Request {
  /**
   * Get the API status
   * @see https://home-assistant.io/developers/rest_api/#get-api
   */
  status(): Promise<StatusResponse> {
    return this._get<StatusResponse>("/");
  }

  /**
   * Get the current configuration
   * @see https://home-assistant.io/developers/rest_api/#get-apiconfig
   */
  config(): Promise<ConfigResponse> {
    return this._get<ConfigResponse>("/config");
  }

  /**
   * Get discovery information
   * @see https://home-assistant.io/developers/rest_api/#get-apidiscovery_info
   */
  discoveryInfo(): Promise<DiscoveryInfoResponse> {
    return this._get<DiscoveryInfoResponse>("/discovery_info");
  }

  /**
   * Get bootstrap information
   * @see https://home-assistant.io/developers/rest_api/#get-apibootstrap
   */
  bootstrap(): Promise<BootstrapResponse> {
    return this._get<BootstrapResponse>("/bootstrap");
  }
}

// Factory function to create a new Config instance
export default function (apiConfig: ApiConfig): Config {
  return new Config(apiConfig);
}
