import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { cleanup, createTestQueryClient, render, screen } from "~/test/test-utils";
import type { ServerEventPayloadMap } from "~/schemas/server-events";
import { useServerEvents } from "../use-server-events";

class MockEventSource {
	static instances: MockEventSource[] = [];

	public onerror: ((event: Event) => void) | null = null;
	public close = vi.fn(() => {});
	private listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(public url: string) {
		MockEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
		const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
		listeners.add(callback);
		this.listeners.set(type, listeners);
	}

	emit(type: string, data: unknown) {
		const event = new MessageEvent(type, {
			data: JSON.stringify(data),
		});
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	static reset() {
		MockEventSource.instances = [];
	}
}

const originalEventSource = globalThis.EventSource;
const originalConsoleInfo = console.info;
const originalConsoleError = console.error;

const ConnectionConsumer = ({ enabled = true }: { enabled?: boolean }) => {
	useServerEvents({ enabled });
	return null;
};

const QueryStatusConsumer = ({ getValue }: { getValue: () => string }) => {
	const { data } = useQuery({
		queryKey: ["backup-status"],
		queryFn: async () => getValue(),
	});

	return <div>{data}</div>;
};

describe("useServerEvents", () => {
	beforeEach(() => {
		MockEventSource.reset();
		globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
		console.info = vi.fn(() => {});
		console.error = vi.fn(() => {});
	});

	afterEach(() => {
		cleanup();
		globalThis.EventSource = originalEventSource;
		console.info = originalConsoleInfo;
		console.error = originalConsoleError;
		MockEventSource.reset();
	});

	test("shares one EventSource across consumers", () => {
		const queryClient = createTestQueryClient();

		const view = render(
			<>
				<ConnectionConsumer />
				<ConnectionConsumer />
			</>,
			{ queryClient },
		);

		expect(MockEventSource.instances).toHaveLength(1);

		view.unmount();

		expect(MockEventSource.instances[0]?.close).toHaveBeenCalledTimes(1);
	});

	test("refreshes active queries when task history changes", async () => {
		const queryClient = createTestQueryClient();
		let queryValue = "doctor";

		render(
			<>
				<ConnectionConsumer />
				<QueryStatusConsumer getValue={() => queryValue} />
			</>,
			{ queryClient },
		);

		expect(await screen.findByText("doctor")).toBeTruthy();
		queryValue = "healthy";

		const taskHistoryChangedEvent: ServerEventPayloadMap["task:history-changed"] = {
			organizationId: "default-org",
			previousOutcome: "running",
			item: {
				id: "doctor-task",
				kind: "doctor",
				status: "succeeded",
				outcome: "success",
				startedAt: 1,
				finishedAt: 2,
				message: null,
			},
		};
		MockEventSource.instances[0]?.emit("task:history-changed", taskHistoryChangedEvent);

		expect(await screen.findByText("healthy")).toBeTruthy();
	});

	test("refreshes active queries when the event stream connects", async () => {
		const queryClient = createTestQueryClient();
		let queryValue = "before";

		render(
			<>
				<ConnectionConsumer />
				<QueryStatusConsumer getValue={() => queryValue} />
			</>,
			{ queryClient },
		);

		expect(await screen.findByText("before")).toBeTruthy();
		queryValue = "after";
		MockEventSource.instances[0]?.emit("connected", { type: "connected", timestamp: 1 });

		expect(await screen.findByText("after")).toBeTruthy();
	});

	test("waits to subscribe until enabled", () => {
		const queryClient = createTestQueryClient();
		const view = render(<ConnectionConsumer enabled={false} />, { queryClient });

		expect(MockEventSource.instances).toHaveLength(0);

		view.rerender(<ConnectionConsumer />);

		expect(MockEventSource.instances).toHaveLength(1);
		expect(MockEventSource.instances[0]?.url).toBe("/api/v1/events");
	});
});
