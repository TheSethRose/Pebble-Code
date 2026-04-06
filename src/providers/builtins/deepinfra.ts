import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("deepinfra", "DeepInfra", {
  envKeys: ["DEEPINFRA_API_KEY"],
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
  exampleModels: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "deepseek-ai/DeepSeek-V3.1",
  ],
});