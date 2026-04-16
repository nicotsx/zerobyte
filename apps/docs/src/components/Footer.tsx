import { Link } from "@tanstack/react-router";
import { GithubLogoIcon } from "@phosphor-icons/react";

const repoUrl = "https://github.com/nicotsx/zerobyte";

export default function Footer() {
	return (
		<footer className="bg-secondary/30">
			<div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
				<div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
					<div className="flex items-center gap-2">
						<div className="flex h-6 w-6 items-center justify-center">
							<img src="/zerobyte.png" alt="" className="h-full w-full object-contain" />
						</div>
						<span className="text-lg font-semibold text-foreground">Zerobyte</span>
					</div>

					<nav className="flex items-center gap-6">
						<Link
							to="/docs/$"
							params={{ _splat: "" }}
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							Docs
						</Link>
						<a
							href={repoUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<GithubLogoIcon className="h-4 w-4" />
							GitHub
						</a>
					</nav>
				</div>

				<div className="mt-8 border-t border-border pt-8">
					<p className="text-center text-sm text-muted-foreground">Open source backup automation for Restic.</p>
				</div>
			</div>
		</footer>
	);
}
