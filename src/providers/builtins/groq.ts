import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("groq", "Groq", {
  envKeys: ["GROQ_API_KEY"],
  defaultModel: "llama-3.3-70b-versatile",
  defaultBaseUrl: "https://api.groq.com/openai/v1",
  exampleModels: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
});