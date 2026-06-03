import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHotkeySequence } from "@tanstack/react-hotkeys";
import { getDevPanelOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { DevPanel } from "./dev-panel";

export function DevPanelListener() {
	const [isOpen, setIsOpen] = useState(false);
	const { data: devPanelStatus } = useQuery({
		...getDevPanelOptions(),
	});

	useHotkeySequence(["D", "E", "V"], () => setIsOpen(true), {
		enabled: !!devPanelStatus?.enabled,
		preventDefault: true,
		ignoreInputs: true,
		timeout: 1000,
	});

	if (!devPanelStatus?.enabled) {
		return null;
	}

	return <DevPanel open={isOpen} onOpenChange={setIsOpen} />;
}
