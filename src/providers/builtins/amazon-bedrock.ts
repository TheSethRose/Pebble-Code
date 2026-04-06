import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("amazon-bedrock", "Amazon Bedrock", {
  envKeys: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK"],
  aliases: ["bedrock"],
  authKind: "cloud-credentials",
  help: "Pebble has cataloged Amazon Bedrock, but the built-in runtime still needs AWS credential-chain and Bedrock request signing support.",
});