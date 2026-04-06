import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("venice", "Venice", {
  envKeys: ["VENICE_API_KEY"],
  defaultModel: "venice/kimi-k2-5",
  defaultBaseUrl: "https://api.venice.ai/api/v1",
  exampleModels: [
    "venice/kimi-k2-5",
    "venice/claude-opus-4-6",
    "venice/qwen3-coder-480b-a35b-instruct",
  ],
  help: "Venice is wired through its documented OpenAI-compatible /api/v1 endpoint. The mirrored docs note that some models disable tools or have provider-specific max-token quirks, so live smoke tests are still pending.",
});