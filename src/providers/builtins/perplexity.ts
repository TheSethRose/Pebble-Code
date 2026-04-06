import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("perplexity", "Perplexity", {
  envKeys: ["PERPLEXITY_API_KEY"],
  defaultModel: "sonar",
  defaultBaseUrl: "https://api.perplexity.ai",
  exampleModels: ["sonar", "sonar-pro"],
});