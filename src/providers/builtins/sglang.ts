import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("sglang", "SGLang", {
  envKeys: ["SGLANG_API_KEY"],
  authKind: "local-url",
  defaultApiKey: "sglang-local",
  defaultModel: "local-model",
  defaultBaseUrl: "http://localhost:30000/v1",
  requiresApiKey: false,
  exampleModels: ["local-model"],
});