import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface OnboardingState {
  showProfileWizard: boolean;
  showAppTour: boolean;
  profileWizardCompleted: boolean;
  appTourCompleted: boolean;
  tourStepIndex: number;
  loginMethod: "generate" | "import" | "nip07" | null;
}

const initialState: OnboardingState = {
  showProfileWizard: false,
  showAppTour: false,
  profileWizardCompleted: false,
  appTourCompleted: false,
  tourStepIndex: 0,
  loginMethod: null,
};

export const onboardingSlice = createSlice({
  name: "onboarding",
  initialState,
  reducers: {
    setShowProfileWizard(state, action: PayloadAction<boolean>) {
      state.showProfileWizard = action.payload;
    },
    setShowAppTour(state, action: PayloadAction<boolean>) {
      state.showAppTour = action.payload;
      if (action.payload) state.tourStepIndex = 0;
    },
    setProfileWizardCompleted(state, action: PayloadAction<boolean>) {
      state.profileWizardCompleted = action.payload;
      state.showProfileWizard = false;
    },
    setAppTourCompleted(state, action: PayloadAction<boolean>) {
      state.appTourCompleted = action.payload;
      state.showAppTour = false;
    },
    setTourStepIndex(state, action: PayloadAction<number>) {
      state.tourStepIndex = action.payload;
    },
    setLoginMethod(
      state,
      action: PayloadAction<OnboardingState["loginMethod"]>,
    ) {
      state.loginMethod = action.payload;
    },
    restoreOnboardingState(
      state,
      action: PayloadAction<{
        profileWizardCompleted?: boolean;
        appTourCompleted?: boolean;
      } | undefined>,
    ) {
      if (!action.payload) return;
      if (action.payload.profileWizardCompleted !== undefined)
        state.profileWizardCompleted = action.payload.profileWizardCompleted;
      if (action.payload.appTourCompleted !== undefined)
        state.appTourCompleted = action.payload.appTourCompleted;
    },
  },
});

export const {
  setShowProfileWizard,
  setShowAppTour,
  setProfileWizardCompleted,
  setAppTourCompleted,
  setTourStepIndex,
  setLoginMethod,
  restoreOnboardingState,
} = onboardingSlice.actions;
