import { useEffect, useRef, useState } from "react";

export function useMinimumDuration(isActive: boolean, minimumDuration: number): boolean {
	const [displayActive, setDisplayActive] = useState(isActive);
	const startTimeRef = useRef<number | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (isActive) {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
				timeoutRef.current = null;
			}
			startTimeRef.current = Date.now();
			setDisplayActive(true);
		} else if (startTimeRef.current !== null) {
			const elapsed = Date.now() - startTimeRef.current;
			const remaining = Math.max(0, minimumDuration - elapsed);

			if (remaining > 0) {
				timeoutRef.current = setTimeout(() => {
					setDisplayActive(false);
					startTimeRef.current = null;
				}, remaining);
			} else {
				setDisplayActive(false);
				startTimeRef.current = null;
			}
		}

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, [isActive, minimumDuration]);

	return displayActive;
}
