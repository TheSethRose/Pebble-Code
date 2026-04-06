import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("kilo", "Kilo", {
  envKeys: ["KILO_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Kilo, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
});