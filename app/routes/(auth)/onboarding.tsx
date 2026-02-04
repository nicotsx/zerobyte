import { createFileRoute } from "@tanstack/react-router";
import { OnboardingPage } from "~/client/modules/auth/routes/onboarding";

export const Route = createFileRoute("/(auth)/onboarding")({
	component: OnboardingPage,
});
