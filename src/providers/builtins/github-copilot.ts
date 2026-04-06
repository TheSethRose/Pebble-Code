import {
  buildCopilotRequestHeaders,
  DEFAULT_COPILOT_API_BASE_URL,
} from "../../constants/githubCopilot.js";
import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("github-copilot", "GitHub Copilot", {
  envKeys: [
    "COPILOT_GITHUB_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_COPILOT_TOKEN",
    "COPILOT_TOKEN",
  ],
  aliases: ["copilot"],
  authKind: "oauth",
  defaultModel: "gpt-4o",
  defaultBaseUrl: DEFAULT_COPILOT_API_BASE_URL,
  requiresApiKey: false,
  exampleModels: [
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-codex",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.4",
  ],
  requestHeaders: buildCopilotRequestHeaders(),
  help: "Pebble supports GitHub.com device-flow login plus Copilot token exchange. Live smoke tests are still pending, and GitHub Enterprise / proxy bridge modes remain follow-up work.",
});