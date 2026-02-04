import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "~/client/modules/auth/routes/login";

export const Route = createFileRoute("/(auth)/login")({
	component: LoginPage,
	head: () => ({
		meta: [
			{ title: "Zerobyte - Login" },
			{
				name: "description",
				content: "Sign in to your Zerobyte account.",
			},
		],
	}),
});
