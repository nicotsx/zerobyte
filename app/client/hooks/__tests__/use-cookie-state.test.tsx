import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
	createIsomorphicFn: () => ({
		server: () => ({
			client: (clientImplementation: unknown) => clientImplementation,
		}),
	}),
}));

import { useCookieState } from "../use-cookie-state";

const expireCookie = (name: string) => {
	document.cookie = `${name}=; Path=/; Max-Age=0`;
};

describe("useCookieState", () => {
	afterEach(() => {
		cleanup();
		expireCookie("sorting_volumes");
		expireCookie("sorting_repositories");
		expireCookie("sorting_notifications");
		expireCookie("theme");
	});

	test("uses a stored cookie on the first render", () => {
		const storedValue = [{ id: "status", desc: true }];
		const encodedValue = encodeURIComponent(JSON.stringify(storedValue));
		document.cookie = `sorting_volumes=${encodedValue}; Path=/`;

		const { result } = renderHook(() => useCookieState("sorting_volumes", []));

		expect(result.current[0]).toEqual(storedValue);
	});

	test("persists direct and functional updates", () => {
		const { result } = renderHook(() => useCookieState("sorting_repositories", [{ id: "name", desc: false }]));

		act(() => {
			result.current[1]([{ id: "status", desc: false }]);
			result.current[1]((currentValue) => currentValue.map((sort) => ({ ...sort, desc: !sort.desc })));
		});

		const expectedValue = [{ id: "status", desc: true }];
		const encodedValue = encodeURIComponent(JSON.stringify(expectedValue));
		expect(result.current[0]).toEqual(expectedValue);
		expect(document.cookie).toContain(`sorting_repositories=${encodedValue}`);
	});

	test("supports existing raw string cookies", () => {
		document.cookie = "theme=light; Path=/";

		const { result } = renderHook(() => useCookieState<"light" | "dark">("theme", "dark"));

		expect(result.current[0]).toBe("light");
	});

	test("falls back to the initial value for invalid stored JSON", () => {
		document.cookie = "sorting_notifications=invalid; Path=/";
		const initialValue = [{ id: "name", desc: false }];

		const { result } = renderHook(() => useCookieState("sorting_notifications", initialValue));

		expect(result.current[0]).toEqual(initialValue);
	});
});
