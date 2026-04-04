# Providers

This file is the source-backed provider inventory for the mirrored repos under `docs/context/`:

- `openclaw`
- `opencode`
- `vscode-copilot-chat`

It answers two questions:

1. **Which providers are available in the mirrored repos?**
2. **How do they authenticate?**

## Notes before you use this list

- **OpenClaw is the broadest catalog** in the mirrored sources, so most provider names come from `docs/context/openclaw/docs/providers/**` plus `docs/context/openclaw/docs/concepts/model-providers.md`.
- **Opencode has a dynamic live catalog** via `models.dev`. This file lists the providers and auth seams that are **explicitly visible in the mirrored source** (`provider.ts`, `provider/auth.ts`, provider login commands, and auth plugins). Where the exact env var name is not pinned in-repo, this file calls the auth style out as **catalog/config-driven API-key auth** instead of inventing a secret name.
- **VS Code Copilot Chat has two different surfaces**:
  - **native Copilot auth** (GitHub sign-in -> Copilot token exchange)
  - **BYOK** providers (Anthropic, OpenAI, Gemini, Azure, etc.)
- Auth labels in this file mean:
  - **API key / token**: direct secret-based auth
  - **OAuth / device flow / PKCE**: browser, device-code, or refresh-token login
  - **Local / URL-only / dummy key**: local server runtime, URL config, or non-secret marker value
  - **Cloud credentials / IAM / service account**: AWS/GCP/Azure identity instead of a normal API key
  - **Gateway / proxy composite auth**: provider key plus gateway/proxy auth/header

## Current Pebble status (2026-04-04)

- Pebble now has a real built-in provider catalog in `src/providers/catalog.ts`, shared config resolution in `src/providers/config.ts`, runtime selection in `src/providers/runtime.ts`, and per-provider auth persistence in `src/runtime/config.ts` instead of a single global API key slot.
- The currently runnable built-in slice is the shared **OpenAI-compatible transport** path: `openrouter`, `openai`, `xai`, `groq`, `mistral`, `deepseek`, `together`, `nvidia`, `perplexity`, `cerebras`, `deepinfra`, `huggingface`, `qianfan`, `zai`, `qwen`, `moonshot`, `stepfun`, `stepfun-plan`, `volcengine`, `volcengine-plan`, `kilocode`, `venice`, `xiaomi`, `ollama`, `litellm`, `vllm`, `sglang`, and explicit custom OpenAI-compatible endpoints.
- `/login` now stores credentials per provider and refuses to fake OAuth/cloud-login providers as pasted API-key flows, while `/model` now forces provider selection first and then lets you search/select seeded or discovered model IDs for that provider.
- Selecting an unconfigured built-in provider from the Settings provider/model flows now hands off directly into the auth/login tab with provider-specific guidance instead of leaving you in a half-configured state.
- GitHub Copilot now has a real Pebble path: `/login github-copilot` runs GitHub.com device flow, Pebble persists the resulting OAuth session, and the runtime exchanges that GitHub token into a short-lived Copilot API token before execution. Local config/runtime tests cover that flow, but live credential smoke tests are still pending.
- The rest of the providers in this file are still **cataloged-only** with provider-specific env/config metadata and explicit runtime messaging, but they remain blocked on bespoke auth flows, Anthropic-specific adapters, or provider-specific transport work and should stay unchecked in `TODO.md` until those paths exist end-to-end.
- The new test coverage is still local/config/runtime focused. Most providers above still need **live credential smoke tests** before they should be considered production-hardened.

## Provider inventory

## Amazon Bedrock

### How to implement in Pebble

- Add a real `amazon-bedrock` provider path to `src/providers/config.ts` and `src/providers/runtime.ts` instead of falling back to OpenRouter.
- Read AWS region/profile/bearer-token inputs from settings + env, then expose them through a dedicated provider adapter rather than a plain OpenAI-compatible wrapper.
- Validate both non-streaming and streaming execution in `QueryEngine`, and add failure-path tests for missing credentials, invalid region/profile, and bearer-token precedence.

### Cloud credentials / IAM / profile / web identity

- **OpenClaw**: `bedrock` uses AWS credentials from env vars, shared config, or instance role/IAM.
- **Opencode**: `amazon-bedrock` uses AWS region/profile config, access keys, web identity, container creds, or the standard AWS credential chain.

### Bearer token

- **OpenClaw**: also supports `AWS_BEARER_TOKEN_BEDROCK`.
- **Opencode**: bearer token auth takes precedence when present.

## Anthropic

### How to implement in Pebble

- Add an `anthropic` provider config that resolves Anthropic API-key auth directly and treats that as the supported Pebble path.
- Seed provider metadata around Anthropic-style tool use / system prompt support in a dedicated adapter rather than treating it as OpenAI-compatible.
- Test both API-key configuration resolution and provider-specific execution/error behavior before marking the backlog item complete.

### API key / token

- **OpenClaw**: direct Anthropic API key setup.
- **Opencode**: API-key auth is available through the catalog/generic provider auth path.
- **VS Code Copilot Chat BYOK**: Anthropic is API-key based.

### Cloud credentials / service account

- **Opencode**: `google-vertex-anthropic` runs Anthropic models through Google Vertex auth instead of an Anthropic API key.

## Azure OpenAI

### How to implement in Pebble

- Add `azure` provider support with explicit endpoint/base URL handling in `src/providers/config.ts`.
- Model this as a distinct provider adapter because Azure URL construction and auth behavior differ from a simple OpenAI-compatible base URL swap.
- Split the backlog into API-key mode and Entra ID mode, and test both resolution and runtime failure paths independently.

### API key / token

- **Opencode**: `azure` uses API-key-style auth through config/env/generic provider auth.
- **VS Code Copilot Chat BYOK**: Azure can use an API key directly.

### Cloud identity / Entra ID

- **VS Code Copilot Chat BYOK**: if no API key is set, Azure falls back to Microsoft authentication / Entra ID.

## Azure Cognitive Services

### How to implement in Pebble

- Treat this as a separate provider id from generic Azure OpenAI because the endpoint/resource semantics differ.
- Add config fields for resource name / endpoint selection and wire them through runtime bootstrap explicitly.
- Cover auth/config errors with targeted provider-config and runtime tests.

### API key / token

- **Opencode**: `azure-cognitive-services` is an explicit provider surface in runtime config and uses endpoint/resource configuration plus API-key-style auth.

## BytePlus

### How to implement in Pebble

- Add `byteplus` and `byteplus-plan` as first-class provider ids instead of collapsing them into one generic surface.
- Read `BYTEPLUS_API_KEY`, seed example refs like `byteplus-plan/ark-code-latest`, and keep both the general and coding catalogs available.
- Mirror the OpenClaw behavior where setup prefers the coding plan by default but still exposes both provider catalogs.

### API key / token

- **OpenClaw**: `byteplus` and `byteplus-plan` use `BYTEPLUS_API_KEY`.

## Cerebras

### How to implement in Pebble

- Add a dedicated Cerebras provider config path keyed off `CEREBRAS_API_KEY`.
- Treat it as OpenAI-compatible transport with Cerebras-specific defaults/headers rather than as a generic unnamed custom provider.
- Include explicit example model coverage and provider-specific failure tests instead of only config resolution tests.

### API key / token

- **Opencode**: Cerebras support is bundled in the runtime; auth is catalog/config-driven API-key auth, not OAuth, in the mirrored source.

## Chutes

### How to implement in Pebble

- Support two auth paths under the same `chutes` provider id: OAuth and API key.
- Resolve `CHUTES_API_KEY` / OAuth token inputs separately in config, and persist enough auth metadata for refreshable OAuth sessions.
- Add tests that prove Pebble picks the same runtime provider surface regardless of whether auth came from browser OAuth or direct API key.

### OAuth / browser flow

- **OpenClaw**: `chutes` supports browser/headless OAuth with refreshable tokens.

### API key / token

- **OpenClaw**: `chutes` also supports `CHUTES_API_KEY`.

## Cloudflare AI Gateway

### How to implement in Pebble

- Add a dedicated provider path that composes gateway config plus upstream provider auth instead of a single opaque base URL string.
- Read gateway ids/tokens from config/env and allow optional extra gateway auth headers when required.
- Test the composite auth path separately from normal provider API-key flows.

### Gateway + upstream provider credentials

- **OpenClaw**: `cloudflare-ai-gateway` uses `CLOUDFLARE_AI_GATEWAY_API_KEY` for the upstream provider request path and can also require an extra `cf-aig-authorization` bearer header for authenticated gateways.

### Gateway token

- **Opencode**: `cloudflare-ai-gateway` uses `CLOUDFLARE_API_TOKEN` / `CF_AIG_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID` and gateway ID.

## Cloudflare Workers AI

### How to implement in Pebble

- Add `cloudflare-workers-ai` as a dedicated provider id with account-id-aware config resolution.
- Treat it as a cloud-provider-specific adapter rather than a generic OpenAI-compatible transport.
- Add focused tests for missing account id, missing API key, and successful runtime selection.

### API key / token

- **Opencode**: `cloudflare-workers-ai` uses `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_ACCOUNT_ID`.

## Cohere

### How to implement in Pebble

- Add a dedicated `cohere` provider config keyed off the provider-specific API token.
- Keep the adapter/provider metadata separate from OpenAI-compatible providers so capabilities and failure messages stay accurate.
- Add config, runtime, and failure-path tests before marking support complete.

### API key / token

- **Opencode**: Cohere support is bundled in the runtime; auth is catalog/config-driven API-key auth in the mirrored source.

## Custom OpenAI-compatible endpoint

### How to implement in Pebble

- Add a user-configurable OpenAI-compatible provider surface that accepts explicit base URLs, model metadata, and optional per-model capabilities.
- Reuse the primary OpenAI-compatible transport layer, but keep config/schema support rich enough to express custom models cleanly.
- Validate both default chat-completions URL behavior and explicitly specified endpoint paths.

### API key / token

- **VS Code Copilot Chat BYOK**: `customoai` supports API-key auth plus per-model URL/model metadata.

### URL-only / custom endpoint config

- **VS Code Copilot Chat BYOK**: each custom model is configured with an explicit endpoint URL.

## Deepgram

### How to implement in Pebble

- Implement this as a media/transcription provider path, not a normal chat-model provider.
- Read `DEEPGRAM_API_KEY` and wire it into the audio/media tool path instead of the main chat provider selector.
- Add tests around transcription setup, transcript injection, and failure handling.

### API key / token

- **OpenClaw**: `deepgram` transcription uses `DEEPGRAM_API_KEY`.

## DeepInfra

### How to implement in Pebble

- Add `deepinfra` as a dedicated provider config using the provider’s token-based auth.
- Treat it as a first-class selectable provider with explicit config/env resolution rather than hiding it under a custom base URL workaround.
- Add provider selection and runtime tests that prove the chosen provider/model are recorded correctly.

### API key / token

- **Opencode**: DeepInfra support is bundled in the runtime; auth is catalog/config-driven API-key auth in the mirrored source.

## DeepSeek

### How to implement in Pebble

- Add `deepseek` config keyed off `DEEPSEEK_API_KEY`.
- Seed one or more known model refs and run the provider through both non-streaming and streaming code paths.
- Add failure-path tests for missing API key and provider request errors.

### API key / token

- **OpenClaw**: `deepseek` uses `DEEPSEEK_API_KEY`.
- **Opencode**: DeepSeek is available through the bundled provider stack with API-key-style auth.

## GitHub Copilot

### How to implement in Pebble

- Pebble now supports the native GitHub.com device-flow path through `/login github-copilot`.
- Pebble persists the GitHub device token in per-provider auth storage and exchanges it into a Copilot runtime token on demand before requests.
- Current gaps: GitHub Enterprise/device-domain variants, proxy-bridge mode, and live credential smoke tests still need follow-up before we should call the integration production-hardened.

### Current Pebble notes

- Built-in provider id: `github-copilot`
- Default model: `github-copilot/gpt-4o`
- Default base URL: `https://api.individual.githubcopilot.com`
- Env fallbacks: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` (plus Pebble's legacy compatibility aliases)
- Runtime behavior: exchange the saved GitHub token at `https://api.github.com/copilot_internal/v2/token`, derive the Copilot API base URL from `proxy-ep` when present, then use Pebble's shared OpenAI-compatible transport.

### OAuth / device flow / token exchange

- **OpenClaw**: `github-copilot` uses GitHub device flow and then exchanges that into Copilot API usage.
- **Opencode**: `github-copilot` has a dedicated device-flow OAuth plugin.
- **VS Code Copilot Chat native**: GitHub auth session -> Copilot token exchange.

### Proxy / bridge

- **OpenClaw**: can also use the Copilot Proxy VS Code extension as a local bridge.

### PAT / test token path

- **VS Code Copilot Chat native**: the mirrored auth code also supports PAT / pre-minted token env vars in testing and automation flows.

## GitLab

### How to implement in Pebble

- Add `gitlab` support with two auth modes: OAuth token and API token.
- Resolve `GITLAB_TOKEN` plus stored OAuth state through the same provider id while preserving which path is active for debugging.
- Add provider-config tests for auth-mode selection and runtime tests for bearer-vs-token request behavior.

### OAuth

- **Opencode**: `gitlab` accepts stored OAuth auth and uses bearer auth for requests.

### API key / token

- **Opencode**: `gitlab` also accepts API-token auth via `GITLAB_TOKEN` / generic API auth.

## GLM / Z.AI

### How to implement in Pebble

- Implement Z.AI as the actual provider id (`zai`) and document GLM as the model family on top of it.
- Read `ZAI_API_KEY` and seed example refs like `zai/glm-5` instead of inventing a separate `glm` runtime provider.
- Add tests that verify GLM selections resolve back to the `zai` provider path.

### API key / token

- **OpenClaw**: GLM models are exposed through the `zai` provider with `ZAI_API_KEY`.
- **OpenClaw**: the `glm` page is a model-family page, but the actual provider/auth surface is Z.AI.

## Google Gemini

### How to implement in Pebble

- Add `google` API-key mode keyed off `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
- Keep API-key mode and Gemini CLI OAuth mode as separate provider/auth paths so config and runtime behavior stay unambiguous.
- Validate streaming, tool-use behavior, and provider-specific error handling before closing support.

### API key / token

- **OpenClaw**: `google` uses `GEMINI_API_KEY` or `GOOGLE_API_KEY`.
- **Opencode**: Google/Gemini support is available through the bundled runtime provider stack with API-key-style auth.
- **VS Code Copilot Chat BYOK**: Gemini is API-key based.

### OAuth / PKCE / browser login

- **OpenClaw**: `google-gemini-cli` is a separate OAuth-only provider that uses PKCE.

## Google Vertex AI

### How to implement in Pebble

- Add explicit project/location-aware config and service-account/ADC auth handling.
- Treat Vertex as a cloud-identity provider path, not just another API-key provider.
- Keep Anthropic-on-Vertex as a distinct follow-up path so provider/model reporting remains accurate.

### Cloud credentials / service account / ADC

- **Opencode**: `google-vertex` uses project/location config and Google application credentials / ADC to mint bearer tokens.
- **Opencode**: `google-vertex-anthropic` uses the same Google Vertex identity model for Anthropic-hosted models on Vertex.

## Groq

### How to implement in Pebble

- Add `groq` support keyed off `GROQ_API_KEY`.
- Seed provider metadata and example models explicitly instead of funneling it through a generic custom provider.
- Add streaming and failure tests because Groq is likely to be used as a fast-path provider.

### API key / token

- **OpenClaw**: `groq` uses `GROQ_API_KEY`.
- **Opencode**: Groq is available through the bundled runtime provider stack with API-key-style auth.

## Hugging Face

### How to implement in Pebble

- Read `HUGGINGFACE_HUB_TOKEN` / `HF_TOKEN` and expose `huggingface` as a real provider id.
- Support model discovery/refresh as a follow-up enhancement, but start with a seeded catalog and explicit example refs.
- Add tests for token resolution and routing through the Hugging Face provider path.

### API key / token

- **OpenClaw**: `huggingface` uses `HUGGINGFACE_HUB_TOKEN` or `HF_TOKEN`.

## Kilo

### How to implement in Pebble

- Add `kilo` as a provider id with provider-specific config/env handling rather than leaving it implied.
- Reuse OpenAI-compatible request plumbing where appropriate, but keep provider reporting and error messages Kilo-specific.
- Add tests that prove Pebble records Kilo as the answering provider when selected.

### API key / token

- **Opencode**: `kilo` is an explicit runtime-aware provider surface. In the mirrored repo it uses catalog/config-driven API-key auth rather than OAuth.

## Kilocode

### How to implement in Pebble

- Add `kilocode` keyed off `KILOCODE_API_KEY` and seed the stable default ref `kilocode/kilo/auto`.
- Treat it as a gateway/provider-router surface and preserve the selected upstream model ref when available for debug output.
- Add config and runtime tests around smart-routing defaults and explicit concrete model refs.

### API key / token

- **OpenClaw**: `kilocode` uses `KILOCODE_API_KEY`; the gateway uses Bearer auth under the hood.

## LiteLLM

### How to implement in Pebble

- Treat LiteLLM as a local or remote gateway surface with configurable base URL plus LiteLLM key/master-key auth.
- Reuse OpenAI-compatible transport logic, but keep the provider id explicit so Pebble can report that a gateway answered the request.
- Add tests for local gateway connectivity and auth/header configuration.

### API key / token

- **OpenClaw**: `litellm` is a local/unified gateway surface that uses LiteLLM keys/master-key Bearer auth.

### Local endpoint

- **OpenClaw**: typically runs against a local LiteLLM server (for example `http://localhost:4000`).

## MiniMax

### How to implement in Pebble

- Add separate provider/auth handling for `minimax` API-key auth and `minimax-portal` OAuth auth.
- Seed example refs like `minimax/MiniMax-M2.7` and preserve the distinction between text, multimodal, and portal-backed variants.
- Add tests that prove Pebble does not blur the API-key and OAuth surfaces together.
- Keep `minimax-portal` unchecked for now: the mirrored runtime defaults point at Anthropic-compatible endpoints plus provider-owned hooks, so Pebble's current shared OpenAI-compatible adapter is not yet an honest end-to-end fit.

### API key / token

- **OpenClaw**: `minimax` uses `MINIMAX_API_KEY`.

### OAuth / portal auth

- **OpenClaw**: `minimax-portal` is the OAuth-authenticated MiniMax surface.

## Mistral

### How to implement in Pebble

- Add `mistral` support keyed off `MISTRAL_API_KEY`.
- Start with model routing (`mistral/mistral-large-latest`) and keep audio/transcription/media uses as a follow-up provider-specific expansion.
- Add provider-config plus streaming/non-streaming runtime tests.

### API key / token

- **OpenClaw**: `mistral` uses `MISTRAL_API_KEY`.
- **Opencode**: Mistral is available through the bundled runtime provider stack with API-key-style auth.

## Moonshot / Kimi

### How to implement in Pebble

- Keep `moonshot` and `kimi` as distinct surfaces because Moonshot and Kimi Coding use separate refs/endpoints/keys.
- Pebble now wires the Moonshot OpenAI-compatible endpoint with `MOONSHOT_API_KEY`, seeded `moonshot/...` refs, and config/runtime tests.
- `kimi` should remain a separate follow-up because the mirrored source describes Kimi Coding as an Anthropic-compatible path rather than a sibling OpenAI-compatible endpoint.

### API key / token

- **OpenClaw**: `moonshot` uses Moonshot/Kimi API keys; Moonshot and Kimi Coding are separate provider surfaces with separate model refs.

## NVIDIA

### How to implement in Pebble

- Add `nvidia` support keyed off `NVIDIA_API_KEY`.
- Treat it as an OpenAI-compatible transport with NVIDIA-specific defaults and model refs, not as a generic unnamed base URL.
- Add tests for token resolution and provider-specific request errors.

### API key / token

- **OpenClaw**: `nvidia` uses an API key from NVIDIA NGC.

## Ollama

### How to implement in Pebble

- Implement two paths: local Ollama runtime support and optional cloud/browser-sign-in support.
- Allow URL-only configuration for local mode, and treat the local marker key (`ollama-local`) as a compatibility behavior rather than a real secret requirement.
- Add tests for local discovery, URL overrides, and cloud/local mode selection so the provider path stays deterministic.

### URL-only / local endpoint config

- **VS Code Copilot Chat BYOK**: Ollama is configured with a URL only.

### Local marker / non-secret local auth

- **OpenClaw**: local Ollama usage commonly uses `OLLAMA_API_KEY="ollama-local"` or an auth profile as a local-discovery marker.

### Browser sign-in

- **OpenClaw**: Cloud + Local mode opens an Ollama browser sign-in flow when needed.

## OpenAI

### How to implement in Pebble

- Add a real `openai` provider config keyed off `OPENAI_API_KEY`, separate from OpenRouter defaults.
- Reuse the existing OpenAI-compatible transport, but keep provider/model reporting, default env names, and failure messages OpenAI-specific.
- Follow up with a second auth path for Codex/ChatGPT OAuth rather than overloading the API-key implementation.

### API key / token

- **OpenClaw**: `openai` supports standard OpenAI API keys.
- **Opencode**: `openai` supports generic API-key auth.
- **VS Code Copilot Chat BYOK**: OpenAI is API-key based.

### OAuth / browser login / device flow

- **OpenClaw**: `openai-codex` supports ChatGPT/Codex OAuth-style login.
- **Opencode**: the Codex plugin supports browser OAuth and a headless device-auth flow for ChatGPT Plus/Pro, while still allowing manual API-key entry.

### Current Pebble note

- Keep `openai-codex` unchecked for now: the mirrored Codex runtime is not just OAuth on top of `/chat/completions`; it rewrites onto the ChatGPT Codex Responses transport (`chatgpt.com/backend-api`) and needs a dedicated adapter beyond Pebble's current shared OpenAI-compatible chat-completions path.

## OpenCode

### How to implement in Pebble

- Add `opencode` as a first-class provider id keyed off `OPENCODE_API_KEY`.
- Preserve the distinction between public/free and paid catalog behavior so Pebble can surface useful config errors instead of generic auth failures.
- Add tests for configured vs unconfigured model availability.

### API key / token

- **OpenClaw**: `opencode` uses `OPENCODE_API_KEY`.
- **Opencode**: the `opencode` provider hides paid models unless an API key/auth/config entry exists; auth is API-key based.

## OpenCode Go

### How to implement in Pebble

- Add `opencode-go` as a separate provider id that shares `OPENCODE_API_KEY` with `opencode`.
- Seed refs like `opencode-go/kimi-k2.5` and keep provider reporting explicit so Go-vs-Zen routing is visible.
- Add tests that prove the shared key does not collapse the two provider ids together.

### API key / token

- **OpenClaw**: `opencode-go` uses the same `OPENCODE_API_KEY` as the main OpenCode catalog.

## OpenRouter

### How to implement in Pebble

- OpenRouter is already the current primary path; use it as the implementation template for additional providers.
- Keep `src/providers/config.ts` and `src/providers/runtime.ts` as the source of truth for how provider selection, env resolution, and runtime bootstrap should work.
- When adding other providers, mirror the same config-resolution and debug-reporting quality OpenRouter already has.

### API key / token

- **OpenClaw**: `openrouter` uses `OPENROUTER_API_KEY` and sends it as Bearer auth.
- **Opencode**: `openrouter` is an explicit runtime provider with API-key-style auth.
- **VS Code Copilot Chat BYOK**: OpenRouter is API-key based.

## Perplexity

### How to implement in Pebble

- Support direct `PERPLEXITY_API_KEY` auth first, then optionally add the OpenRouter-routed variant as a second transport mode.
- Keep the provider id explicit so Pebble can report whether Perplexity answered directly or via a router/proxy path.
- Add tests for auth-mode selection and provider error isolation.

### API key / token

- **OpenClaw**: `perplexity` can use `PERPLEXITY_API_KEY` directly.

### API key via proxy/router

- **OpenClaw**: the Perplexity plugin can also route through OpenRouter using `OPENROUTER_API_KEY`.
- **Opencode**: Perplexity support is bundled in the runtime provider stack with API-key-style auth.

## Qianfan

### How to implement in Pebble

- Add `qianfan` keyed off `QIANFAN_API_KEY` with explicit example refs.
- Treat it as a provider-specific integration instead of a generic OpenAI-compatible custom provider so base URL, auth, and debug output stay accurate.
- Add provider-config and runtime tests.

### API key / token

- **OpenClaw**: `qianfan` uses a Qianfan API key.

## Qwen / Model Studio

### How to implement in Pebble

- Implement Qwen / Model Studio as an API-key-only provider path and do not resurrect the removed OAuth flow.
- Resolve `QWEN_API_KEY`, `MODELSTUDIO_API_KEY`, and `DASHSCOPE_API_KEY` aliases in config, then normalize them to a single runtime provider id.
- Add tests proving that legacy OAuth assumptions are rejected cleanly.

### API key / token

- **OpenClaw**: current Qwen / Model Studio setup is API-key based (`QWEN_API_KEY`).

### Removed auth path

- **OpenClaw**: the old Qwen OAuth flow is explicitly documented as removed.

## SAP AI Core

### How to implement in Pebble

- Treat SAP AI Core as a service-key-based enterprise provider, not as an OAuth or plain API-key clone.
- Add explicit config/env handling for `AICORE_SERVICE_KEY` and related deployment/resource settings.
- Add tests for missing service key and successful runtime bootstrap.

### Service key / enterprise credential

- **Opencode**: `sap-ai-core` uses `AICORE_SERVICE_KEY` / service-key style auth rather than OAuth.

## SGLang

### How to implement in Pebble

- Add `sglang` as a local/self-hosted OpenAI-compatible provider path.
- Support both marker-key local mode and real-key/header override mode so self-hosted deployments remain usable.
- Add tests for local URL defaults, marker-key behavior, and real-key override behavior.

### Local marker / API key

- **OpenClaw**: `sglang` usually runs as a local server with a local marker key such as `SGLANG_API_KEY="sglang-local"`, but can also send a real key/header if your server requires one.

## StepFun

### How to implement in Pebble

- Add `stepfun` and `stepfun-plan` as separate provider ids sharing `STEPFUN_API_KEY`.
- Seed example refs like `stepfun/step-3.5-flash` and `stepfun-plan/step-3.5-flash-2603` and preserve the standard-vs-plan routing split.
- Add provider-config and runtime tests for both surfaces.

### API key / token

- **OpenClaw**: `stepfun` and `stepfun-plan` use `STEPFUN_API_KEY`.

## Synthetic

### How to implement in Pebble

- Add `synthetic` keyed off `SYNTHETIC_API_KEY`.
- Treat it as an Anthropic-compatible provider path with provider-specific config and debug reporting.
- Seed a known example ref and add tests for auth resolution and request failure handling.

### API key / token

- **OpenClaw**: `synthetic` uses `SYNTHETIC_API_KEY`.

## Together AI

### How to implement in Pebble

- Add `together` keyed off `TOGETHER_API_KEY`.
- Reuse OpenAI-compatible request plumbing while preserving a dedicated provider id and provider-specific config surface.
- Add streaming and failure-path tests.

### API key / token

- **OpenClaw**: `together` uses `TOGETHER_API_KEY`.
- **Opencode**: Together AI is available through the bundled runtime provider stack with API-key-style auth.

## Venice

### How to implement in Pebble

- Pebble now wires `venice` through the documented OpenAI-compatible base URL `https://api.venice.ai/api/v1` with the seeded default ref `venice/kimi-k2-5`.
- Provider selection, config resolution, and runtime bootstrap are covered locally; live credential smoke tests are still pending, and provider-specific tool/max-token quirks from the mirrored docs still need follow-up hardening.
- Keep future work focused on richer failure-path coverage, dynamic model discovery sanity checks, and Venice-specific capability caveats rather than basic bootstrap wiring.

### API key / token

- **OpenClaw**: `venice` uses `VENICE_API_KEY` for inference.
- **Opencode**: Venice support is bundled in the runtime provider stack with API-key-style auth.

## Vercel AI

### How to implement in Pebble

- Add `vercel` as a distinct provider id rather than treating it as a generic router alias.
- Resolve its API key and any provider-specific headers in config/runtime bootstrap explicitly.
- Add tests for provider selection and failure handling.

### API key / token

- **Opencode**: `vercel` is an explicit runtime provider surface with API-key-style auth.

## Vercel AI Gateway

### How to implement in Pebble

- Add `vercel-ai-gateway` keyed off `AI_GATEWAY_API_KEY`.
- Treat it as a gateway surface with its own config/debug identity rather than as direct model-provider auth.
- Add tests for gateway auth resolution and request failure isolation.

### API key / token

- **OpenClaw**: `vercel-ai-gateway` uses `AI_GATEWAY_API_KEY`.

## vLLM

### How to implement in Pebble

- Add `vllm` as a local/self-hosted OpenAI-compatible provider with configurable base URL.
- Support both local marker-key mode and real-key/header override mode.
- Add tests for local defaults, URL overrides, and runtime request failures.

### Local marker / API key

- **OpenClaw**: `vllm` usually runs against a local OpenAI-compatible server with a local marker key such as `VLLM_API_KEY="vllm-local"`, but can also use a real API key/header.

## Volcengine / Doubao

### How to implement in Pebble

- Add `volcengine` and `volcengine-plan` as separate provider ids sharing `VOLCANO_ENGINE_API_KEY`.
- Seed example refs like `volcengine-plan/ark-code-latest` and keep the general-vs-coding catalog split explicit.
- Mirror the documented setup behavior where coding-plan models are preferred by default without hiding the general catalog.

### API key / token

- **OpenClaw**: `volcengine` and `volcengine-plan` use `VOLCANO_ENGINE_API_KEY`.

## xAI

### How to implement in Pebble

- Add `xai` keyed off `XAI_API_KEY`.
- Treat it as a dedicated provider adapter so xAI-specific behavior like fast variants and tool-streaming defaults can be expressed cleanly later.
- Add streaming/non-streaming and failure-path tests before marking support complete.

### API key / token

- **OpenClaw**: `xai` is API-key only today.
- **Opencode**: `xai` is an explicit runtime provider with API-key auth.
- **VS Code Copilot Chat BYOK**: xAI is API-key based.

## Xiaomi

### How to implement in Pebble

- Pebble now wires `xiaomi` through the documented OpenAI-compatible base URL `https://api.xiaomimimo.com/v1` with the seeded default ref `xiaomi/mimo-v2-flash`.
- Provider selection, config resolution, and runtime bootstrap are covered locally; live credential smoke tests are still pending.
- Future work should focus on dynamic model discovery validation and provider-specific failure-path coverage rather than the base integration slice.

### API key / token

- **OpenClaw**: `xiaomi` is an OpenAI-compatible provider with API-key auth.

## Z.AI

### How to implement in Pebble

- Add `zai` keyed off `ZAI_API_KEY` as the real provider surface for GLM models.
- Seed example refs like `zai/glm-5` and keep GLM naming documented as model-family terminology rather than a separate provider implementation.
- Add tests that verify GLM-prefixed selections still resolve through the `zai` provider path.

### API key / token

- **OpenClaw**: `zai` uses `ZAI_API_KEY` and is the real auth surface for GLM models.

## ZenMux

### How to implement in Pebble

- Add `zenmux` as a dedicated provider id with explicit config/env resolution instead of leaving it implied.
- Reuse shared OpenAI-compatible plumbing if appropriate, but preserve dedicated provider reporting and failure messages.
- Add runtime selection and failure-path tests.

### API key / token

- **Opencode**: `zenmux` is an explicit runtime-aware provider surface with catalog/config-driven API-key auth in the mirrored source.

## VS Code native Copilot auth (not a BYOK provider, but still a provider surface)

### How to implement in Pebble

- Use this as reference material if Pebble ever adds a native Copilot integration that is separate from OpenAI/OpenRouter-style BYOK providers.
- Model it as GitHub auth-session/OAuth state plus token exchange, not as a plain API-key provider.
- Keep it separate from generic custom-provider support so auth UX and failure messages stay actionable.

### GitHub auth session -> Copilot token exchange

- **VS Code Copilot Chat native**: GitHub OAuth/session auth mints a Copilot token for model access.

## Opencode-only dynamic provider note

`opencode` also loads a live provider/model catalog from `models.dev`. In practice that means the runtime can surface additional providers beyond the ones with dedicated auth logic above. Where the mirrored repo does not pin a dedicated auth plugin or provider doc, treat those providers as **catalog/config-driven API-key providers unless the runtime code clearly shows OAuth, local-runtime, or cloud-credential behavior instead**.

For Pebble implementation work, that means:

- add explicit first-class support for the providers Pebble actually wants to ship,
- keep `src/providers/config.ts`, `src/providers/runtime.ts`, and `src/providers/types.ts` as the core wiring seams,
- validate both `QueryEngine.process()` and `QueryEngine.stream()` for every provider that is added,
- and add provider-specific config + failure-path tests instead of relying on the OpenRouter happy path alone.

## Primary source files

- `docs/context/openclaw/docs/providers/index.md`
- `docs/context/openclaw/docs/providers/*.md`
- `docs/context/openclaw/docs/concepts/model-providers.md`
- `docs/context/opencode/packages/opencode/src/provider/provider.ts`
- `docs/context/opencode/packages/opencode/src/provider/auth.ts`
- `docs/context/opencode/packages/opencode/src/cli/cmd/providers.ts`
- `docs/context/opencode/packages/opencode/src/plugin/github-copilot/copilot.ts`
- `docs/context/opencode/packages/opencode/src/plugin/codex.ts`
- `docs/context/vscode-copilot-chat/src/extension/byok/vscode-node/byokContribution.ts`
- `docs/context/vscode-copilot-chat/src/extension/byok/vscode-node/azureProvider.ts`
- `docs/context/vscode-copilot-chat/src/platform/authentication/node/copilotTokenManager.ts`
- `docs/context/vscode-copilot-chat/package.json`