import { useTimeFormat, type DateInput } from "~/client/lib/datetime";

type Props = {
	date: DateInput;
	className?: string;
};

export function TimeAgo({ date, className }: Props) {
	const { formatTimeAgo } = useTimeFormat();

	return <span className={className}>{formatTimeAgo(date)}</span>;
}
