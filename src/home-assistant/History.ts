import Request from "./Request";
import { type QueryParams } from "./Request"; // Import the interface
import { type ApiConfig } from "./HomeAssistant";

interface StateHistory {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

class History extends Request {
  period(
    timestamp: Date,
    filterEntityId: string,
    endTime?: Date,
    minimalResponse?: boolean,
    noAttributes?: boolean,
    significantChangesOnly?: boolean
  ): Promise<StateHistory[][]> {
    const queryParams: QueryParams = {};

    if (filterEntityId) queryParams.filter_entity_id = filterEntityId;
    if (endTime) queryParams.end_time = endTime.toISOString();
    if (minimalResponse) queryParams.minimal_response = minimalResponse;
    if (noAttributes) queryParams.no_attributes = noAttributes;
    if (significantChangesOnly)
      queryParams.significant_changes_only = significantChangesOnly;

    return this._get<StateHistory[][]>(
      `/history/period/${timestamp.toISOString()}`,
      queryParams
    );
  }
}

export default function (apiConfig: ApiConfig): History {
  return new History(apiConfig);
}
