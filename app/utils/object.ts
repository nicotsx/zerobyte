/**
 * Deeply removes empty-ish values from an object/array tree.
 *
 * - Arrays: maps + filters out `undefined`, `null`, and empty strings.
 * - Objects: recursively cleans values and drops keys whose cleaned value is `undefined` or "".
 *
 * Note: this function is intended for building payloads; it does not preserve object prototypes.
 */
export function deepClean<T>(obj: T): T {
	if (Array.isArray(obj)) {
		return obj.map(deepClean).filter((v) => v !== undefined && v !== null && v !== "") as T;
	}

	if (obj && typeof obj === "object") {
		return Object.entries(obj).reduce((acc, [key, value]) => {
			const cleaned = deepClean(value);
			if (cleaned !== undefined && cleaned !== "") acc[key as keyof T] = cleaned;
			return acc;
		}, {} as T);
	}
	return obj;
}

/**
 * A "shape" describes the allowed top-level keys for an object.
 *
 * The values are irrelevant; only the keys matter.
 */
type Shape = Record<string, unknown>;

/**
 * Strips an object to only the keys present in the provided shape.
 *
 * - This is a shallow operation (top-level keys only).
 * - Missing keys become `undefined` in the returned object.
 *
 * This is used to avoid persisting polluted objects (e.g. form state) into DB `config` JSON blobs.
 */
export function stripToShape<T extends Record<string, unknown>, S extends Shape>(obj: T, shape: S): {
	[K in keyof S]: K extends keyof T ? T[K] : undefined;
} {
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(shape)) {
		result[key] = (obj as Record<string, unknown>)[key];
	}
	return result as {
		[K in keyof S]: K extends keyof T ? T[K] : undefined;
	};
}

/**
 * Strips a discriminated-union object to only the keys allowed for its variant.
 *
 * Example: given `discriminantKey = "backend"` and a map of backend -> shape,
 * this returns `stripToShape(obj, shapes[obj.backend])`.
 *
 * Fallback behavior:
 * - If the discriminant value is not a string, or there is no matching shape,
 *   the original object is returned unchanged.
 */
export function stripDiscriminatedUnion<
	T extends Record<string, unknown>,
	DiscriminantKey extends keyof T,
	Shapes extends Record<string, Shape>,
>(
	obj: T,
	discriminantKey: DiscriminantKey,
	shapes: Shapes,
): Record<string, unknown> {
	const discriminant = obj[discriminantKey];
	if (typeof discriminant !== "string") {
		return obj;
	}
	const shape = shapes[discriminant];
	if (!shape) {
		return obj;
	}
	return stripToShape(obj, shape);
}
