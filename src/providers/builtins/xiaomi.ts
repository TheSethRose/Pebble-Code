import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("xiaomi", "Xiaomi", {
  envKeys: ["XIAOMI_API_KEY"],
  defaultModel: "xiaomi/mimo-v2-flash",
  defaultBaseUrl: "https://api.xiaomimimo.com/v1",
  exampleModels: [
    "xiaomi/mimo-v2-flash",
    "xiaomi/mimo-v2-pro",
    "xiaomi/mimo-v2-omni",
  ],
  help: "Xiaomi MiMo is wired through its documented OpenAI-compatible /v1 endpoint. Live credential smoke tests are still pending.",
});