import type { BuiltinProviderDefinition } from "./providerDefinition.js";
import amazonBedrockProviderDefinition from "./builtins/amazon-bedrock.js";
import anthropicProviderDefinition from "./builtins/anthropic.js";
import azureProviderDefinition from "./builtins/azure.js";
import azureCognitiveServicesProviderDefinition from "./builtins/azure-cognitive-services.js";
import byteplusProviderDefinition from "./builtins/byteplus.js";
import byteplusPlanProviderDefinition from "./builtins/byteplus-plan.js";
import cerebrasProviderDefinition from "./builtins/cerebras.js";
import chutesProviderDefinition from "./builtins/chutes.js";
import cloudflareAiGatewayProviderDefinition from "./builtins/cloudflare-ai-gateway.js";
import cloudflareWorkersAiProviderDefinition from "./builtins/cloudflare-workers-ai.js";
import cohereProviderDefinition from "./builtins/cohere.js";
import customOpenAiProviderDefinition from "./builtins/custom-openai.js";
import deepgramProviderDefinition from "./builtins/deepgram.js";
import deepinfraProviderDefinition from "./builtins/deepinfra.js";
import deepseekProviderDefinition from "./builtins/deepseek.js";
import githubCopilotProviderDefinition from "./builtins/github-copilot.js";
import gitlabProviderDefinition from "./builtins/gitlab.js";
import googleProviderDefinition from "./builtins/google.js";
import googleGeminiCliProviderDefinition from "./builtins/google-gemini-cli.js";
import googleVertexProviderDefinition from "./builtins/google-vertex.js";
import googleVertexAnthropicProviderDefinition from "./builtins/google-vertex-anthropic.js";
import groqProviderDefinition from "./builtins/groq.js";
import huggingFaceProviderDefinition from "./builtins/huggingface.js";
import kiloProviderDefinition from "./builtins/kilo.js";
import kilocodeProviderDefinition from "./builtins/kilocode.js";
import kimiProviderDefinition from "./builtins/kimi.js";
import liteLlmProviderDefinition from "./builtins/litellm.js";
import minimaxProviderDefinition from "./builtins/minimax.js";
import minimaxPortalProviderDefinition from "./builtins/minimax-portal.js";
import mistralProviderDefinition from "./builtins/mistral.js";
import moonshotProviderDefinition from "./builtins/moonshot.js";
import nvidiaProviderDefinition from "./builtins/nvidia.js";
import ollamaProviderDefinition from "./builtins/ollama.js";
import openaiProviderDefinition from "./builtins/openai.js";
import openaiCodexProviderDefinition from "./builtins/openai-codex.js";
import opencodeProviderDefinition from "./builtins/opencode.js";
import opencodeGoProviderDefinition from "./builtins/opencode-go.js";
import openrouterProviderDefinition from "./builtins/openrouter.js";
import perplexityProviderDefinition from "./builtins/perplexity.js";
import qianfanProviderDefinition from "./builtins/qianfan.js";
import qwenProviderDefinition from "./builtins/qwen.js";
import sapAiCoreProviderDefinition from "./builtins/sap-ai-core.js";
import sglangProviderDefinition from "./builtins/sglang.js";
import stepfunProviderDefinition from "./builtins/stepfun.js";
import stepfunPlanProviderDefinition from "./builtins/stepfun-plan.js";
import syntheticProviderDefinition from "./builtins/synthetic.js";
import togetherProviderDefinition from "./builtins/together.js";
import veniceProviderDefinition from "./builtins/venice.js";
import vercelProviderDefinition from "./builtins/vercel.js";
import vercelAiGatewayProviderDefinition from "./builtins/vercel-ai-gateway.js";
import vllmProviderDefinition from "./builtins/vllm.js";
import volcengineProviderDefinition from "./builtins/volcengine.js";
import volcenginePlanProviderDefinition from "./builtins/volcengine-plan.js";
import xaiProviderDefinition from "./builtins/xai.js";
import xiaomiProviderDefinition from "./builtins/xiaomi.js";
import zaiProviderDefinition from "./builtins/zai.js";
import zenmuxProviderDefinition from "./builtins/zenmux.js";

export const BUILTIN_PROVIDER_DEFINITIONS = [
  openrouterProviderDefinition,
  openaiProviderDefinition,
  anthropicProviderDefinition,
  googleProviderDefinition,
  xaiProviderDefinition,
  groqProviderDefinition,
  mistralProviderDefinition,
  deepseekProviderDefinition,
  togetherProviderDefinition,
  cerebrasProviderDefinition,
  deepinfraProviderDefinition,
  nvidiaProviderDefinition,
  perplexityProviderDefinition,
  huggingFaceProviderDefinition,
  zaiProviderDefinition,
  moonshotProviderDefinition,
  qianfanProviderDefinition,
  qwenProviderDefinition,
  stepfunProviderDefinition,
  stepfunPlanProviderDefinition,
  volcengineProviderDefinition,
  volcenginePlanProviderDefinition,
  kilocodeProviderDefinition,
  ollamaProviderDefinition,
  liteLlmProviderDefinition,
  vllmProviderDefinition,
  sglangProviderDefinition,
  customOpenAiProviderDefinition,
  githubCopilotProviderDefinition,
  openaiCodexProviderDefinition,
  googleGeminiCliProviderDefinition,
  chutesProviderDefinition,
  minimaxPortalProviderDefinition,
  gitlabProviderDefinition,
  amazonBedrockProviderDefinition,
  azureProviderDefinition,
  azureCognitiveServicesProviderDefinition,
  googleVertexProviderDefinition,
  googleVertexAnthropicProviderDefinition,
  cloudflareAiGatewayProviderDefinition,
  cloudflareWorkersAiProviderDefinition,
  cohereProviderDefinition,
  deepgramProviderDefinition,
  kiloProviderDefinition,
  minimaxProviderDefinition,
  kimiProviderDefinition,
  opencodeProviderDefinition,
  opencodeGoProviderDefinition,
  sapAiCoreProviderDefinition,
  syntheticProviderDefinition,
  veniceProviderDefinition,
  vercelProviderDefinition,
  vercelAiGatewayProviderDefinition,
  xiaomiProviderDefinition,
  zenmuxProviderDefinition,
  byteplusProviderDefinition,
  byteplusPlanProviderDefinition,
] as const satisfies readonly BuiltinProviderDefinition[];