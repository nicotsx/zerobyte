import { Link } from "@tanstack/react-router";
import { GithubLogoIcon, DiscordLogoIcon } from "@phosphor-icons/react";

const discordUrl = "https://discord.gg/MzBXz5v5XB";
const repoUrl = "https://github.com/nicotsx/zerobyte";
const homeSectionLinks = [{ href: "/", label: "Home" }];
const buttonBaseClass =
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export default function Header() {
	return (
		<header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
				<div className="flex gap-6">
					<Link to="/" className="flex items-center gap-2">
						<div className="flex h-6 w-6 items-center justify-center">
							<img src="/zerobyte.png" alt="" className="h-full w-full object-contain" />
						</div>
						<span className="text-lg font-semibold text-foreground">Zerobyte</span>
					</Link>

					<nav className="hidden items-center gap-4 md:flex">
						{homeSectionLinks.map((link) => (
							<a
								key={link.href}
								href={link.href}
								className="text-sm text-muted-foreground transition-colors hover:text-foreground"
							>
								{link.label}
							</a>
						))}
						<Link
							to="/docs/$"
							params={{ _splat: "" }}
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							Docs
						</Link>
					</nav>
				</div>

				<div className="flex items-center gap-3">
					<a
						href={discordUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={`${buttonBaseClass} size-9 text-muted-foreground hover:bg-accent hover:text-foreground`}
					>
						<DiscordLogoIcon className="h-5 w-5" />
						<span className="sr-only">Join Discord</span>
					</a>
					<a
						href={repoUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={`${buttonBaseClass} size-9 text-muted-foreground hover:bg-accent hover:text-foreground`}
					>
						<GithubLogoIcon className="h-5 w-5" />
						<span className="sr-only">View on GitHub</span>
					</a>
				</div>
			</div>
		</header>
	);
}
