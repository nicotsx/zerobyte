import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TimeAgo } from "../time-ago";
import { act, cleanup, render, screen } from "~/test/test-utils";

const { loaderNow } = vi.hoisted(() => ({
	loaderNow: Date.UTC(2026, 10, 14, 14, 55),
}));

vi.mock("~/client/hooks/use-root-loader-data", () => ({
	useRootLoaderData: () => ({ now: loaderNow }),
}));

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
	vi.setSystemTime(new Date("2026-11-14T15:00:05.000Z"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

test("renders relative time using the root loader timestamp on the server", () => {
	expect(renderToString(<TimeAgo date={new Date("2026-11-14T14:50:00.000Z")} />)).toContain("5 minutes ago");
});

test("refreshes mounted labels from a shared clock", () => {
	const backupDate = new Date("2026-11-14T14:58:15.000Z");
	const first = render(<TimeAgo date={backupDate} />);
	const second = render(<TimeAgo date={backupDate} />);

	expect(screen.getAllByText("just now")).toHaveLength(2);
	expect(vi.getTimerCount()).toBe(1);

	first.unmount();
	act(() => {
		vi.advanceTimersByTime(30_000);
	});

	expect(screen.getByText("2 minutes ago")).toBeTruthy();

	second.unmount();
	expect(vi.getTimerCount()).toBe(0);
});
