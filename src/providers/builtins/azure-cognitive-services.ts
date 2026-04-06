import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("azure-cognitive-services", "Azure Cognitive Services", {
  envKeys: ["AZURE_COGNITIVE_SERVICES_API_KEY"],
  authKind: "api-key",
  help: "Pebble has cataloged Azure Cognitive Services, but the built-in runtime still needs the Azure resource-specific request path.",
});