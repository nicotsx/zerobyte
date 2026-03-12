import { Badge } from "~/client/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";

type ManagedBadgeProps = {
	label?: string;
	message?: string;
};

const defaultMessage =
	"This resource is provisioned at startup. Changes are useful for testing, but the next provisioning sync can overwrite or recreate it.";

export const ManagedBadge = ({ label = "Managed", message = defaultMessage }: ManagedBadgeProps) => {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant="secondary">{label}</Badge>
			</TooltipTrigger>
			<TooltipContent>
				<p className="max-w-80 text-sm">{message}</p>
			</TooltipContent>
		</Tooltip>
	);
};
