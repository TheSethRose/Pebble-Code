import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("ollama", "Ollama", {
  envKeys: ["OLLAMA_API_KEY"],
  authKind: "local-url",
  defaultApiKey: "ollama-local",
  defaultModel: "llama3.2",
  defaultBaseUrl: "http://localhost:11434/v1",
  requiresApiKey: false,
  exampleModels: ["llama3.2", "qwen2.5-coder:7b"],
  aliases: ["ollama-local"],
  help: "Local Ollama runs typically use a URL-only setup; Pebble seeds the conventional local marker key when no explicit credential is configured.",
});