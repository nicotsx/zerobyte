import { useEffect, useState } from "react";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";

export const useLiveClock = (enabled: boolean) => {
	const { now: initialNow } = useRootLoaderData();
	const [now, setNow] = useState(initialNow);

	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- Refresh the SSR timestamp on mount and when the live clock stops or starts.
		setNow(Date.now());
		if (!enabled) return;

		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [enabled]);

	return now;
};
