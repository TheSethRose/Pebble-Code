import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("volcengine-plan", "Volcengine Plan", {
  envKeys: ["VOLCANO_ENGINE_API_KEY"],
  defaultModel: "volcengine-plan/ark-code-latest",
  defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
  exampleModels: ["volcengine-plan/ark-code-latest"],
  help: "Volcengine Plan uses the separate coding endpoint; live smoke tests are still pending.",
});