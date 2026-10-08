// Nitro bundles plugins and request handlers into separate chunks, so module-level state would not be shared.
export const getProcessSingleton = <Value>(key: `__zerobyte${string}`, create: () => Value): Value => {
	const store = process as unknown as Record<string, Value | undefined>;

	store[key] ??= create();
	return store[key];
};
