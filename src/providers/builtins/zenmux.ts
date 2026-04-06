import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("zenmux", "ZenMux", {
  envKeys: ["ZENMUX_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged ZenMux, but the built-in runtime still needs a verified provider-specific endpoint/default-model path and dedicated failure messaging.",
});