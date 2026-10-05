import * as sdk from "@immich/sdk";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";

export type ImmichSdk = typeof sdk;

/** Initialises the shared `@immich/sdk` client from the application config. */
export function initImmich(config: AppConfig): void {
  sdk.setBaseUrl(config.baseUrl);

  if (config.apiKey) {
    sdk.setApiKey(config.apiKey);
  }
  if (config.accessToken) {
    sdk.setHeader("Authorization", `Bearer ${config.accessToken}`);
  }
  if (Object.keys(config.headers).length > 0) {
    sdk.setHeaders(config.headers);
  }

  logger.debug("Initialised Immich SDK", {
    baseUrl: config.baseUrl,
    auth: config.apiKey ? "api-key" : "access-token",
  });
}

export { sdk };
