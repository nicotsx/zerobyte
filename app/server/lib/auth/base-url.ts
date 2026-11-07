type AllowedHostsResult = {
	allowedHosts: string[];
	invalidOrigins: string[];
};

export function buildAllowedHosts(origins: string[]): AllowedHostsResult {
	const validHosts = new Set<string>();
	const invalidOrigins: string[] = [];

	for (const origin of origins) {
		try {
			validHosts.add(new URL(origin).host);
		} catch {
			invalidOrigins.push(origin);
		}
	}

	return {
		allowedHosts: Array.from(validHosts),
		invalidOrigins,
	};
}

export function getPasskeyOrigins(origins: string[]): string[] {
	const exactOrigins = origins.filter((origin) => !origin.includes("*") && !origin.includes("?"));

	return Array.from(new Set(exactOrigins.map((origin) => new URL(origin).origin)));
}
