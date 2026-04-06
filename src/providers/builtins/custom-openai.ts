import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("custom-openai", "Custom OpenAI-Compatible Endpoint", {
  envKeys: ["CUSTOM_OPENAI_API_KEY", "CUSTOMOAI_API_KEY"],
  modelEnvKeys: ["CUSTOM_OPENAI_MODEL", "CUSTOMOAI_MODEL"],
  baseUrlEnvKeys: ["CUSTOM_OPENAI_BASE_URL", "CUSTOMOAI_BASE_URL"],
  aliases: ["customoai", "custom-openai-endpoint"],
  requiresBaseUrl: true,
  exampleModels: ["custom/model"],
  help: "Set the OpenAI-compatible API root URL (usually ending in /v1) plus model metadata to route Pebble through another endpoint. Do not paste a full /chat/completions URL.",
});