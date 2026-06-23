import Request from "./Request";
import { type ApiConfig } from "./HomeAssistant";

class Camera extends Request {
  /**
   * Gets the camera image for a specific entity
   * @see https://home-assistant.io/developers/rest_api/#get-apicamera_proxycameraltentity_id
   * @param entityId - The ID of the camera entity
   * @returns Promise containing the camera image data
   */
  image(entityId: string): Promise<ArrayBuffer> {
    return this._get<ArrayBuffer>(`/camera_proxy/camera.${entityId}`);
  }
}

// Factory function to create a new Camera instance
export default function (apiConfig: ApiConfig): Camera {
  return new Camera(apiConfig);
}
