import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "~/client/lib/utils";

interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
}

const CollapsibleContext = React.createContext<{
	open: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}>({
	open: false,
	setOpen: () => {},
});

const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
	({ className, open: controlledOpen, onOpenChange, defaultOpen = false, children, ...props }, ref) => {
		const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);

		const isControlled = controlledOpen !== undefined;
		const open = isControlled ? controlledOpen : uncontrolledOpen;

		const setOpen = React.useCallback(
			(value: React.SetStateAction<boolean>) => {
				const newValue = typeof value === "function" ? value(open) : value;
				if (!isControlled) {
					setUncontrolledOpen(newValue);
				}
				onOpenChange?.(newValue);
			},
			[isControlled, open, onOpenChange],
		);

		return (
			<CollapsibleContext.Provider value={{ open, setOpen }}>
				<div ref={ref} className={cn(className)} {...props}>
					{children}
				</div>
			</CollapsibleContext.Provider>
		);
	},
);
Collapsible.displayName = "Collapsible";

interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
	({ className, children, ...props }, ref) => {
		const { open, setOpen } = React.useContext(CollapsibleContext);

		return (
			<button
				ref={ref}
				type="button"
				className={cn(
					"flex w-full items-center justify-between py-2 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
					className,
				)}
				data-state={open ? "open" : "closed"}
				onClick={() => setOpen(!open)}
				{...props}
			>
				{children}
				<ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
			</button>
		);
	},
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const CollapsibleContent = React.forwardRef<HTMLDivElement, CollapsibleContentProps>(
	({ className, children, ...props }, ref) => {
		const { open } = React.useContext(CollapsibleContext);

		return (
			<div
				ref={ref}
				className={cn(
					"overflow-hidden transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
					className,
				)}
				data-state={open ? "open" : "closed"}
				hidden={!open}
				{...props}
			>
				{open && children}
			</div>
		);
	},
);
CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
