import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("mistral", "Mistral", {
  envKeys: ["MISTRAL_API_KEY"],
  defaultModel: "mistral-large-latest",
  defaultBaseUrl: "https://api.mistral.ai/v1",
  exampleModels: ["mistral-large-latest", "ministral-8b-latest"],
});