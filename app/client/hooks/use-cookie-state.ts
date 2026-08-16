import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie as getServerCookie } from "@tanstack/react-start/server";
import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const getCookie = createIsomorphicFn()
	.server((name: string) => getServerCookie(name))
	.client((name: string) => {
		const prefix = `${name}=`;
		const cookie = document.cookie.split("; ").find((item) => item.startsWith(prefix));
		if (!cookie) return undefined;

		const encodedValue = cookie.slice(prefix.length);
		return decodeURIComponent(encodedValue);
	});

const readCookie = <T>(name: string, initialValue: T): T => {
	try {
		const serializedValue = getCookie(name);
		if (serializedValue === undefined) return initialValue;
		if (typeof initialValue === "string") return serializedValue as T;

		return JSON.parse(serializedValue) as T;
	} catch {
		return initialValue;
	}
};

const serializeCookie = <T>(value: T) => (typeof value === "string" ? value : JSON.stringify(value));

export function useCookieState<T>(
	name: string,
	initialValue: T,
	maxAge = COOKIE_MAX_AGE,
): [T, Dispatch<SetStateAction<T>>] {
	const [value, setValue] = useState<T>(() => readCookie(name, initialValue));
	const valueRef = useRef(value);

	const setCookieValue = useCallback<Dispatch<SetStateAction<T>>>(
		(nextValue) => {
			const currentValue = valueRef.current;
			const resolvedValue = nextValue instanceof Function ? nextValue(currentValue) : nextValue;
			valueRef.current = resolvedValue;
			setValue(resolvedValue);

			const serializedValue = serializeCookie(resolvedValue);
			const encodedValue = encodeURIComponent(serializedValue);
			document.cookie = `${name}=${encodedValue}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
		},
		[maxAge, name],
	);

	return [value, setCookieValue];
}
