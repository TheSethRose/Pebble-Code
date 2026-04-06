import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("cloudflare-workers-ai", "Cloudflare Workers AI", {
  envKeys: ["CLOUDFLARE_API_KEY"],
  additionalEnvKeys: ["CLOUDFLARE_ACCOUNT_ID"],
  authKind: "api-key",
  help: "Pebble has cataloged Cloudflare Workers AI, but the built-in runtime still needs account-aware Cloudflare request handling and explicit account-id routing.",
});