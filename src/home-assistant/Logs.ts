import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

class Logs extends Request {
  /**
   * Get error logs
   * @see https://home-assistant.io/developers/rest_api/#get-apierror_log
   */
  errors(): Promise<string> {
    return this._get<string>("/error_log");
  }
}

export default function (apiConfig: ApiConfig): Logs {
  return new Logs(apiConfig);
}
