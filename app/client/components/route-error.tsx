interface RouteErrorProps {
	error: unknown;
}

export function RouteError({ error }: RouteErrorProps) {
	const message = error instanceof Error ? error.message : String(error);

	return <div>{message}</div>;
}
