import { createFileRoute } from "@tanstack/react-router";
import { OnboardingPage } from "~/client/modules/auth/routes/onboarding";

export const Route = createFileRoute("/(auth)/onboarding")({
	component: OnboardingPage,
	head: () => ({
		meta: [
			{ title: "Zerobyte - Onboarding" },
			{
				name: "description",
				content: "Welcome to Zerobyte. Create your admin account to get started.",
			},
		],
	}),
});
