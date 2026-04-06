import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("cerebras", "Cerebras", {
  envKeys: ["CEREBRAS_API_KEY"],
  defaultModel: "llama-3.3-70b",
  defaultBaseUrl: "https://api.cerebras.ai/v1",
  exampleModels: ["llama-3.3-70b", "qwen-3-coder-480b"],
});