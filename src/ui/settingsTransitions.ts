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