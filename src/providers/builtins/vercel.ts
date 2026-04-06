import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("vercel", "Vercel AI", {
  envKeys: ["VERCEL_API_KEY"],
  aliases: ["vercel-ai"],
  authKind: "api-key",
  help: "Pebble has cataloged Vercel AI, but the built-in runtime still needs provider-specific gateway/header behavior and dedicated runtime selection tests.",
});