import type React from "react";
import { formatBytes } from "~/utils/format-bytes";

type ByteSizeProps = {
	bytes: number;
	base?: 1000 | 1024; // 1000 = SI (KB, MB, ...), 1024 = IEC (KiB, MiB, ...)
	maximumFractionDigits?: number; // default: 2
	smartRounding?: boolean; // dynamically reduces decimals for big numbers (default: true)
	locale?: string | string[]; // e.g., 'en', 'de', or navigator.languages
	space?: boolean; // space between number and unit (default: true)
	className?: string;
	style?: React.CSSProperties;
	fallback?: string; // shown if bytes is not a finite number (default: '—')
};

export function ByteSize(props: ByteSizeProps) {
	const {
		bytes,
		base = 1000,
		maximumFractionDigits = 2,
		smartRounding = true,
		locale,
		space = true,
		className,
		style,
		fallback = "—",
	} = props;

	const { text, unit } = formatBytes(bytes, {
		base,
		maximumFractionDigits,
		smartRounding,
		locale,
		fallback,
	});

	if (text === fallback) {
		return (
			<span className={className} style={style}>
				{fallback}
			</span>
		);
	}

	return (
		<span className={className} style={style}>
			{text}
			{space ? " " : ""}
			{unit}
		</span>
	);
}
