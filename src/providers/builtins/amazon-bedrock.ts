import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("amazon-bedrock", "Amazon Bedrock", {
  envKeys: ["AWS_BEARER_TOKEN_BEDROCK"],
  additionalEnvKeys: [
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
  ],
  aliases: ["bedrock"],
  authKind: "cloud-credentials",
  help: "Pebble has cataloged Amazon Bedrock, but the built-in runtime still needs AWS credential-chain resolution, region/profile handling, and Bedrock request signing support.",
});