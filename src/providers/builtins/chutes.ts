import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("chutes", "Chutes", {
  envKeys: ["CHUTES_API_KEY", "CHUTES_ACCESS_TOKEN"],
  authKind: "oauth",
  help: "Pebble has cataloged Chutes, but the built-in runtime still needs dual OAuth/API-key auth handling and provider-specific transport wiring.",
});