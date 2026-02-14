import { Outlet, createFileRoute } from "@tanstack/react-router";
import { authMiddleware } from "~/middleware/auth";

export const Route = createFileRoute("/(auth)")({
	component: () => <Outlet />,
	server: {
		middleware: [authMiddleware],
	},
});
