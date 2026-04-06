import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("litellm", "LiteLLM", {
  envKeys: ["LITELLM_API_KEY", "LITELLM_MASTER_KEY"],
  authKind: "local-url",
  defaultApiKey: "litellm-local",
  defaultModel: "gpt-4o-mini",
  defaultBaseUrl: "http://localhost:4000/v1",
  requiresApiKey: false,
  exampleModels: ["gpt-4o-mini", "claude-3-7-sonnet"],
});