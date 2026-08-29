import type { ReactNode } from "react";

type AuthLayoutProps = {
	title: string;
	description: string;
	children: ReactNode;
};

export function AuthLayout({ title, description, children }: AuthLayoutProps) {
	return (
		<div className="fixed inset-0 flex overflow-hidden">
			<div className="flex min-h-0 flex-1 justify-center overflow-y-auto overscroll-contain bg-background p-8">
				<div className="my-auto w-full max-w-md space-y-8">
					<div className="flex items-center gap-3">
						<img src="/images/zerobyte.png" alt="Zerobyte Logo" className="h-5 w-5 object-contain" />
						<span className="text-lg font-semibold">Zerobyte</span>
					</div>

					<div className="space-y-2">
						<h1 className="text-3xl font-bold tracking-tight">{title}</h1>
						<p className="text-sm text-muted-foreground">{description}</p>
					</div>

					{children}
				</div>
			</div>
			<div
				className="hidden lg:block lg:flex-1 dither-lg bg-cover bg-center"
				style={{ backgroundImage: "url(/images/background.jpg)" }}
			/>
		</div>
	);
}
