import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("azure", "Azure OpenAI", {
  envKeys: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_TOKEN"],
  aliases: ["azure-openai"],
  authKind: "cloud-credentials",
  help: "Pebble has cataloged Azure OpenAI, but the built-in runtime still needs Azure endpoint/auth handling beyond a plain OpenAI-compatible base URL swap.",
});