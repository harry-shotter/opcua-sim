import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

interface EventData {
  [key: string]: unknown;
}

interface Event {
  event: string;
  listener_count: number;
}

class Events extends Request {
  /**
   * Get list of events
   * @see https://home-assistant.io/developers/rest_api/#get-apievents
   */
  list(): Promise<Event[]> {
    return this._get<Event[]>("/events");
  }

  /**
   * Fire an event
   * @see https://home-assistant.io/developers/rest_api/#post-apieventsltevent_type
   */
  fire(eventType: string, eventData?: EventData): Promise<void> {
    return this._post<void>(`/events/${eventType}`, null, eventData);
  }
}

export default function (apiConfig: ApiConfig): Events {
  return new Events(apiConfig);
}
