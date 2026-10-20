import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { MachineSetupPage } from "~/client/modules/settings/routes/machine-setup";

export const Route = createFileRoute("/(dashboard)/settings/machines/connect")({
	validateSearch: z.object({ agentId: z.string().optional(), scope: z.literal("organization").optional() }),
	loader: ({ context }) => {
		if (!context.permissions["agents.manage"] || !context.features.remoteAgents) {
			throw redirect({ to: "/settings" });
		}
	},
	component: RouteComponent,
	staticData: {
		breadcrumb: () => [{ label: "Settings", href: "/settings?scope=organization" }, { label: "Connect machine" }],
	},
	head: () => ({ meta: [{ title: "Zerobyte - Connect machine" }] }),
});

function RouteComponent() {
	const { agentId } = Route.useSearch();

	return <MachineSetupPage key={agentId ?? "new"} agentId={agentId} />;
}
