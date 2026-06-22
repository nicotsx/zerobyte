import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowRight,
	CalendarClock,
	Database,
	ExternalLink,
	HardDrive,
	Play,
	Power,
	Square,
} from "lucide-react";
import {
	getBackupProgressOptions,
	listBackupSchedulesOptions,
	runBackupNowMutation,
	stopBackupMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { ListBackupSchedulesResponse } from "~/client/api-client/types.gen";
import { TimeAgo } from "~/client/components/time-ago";
import { Button } from "~/client/components/ui/button";
import { Progress } from "~/client/components/ui/progress";
import { useFormatBytes } from "~/client/hooks/use-format-bytes";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import { formatDuration } from "~/utils/utils";
import { BackupStatusDot } from "~/client/modules/backups/components/backup-status-dot";

type TraySchedule = ListBackupSchedulesResponse[number];

export const Route = createFileRoute("/desktop/tray")({
	component: DesktopTrayPage,
	head: () => ({
		meta: [{ title: "Zerobyte Tray" }],
	}),
});

function DesktopTrayPage() {
	const { data: schedules = [], isLoading, error } = useQuery(listBackupSchedulesOptions());

	return (
		<main className="dark h-dvh max-h-dvh overflow-hidden bg-background text-foreground">
			<div className="relative flex h-full flex-col overflow-hidden border border-border bg-background">
				<section className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin pt-3">
					<div className={cn({ hidden: !isLoading })}>
						<TrayLoadingState />
					</div>
					<div className={cn({ hidden: !error })}>
						<TrayErrorState />
					</div>
					<div className={cn({ hidden: isLoading || error || schedules.length > 0 })}>
						<TrayEmptyState />
					</div>
					<div
						className={cn("border border-border bg-card", {
							hidden: isLoading || error || schedules.length === 0,
						})}
					>
						{schedules.map((schedule) => (
							<TrayScheduleRow key={schedule.shortId} schedule={schedule} />
						))}
					</div>
				</section>
				<TrayFooter />
			</div>
		</main>
	);
}

function TrayScheduleRow({ schedule }: { schedule: TraySchedule }) {
	const { formatShortDateTime } = useTimeFormat();
	const runBackup = useMutation(runBackupNowMutation());
	const stopBackup = useMutation(stopBackupMutation());
	let nextBackup = "Paused";
	if (schedule.enabled) {
		nextBackup = schedule.cronExpression ? formatShortDateTime(schedule.nextBackupAt) : "Manual";
	}
	const isRunning = schedule.lastBackupStatus === "in_progress";
	const isPending = runBackup.isPending || stopBackup.isPending;

	const openSchedule = () => {
		openMainWindow(`/backups/${schedule.shortId}`);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) {
			return;
		}

		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			openSchedule();
		}
	};

	const handleActionClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (isRunning) {
			stopBackup.mutate({ path: { shortId: schedule.shortId } });
			return;
		}

		runBackup.mutate({ path: { shortId: schedule.shortId } });
	};

	return (
		<div
			aria-label={`Open ${schedule.name}`}
			// oxlint-disable-next-line jsx_a11y/prefer-tag-over-role
			role="button"
			tabIndex={0}
			onClick={openSchedule}
			onKeyDown={handleKeyDown}
			className={cn(
				"group cursor-pointer border-b border-border p-2.5 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-ring",
				{ "opacity-65": !schedule.enabled },
			)}
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="grid size-3 shrink-0 place-items-center">
					<BackupStatusDot
						enabled={schedule.enabled}
						hasError={schedule.lastBackupStatus === "error"}
						hasWarning={schedule.lastBackupStatus === "warning"}
						isInProgress={schedule.lastBackupStatus === "in_progress"}
					/>
				</span>
				<h2 className="truncate text-sm font-semibold leading-5">{schedule.name}</h2>
			</div>
			<div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
				<HardDrive className="h-3 w-3 shrink-0" />
				<span className="truncate font-mono">{schedule.volume.name}</span>
				<ArrowRight className="h-3 w-3 shrink-0" />
				<Database className="h-3 w-3 shrink-0 text-strong-accent" />
				<span className="truncate font-mono text-strong-accent">{schedule.repository.name}</span>
			</div>

			<div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
				<span className="min-w-0 truncate">
					Last: <TimeAgo date={schedule.lastBackupAt} />
				</span>
				<span className="shrink-0 text-border">|</span>
				<span className="min-w-0 truncate">Next: {nextBackup}</span>
				<ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
			</div>
			<TrayProgressLine scheduleShortId={schedule.shortId} isRunning={isRunning} />
			<Button
				size="sm"
				loading={isPending}
				aria-label={isRunning ? `Stop ${schedule.name}` : `Run ${schedule.name}`}
				className="w-18 text-[11px] mt-2"
				onClick={handleActionClick}
			>
				{isRunning ? <Square size={12} className="mr-2" /> : <Play size={12} className="mr-2" />}
				<span>{isRunning ? "Stop" : "Run"}</span>
			</Button>
		</div>
	);
}

function TrayProgressLine({ scheduleShortId, isRunning }: { scheduleShortId: string; isRunning: boolean }) {
	const formatBytes = useFormatBytes();
	const { data: progress } = useQuery({
		...getBackupProgressOptions({ path: { shortId: scheduleShortId } }),
		enabled: isRunning,
		refetchInterval: isRunning ? 1000 : false,
	});

	if (!isRunning || !progress) {
		return null;
	}

	const percentDone = Math.round((progress.percent_done ?? 0) * 100);
	const secondsElapsed = progress.seconds_elapsed ?? 0;
	const bytesDone = progress.bytes_done ?? 0;
	const speed = secondsElapsed > 0 ? formatBytes(bytesDone / secondsElapsed) : null;
	const eta = progress.seconds_remaining ? formatDuration(progress.seconds_remaining) : null;
	const labelParts = [
		`${percentDone}%`,
		speed ? `${speed.text} ${speed.unit}/s` : null,
		eta ? `${eta} left` : null,
	].filter(Boolean);

	return (
		<div className="mt-3 space-y-1.5">
			<Progress value={percentDone} className="h-1 [&>div]:bg-strong-accent" />
			<p className="truncate text-[11px] text-muted-foreground">{labelParts.join(" | ")}</p>
		</div>
	);
}

function TrayLoadingState() {
	return (
		<div className="space-y-2 pt-3">
			{[0, 1, 2].map((item) => (
				<div key={item} className="h-24 animate-pulse border border-border bg-card" />
			))}
		</div>
	);
}

function TrayErrorState() {
	return (
		<div className="mt-10 flex flex-col items-center gap-3 px-8 text-center">
			<AlertTriangle className="h-6 w-6 text-destructive" />
			<div>
				<p className="text-sm font-semibold">Backup status unavailable</p>
				<p className="mt-1 text-xs leading-5 text-muted-foreground">
					Open Zerobyte to inspect the server state.
				</p>
			</div>
		</div>
	);
}

function TrayEmptyState() {
	return (
		<div className="mt-12 flex flex-col items-center gap-4 px-8 text-center">
			<div className="grid h-10 w-10 place-items-center border border-border bg-card">
				<CalendarClock className="h-5 w-5 text-strong-accent" />
			</div>
			<div>
				<p className="text-sm font-semibold">No backup jobs yet</p>
				<p className="mt-1 text-xs leading-5 text-muted-foreground">
					Create a job to start backing up your volumes.
				</p>
			</div>
			<Button size="sm" onClick={() => openMainWindow("/backups/create")}>
				Create
			</Button>
		</div>
	);
}

function TrayFooter() {
	return (
		<footer className="flex justify-end border-t border-border bg-card-header p-3">
			<Button
				variant="secondary"
				size="icon"
				aria-label="Quit Zerobyte"
				className="h-8 w-8"
				onClick={() => window.zerobyteDesktop?.quit()}
			>
				<Power className="h-4 w-4" />
			</Button>
		</footer>
	);
}

function openMainWindow(path?: string) {
	if (window.zerobyteDesktop) {
		void window.zerobyteDesktop.openMainWindow(path);
		return;
	}

	window.location.assign(path ?? "/volumes");
}
