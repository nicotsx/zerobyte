import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as testingLibraryRender, type RenderOptions } from "@testing-library/react";
import testingLibraryUserEvent from "@testing-library/user-event";
import { Suspense, type ReactElement, type ReactNode } from "react";
import { logger } from "~/client/lib/logger";

type TestProviderOptions = {
	queryClient?: QueryClient;
	withSuspense?: boolean;
	suspenseFallback?: ReactNode;
};

type TestRenderOptions = Omit<RenderOptions, "wrapper"> & TestProviderOptions;

export const createTestQueryClient = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Infinity,
			},
			mutations: {
				gcTime: Infinity,
			},
		},
		mutationCache: new MutationCache({
			onError: (error) => {
				logger.error("Mutation error:", error);
			},
			onSettled: (_data, _error, _variables, _onMutateResult, _mutation, context) => {
				void context.client.invalidateQueries(undefined, { cancelRefetch: false });
			},
		}),
	});

	return queryClient;
};

const createWrapper = (options: TestProviderOptions = {}) => {
	const { queryClient = createTestQueryClient(), withSuspense = false, suspenseFallback = null } = options;

	const Wrapper = ({ children }: { children: ReactNode }) => {
		return (
			<QueryClientProvider client={queryClient}>
				{withSuspense ? <Suspense fallback={suspenseFallback}>{children}</Suspense> : children}
			</QueryClientProvider>
		);
	};

	return { queryClient, Wrapper };
};

const customRender = (ui: ReactElement, options: TestRenderOptions = {}) => {
	const { queryClient, withSuspense, suspenseFallback, ...renderOptions } = options;
	const wrapper = createWrapper({ queryClient, withSuspense, suspenseFallback });

	return {
		queryClient: wrapper.queryClient,
		...testingLibraryRender(ui, {
			wrapper: wrapper.Wrapper,
			...renderOptions,
		}),
	};
};

export * from "@testing-library/react";

export const userEvent = testingLibraryUserEvent.setup();
export { customRender as render };
