import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("volcengine", "Volcengine", {
  envKeys: ["VOLCANO_ENGINE_API_KEY"],
  defaultModel: "volcengine/doubao-seed-1.6",
  defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  aliases: ["doubao"],
  exampleModels: ["volcengine/doubao-seed-1.6", "volcengine/doubao-vision-pro-32k"],
});