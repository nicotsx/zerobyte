import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TimeAgo } from "../time-ago";
import { act, cleanup, render, screen } from "~/test/test-utils";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
	vi.setSystemTime(new Date("2026-11-14T15:00:05.000Z"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

test("refreshes the relative time while mounted", () => {
	render(<TimeAgo date={new Date("2026-11-14T15:00:00.000Z")} />);

	expect(screen.getByText("just now")).toBeTruthy();

	act(() => {
		vi.advanceTimersByTime(30 * 60 * 1000);
	});

	expect(screen.getByText("30 minutes ago")).toBeTruthy();
});
