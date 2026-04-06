import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("google-gemini-cli", "Gemini CLI OAuth", {
  envKeys: ["GEMINI_CLI_TOKEN"],
  aliases: ["gemini-cli"],
  authKind: "oauth",
  help: "Pebble has cataloged Gemini CLI PKCE OAuth, but the built-in runtime still needs browser/device auth support.",
});