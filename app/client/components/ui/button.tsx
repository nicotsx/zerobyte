import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "~/client/lib/utils";
import { useMinimumDuration } from "~/client/hooks/useMinimumDuration";

const buttonVariants = cva(
	"inline-flex cursor-pointer uppercase rounded-sm items-center justify-center gap-2 whitespace-nowrap text-xs font-semibold tracking-wide transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring border-0",
	{
		variants: {
			variant: {
				default: "bg-transparent text-white hover:bg-[#3A3A3A]/80 border dark:text-white dark:hover:bg-[#3A3A3A]/80",
				primary: "bg-strong-accent text-white hover:bg-strong-accent/90 focus-visible:ring-strong-accent/50",
				destructive:
					"border border-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/50 text-destructive hover:text-white",
				outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-transparent text-white hover:bg-[#3A3A3A]/80 border dark:text-white dark:hover:bg-[#3A3A3A]/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-5 py-2 has-[>svg]:px-4",
				sm: "h-8 px-3 py-1.5 has-[>svg]:px-2.5",
				lg: "h-10 px-6 py-2.5 has-[>svg]:px-5",
				icon: "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

const MINIMUM_LOADING_DURATION = 300;

function Button({
	className,
	variant,
	size,
	asChild = false,
	loading,
	disabled,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	} & { loading?: boolean }) {
	const Comp = asChild ? Slot : "button";
	const isLoading = useMinimumDuration(loading ?? false, MINIMUM_LOADING_DURATION);

	return (
		<Comp
			{...props}
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }), "transition-all")}
			disabled={disabled || loading || isLoading}
		>
			<Loader2 className={cn("h-4 w-4 animate-spin absolute", { invisible: !isLoading })} />
			<div className={cn("flex items-center justify-center", { invisible: isLoading })}>{props.children}</div>
		</Comp>
	);
}

export { Button, buttonVariants };
