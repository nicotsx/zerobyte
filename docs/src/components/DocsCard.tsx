import type { HTMLAttributes, ReactNode } from "react";
import { Children } from "react";

import { CornerCard } from "./CornerCard";

type CardsProps = HTMLAttributes<HTMLDivElement> & {
	children: ReactNode;
};

type CardProps = {
	children?: ReactNode;
	href?: string;
	icon?: ReactNode;
	title: string;
};

export function Cards({ children, className, ...props }: CardsProps) {
	const count = Children.count(children);

	return (
		<div
			{...props}
			className={`not-prose my-6 grid gap-6 ${count > 1 ? "sm:grid-cols-2" : ""}${className ? ` ${className}` : ""}`}
		>
			{children}
		</div>
	);
}

export function Card({ children, href, icon, title }: CardProps) {
	const content = (
		<CornerCard className="flex h-full flex-col gap-6 py-6">
			<div className={`grid auto-rows-min grid-rows-[auto_auto] items-start px-6 ${icon ? "gap-4" : "gap-0"}`}>
				{icon ? <div className="text-strong-accent [&_svg]:h-5 [&_svg]:w-5">{icon}</div> : null}
				<h3 className="leading-none font-semibold text-foreground">{title}</h3>
			</div>
			{children ? (
				<div className="px-6">
					<div className="text-sm leading-relaxed text-muted-foreground [&_p]:m-0">{children}</div>
				</div>
			) : null}
		</CornerCard>
	);

	if (!href) return <div className="h-full">{content}</div>;

	return (
		<a href={href} className="block h-full text-inherit no-underline">
			{content}
		</a>
	);
}
