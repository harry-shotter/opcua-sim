import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

interface StateData {
  state: string;
  attributes?: Record<string, unknown>;
}

interface State extends StateData {
  entity_id: string;
  last_changed: string;
  last_updated: string;
}

class States extends Request {
  list(): Promise<State[]> {
    return this._get<State[]>("/states");
  }

  get(entityId: string): Promise<State> {
    return this._get<State>(`/states/${entityId}`);
  }

  update(entityId: string, stateData: StateData): Promise<State> {
    return this._post<State>(`/states/${entityId}`, null, stateData);
  }
}

export default function (apiConfig: ApiConfig): States {
  return new States(apiConfig);
}
