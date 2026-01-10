import { formatDistanceToNow, isValid } from "date-fns";

// 1/10/2026, 2:30 PM
export function formatDateTime(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";

	return Intl.DateTimeFormat(navigator.languages, {
		month: "numeric",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "numeric",
	}).format(d);
}

// Jan 10, 2026
export function formatDateWithMonth(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";
	return Intl.DateTimeFormat(navigator.languages, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(d);
}

// 1/10/2026
export function formatDate(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";

	return Intl.DateTimeFormat(navigator.languages, {
		month: "numeric",
		day: "numeric",
		year: "numeric",
	}).format(d);
}

// 1/10
export function formatShortDate(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";

	return Intl.DateTimeFormat(navigator.languages, {
		month: "numeric",
		day: "numeric",
	}).format(d);
}

// 1/10, 2:30 PM
export function formatShortDateTime(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";

	return Intl.DateTimeFormat(navigator.languages, {
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	}).format(d);
}

// 2:30 PM
export function formatTime(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";

	return Intl.DateTimeFormat(navigator.languages, {
		hour: "numeric",
		minute: "numeric",
	}).format(d);
}

// 5 minutes ago
export function formatTimeAgo(date: Date | string | number | null | undefined): string {
	if (!date) return "Never";
	const d = new Date(date);
	if (!isValid(d)) return "Invalid Date";

	const timeAgo = formatDistanceToNow(d, {
		addSuffix: true,
		includeSeconds: true,
	});

	return timeAgo.replace("about ", "").replace("over ", "").replace("almost ", "").replace("less than ", "");
}
