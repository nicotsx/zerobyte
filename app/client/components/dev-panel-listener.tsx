import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDevPanelOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { DevPanel } from "./dev-panel";

export function DevPanelListener() {
	const [isOpen, setIsOpen] = useState(false);
	const pressedKeysRef = useRef<Set<string>>(new Set());

	const { data: devPanelStatus } = useQuery({
		...getDevPanelOptions(),
	});

	const isEnabled = devPanelStatus?.enabled ?? false;

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (!isEnabled) return;
			pressedKeysRef.current.add(e.key.toLowerCase());

			const keys = pressedKeysRef.current;
			if (keys.has("d") && keys.has("e") && keys.has("v")) {
				setIsOpen(true);
				pressedKeysRef.current.clear();
			}
		},
		[isEnabled],
	);

	const handleKeyUp = useCallback(
		(e: KeyboardEvent) => {
			if (!isEnabled) return;
			pressedKeysRef.current.delete(e.key.toLowerCase());
		},
		[isEnabled],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
		};
	}, [handleKeyDown, handleKeyUp]);

	if (!isEnabled) {
		return null;
	}

	return <DevPanel open={isOpen} onOpenChange={setIsOpen} />;
}
