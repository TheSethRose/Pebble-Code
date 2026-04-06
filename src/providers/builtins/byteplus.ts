import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("byteplus", "BytePlus", {
  envKeys: ["BYTEPLUS_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged BytePlus, but the built-in runtime still needs a verified provider-specific endpoint/default-model path.",
});