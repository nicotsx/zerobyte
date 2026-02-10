import { createFileRoute } from "@tanstack/react-router";
import { createApp } from "~/server/app";

const app = createApp();

const handle = ({ request }: { request: Request }) => app.fetch(request.clone());

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
			DELETE: handle,
			PUT: handle,
			PATCH: handle,
		},
	},
});
