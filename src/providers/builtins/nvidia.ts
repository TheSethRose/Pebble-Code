import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("nvidia", "NVIDIA", {
  envKeys: ["NVIDIA_API_KEY"],
  defaultModel: "meta/llama-3.3-70b-instruct",
  defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
  exampleModels: ["meta/llama-3.3-70b-instruct", "mistralai/mistral-large"],
});