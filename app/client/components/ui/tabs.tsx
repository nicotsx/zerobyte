import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "~/client/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn("inline-flex h-7 items-center gap-4 text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(
				"cursor-pointer group relative inline-flex h-7 items-center whitespace-nowrap text-xs font-medium transition-colors",
				"text-muted-foreground data-[state=active]:text-foreground disabled:pointer-events-none disabled:opacity-50",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
				// Padding: 20px horizontal (8px for bracket tick + 12px gap to text)
				"px-5",
				// Transparent orange background for active state
				"data-[state=active]:bg-[#FF453A]/10",
				// Left bracket - vertical line
				"before:absolute before:left-0 before:top-0 before:h-7 before:w-0.5 before:bg-[#5D6570] before:transition-colors data-[state=active]:before:bg-[#FF453A]",
				// Left bracket - top tick
				"after:absolute after:left-0 after:-top-px after:w-2 after:h-0.5 after:bg-[#5D6570] after:transition-colors data-[state=active]:after:bg-[#FF453A]",
				className,
			)}
			{...props}
		>
			<span className="relative z-10">{props.children}</span>
			{/* Left bracket - bottom tick */}
			<span className="absolute left-0 bottom-[-1px] h-0.5 w-2 bg-[#5D6570] transition-colors group-data-[state=active]:bg-[#FF453A]" />
			{/* Right bracket - top tick */}
			<span className="absolute right-0 top-[-1px] h-0.5 w-2 bg-[#5D6570] transition-colors group-data-[state=active]:bg-[#FF453A]" />
			{/* Right bracket - vertical line */}
			<span className="absolute right-0 top-0 h-7 w-0.5 bg-[#5D6570] transition-colors group-data-[state=active]:bg-[#FF453A]" />
			{/* Right bracket - bottom tick */}
			<span className="absolute right-0 bottom-[-1px] h-0.5 w-2 bg-[#5D6570] transition-colors group-data-[state=active]:bg-[#FF453A]" />
		</TabsPrimitive.Trigger>
	);
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
