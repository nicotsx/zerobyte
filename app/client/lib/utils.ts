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

type DownloadFileMimeType = "text/plain" | "application/json";
export const downloadFile = (data: unknown, filename: string, mimeType: DownloadFileMimeType = "text/plain") => {
	const content = mimeType === "application/json" && typeof data !== "string" ? JSON.stringify(data, null, 2) : data;

	const blob = new Blob([content as BlobPart], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");

	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();

	document.body.removeChild(a);
	URL.revokeObjectURL(url);
};
