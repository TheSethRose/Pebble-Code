import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("opencode-go", "OpenCode Go", {
  envKeys: ["OPENCODE_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged OpenCode Go, but the built-in runtime still needs the provider-specific catalog/routing path.",
});