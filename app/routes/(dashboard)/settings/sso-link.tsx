import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/settings/sso-link")({
	beforeLoad: () => {
		throw redirect({
			to: "/settings",
			search: () => ({ tab: "users" }),
		});
	},
});
