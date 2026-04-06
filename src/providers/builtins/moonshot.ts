import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("moonshot", "Moonshot", {
  envKeys: ["MOONSHOT_API_KEY"],
  defaultModel: "moonshot/kimi-k2.5",
  defaultBaseUrl: "https://api.moonshot.ai/v1",
  exampleModels: [
    "moonshot/kimi-k2.5",
    "moonshot/kimi-k2-thinking",
    "moonshot/kimi-k2-turbo",
  ],
  help: "Pebble currently wires the Moonshot OpenAI-compatible surface only. Kimi Coding remains a separate Anthropic-compatible path.",
});