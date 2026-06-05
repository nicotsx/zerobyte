import { runCLI } from "./server/cli";
import { createStartHandler, defaultStreamHandler, defineHandlerCallback } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

const cliRun = await runCLI(Bun.argv);
if (cliRun) {
	process.exit(0);
}

const customHandler = defineHandlerCallback((ctx) => {
	return defaultStreamHandler(ctx);
});

const fetch = createStartHandler(customHandler);

export default createServerEntry({
	fetch,
});
