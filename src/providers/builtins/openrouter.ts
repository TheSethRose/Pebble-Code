import {
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  OPENROUTER_PROVIDER_LABEL,
} from "../../constants/openrouter.js";
import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible(OPENROUTER_PROVIDER_ID, OPENROUTER_PROVIDER_LABEL, {
  envKeys: ["OPENROUTER_API_KEY", "PEBBLE_API_KEY"],
  modelEnvKeys: ["OPENROUTER_MODEL", "PEBBLE_MODEL"],
  baseUrlEnvKeys: ["OPENROUTER_BASE_URL", "PEBBLE_API_BASE"],
  defaultModel: OPENROUTER_DEFAULT_MODEL,
  defaultBaseUrl: OPENROUTER_DEFAULT_BASE_URL,
  exampleModels: [
    OPENROUTER_DEFAULT_MODEL,
    "anthropic/claude-sonnet-4.6",
    "openai/gpt-4.1-mini",
  ],
  requestHeaders: {
    "HTTP-Referer": "https://github.com/TheSethRose/Pebble-Code",
    "X-Title": "Pebble Code",
  },
  aliases: ["or"],
});