import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("sap-ai-core", "SAP AI Core", {
  envKeys: ["AICORE_SERVICE_KEY"],
  authKind: "service-key",
  help: "Pebble has cataloged SAP AI Core, but the built-in runtime still needs service-key parsing and enterprise deployment routing.",
});