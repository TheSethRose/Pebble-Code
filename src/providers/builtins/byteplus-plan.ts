import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("byteplus-plan", "BytePlus Plan", {
  envKeys: ["BYTEPLUS_API_KEY"],
  defaultModel: "byteplus-plan/ark-code-latest",
  exampleModels: ["byteplus-plan/ark-code-latest"],
  authKind: "api-key",
  help: "Pebble has cataloged BytePlus Plan, but the built-in runtime still needs the separate coding-plan endpoint/model path and provider-specific routing defaults.",
});