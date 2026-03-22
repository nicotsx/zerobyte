export function isAuthRoute(pathname: string) {
	if (pathname === "/onboarding") return true;
	if (pathname === "/login") return true;
	if (pathname.match(/^\/login\/[^/]+$/)) return true;
	if (pathname.match(/^\/login\/[^/]+\/error$/)) return true;
	return false;
}
