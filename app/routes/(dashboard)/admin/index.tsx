import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/(dashboard)/admin/")({
	validateSearch: z.object({ tab: z.enum(["users", "system"]).optional() }),
	loader: () => {
		throw redirect({ to: "/settings", search: { scope: "instance" } });
	},
});
