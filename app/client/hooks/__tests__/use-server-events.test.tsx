import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { useServerEvents } from "../use-server-events";

class MockEventSource {
	static instances: MockEventSource[] = [];

	public onerror: ((event: Event) => void) | null = null;
	public close = mock(() => {});
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

const createTestQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Infinity,
			},
			mutations: {
				gcTime: Infinity,
			},
		},
	});

const ConnectionConsumer = ({ enabled = true }: { enabled?: boolean }) => {
	useServerEvents({ enabled });
	return null;
};

const BackupCompletedListener = ({ scheduleId }: { scheduleId: string }) => {
	const { addEventListener } = useServerEvents();
	const [status, setStatus] = useState("pending");

	useEffect(() => {
		const abortController = new AbortController();

		addEventListener(
			"backup:completed",
			(event) => {
				if (event.scheduleId === scheduleId) {
					setStatus(event.status);
				}
			},
			{ signal: abortController.signal },
		);

		return () => abortController.abort();
	}, [addEventListener, scheduleId]);

	return <div>{status}</div>;
};

describe("useServerEvents", () => {
	beforeEach(() => {
		MockEventSource.reset();
		globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
		console.info = mock(() => {});
		console.error = mock(() => {});
	});

	afterEach(() => {
		cleanup();
		globalThis.EventSource = originalEventSource;
		console.info = originalConsoleInfo;
		console.error = originalConsoleError;
		MockEventSource.reset();
	});

	test("shares one EventSource across consumers and invalidates queries once on backup completion", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueries = mock(async () => undefined);
		const refetchQueries = mock(async () => undefined);
		queryClient.invalidateQueries = invalidateQueries as typeof queryClient.invalidateQueries;
		queryClient.refetchQueries = refetchQueries as typeof queryClient.refetchQueries;

		render(
			<QueryClientProvider client={queryClient}>
				<ConnectionConsumer />
				<BackupCompletedListener scheduleId="0b9c940b" />
			</QueryClientProvider>,
		);

		expect(MockEventSource.instances).toHaveLength(1);

		MockEventSource.instances[0]?.emit("backup:completed", {
			organizationId: "default-org",
			scheduleId: "0b9c940b",
			volumeName: "synology",
			repositoryName: "swiss-backup",
			status: "success",
		});

		expect(await screen.findByText("success")).toBeTruthy();
		expect(invalidateQueries).toHaveBeenCalledTimes(1);
		expect(refetchQueries).not.toHaveBeenCalled();

		cleanup();

		expect(MockEventSource.instances[0]?.close).toHaveBeenCalledTimes(1);
	});

	test("waits to subscribe until enabled", () => {
		const queryClient = createTestQueryClient();
		const view = render(
			<QueryClientProvider client={queryClient}>
				<ConnectionConsumer enabled={false} />
			</QueryClientProvider>,
		);

		expect(MockEventSource.instances).toHaveLength(0);

		view.rerender(
			<QueryClientProvider client={queryClient}>
				<ConnectionConsumer />
			</QueryClientProvider>,
		);

		expect(MockEventSource.instances).toHaveLength(1);
		expect(MockEventSource.instances[0]?.url).toBe("/api/v1/events");
	});
});
