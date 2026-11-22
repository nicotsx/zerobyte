import { useSyncExternalStore } from "react";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { rawFormatters, type DateInput } from "~/client/lib/datetime";

const REFRESH_INTERVAL_MS = 30_000;
const clockListeners = new Set<() => void>();

let clockNow: number | undefined;
let clockInterval: number | undefined;

function tickClock() {
	clockNow = Date.now();
	for (const listener of clockListeners) listener();
}

function subscribeToClock(listener: () => void) {
	if (clockInterval === undefined) {
		clockNow = Date.now();
		clockInterval = window.setInterval(tickClock, REFRESH_INTERVAL_MS);
	}

	clockListeners.add(listener);

	return () => {
		clockListeners.delete(listener);
		if (clockListeners.size === 0) {
			window.clearInterval(clockInterval);
			clockInterval = undefined;
			clockNow = undefined;
		}
	};
}

const getClockSnapshot = () => clockNow;

type Props = {
	date: DateInput;
	className?: string;
};

export function TimeAgo({ date, className }: Props) {
	const { now: loaderNow } = useRootLoaderData();
	const now = useSyncExternalStore(subscribeToClock, getClockSnapshot, () => loaderNow) ?? loaderNow;

	return <span className={className}>{rawFormatters.formatTimeAgo(date, now)}</span>;
}
