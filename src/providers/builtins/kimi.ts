import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("kimi", "Kimi", {
  envKeys: ["KIMI_API_KEY"],
  aliases: ["kimi-coding"],
  authKind: "api-key",
  help: "Pebble catalogs Kimi Coding, but the mirrored source describes it as a separate Anthropic-compatible provider path rather than an OpenAI-compatible one, so it should stay distinct from Moonshot.",
});