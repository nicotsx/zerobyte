import { cn } from "~/client/lib/utils";
import { Switch } from "./ui/switch";

type Props = {
	isOn: boolean;
	toggle: (v: boolean) => void;
	enabledLabel: string;
	disabledLabel: string;
	disabled?: boolean;
};

export const OnOff = ({ isOn, toggle, enabledLabel, disabledLabel, disabled }: Props) => {
	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
				isOn
					? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
					: "border-muted bg-muted/40 text-muted-foreground dark:border-muted/60 dark:bg-muted/10",
			)}
		>
			<span>{isOn ? enabledLabel : disabledLabel}</span>
			<Switch
				disabled={disabled}
				checked={isOn}
				onCheckedChange={toggle}
				aria-label={isOn ? `Toggle ${enabledLabel}` : `Toggle ${disabledLabel}`}
			/>
		</div>
	);
};
