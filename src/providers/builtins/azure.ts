import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("azure", "Azure OpenAI", {
  envKeys: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_TOKEN"],
  additionalAuthKinds: ["cloud-credentials"],
  additionalEnvKeys: ["AZURE_OPENAI_ENDPOINT"],
  aliases: ["azure-openai"],
  authKind: "api-key",
  baseUrlEnvKeys: ["AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT"],
  requiresBaseUrl: true,
  help: "Pebble has cataloged Azure OpenAI, but the built-in runtime still needs Azure endpoint routing and API-key/Entra-aware auth handling beyond a plain OpenAI-compatible base URL swap.",
});