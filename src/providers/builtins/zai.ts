import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("zai", "Z.AI", {
  envKeys: ["ZAI_API_KEY"],
  defaultModel: "zai/glm-5",
  defaultBaseUrl: "https://api.z.ai/api/paas/v4",
  aliases: ["glm"],
  exampleModels: ["zai/glm-5", "zai/glm-5.1", "zai/glm-4.7"],
  help: "Pebble defaults to the Z.AI global endpoint. Switch base URL manually for CN or coding-plan surfaces until automatic endpoint detection exists.",
});