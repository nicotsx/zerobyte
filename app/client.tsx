import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { parseError } from "./client/lib/errors";

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
		{
			onRecoverableError: (error, errorInfo) => {
				console.error(
					`[react-recoverable-error] ${parseError(error)?.message}${errorInfo.componentStack ? `\n${errorInfo.componentStack.trim()}` : ""}`,
				);
			},
		},
	);
});
