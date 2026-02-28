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
	errorComponent: () => <div>Failed to load page</div>,
	beforeLoad: () => {
		throw redirect({ to: "/volumes" });
	},
});
