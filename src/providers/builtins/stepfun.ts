import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("stepfun", "StepFun", {
  envKeys: ["STEPFUN_API_KEY"],
  defaultModel: "stepfun/step-3.5-flash",
  defaultBaseUrl: "https://api.stepfun.ai/v1",
  exampleModels: ["stepfun/step-3.5-flash", "stepfun/step-3.5v-mini"],
});