import { Outlet, createFileRoute } from "@tanstack/react-router";
import { authMiddleware } from "~/middleware/auth";

export const Route = createFileRoute("/(auth)")({
	component: () => <Outlet />,
	errorComponent: () => <div>Failed to load auth</div>,
	server: {
		middleware: [authMiddleware],
	},
});
