import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("opencode", "OpenCode", {
  envKeys: ["OPENCODE_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged OpenCode, but the built-in runtime still needs the provider-specific catalog/routing path and configured-vs-paid model availability handling.",
});