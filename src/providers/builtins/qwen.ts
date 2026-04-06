import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("qwen", "Qwen / Model Studio", {
  envKeys: ["QWEN_API_KEY", "MODELSTUDIO_API_KEY", "DASHSCOPE_API_KEY"],
  defaultModel: "qwen/qwen3.5-plus",
  defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  aliases: ["model-studio"],
  exampleModels: ["qwen/qwen3.5-plus", "qwen/qwen3-coder-plus"],
  help: "Pebble defaults to the global Model Studio endpoint. Override the base URL for China-region or coding-specific endpoints if needed.",
});