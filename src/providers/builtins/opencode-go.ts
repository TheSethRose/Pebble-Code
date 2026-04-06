import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("opencode-go", "OpenCode Go", {
  envKeys: ["OPENCODE_API_KEY"],
  defaultModel: "opencode-go/kimi-k2.5",
  exampleModels: ["opencode-go/kimi-k2.5"],
  authKind: "api-key",
  help: "Pebble has cataloged OpenCode Go, but the built-in runtime still needs the provider-specific catalog/routing path while keeping its shared credential separate from the main OpenCode surface.",
});