import type { ComponentProps } from "react";
import Link from "fumadocs-core/link";
import { usePathname } from "fumadocs-core/framework";

export function DocsMdxLink({ href, ...props }: ComponentProps<"a">) {
	const pathname = usePathname();

	if (href?.startsWith("#")) {
		return <a {...props} href={`${pathname}${href}`} />;
	}

	return <Link {...props} href={href} />;
}
