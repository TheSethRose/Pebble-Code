import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("huggingface", "Hugging Face", {
  envKeys: ["HUGGINGFACE_HUB_TOKEN", "HF_TOKEN"],
  defaultModel: "huggingface/deepseek-ai/DeepSeek-R1",
  defaultBaseUrl: "https://router.huggingface.co/v1",
  aliases: ["hf"],
  exampleModels: [
    "huggingface/deepseek-ai/DeepSeek-R1",
    "huggingface/Qwen/Qwen3-8B",
    "huggingface/meta-llama/Llama-3.3-70B-Instruct",
  ],
  help: "Hugging Face can also discover models from /v1/models when a valid token is configured; Pebble seeds a static fallback list until live smoke tests are added.",
});