import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("together", "Together AI", {
  envKeys: ["TOGETHER_API_KEY"],
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  defaultBaseUrl: "https://api.together.xyz/v1",
  exampleModels: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "deepseek-ai/DeepSeek-V3",
  ],
});