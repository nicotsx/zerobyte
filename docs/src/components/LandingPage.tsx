import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowRight,
	Bell,
	CalendarClock,
	Check,
	Clock,
	Cloud,
	Container,
	Copy,
	Database,
	FileQuestion,
	Github,
	HardDrive,
	Layers,
	Lock,
	RotateCcw,
	Settings,
	Shield,
	ShieldCheck,
	Wrench,
	Zap,
	type LucideIcon,
} from "lucide-react";

import { CornerCard } from "./CornerCard";
import Footer from "./Footer";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";

const repoUrl = "https://github.com/nicotsx/zerobyte";

const buttonBaseClass =
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";
const primaryButtonClass = `${buttonBaseClass} h-10 bg-strong-accent px-6 text-white hover:bg-strong-accent/90 focus-visible:ring-strong-accent/50`;
const outlineButtonClass = `${buttonBaseClass} h-10 border border-border bg-background px-6 shadow-xs hover:bg-accent hover:text-accent-foreground`;

const trustItems: Array<{ icon: LucideIcon; label: string }> = [
	{ icon: Shield, label: "Open source" },
	{ icon: Database, label: "Built on Restic" },
	{ icon: Lock, label: "End-to-end encrypted" },
	{ icon: Layers, label: "Incremental & deduplicated" },
	{ icon: Cloud, label: "Multi-backend support" },
];

const problems: Array<{ icon: LucideIcon; text: string }> = [
	{ icon: AlertTriangle, text: "Jobs fail quietly until you need a restore." },
	{ icon: Settings, text: "Different storage backends lead to one-off scripts and fragile setup." },
	{ icon: Clock, text: "Retention policies get buried in config nobody wants to touch." },
	{ icon: Wrench, text: "Repository locks and health issues only show up when something is already broken." },
	{ icon: FileQuestion, text: "Restore workflows stay untested until the pressure is high." },
];

const solutions: Array<{ icon: LucideIcon; title: string; description: string }> = [
	{
		icon: CalendarClock,
		title: "Schedule with confidence",
		description:
			"Create backup jobs with cron-based schedules, retention policies, include and exclude rules, and manual runs when you need an extra snapshot before a risky change.",
	},
	{
		icon: HardDrive,
		title: "Protect data wherever it lives",
		description:
			"Back up local directories plus NFS, SMB/CIFS, WebDAV, SFTP, and rclone-backed sources from the same interface.",
	},
	{
		icon: Database,
		title: "Keep storage flexible",
		description:
			"Write encrypted snapshots to local repositories, S3-compatible storage, Cloudflare R2, Google Cloud Storage, Azure Blob Storage, REST servers, SFTP targets, and 40+ providers through rclone.",
	},
	{
		icon: RotateCcw,
		title: "Restore what you need",
		description:
			"Browse snapshots in the UI and restore individual files, directories, or larger paths without dropping back to the CLI.",
	},
	{
		icon: Bell,
		title: "Catch problems before they become incidents",
		description:
			"Track run status, next backup time, snapshot history, repository health, and send alerts to Slack, Discord, email, ntfy, Telegram, webhooks, and more.",
	},
	{
		icon: ShieldCheck,
		title: "Operate securely",
		description:
			"Zerobyte is organization-scoped, supports roles and invitations, offers OIDC-based SSO, and encrypts sensitive credentials before storage.",
	},
];

const features: Array<{ icon: LucideIcon; title: string; description: string }> = [
	{
		icon: Lock,
		title: "Encrypted by design",
		description: "Data gets encrypted before it leaves the source, so your storage backend never sees plaintext.",
	},
	{
		icon: Zap,
		title: "Incremental and deduplicated",
		description: "After the first run, only changed data is transferred and stored.",
	},
	{
		icon: Settings,
		title: "Compression controls",
		description: "Choose auto, off, or max compression to balance CPU time and storage cost.",
	},
	{
		icon: Copy,
		title: "Mirror repositories",
		description: "Copy snapshots to additional repositories for geographic redundancy or provider diversification.",
	},
	{
		icon: Wrench,
		title: "Repository maintenance",
		description: "Run Doctor, unlock stale repositories, and refresh repository statistics from the UI.",
	},
	{
		icon: Container,
		title: "Operator-friendly deployment",
		description: "Self-host with Docker Compose and manage backups from a web interface your team can actually use.",
	},
];

const steps = [
	{
		number: "1",
		title: "Connect a volume",
		description: "Add a local directory, NAS share, remote filesystem, or rclone-backed source.",
	},
	{
		number: "2",
		title: "Create a repository",
		description:
			"Choose where encrypted snapshots should live and configure compression, bandwidth limits, or imported repository settings.",
	},
	{
		number: "3",
		title: "Set your schedule",
		description: "Define when backups run, how long snapshots stay, and which paths to include or exclude.",
	},
	{
		number: "4",
		title: "Monitor and restore",
		description:
			"Watch backup progress, review snapshot history, receive notifications, and restore exactly what you need.",
	},
];

const benefits = [
	"You keep Restic's encryption, deduplication, and incremental snapshots.",
	"You gain scheduling, monitoring, restore workflows, repository maintenance, and team access controls.",
	"You keep your choice of storage backend instead of being tied to a single vendor.",
];

const faqs = [
	{
		question: "Is Zerobyte a backup engine or a UI for Restic?",
		answer:
			"Zerobyte is a Restic-based backup automation tool. It gives you a web control plane for scheduling, managing, monitoring, restoring, and maintaining Restic backups.",
	},
	{
		question: "What can I back up with Zerobyte?",
		answer:
			"You can back up local directories, NFS shares, SMB/CIFS shares, WebDAV endpoints, SFTP locations, and rclone-backed sources.",
	},
	{
		question: "Where can I store backups?",
		answer:
			"Zerobyte supports local repositories, S3-compatible storage, Cloudflare R2, Google Cloud Storage, Azure Blob Storage, REST servers, SFTP targets, and many additional providers through rclone.",
	},
	{
		question: "Is my data encrypted?",
		answer:
			"Yes. Zerobyte relies on Restic's end-to-end encryption for repository data, and sensitive credentials stored by the app are encrypted before they are written to the database.",
	},
	{
		question: "Can I restore individual files?",
		answer:
			"Yes. You can browse snapshots from the web interface and restore individual files, directories, or larger paths to the original or an alternate location.",
	},
	{
		question: "Can teams use Zerobyte?",
		answer:
			"Yes. Zerobyte is organization-scoped and supports roles, invitations, and OIDC-based SSO for managed access.",
	},
	{
		question: "How do I deploy it?",
		answer: "Zerobyte is designed to be self-hosted and can be deployed with Docker Compose.",
	},
];

function BrowserMockup() {
	return (
		<div className="w-full overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
			<div className="relative flex items-center gap-3 border-b border-border bg-secondary/80 px-4 py-2">
				<div className="flex shrink-0 gap-1.5">
					<div className="h-3 w-3 rounded-full bg-red-500" />
					<div className="h-3 w-3 rounded-full bg-yellow-500" />
					<div className="h-3 w-3 rounded-full bg-green-500" />
				</div>
				<div className="min-w-0 flex-1 sm:pointer-events-none sm:absolute sm:inset-0 sm:flex sm:items-center sm:justify-center sm:px-20">
					<div className="w-full rounded bg-background/80 px-3 py-0.5 text-center text-xs text-muted-foreground sm:max-w-md">
						localhost:4096
					</div>
				</div>
			</div>
			<div className="aspect-video bg-background/80">
				<img
					src="/images/screenshot.png"
					alt="Zerobyte backups dashboard"
					className="h-full w-full object-cover object-top"
				/>
			</div>
		</div>
	);
}

export default function LandingPage() {
	return (
		<div data-landing-page className="bg-background text-foreground">
			<main>
				<section className="relative overflow-hidden border-b border-border">
					<div aria-hidden className="landing-hero-docs-grid pointer-events-none absolute inset-0" />
					<div aria-hidden className="landing-hero-glow pointer-events-none absolute inset-0" />
					<div className="relative mx-auto max-w-[90rem] px-4 py-20 sm:px-6 sm:py-24 lg:py-32">
						<div className="grid items-center gap-12 min-[1100px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[1100px]:gap-8 lg:gap-12">
							<div className="text-left">
								<p className="mb-4 text-sm font-medium uppercase tracking-wider text-strong-accent">
									Open Source Backup Control Plane
								</p>
								<h1 className="text-balance text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl">
									Backups you can finally forget about
								</h1>
								<p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
									Zerobyte gives you a clean web interface to schedule, monitor, restore, and maintain encrypted backups
									across local disks, NAS shares, remote servers, and cloud storage.
								</p>
								<div className="mt-10 flex flex-wrap gap-3">
									<Link to="/docs/$" params={{ _splat: "" }} className={primaryButtonClass}>
										Documentation
										<ArrowRight className="h-4 w-4" />
									</Link>
									<a href={repoUrl} target="_blank" rel="noopener noreferrer" className={outlineButtonClass}>
										<Github className="h-4 w-4" />
										View on GitHub
									</a>
								</div>
								<p className="mt-6 max-w-xl text-sm text-muted-foreground">
									Self-hosted. Restic-powered. Built for operators who want fewer scripts and more visibility.
								</p>
							</div>
							<div className="min-[1100px]:-mr-8 xl:-mr-12">
								<BrowserMockup />
							</div>
						</div>
					</div>
				</section>

				<section className="border-b border-border bg-secondary/30">
					<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
						<div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
							{trustItems.map((item) => (
								<div key={item.label} className="flex items-center gap-2 text-muted-foreground">
									<item.icon className="h-4 w-4 text-strong-accent" />
									<span className="text-sm font-medium">{item.label}</span>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="border-b border-border">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Backups are easy to start and hard to trust
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								A few commands and a cron job can get backups running. Keeping them reliable is the hard part.
							</p>
							<ul className="mt-10 space-y-5">
								{problems.map((problem) => (
									<li key={problem.text} className="flex items-start gap-4">
										<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary">
											<problem.icon className="h-3.5 w-3.5 text-muted-foreground" />
										</div>
										<span className="text-muted-foreground">{problem.text}</span>
									</li>
								))}
							</ul>
						</div>
					</div>
				</section>

				<section className="border-b border-border">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl text-center">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Zerobyte puts a real control plane on top of Restic
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								Instead of stitching together CLI commands, cron, and ad hoc monitoring, you manage the full backup
								lifecycle from one place.
							</p>
						</div>
						<div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
							{solutions.map((solution) => (
								<div key={solution.title} className="group">
									<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
										<solution.icon className="h-5 w-5 text-strong-accent" />
									</div>
									<h3 className="text-lg font-semibold text-foreground">{solution.title}</h3>
									<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{solution.description}</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section id="features" className="border-b border-border bg-secondary/20">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl text-center">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Everything you need to run serious backups
							</h2>
						</div>
						<div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							{features.map((feature) => (
								<CornerCard key={feature.title} className="flex h-full flex-col gap-6 py-6">
									<div className="grid auto-rows-min grid-rows-[auto_auto] items-start gap-4 px-6">
										<feature.icon className="h-5 w-5 text-strong-accent" />
										<h3 className="leading-none font-semibold text-foreground">{feature.title}</h3>
									</div>
									<div className="px-6">
										<p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
									</div>
								</CornerCard>
							))}
						</div>
					</div>
				</section>

				<section id="how-it-works" className="border-b border-border">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl text-center">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								From source to snapshot in four steps
							</h2>
						</div>
						<div className="relative mt-16">
							<div className="absolute left-6 top-0 hidden h-full w-px bg-border lg:left-1/2 lg:block" />
							<div className="space-y-8 lg:space-y-12">
								{steps.map((step, index) => (
									<div
										key={step.number}
										className="relative flex flex-col gap-6 pl-16 lg:flex-row lg:items-center lg:gap-12 lg:pl-0"
									>
										<div className={`lg:w-1/2 ${index % 2 === 0 ? "lg:pr-12 lg:text-right" : "lg:order-2 lg:pl-12"}`}>
											<h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
											<p className="mt-2 text-muted-foreground">{step.description}</p>
										</div>
										<div className="absolute left-0 top-0 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-background text-lg font-bold text-strong-accent lg:left-1/2 lg:-translate-x-1/2">
											{step.number}
										</div>
										<div className={`hidden lg:block lg:w-1/2 ${index % 2 === 0 ? "lg:order-2" : ""}`} />
									</div>
								))}
							</div>
						</div>
						<div className="mt-16 text-center">
							<Link to="/docs/$" params={{ _splat: "" }} className={outlineButtonClass}>
								Read the Docs
								<ArrowRight className="h-4 w-4" />
							</Link>
						</div>
					</div>
				</section>

				<section className="border-b border-border bg-secondary/20">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Built for the gap between raw CLI power and real-world operations
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								Restic is excellent at creating secure, efficient backups. Zerobyte makes that power practical day to
								day.
							</p>
							<ul className="mt-10 space-y-4">
								{benefits.map((benefit) => (
									<li key={benefit} className="flex items-start gap-4">
										<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-strong-accent/10">
											<Check className="h-3.5 w-3.5 text-strong-accent" />
										</div>
										<span className="text-foreground">{benefit}</span>
									</li>
								))}
							</ul>
						</div>
					</div>
				</section>

				<section id="faq" className="border-b border-border">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl">
							<h2 className="text-balance text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Frequently asked questions
							</h2>
							<div className="mt-12">
								<Accordion defaultValue={[faqs[0].question]}>
									{faqs.map((faq) => (
										<AccordionItem key={faq.question} value={faq.question}>
											<AccordionTrigger className="py-4 text-sm font-medium text-foreground hover:text-strong-accent">
												{faq.question}
											</AccordionTrigger>
											<AccordionContent className="pb-4 text-sm text-muted-foreground">{faq.answer}</AccordionContent>
										</AccordionItem>
									))}
								</Accordion>
							</div>
						</div>
					</div>
				</section>

				<section className="border-b border-border">
					<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
						<div className="mx-auto max-w-3xl text-center">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Stop babysitting backup scripts
							</h2>
							<p className="mt-4 text-lg text-muted-foreground">
								Give your setup a control plane that operators can actually use.
							</p>
							<div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
								<Link to="/docs/$" params={{ _splat: "" }} className={primaryButtonClass}>
									Documentation
									<ArrowRight className="h-4 w-4" />
								</Link>
								<a href={repoUrl} target="_blank" rel="noopener noreferrer" className={outlineButtonClass}>
									<Github className="h-4 w-4" />
									View on GitHub
								</a>
							</div>
							<p className="mt-8 text-sm text-muted-foreground">
								Self-host Zerobyte and bring scheduling, visibility, restores, and repository maintenance into one
								place.
							</p>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
