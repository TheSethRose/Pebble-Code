import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("deepseek", "DeepSeek", {
  envKeys: ["DEEPSEEK_API_KEY"],
  defaultModel: "deepseek-chat",
  defaultBaseUrl: "https://api.deepseek.com/v1",
  exampleModels: ["deepseek-chat", "deepseek-reasoner"],
});