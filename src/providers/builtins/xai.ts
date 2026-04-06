import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("xai", "xAI", {
  envKeys: ["XAI_API_KEY"],
  defaultModel: "grok-2-latest",
  defaultBaseUrl: "https://api.x.ai/v1",
  exampleModels: ["grok-2-latest", "grok-beta"],
});