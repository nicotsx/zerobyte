import type * as React from "react";

import { cn } from "~/client/lib/utils";

function Card({ className, children, interactive, ...props }: React.ComponentProps<"div"> & { interactive?: boolean }) {
	return (
		<div
			data-slot="card"
			className={cn(
				"bg-card text-card-foreground group relative flex flex-col gap-6 border border-border py-6 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] transition-colors duration-300 ",
				className,
			)}
			{...props}
		>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-0 z-10 select-none opacity-30 transition-opacity duration-300 ",
					{
						"group-hover:opacity-100": interactive,
					},
				)}
			>
				<span className="absolute -left-0.5 -top-0.5 h-0.5 w-4 bg-white/80" />
				<span className="absolute -left-0.5 -top-0.5 h-4 w-0.5 bg-white/80" />
				<span className="absolute -right-0.5 -top-0.5 h-0.5 w-4 bg-white/80" />
				<span className="absolute -right-0.5 -top-0.5 h-4 w-0.5 bg-white/80" />
				<span className="absolute -left-0.5 -bottom-0.5 h-0.5 w-4 bg-white/80" />
				<span className="absolute -left-0.5 -bottom-0.5 h-4 w-0.5 bg-white/80" />
				<span className="absolute -right-0.5 -bottom-0.5 h-0.5 w-4 bg-white/80" />
				<span className="absolute -right-0.5 -bottom-0.5 h-4 w-0.5 bg-white/80" />
			</span>
			{children}
		</div>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
				className,
			)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-title" className={cn("leading-none font-semibold", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-description" className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="card-footer" className={cn("flex items-center px-6 [.border-t]:pt-6", className)} {...props} />
	);
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
