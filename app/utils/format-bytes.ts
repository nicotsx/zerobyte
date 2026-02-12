const SI_UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"] as const;
const IEC_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"] as const;

export type FormatBytesResult = {
	text: string;
	unit: string;
	unitIndex: number;
	numeric: number;
};

export type FormatBytesOptions = {
	base?: 1000 | 1024;
	maximumFractionDigits?: number;
	smartRounding?: boolean;
	locale?: string | string[];
	fallback?: string;
};

export function formatBytes(bytes: number, options?: FormatBytesOptions): FormatBytesResult {
	const {
		base = 1000,
		maximumFractionDigits = 2,
		smartRounding = true,
		locale,
		fallback = "—",
	} = options ?? {};

	if (!Number.isFinite(bytes)) {
		return {
			text: fallback,
			unit: "",
			unitIndex: 0,
			numeric: NaN,
		};
	}

	const units = base === 1024 ? IEC_UNITS : SI_UNITS;
	const sign = Math.sign(bytes) || 1;
	const abs = Math.abs(bytes);

	let idx = 0;
	if (abs > 0) {
		idx = Math.floor(Math.log(abs) / Math.log(base));
		if (!Number.isFinite(idx)) idx = 0;
		idx = Math.max(0, Math.min(idx, units.length - 1));
	}

	const numeric = (abs / base ** idx) * sign;
	const maxFrac = (() => {
		if (!smartRounding) return maximumFractionDigits;
		const value = Math.abs(numeric);
		if (value >= 100) return 0;
		if (value >= 10) return Math.min(1, maximumFractionDigits);
		return maximumFractionDigits;
	})();

	const text = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 0,
		maximumFractionDigits: maxFrac,
	}).format(numeric);

	return {
		text,
		unit: units[idx],
		unitIndex: idx,
		numeric,
	};
}
