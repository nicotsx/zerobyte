import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Conditional merge of class names */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Converts an arbitrary string into a URL-safe slug:
 * - lowercase
 * - trims whitespace
 * - replaces non-alphanumeric runs with "-"
 * - collapses multiple hyphens
 * - trims leading/trailing hyphens
 */
/**
 * Live slugify for UI: lowercases, normalizes dashes, replaces invalid runs with "-",
 * collapses repeats, but DOES NOT trim leading/trailing hyphens so the user can type
 * spaces/dashes progressively while editing.
 */
export function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[ ]/g, "-")
		.replace(/[^a-z0-9_-]+/g, "")
		.replace(/[-]{2,}/g, "-")
		.replace(/[_]{2,}/g, "_")
		.trim();
}

export function safeJsonParse<T>(input: string): T | null {
	try {
		return JSON.parse(input) as T;
	} catch {
		return null;
	}
}
