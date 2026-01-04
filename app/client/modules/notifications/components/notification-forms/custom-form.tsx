import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const CustomForm = ({ form }: Props) => {
	return (
		<FormField
			control={form.control}
			name="shoutrrrUrl"
			render={({ field }) => (
				<FormItem>
					<FormLabel>Shoutrrr URL</FormLabel>
					<FormControl>
						<Input
							{...field}
							placeholder="smtp://user:pass@smtp.gmail.com:587/?from=you@gmail.com&to=recipient@example.com"
						/>
					</FormControl>
					<FormDescription>
						Direct Shoutrrr URL for power users. See&nbsp;
						<a
							href="https://shoutrrr.nickfedor.com/latest/services/overview/"
							target="_blank"
							rel="noopener noreferrer"
							className="text-strong-accent hover:underline"
						>
							Shoutrrr documentation
						</a>
						&nbsp;for supported services and URL formats.
					</FormDescription>
					<FormMessage />
				</FormItem>
			)}
		/>
	);
};
