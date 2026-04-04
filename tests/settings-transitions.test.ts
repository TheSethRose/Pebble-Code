import { describe, expect, test } from "bun:test";
import {
  getInitialSettingsModelPhase,
  resolveSettingsPostLoginNavigation,
} from "../src/ui/settingsTransitions";

describe("settings post-login navigation", () => {
  test("opens the model tab directly into the current provider's model list by default", () => {
    expect(getInitialSettingsModelPhase()).toBe("model");
    expect(getInitialSettingsModelPhase(null)).toBe("model");
  });

  test("respects an explicit resume target phase when returning from auth", () => {
    expect(getInitialSettingsModelPhase({
      nonce: 1,
      phase: "provider",
      message: "Pick a provider.",
    })).toBe("provider");
  });

  test("returns to the model picker after a follow-up login succeeds", () => {
    expect(resolveSettingsPostLoginNavigation({
      providerId: "github-copilot",
      followUpProviderId: "github-copilot",
      returnTarget: {
        tab: "model",
        modelPhase: "model",
        successMessage: "GitHub Copilot authenticated. Pick a model below.",
      },
    })).toEqual({
      nextTab: "model",
      modelResumeTarget: {
        phase: "model",
        message: "GitHub Copilot authenticated. Pick a model below.",
      },
    });
  });

  test("does not navigate away when the login did not come from a follow-up tab switch", () => {
    expect(resolveSettingsPostLoginNavigation({
      providerId: "github-copilot",
      followUpProviderId: undefined,
      returnTarget: {
        tab: "provider",
      },
    })).toBeNull();
  });
});