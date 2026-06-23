import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { type ApiConfig } from "./HomeAssistant";

export type QueryParams = Record<string, string | number | boolean>;

class Request {
  private apiConfig: ApiConfig;

  constructor(apiConfig?: ApiConfig) {
    this.apiConfig = apiConfig || ({} as ApiConfig);
  }

  protected _get<T>(
    path: string,
    queryParams?: QueryParams | null
  ): Promise<T> {
    return this._request<T>("GET", path, queryParams);
  }

  protected _post<T>(
    path: string,
    queryParams?: QueryParams | null,
    body?: unknown
  ): Promise<T> {
    return this._request<T>("POST", path, queryParams, body);
  }

  private _request<T>(
    method: "GET" | "POST",
    path: string,
    queryParams?: QueryParams | null,
    body?: unknown
  ): Promise<T> {
    const options: AxiosRequestConfig = {
      method,
      url: `${this.apiConfig.base}/api${path}`,
      headers: {},
      timeout: 30000
    };

    options.headers = {
      "Content-Type": "application/json"
    } as Record<string, string>;

    if (this.apiConfig.rejectUnauthorized !== undefined) {
      options.httpsAgent = {
        rejectUnauthorized: this.apiConfig.rejectUnauthorized
      };
    }

    if (queryParams) options.params = queryParams;

    if (typeof this.apiConfig.token === "string") {
      options.headers["authorization"] = `Bearer ${this.apiConfig.token}`;
    } else if (this.apiConfig.password) {
      options.headers["x-ha-access"] = this.apiConfig.password;
    }

    if (method !== "GET" && body !== undefined) {
      if (typeof body === "object" && !Array.isArray(body)) {
        options.data = body;
      } else if (typeof body === "string") {
        try {
          options.data = JSON.parse(body);
        } catch (e) {
          return Promise.reject(new Error("Invalid JSON provided."));
        }
      } else {
        return Promise.reject(new Error("Invalid JSON provided."));
      }
    }

    return axios(options).then((response: AxiosResponse<T>) => response.data);
  }
}

export default Request;
