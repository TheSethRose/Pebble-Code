import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("azure-cognitive-services", "Azure Cognitive Services", {
  envKeys: ["AZURE_COGNITIVE_SERVICES_API_KEY"],
  additionalEnvKeys: ["AZURE_COGNITIVE_SERVICES_ENDPOINT", "AZURE_COGNITIVE_SERVICES_RESOURCE"],
  authKind: "api-key",
  baseUrlEnvKeys: ["AZURE_COGNITIVE_SERVICES_BASE_URL", "AZURE_COGNITIVE_SERVICES_ENDPOINT"],
  requiresBaseUrl: true,
  help: "Pebble has cataloged Azure Cognitive Services, but the built-in runtime still needs resource-specific endpoint handling instead of the shared OpenAI-compatible request path.",
});