---
title: "Providers"
summary: "Pebble provider selection, credential flows, runnable built-in providers, and catalog-only provider status."
read_when:
  - You want the current provider story for Pebble as a product
  - You are documenting provider setup instead of the underlying provider implementation internals
---

# Providers

Pebble ships with a built-in provider catalog in `src/providers/catalog.ts` and runtime resolution in `src/providers/runtime.ts`.

## Default provider

Pebble defaults to:

- **provider**: `openrouter`
- **model**: `openrouter/auto`

## How to configure a provider

You have three main product paths:

1. set provider env vars such as `OPENROUTER_API_KEY`
2. use `/login [provider] <credential>` in the interactive UI
3. switch providers in the settings UI opened with `/config` or `/provider`

<Note>
Pebble stores user credentials per provider. Switching providers does not overwrite previously saved credentials for other providers.
</Note>

## Runnable built-in providers today

Pebble's current runnable built-in slice is the **OpenAI-compatible transport path**.

That includes:

- `openrouter`
- `openai`
- `xai`
- `groq`
- `mistral`
- `deepseek`
- `together`
- `cerebras`
- `deepinfra`
- `nvidia`
- `perplexity`
- `huggingface`
- `zai`
- `moonshot`
- `qianfan`
- `qwen`
- `stepfun`
- `stepfun-plan`
- `volcengine`
- `volcengine-plan`
- `kilocode`
- `venice`
- `xiaomi`
- `ollama`
- `litellm`
- `vllm`
- `sglang`
- `custom-openai`

## Catalog-only providers

Pebble also catalogs providers that are **not** fully runnable yet through the built-in runtime.

Examples include:

- `anthropic`
- `amazon-bedrock`
- `azure`
- `cloudflare-ai-gateway`
- `gitlab`
- `google-vertex`

When you select one of these, Pebble should tell you it is **cataloged** but not yet implemented, rather than silently falling back to another provider.

## Auth experience

Pebble distinguishes between:

- providers that accept a manually entered credential
- providers that need OAuth, IAM, service-account, or other non-manual auth flows

If a provider does **not** support pasted credentials, `/login` refuses the input and tells you that the auth path is only cataloged for now.

## Related pages

- [Configuration](/concepts/configuration)
- [Slash commands](/cli/slash-commands)
- [Troubleshooting](/help/troubleshooting)