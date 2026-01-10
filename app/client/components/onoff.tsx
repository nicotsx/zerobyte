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
					? "border-green-200 bg-green-50 text-green-700 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200"
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
