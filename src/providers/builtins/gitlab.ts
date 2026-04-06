import { catalogOnly } from "../providerDefinition.js";

export default catalogOnly("gitlab", "GitLab", {
  envKeys: ["GITLAB_TOKEN", "GITLAB_ACCESS_TOKEN"],
  additionalAuthKinds: ["oauth"],
  authKind: "api-key",
  help: "Pebble has cataloged GitLab OAuth/API-token auth, but the built-in runtime still needs GitLab-specific request/auth behavior and auth-mode-aware runtime debugging.",
});