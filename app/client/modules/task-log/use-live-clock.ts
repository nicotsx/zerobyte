import { useEffect, useState } from "react";

export const useLiveClock = (enabled: boolean) => {
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		if (!enabled) return;

		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [enabled]);

	return now;
};
