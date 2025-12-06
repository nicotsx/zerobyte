import { useQuery } from "@tanstack/react-query";
import { getApiV1SecretProviders } from "~/client/api-client";
import { BUILTIN_SECRET_SCHEMES } from "~/client/lib/secrets";

type SecretProvider = {
	enabled: boolean;
	uriPrefix: string;
};

/**
 * Hook to fetch all registered secret provider schemes
 * Returns built-in schemes + dynamically registered provider schemes
 */
export function useSecretSchemes() {
	const { data } = useQuery({
		queryKey: ["secret-providers-schemes"],
		queryFn: async () => {
			const result = await getApiV1SecretProviders();
			// Response is { providers: [...] }
			const response = result.data as { providers: SecretProvider[] } | undefined;
			return response?.providers ?? [];
		},
		staleTime: 5 * 60 * 1000, // Cache for 5 minutes
		gcTime: 10 * 60 * 1000,
	});

	// Extract schemes from provider uriPrefix (e.g., "op://" -> "op")
	const dynamicSchemes =
		data
			?.filter((p) => p.enabled)
			.map((p) => p.uriPrefix.replace("://", ""))
			.filter((scheme) => !BUILTIN_SECRET_SCHEMES.includes(scheme as (typeof BUILTIN_SECRET_SCHEMES)[number])) ?? [];

	// Combine built-in + dynamic schemes
	const allSchemes = [...BUILTIN_SECRET_SCHEMES, ...dynamicSchemes];

	return {
		schemes: allSchemes,
		builtinSchemes: BUILTIN_SECRET_SCHEMES,
		dynamicSchemes,
		isLoading: !data,
	};
}
