import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("byteplus-plan", "BytePlus Plan", {
  envKeys: ["BYTEPLUS_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged BytePlus Plan, but the built-in runtime still needs the separate coding-plan endpoint/model path.",
});