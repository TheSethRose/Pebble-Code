import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("openai-codex", "OpenAI Codex / ChatGPT OAuth", {
  envKeys: ["OPENAI_CODEX_TOKEN", "CHATGPT_TOKEN"],
  aliases: ["codex"],
  authKind: "oauth",
  help: "Pebble has cataloged the ChatGPT/Codex OAuth path, but the built-in runtime currently only supports API-key OpenAI transport and still needs a browser/device OAuth adapter.",
});