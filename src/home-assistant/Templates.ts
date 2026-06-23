import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

interface TemplateRequest {
  template: string;
}

class Templates extends Request {
  render(template: string | TemplateRequest): Promise<string> {
    const templateData: TemplateRequest =
      typeof template === "string" ? { template } : template;

    return this._post<string>("/template", null, templateData);
  }
}

export default function (apiConfig: ApiConfig): Templates {
  return new Templates(apiConfig);
}
