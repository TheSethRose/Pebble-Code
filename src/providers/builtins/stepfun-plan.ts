import { openAiCompatible } from "../providerDefinition.js";

export default openAiCompatible("stepfun-plan", "StepFun Plan", {
  envKeys: ["STEPFUN_API_KEY"],
  defaultModel: "stepfun-plan/step-3.5-flash",
  defaultBaseUrl: "https://api.stepfun.ai/step_plan/v1",
  exampleModels: ["stepfun-plan/step-3.5-flash"],
  help: "StepFun Plan uses the separate coding-plan endpoint; live smoke tests are still pending.",
});