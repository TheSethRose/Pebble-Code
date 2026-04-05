export type SettingsTabId = "config" | "provider" | "model" | "api-key";
export type SettingsModelPhase = "provider" | "model";

export interface SettingsAuthReturnTarget {
  tab: SettingsTabId;
  modelPhase?: SettingsModelPhase;
  successMessage?: string;
}

export interface SettingsModelResumeTarget {
  nonce: number;
  phase: SettingsModelPhase;
  message?: string;
}

export interface SettingsPostLoginNavigation {
  nextTab: SettingsTabId;
  modelResumeTarget?: Omit<SettingsModelResumeTarget, "nonce">;
}

export interface SettingsPostProviderSelectionNavigation {
  nextTab: SettingsTabId;
  authReturnTarget?: SettingsAuthReturnTarget;
  modelResumeTarget?: Omit<SettingsModelResumeTarget, "nonce">;
}

export function getInitialSettingsModelPhase(
  resumeTarget?: SettingsModelResumeTarget | null,
): SettingsModelPhase {
  return resumeTarget?.phase ?? "model";
}

export function resolveSettingsPostLoginNavigation(params: {
  providerId: string;
  followUpProviderId?: string;
  returnTarget?: SettingsAuthReturnTarget | null;
}): SettingsPostLoginNavigation | null {
  const providerId = params.providerId.trim();
  const followUpProviderId = params.followUpProviderId?.trim();

  if (!providerId || !followUpProviderId || followUpProviderId !== providerId || !params.returnTarget) {
    return null;
  }

  return {
    nextTab: params.returnTarget.tab,
    modelResumeTarget: params.returnTarget.tab === "model"
      ? {
          phase: params.returnTarget.modelPhase ?? "provider",
          message: params.returnTarget.successMessage,
        }
      : undefined,
  };
}

export function resolveSettingsPostProviderSelectionNavigation(params: {
  providerId: string;
  providerLabel?: string;
  requiresAuth: boolean;
  providerWasChanged: boolean;
}): SettingsPostProviderSelectionNavigation {
  const providerId = params.providerId.trim();
  const providerLabel = params.providerLabel?.trim() || providerId;

  if (params.requiresAuth) {
    return {
      nextTab: "api-key",
      authReturnTarget: {
        tab: "model",
        modelPhase: "model",
        successMessage: `${providerLabel} authenticated. Pick a model below.`,
      },
    };
  }

  return {
    nextTab: "model",
    modelResumeTarget: {
      phase: "model",
      message: params.providerWasChanged
        ? `${providerLabel} selected. Pick a model below.`
        : `${providerLabel} confirmed. Pick a model below.`,
    },
  };
}