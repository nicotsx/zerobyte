import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [
			{ title: "Zerobyte" },
			{
				name: "description",
				content: "Zerobyte - Manage your backups and storage volumes with ease.",
			},
		],
	}),
	beforeLoad: () => {
		throw redirect({ to: "/volumes" });
	},
});
