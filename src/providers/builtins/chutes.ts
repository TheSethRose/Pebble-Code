import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("chutes", "Chutes", {
  envKeys: ["CHUTES_API_KEY", "CHUTES_ACCESS_TOKEN"],
  additionalAuthKinds: ["oauth"],
  authKind: "api-key",
  help: "Pebble has cataloged Chutes, but the built-in runtime still needs dual OAuth/API-key auth handling plus provider-specific transport wiring and token-refresh behavior.",
});