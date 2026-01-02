import { Link, useMatches, type UIMatch } from "react-router";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "~/client/components/ui/breadcrumb";

export interface BreadcrumbItemData {
	label: string;
	href?: string;
}

interface RouteHandle {
	breadcrumb?: (match: UIMatch) => BreadcrumbItemData[] | null;
}

export function AppBreadcrumb() {
	const matches = useMatches();

	// Find the last match with a breadcrumb handler
	const lastMatchWithBreadcrumb = [...matches].reverse().find((match) => {
		const handle = match.handle as RouteHandle | undefined;
		return handle?.breadcrumb;
	});

	if (!lastMatchWithBreadcrumb) {
		return null;
	}

	const handle = lastMatchWithBreadcrumb.handle as RouteHandle;
	const breadcrumbs = handle.breadcrumb?.(lastMatchWithBreadcrumb);

	if (!breadcrumbs || breadcrumbs.length === 0) {
		return null;
	}

	return (
		<Breadcrumb className="min-w-0">
			<BreadcrumbList>
				{breadcrumbs.map((breadcrumb, index) => {
					const isLast = index === breadcrumbs.length - 1;

					return (
						<div key={`${breadcrumb.label}-${index}`} className="contents">
							<BreadcrumbItem>
								{isLast || !breadcrumb.href ? (
									<BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink asChild>
										<Link to={breadcrumb.href}>{breadcrumb.label}</Link>
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
							{!isLast && <BreadcrumbSeparator />}
						</div>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
