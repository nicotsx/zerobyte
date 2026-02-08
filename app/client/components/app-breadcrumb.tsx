import { useMatches, Link } from "@tanstack/react-router";
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

type BreadcrumbFunction = (match: ReturnType<typeof useMatches>[number]) => BreadcrumbItemData[] | null;

export function AppBreadcrumb() {
	const matches = useMatches();

	const lastMatchWithBreadcrumb = [...matches].reverse().find((match) => {
		const breadcrumbFn = match.staticData?.breadcrumb as BreadcrumbFunction | undefined;
		return breadcrumbFn;
	});

	if (!lastMatchWithBreadcrumb) {
		return null;
	}

	const breadcrumbFn = lastMatchWithBreadcrumb.staticData?.breadcrumb as BreadcrumbFunction;
	const breadcrumbs = breadcrumbFn?.(lastMatchWithBreadcrumb);

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
