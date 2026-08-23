import { Fragment, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "~/client/lib/utils";

type Props = {
	/** The tree's root; segments above it are not navigable. */
	root: string;
	path: string;
	onNavigate: (path: string) => void;
};

type Crumb = { label: string; path: string };

export const buildCrumbs = (root: string, path: string): Crumb[] => {
	const crumbs: Crumb[] = [{ label: root === "/" ? "/" : root.slice(root.lastIndexOf("/") + 1) || "/", path: root }];

	if (path === root || !path.startsWith(root)) return crumbs;

	const remainder = path.slice(root === "/" ? 1 : root.length + 1);
	let current = root;

	for (const segment of remainder.split("/").filter(Boolean)) {
		current = current === "/" ? `/${segment}` : `${current}/${segment}`;
		crumbs.push({ label: segment, path: current });
	}

	return crumbs;
};

export const UsageBreadcrumb = ({ root, path, onNavigate }: Props) => {
	const crumbs = useMemo(() => buildCrumbs(root, path), [root, path]);

	return (
		<nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
			{crumbs.map((crumb, index) => {
				const isLast = index === crumbs.length - 1;

				return (
					<Fragment key={crumb.path}>
						{index > 0 && (
							<ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						)}
						<button
							type="button"
							onClick={() => onNavigate(crumb.path)}
							disabled={isLast}
							title={crumb.path}
							className={cn(
								"max-w-60 truncate rounded px-1 font-mono text-xs",
								isLast
									? "cursor-default font-medium text-foreground"
									: "text-muted-foreground hover:bg-accent hover:text-foreground",
							)}
						>
							{crumb.label}
						</button>
					</Fragment>
				);
			})}
		</nav>
	);
};
