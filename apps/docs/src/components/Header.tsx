import { Link } from "@tanstack/react-router";
import { Github } from "lucide-react";

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
						<svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
							<path d="M20.317 4.369A19.791 19.791 0 0 0 15.44 3a13.967 13.967 0 0 0-.599 1.233 18.27 18.27 0 0 0-5.682 0A13.966 13.966 0 0 0 8.56 3a19.736 19.736 0 0 0-4.878 1.37C.598 9.04-.323 13.58.138 18.057A19.943 19.943 0 0 0 6.13 21a14.31 14.31 0 0 0 1.282-2.11 12.874 12.874 0 0 1-2.02-.964c.17-.123.336-.252.497-.385 3.897 1.78 8.148 1.78 12 0 .162.133.328.262.498.385a12.916 12.916 0 0 1-2.024.965A14.223 14.223 0 0 0 17.645 21a19.874 19.874 0 0 0 5.994-2.943c.541-5.19-.92-9.689-3.322-13.688ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.211 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.419-2.157 2.419Zm7.96 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.211 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z" />
						</svg>
						<span className="sr-only">Join Discord</span>
					</a>
					<a
						href={repoUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={`${buttonBaseClass} size-9 text-muted-foreground hover:bg-accent hover:text-foreground`}
					>
						<Github className="h-5 w-5" />
						<span className="sr-only">View on GitHub</span>
					</a>
				</div>
			</div>
		</header>
	);
}
