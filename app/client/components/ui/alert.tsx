import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/client/lib/utils";

const alertVariants = cva(
	"relative w-full rounded-[2px] border border-alert-border border-l-2 border-l-(--alert-accent) bg-alert-surface px-3.5 py-3 font-sans text-xs leading-relaxed text-foreground has-[[data-slot=alert-action]]:flex has-[[data-slot=alert-action]]:flex-wrap has-[[data-slot=alert-action]]:items-center has-[[data-slot=alert-action]]:gap-x-4 has-[[data-slot=alert-action]]:gap-y-3 [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3.5 [&>svg]:size-3.5 [&>svg]:text-(--alert-accent) [&>svg+*]:pl-5 [&_code]:font-mono",
	{
		variants: {
			variant: {
				default: "[--alert-accent:var(--alert-info)]",
				info: "[--alert-accent:var(--alert-info)]",
				destructive: "[--alert-accent:var(--alert-error)]",
				warning: "[--alert-accent:var(--alert-warning)]",
				success: "[--alert-accent:var(--alert-success)]",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

const Alert = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
	<div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn(
				"relative min-w-0 flex-1 basis-64 [&>svg]:absolute [&>svg]:left-0 [&>svg]:top-0.5 [&>svg]:size-3.5 [&>svg]:text-(--alert-accent) [&>svg+*]:pl-5",
				className,
			)}
			{...props}
		/>
	),
);
AlertContent.displayName = "AlertContent";

const AlertAction = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			data-slot="alert-action"
			className={cn("ml-auto flex shrink-0 items-center gap-2", className)}
			{...props}
		/>
	),
);
AlertAction.displayName = "AlertAction";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
	({ className, ...props }, ref) => (
		<h5 ref={ref} className={cn("mb-1 text-[13px] font-semibold leading-snug", className)} {...props}>
			{props.children}
		</h5>
	),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn(
				"text-xs leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground",
				className,
			)}
			{...props}
		/>
	),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertContent, AlertAction, AlertTitle, AlertDescription };
