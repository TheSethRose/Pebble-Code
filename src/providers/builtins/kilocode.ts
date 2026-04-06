import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("kilocode", "Kilocode", {
  envKeys: ["KILOCODE_API_KEY"],
  defaultModel: "kilocode/kilo/auto",
  defaultBaseUrl: "https://api.kilo.ai/api/gateway",
  exampleModels: ["kilocode/kilo/auto"],
  help: "Kilocode is wired through its OpenAI-compatible smart router. Upstream-model reporting and live smoke tests are still pending.",
});