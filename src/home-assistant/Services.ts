import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

interface ServiceData {
  entity_id?: string;
  [key: string]: unknown;
}

interface Service {
  domain: string;
  services: Record<string, { name: string; description: string }>;
}

class Services extends Request {
  list(): Promise<Service[]> {
    return this._get<Service[]>("/services");
  }

  call(
    service: string,
    domain: string,
    serviceData?: string | ServiceData
  ): Promise<void> {
    let data: ServiceData | undefined = undefined;

    if (typeof serviceData === "string") {
      if (!serviceData.startsWith(`${domain}.`)) {
        serviceData = `${domain}.${serviceData}`;
      }
      data = {
        entity_id: serviceData
      };
    } else {
      data = serviceData;
    }

    return this._post<void>(`/services/${domain}/${service}`, null, data);
  }
}

export default function (apiConfig: ApiConfig): Services {
  return new Services(apiConfig);
}
