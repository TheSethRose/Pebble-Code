import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("vllm", "vLLM", {
  envKeys: ["VLLM_API_KEY"],
  authKind: "local-url",
  defaultApiKey: "vllm-local",
  defaultModel: "local-model",
  defaultBaseUrl: "http://localhost:8000/v1",
  requiresApiKey: false,
  exampleModels: ["local-model"],
});