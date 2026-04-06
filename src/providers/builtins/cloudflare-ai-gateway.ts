import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("cloudflare-ai-gateway", "Cloudflare AI Gateway", {
  envKeys: ["CLOUDFLARE_API_TOKEN", "CF_AIG_TOKEN", "CLOUDFLARE_AI_GATEWAY_API_KEY"],
  additionalEnvKeys: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AI_GATEWAY_ID"],
  authKind: "gateway",
  help: "Pebble has cataloged Cloudflare AI Gateway, but the built-in runtime still needs composite gateway + upstream-provider auth/header handling, including authenticated gateway headers when required.",
});