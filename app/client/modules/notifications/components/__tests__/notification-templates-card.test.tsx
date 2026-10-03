import { useSuspenseQuery } from "@tanstack/react-query";
import { afterEach, expect, test } from "vitest";
import { getNotificationDestinationOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { defaultNotificationTemplates, type NotificationTemplateSet } from "~/lib/notification-templates/catalog";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { NotificationTemplatesCard } from "../notification-templates-card";

afterEach(cleanup);

function DestinationTemplates() {
	const { data } = useSuspenseQuery(getNotificationDestinationOptions({ path: { id: "1" } }));
	return <NotificationTemplatesCard notificationId="1" enabled={data.enabled} templates={data.templates} />;
}

test("edits the actual default source, saves every event, and retains the change after reload", async () => {
	let stored = structuredClone(defaultNotificationTemplates);
	server.use(
		http.get("/api/v1/notifications/destinations/1", () =>
			HttpResponse.json({ name: "Alerts", enabled: true, templates: stored }),
		),
		http.patch("/api/v1/notifications/destinations/1", async ({ request }) => {
			const body = (await request.json()) as { templates: NotificationTemplateSet };
			expect(Object.keys(body)).toEqual(["templates"]);
			expect(body.templates.backup_start).toEqual(defaultNotificationTemplates.backup_start);
			expect(Object.keys(body.templates)).toHaveLength(6);
			stored = body.templates;
			return HttpResponse.json({ templates: stored });
		}),
	);
	const first = render(<DestinationTemplates />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));

	expect((screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).value).toEqual(
		defaultNotificationTemplates.backup_success.body,
	);
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		defaultNotificationTemplates.backup_success.title,
	);
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Backup completed · Zerobyte");
	expect(
		within(screen.getByRole("region", { name: "Message preview" })).getByText("Backup completed · Zerobyte"),
	).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
	await screen.findByRole("button", { name: "Edit templates" });
	first.unmount();

	render(<DestinationTemplates />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Backup completed · Zerobyte",
	);
});

test("reopens saved templates before the refresh completes and accepts later server changes", async () => {
	let stored = structuredClone(defaultNotificationTemplates);
	let reads = 0;
	const refreshStarted = Promise.withResolvers<void>();
	const releaseRefresh = Promise.withResolvers<void>();

	server.use(
		http.get("/api/v1/notifications/destinations/1", async () => {
			reads += 1;
			if (reads === 2) {
				refreshStarted.resolve();
				await releaseRefresh.promise;
			}

			return HttpResponse.json({ name: "Alerts", enabled: true, templates: stored });
		}),
		http.patch("/api/v1/notifications/destinations/1", async ({ request }) => {
			const body = (await request.json()) as { templates: NotificationTemplateSet };
			stored = body.templates;

			return HttpResponse.json({ name: "Alerts", enabled: true, templates: stored });
		}),
	);
	const view = render(<DestinationTemplates />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Saved replacement title");
	await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
	await refreshStarted.promise;
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Saved replacement title",
	);
	await userEvent.clear(screen.getByRole("textbox", { name: "Body" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Body" }), "Another unsaved edit");

	releaseRefresh.resolve();
	await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Saved replacement title",
	);
	expect((screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).value).toEqual(
		"Another unsaved edit",
	);
	await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
	await screen.findByRole("button", { name: "Edit templates" });
	await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Saved replacement title",
	);
	expect((screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).value).toEqual(
		"Another unsaved edit",
	);
	await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

	stored = { ...stored, backup_success: { ...stored.backup_success, title: "Updated elsewhere" } };
	await view.queryClient.refetchQueries();
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual("Updated elsewhere");
});

test("keeps a saved change when an earlier refresh returns and preserves it in the next save", async () => {
	let stored = structuredClone(defaultNotificationTemplates);
	let reads = 0;
	const refreshStarted = Promise.withResolvers<void>();
	const releaseRefresh = Promise.withResolvers<void>();

	server.use(
		http.get("/api/v1/notifications/destinations/1", async () => {
			const templates = structuredClone(stored);
			reads += 1;

			if (reads === 2) {
				refreshStarted.resolve();
				await releaseRefresh.promise;
			}

			return HttpResponse.json({ name: "Alerts", enabled: true, templates });
		}),
		http.patch("/api/v1/notifications/destinations/1", async ({ request }) => {
			const body = (await request.json()) as { templates: NotificationTemplateSet };
			stored = body.templates;

			return HttpResponse.json({ name: "Alerts", enabled: true, templates: stored });
		}),
	);
	const view = render(<DestinationTemplates />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Saved replacement title");

	const earlierRefresh = view.queryClient.refetchQueries();
	await refreshStarted.promise;
	await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
	await screen.findByRole("button", { name: "Edit templates" });

	releaseRefresh.resolve();
	await earlierRefresh;
	await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
	expect(
		within(screen.getByRole("region", { name: "Message preview" })).getByText("Saved replacement title"),
	).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Saved replacement title",
	);
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Mirror sync failed" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Another saved event");
	await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
	await screen.findByRole("button", { name: "Edit templates" });
	await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Another saved event",
	);
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Backup completed" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		"Saved replacement title",
	);
});

test("keeps distinct event drafts, resets only the selected event, and cancels unsaved changes", async () => {
	const templates = structuredClone(defaultNotificationTemplates);
	templates.mirror_failure.title = "My mirror alert";
	const view = render(<NotificationTemplatesCard notificationId="1" enabled templates={templates} />);
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "My backup alert");
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Mirror sync failed" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual("My mirror alert");
	await userEvent.click(screen.getByRole("button", { name: "Reset to default" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		defaultNotificationTemplates.mirror_failure.title,
	);
	expect((screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).value).toEqual(
		defaultNotificationTemplates.mirror_failure.body,
	);
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Backup completed" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual("My backup alert");

	view.rerender(
		<NotificationTemplatesCard
			notificationId="1"
			enabled
			templates={structuredClone(defaultNotificationTemplates)}
		/>,
	);
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual("My backup alert");
	await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual(
		defaultNotificationTemplates.backup_success.title,
	);
});

test("validates variables and optional sections, prevents saving hidden errors, and previews literal values safely", async () => {
	render(<NotificationTemplatesCard notificationId="1" enabled templates={defaultNotificationTemplates} />);
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Body" }));
	await userEvent.paste("{{unknown}}");
	expect(screen.getByRole("alert").textContent).toContain("Unknown variable: unknown");
	expect(screen.getByRole("textbox", { name: "Body" }).getAttribute("aria-invalid")).toBe("true");
	expect((screen.getByRole("button", { name: "Save templates" }) as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true);
	await userEvent.clear(screen.getByRole("textbox", { name: "Body" }));
	await userEvent.paste("{{#schedule}}Hello");
	expect(screen.getByRole("alert").textContent).toContain("Unclosed section");
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Mirror sync failed" }));
	expect(screen.getByRole("alert").textContent).toContain("Backup completed");
	expect((screen.getByRole("button", { name: "Save templates" }) as HTMLButtonElement).disabled).toBe(true);
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Backup completed" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Body" }));
	await userEvent.paste(
		"**Source:** {{source}}\n{{#duration}}Time: {{duration}}{{/duration}}\n<script>literal</script>",
	);
	const preview = screen.getByRole("region", { name: "Message preview" });
	expect(preview.textContent).toContain("Source: Documents");
	expect(preview.textContent).toContain("Time: 1m 24s");
	expect(preview.textContent).toContain("<script>literal</script>");
	expect((screen.getByRole("button", { name: "Save templates" }) as HTMLButtonElement).disabled).toBe(false);
	expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false);
});

test("sends the selected draft without saving and keeps edits after the resulting query refresh", async () => {
	let sent: unknown;
	let reads = 0;
	server.use(
		http.get("/api/v1/notifications/destinations/1", () => {
			reads += 1;
			return HttpResponse.json({
				name: "Alerts",
				enabled: true,
				templates: structuredClone(defaultNotificationTemplates),
			});
		}),
		http.post("/api/v1/notifications/destinations/1/test-template", async ({ request }) => {
			sent = await request.json();
			return HttpResponse.json({ success: true });
		}),
	);
	render(<DestinationTemplates />, { withSuspense: true });
	await userEvent.click(await screen.findByRole("button", { name: "Edit templates" }));
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Mirror sync failed" }));
	await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Draft mirror title");
	await userEvent.click(screen.getByRole("button", { name: "Send test" }));
	await waitFor(() =>
		expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false),
	);
	await waitFor(() => expect(reads).toBeGreaterThan(1));
	expect(sent).toEqual({
		key: "mirror_failure",
		template: { title: "Draft mirror title", body: defaultNotificationTemplates.mirror_failure.body },
	});
	expect((screen.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement).value).toEqual("Draft mirror title");
});

test("saves a reset for one event while preserving the other saved templates", async () => {
	const templates = structuredClone(defaultNotificationTemplates);
	templates.backup_success = { title: "My backup", body: "Saved backup body" };
	templates.mirror_failure = { title: "My mirror", body: "Saved mirror body" };
	let submitted: NotificationTemplateSet | undefined;

	server.use(
		http.patch("/api/v1/notifications/destinations/1", async ({ request }) => {
			const body = (await request.json()) as { templates: NotificationTemplateSet };
			submitted = body.templates;
			return HttpResponse.json({ templates: submitted });
		}),
	);
	render(<NotificationTemplatesCard notificationId="1" enabled templates={templates} />);
	await userEvent.click(screen.getByRole("button", { name: "Edit templates" }));
	await userEvent.click(screen.getByRole("combobox", { name: "Event" }));
	await userEvent.click(screen.getByRole("option", { name: "Mirror sync failed" }));
	await userEvent.click(screen.getByRole("button", { name: "Reset to default" }));
	await userEvent.click(screen.getByRole("button", { name: "Save templates" }));
	await screen.findByRole("button", { name: "Edit templates" });

	expect(submitted?.mirror_failure).toEqual(defaultNotificationTemplates.mirror_failure);
	expect(submitted?.backup_success).toEqual(templates.backup_success);
});
