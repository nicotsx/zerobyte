import { createFileRoute } from "@tanstack/react-router";

import Footer from "@/components/Footer";
import { buildSeoHead } from "@/lib/metadata";

const title = "Privacy Policy | Zerobyte";
const description = "How Zerobyte handles data in the desktop app and on zerobyte.app.";

export const Route = createFileRoute("/privacy")({
	head: () => buildSeoHead({ title, description, path: "/privacy" }),
	component: PrivacyPolicy,
});

function PrivacyPolicy() {
	return (
		<>
			<main className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
				<h1 className="text-4xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
				<p className="mt-3 text-sm text-muted-foreground">Last updated: August 30, 2026</p>

				<div className="mt-10 space-y-8 text-base leading-7 text-muted-foreground">
					<section>
						<h2 className="text-xl font-semibold text-foreground">Desktop app</h2>
						<p className="mt-3">
							Zerobyte processes the files and configuration you choose so it can create and manage your
							backups. Backup data is sent directly to the repository you configure. Zerobyte does not
							send your files, credentials, backup metadata, or app usage data to the Zerobyte developer,
							and the desktop app does not include analytics or advertising.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-foreground">Services you connect</h2>
						<p className="mt-3">
							The app connects to storage, notification, authentication, and other services only when you
							configure them. Those services process data under their own terms and privacy policies. The
							app also checks GitHub Releases for available updates, which sends standard request
							information such as your IP address and user agent to GitHub.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-foreground">Website</h2>
						<p className="mt-3">
							The Zerobyte website uses aggregate analytics to understand visits and improve the
							documentation. This may process basic request information such as visited pages, referrer,
							browser type, and IP address. The website does not use this information for advertising.
						</p>
					</section>

					<section>
						<h2 className="text-xl font-semibold text-foreground">Contact</h2>
						<p className="mt-3">
							For privacy questions, open an issue in the{" "}
							<a
								href="https://github.com/nicotsx/zerobyte/issues"
								className="text-foreground underline underline-offset-4"
							>
								Zerobyte GitHub repository
							</a>
							.
						</p>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
}
