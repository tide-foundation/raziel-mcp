import { readFileSync } from "fs";
import { join } from "path";

// Playbook: protect-api-nextjs Step 1
export interface TidecloakConfig {
  realm: string;
  "auth-server-url": string;
  "ssl-required": string;
  resource: string;
  "public-client": boolean;
  "confidential-port": number;
  jwk: { keys: any[] }; // Tide extension: embedded JWKS
  vendorId?: string;
  homeOrkUrl?: string;
}

export function loadTideConfig(): TidecloakConfig {
  if (process.env.CLIENT_ADAPTER) {
    return JSON.parse(process.env.CLIENT_ADAPTER);
  }

  const configPath = join(process.cwd(), "data", "tidecloak.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  if (!config.jwk) {
    throw new Error(
      "Adapter JSON missing jwk field. " +
        "Export via Tide endpoint (providerId=keycloak-oidc-keycloak-json). " +
        "The jwk field is only present when IGA is enabled on the realm."
    );
  }

  return config;
}
