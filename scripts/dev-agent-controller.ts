const parseControllerUrl = (value: string) => {
	const url = new URL(value);
	if (
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error("Invalid Portless controller URL");
	}

	return url;
};

export const getDevControllerUrl = async (runPortless: (args: string[]) => Promise<string>) => {
	try {
		const localUrl = parseControllerUrl((await runPortless(["get", "zerobyte"])).trim());
		const routes = await runPortless(["list"]);
		let matchingRoute = false;

		for (const line of routes.split(/\r?\n/)) {
			const route = /^\s+(https?:\/\/\S+)\s+->\s+localhost:\d+\s+\(pid \d+\)\s*$/.exec(line);
			if (route) matchingRoute = route[1] === localUrl.href.replace(/\/$/, "");
			else if (/^\s+https?:\/\//.test(line)) matchingRoute = false;

			const tailscale = /^\s+tailscale:\s+(https:\/\/\S+)\s*$/.exec(line);
			if (matchingRoute && tailscale?.[1]) return parseControllerUrl(tailscale[1]).origin;
		}

		throw new Error("No active Tailscale route for this worktree");
	} catch (error) {
		throw new Error(
			"Could not resolve the running Zerobyte controller from Portless. Start bun run dev with Tailscale before deploying the agent.",
			{ cause: error },
		);
	}
};
