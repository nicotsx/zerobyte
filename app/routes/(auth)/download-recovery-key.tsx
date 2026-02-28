import { createFileRoute } from "@tanstack/react-router";
import { DownloadRecoveryKeyPage } from "~/client/modules/auth/routes/download-recovery-key";

export const Route = createFileRoute("/(auth)/download-recovery-key")({
	component: DownloadRecoveryKeyPage,
	errorComponent: () => <div>Failed to load recovery key</div>,
	head: () => ({
		meta: [
			{ title: "Zerobyte - Download Recovery Key" },
			{
				name: "description",
				content: "Download your backup recovery key to ensure you can restore your data.",
			},
		],
	}),
});
