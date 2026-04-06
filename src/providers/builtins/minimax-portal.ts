import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("minimax-portal", "MiniMax Portal", {
  envKeys: ["MINIMAX_PORTAL_TOKEN"],
  authKind: "oauth",
  help: "Pebble has cataloged MiniMax Portal OAuth, but the built-in runtime still needs portal-auth session handling.",
});