import {
	Outlet,
	RouterProvider,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, expect, test } from "vitest";
import type { GetNotificationDestinationResponse } from "~/client/api-client/types.gen";
import { defaultNotificationTemplates, type NotificationTemplateSet } from "~/lib/notification-templates/catalog";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { NotificationDetailsPage } from "../notification-details";

afterEach(cleanup);

test("preserves saved templates on a leading-zero route when an older refresh returns", async () => {
	let stored = structuredClone(defaultNotificationTemplates);
	let reads = 0;
	let staleRequest: Request | undefined;
	const staleRefreshStarted = Promise.withResolvers<void>();
	const releaseStaleRefresh = Promise.withResolvers<void>();
	const savedRefreshStarted = Promise.withResolvers<void>();
	const releaseSavedRefresh = Promise.withResolvers<void>();

	const destination = fromPartial<GetNotificationDestinationResponse>({
		id: 1,
		name: "Alerts",
		enabled: true,
		type: "custom",
		config: { type: "custom", shoutrrrUrl: "generic://example.com" },
		createdAt: 0,
	});

	server.use(
		http.get("/api/v1/notifications/destinations/01", async ({ request }) => {
			const templates = structuredClone(stored);
			reads += 1;

			if (reads === 2) {
				staleRequest = request;
				staleRefreshStarted.resolve();
				await releaseStaleRefresh.promise;
			} else if (reads === 3) {
				savedRefreshStarted.resolve();
				await releaseSavedRefresh.promise;
			}

			return HttpResponse.json({ ...destination, templates });
		}),
		http.patch("/api/v1/notifications/destinations/:id", async ({ request }) => {
			const body = (await request.json()) as { templates: NotificationTemplateSet };
			stored = body.templates;

			return HttpResponse.json({ ...destination, templates: stored });
		}),
	);

	const rootRoute = createRootRoute({ component: Outlet });
	const destinationRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/notifications/$notificationId",
		component: () => {
			const { notificationId } = destinationRoute.useParams();

			return <NotificationDetailsPage notificationId={notificationId} />;
		},
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([destinationRoute]),
		history: createMemoryHistory({ initialEntries: ["/notifications/01"] }),
	});

	const view = render(<RouterProvider router={router} />, { withSuspense: true });

	try {
		await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
		await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
		await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Saved replacement title");

		const earlierRefresh = view.queryClient.refetchQueries();
		await staleRefreshStarted.promise;
		await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
		await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
		expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
			"Saved replacement title",
		);
		expect(staleRequest?.signal.aborted).toBe(true);

		await savedRefreshStarted.promise;
		releaseStaleRefresh.resolve();
		await earlierRefresh;
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
		expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
			"Saved replacement title",
		);

		releaseSavedRefresh.resolve();
		await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
		await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
		await userEvent.click(screen.getByRole("option", { name: "Mirror sync failed" }));
		await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
		await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Another saved event");
		await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
		await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
		await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
		await userEvent.click(screen.getByRole("option", { name: "Backup completed" }));
		expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
			"Saved replacement title",
		);
	} finally {
		releaseStaleRefresh.resolve();
		releaseSavedRefresh.resolve();
	}
});

test("starts with the destination's own saved templates when switching destinations with an open draft", async () => {
	const secondTemplates = structuredClone(defaultNotificationTemplates);
	secondTemplates.backup_success.title = "Second destination title";

	server.use(
		http.get("/api/v1/notifications/destinations/:id", ({ params }) =>
			HttpResponse.json(
				fromPartial<GetNotificationDestinationResponse>({
					id: Number(params.id),
					name: `Destination ${String(params.id)}`,
					enabled: true,
					type: "custom",
					config: { type: "custom", shoutrrrUrl: "generic://example.com" },
					createdAt: 0,
					templates: params.id === "2" ? secondTemplates : defaultNotificationTemplates,
				}),
			),
		),
	);
	const rootRoute = createRootRoute({
		component: () => (
			<>
				<button
					onClick={() =>
						void router.navigate({ to: "/notifications/$notificationId", params: { notificationId: "2" } })
					}
				>
					Open second destination
				</button>
				<Outlet />
			</>
		),
	});
	const destinationRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/notifications/$notificationId",
		component: () => {
			const { notificationId } = destinationRoute.useParams();

			return <NotificationDetailsPage notificationId={notificationId} />;
		},
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([destinationRoute]),
		history: createMemoryHistory({ initialEntries: ["/notifications/1"] }),
	});

	render(<RouterProvider router={router} />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "First destination unsaved draft");
	await userEvent.click(screen.getByRole("button", { name: "Open second destination" }));
	await screen.findByRole("heading", { name: "Destination 2" });
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));

	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Second destination title",
	);
});
