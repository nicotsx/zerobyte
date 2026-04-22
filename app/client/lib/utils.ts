import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Conditional merge of class names */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function safeJsonParse<T>(input: string): T | null {
	try {
		return JSON.parse(input) as T;
	} catch {
		return null;
	}
}
