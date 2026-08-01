import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { useLiveClock } from "../use-live-clock";

const { loaderNow } = vi.hoisted(() => ({
	loaderNow: Date.UTC(2026, 6, 13, 12, 0, 0),
}));

vi.mock("~/client/hooks/use-root-loader-data", () => ({
	useRootLoaderData: () => ({ now: loaderNow }),
}));

const LiveClockValue = () => <time>{useLiveClock(false)}</time>;

test("uses the root loader timestamp during server rendering", () => {
	const dateNow = vi.spyOn(Date, "now").mockReturnValue(loaderNow + 60_000);

	expect(renderToString(<LiveClockValue />)).toContain(String(loaderNow));
	dateNow.mockRestore();
});
