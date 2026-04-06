import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("openai", "OpenAI", {
  envKeys: ["OPENAI_API_KEY"],
  defaultModel: "gpt-4o-mini",
  defaultBaseUrl: "https://api.openai.com/v1",
  exampleModels: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
});