import { useEffect, useState } from "react";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { rawFormatters, type DateInput } from "~/client/lib/datetime";

const REFRESH_INTERVAL_MS = 30_000;

type Props = {
	date: DateInput;
	className?: string;
};

export function TimeAgo({ date, className }: Props) {
	const { now: initialNow } = useRootLoaderData();
	const [now, setNow] = useState(initialNow);

	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect
		setNow(Date.now());
		const interval = window.setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS);
		return () => window.clearInterval(interval);
	}, []);

	return <span className={className}>{rawFormatters.formatTimeAgo(date, now)}</span>;
}
