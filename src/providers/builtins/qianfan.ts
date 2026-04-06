import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("qianfan", "Qianfan", {
  envKeys: ["QIANFAN_API_KEY"],
  defaultModel: "qianfan/deepseek-v3.2",
  defaultBaseUrl: "https://qianfan.baidubce.com/v2",
  exampleModels: ["qianfan/deepseek-v3.2", "qianfan/ernie-4.5-300b-a47b"],
});