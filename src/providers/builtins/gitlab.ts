import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("gitlab", "GitLab", {
  envKeys: ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN"],
  authKind: "oauth",
  help: "Pebble has cataloged GitLab OAuth/API-token auth, but the built-in runtime still needs the GitLab-specific request/auth behavior.",
});