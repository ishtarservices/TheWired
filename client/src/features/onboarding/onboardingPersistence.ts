import { saveUserState, getUserState } from "../../lib/db/userStateStore";

interface PersistedOnboarding {
  profileWizardCompleted: boolean;
  appTourCompleted: boolean;
}

export async function loadOnboardingState(): Promise<PersistedOnboarding | undefined> {
  return getUserState<PersistedOnboarding>("onboarding");
}

export async function persistOnboardingFlag(
  key: keyof PersistedOnboarding,
  value: boolean,
): Promise<void> {
  const current = (await getUserState<PersistedOnboarding>("onboarding")) ?? {
    profileWizardCompleted: false,
    appTourCompleted: false,
  };
  current[key] = value;
  await saveUserState("onboarding", current);
}
