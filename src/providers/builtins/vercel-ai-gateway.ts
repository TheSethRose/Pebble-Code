import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("vercel-ai-gateway", "Vercel AI Gateway", {
  envKeys: ["AI_GATEWAY_API_KEY"],
  authKind: "gateway",
  help: "Pebble has cataloged Vercel AI Gateway, but the built-in runtime still needs gateway-specific auth/header handling and failure isolation.",
});