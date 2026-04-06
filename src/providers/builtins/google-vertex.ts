import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("google-vertex", "Google Vertex AI", {
  envKeys: ["GOOGLE_APPLICATION_CREDENTIALS"],
  additionalEnvKeys: ["GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION"],
  authKind: "cloud-credentials",
  help: "Pebble has cataloged Google Vertex AI, but the built-in runtime still needs ADC/service-account auth and Vertex-specific request handling.",
});