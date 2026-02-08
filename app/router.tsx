import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { client } from "./client/api-client/client.gen";
import type { BreadcrumbItemData } from "./client/components/app-breadcrumb";

client.setConfig({
	baseUrl: "/",
	credentials: "include",
});

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
		mutationCache: new MutationCache({
			onSuccess: () => {
				void queryClient.invalidateQueries();
			},
			onError: (error) => {
				console.error("Mutation error:", error);
				void queryClient.invalidateQueries();
			},
		}),
	});

	const router = createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		scrollRestoration: true,
	});
	setupRouterSsrQueryIntegration({
		router,
		queryClient,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
	interface StaticDataRouteOption {
		breadcrumb?: (match: any) => BreadcrumbItemData[] | null;
	}
}
