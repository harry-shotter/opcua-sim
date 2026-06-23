import Camera from "./Camera";
import Config from "./Config";
import Events from "./Events";
import History from "./History";
import Logs from "./Logs";
import Services from "./Services";
import States from "./States";
import Templates from "./Templates";

export interface AuthConfig {
  host?: string;
  port?: number;
  password?: string;
  ignoreCert?: boolean;
  token?: string;
}

export interface ApiConfig {
  base: string;
  password?: string;
  rejectUnauthorized: boolean;
  token?: string;
}

export class HomeAssistant {
  public readonly camera: ReturnType<typeof Camera>;
  public readonly config: ReturnType<typeof Config>;
  public readonly events: ReturnType<typeof Events>;
  public readonly history: ReturnType<typeof History>;
  public readonly logs: ReturnType<typeof Logs>;
  public readonly services: ReturnType<typeof Services>;
  public readonly states: ReturnType<typeof States>;
  public readonly templates: ReturnType<typeof Templates>;

  constructor(auth?: AuthConfig) {
    const config = this.createApiConfig(auth);

    this.camera = Camera(config);
    this.config = Config(config);
    this.events = Events(config);
    this.history = History(config);
    this.logs = Logs(config);
    this.services = Services(config);
    this.states = States(config);
    this.templates = Templates(config);
  }

  private createApiConfig(auth: AuthConfig = {}): ApiConfig {
    const host = auth.host || "http://localhost";
    const port = auth.port || 8123;

    const config: ApiConfig = {
      base: `${host}:${port}`,
      password: auth.password,
      rejectUnauthorized: !auth.ignoreCert
    };

    if ("token" in auth) {
      config.token = auth.token;
    }

    return config;
  }
}

export { Camera, Config, Events, History, Logs, Services, States, Templates };
