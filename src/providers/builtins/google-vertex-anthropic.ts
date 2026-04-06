import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("google-vertex-anthropic", "Anthropic on Vertex", {
  envKeys: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION"],
  authKind: "cloud-credentials",
  help: "Pebble has cataloged Anthropic on Vertex, but the built-in runtime still needs both Vertex auth and Anthropic-specific request mapping.",
});