import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "~/test/test-utils";

vi.mock("~/client/hooks/use-root-loader-data", () => ({
	useRootLoaderData: () => ({ locale: "en-US" }),
}));

import { BackupProgressCard } from "../backup-progress-card";

type BackupProgress = NonNullable<ComponentProps<typeof BackupProgressCard>["progress"]>;

const createProgress = (overrides: Partial<BackupProgress> = {}): BackupProgress => {
	return {
		message_type: "status",
		percent_done: 0.25,
		bytes_done: 256 * 1024,
		total_bytes: 1024 * 1024,
		seconds_elapsed: 5,
		seconds_remaining: 10,
		files_done: 25,
		total_files: 100,
		current_files: ["/backups/project/document.txt"],
		...overrides,
	};
};

afterEach(cleanup);

test("does not show an underflowed ETA after processed bytes exceed the discovered total", () => {
	const hugeEtaSeconds = 1_000_000_000_000_000;
	const progress = createProgress({
		percent_done: 1,
		bytes_done: 2 * 1024 * 1024,
		total_bytes: 1024 * 1024,
		seconds_remaining: hugeEtaSeconds,
	});

	render(<BackupProgressCard progress={progress} />);

	expect(screen.getByText("Calculating...")).toBeTruthy();
	expect(screen.queryByText(/11,574,074,074d/)).toBeNull();
});

test("keeps an active backup below 100 percent while Restic is still scanning", () => {
	const progress = createProgress({ percent_done: 1.1 });

	render(<BackupProgressCard progress={progress} />);

	expect(screen.getByText("99% · scanning")).toBeTruthy();
	const progressbar = screen.getByRole("progressbar", { name: "Backup in progress" });
	expect(progressbar.getAttribute("aria-valuenow")).toBe("99");
});

test("keeps processed data on one line while Restic totals grow", () => {
	const firstProgress = createProgress({
		percent_done: 1,
		bytes_done: 1024 * 1024,
		total_bytes: 1024 * 1024,
	});
	const { rerender } = render(<BackupProgressCard progress={firstProgress} />);

	expect(screen.getByText("Data processed")).toBeTruthy();
	expect(screen.getByText((_, element) => element?.textContent === "1 MiB processed")).toBeTruthy();
	expect(screen.queryByText(/discovered so far/i)).toBeNull();

	const nextProgress = createProgress({
		percent_done: 1,
		bytes_done: 2 * 1024 * 1024,
		total_bytes: 2 * 1024 * 1024,
	});
	rerender(<BackupProgressCard progress={nextProgress} />);

	expect(screen.getByText((_, element) => element?.textContent === "2 MiB processed")).toBeTruthy();
	expect(screen.queryByText(/discovered so far/i)).toBeNull();
});

test("shows the normal progress, rate, and ETA for coherent backup metrics", () => {
	const progress = createProgress({
		percent_done: 0.25,
		bytes_done: 256 * 1024,
		total_bytes: 1024 * 1024,
		seconds_elapsed: 5,
		seconds_remaining: 10,
	});

	render(<BackupProgressCard progress={progress} />);

	expect(screen.getByText("25%")).toBeTruthy();
	expect(screen.getByText((_, element) => element?.textContent === "256 KiB processed")).toBeTruthy();
	expect(screen.getByText("52.4 KB/s")).toBeTruthy();
	expect(screen.getByText("10s")).toBeTruthy();
});
