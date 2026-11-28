export const faqs = [
	{
		question: "Is Zerobyte a backup engine or a UI for Restic?",
		answer: "Zerobyte is a Restic-based backup automation tool. It gives you a web control plane for scheduling, managing, monitoring, restoring, and maintaining Restic backups.",
	},
	{
		question: "What can I back up with Zerobyte?",
		answer: "You can back up local directories, NFS shares, SMB/CIFS shares, WebDAV endpoints, SFTP locations, and rclone-backed sources.",
	},
	{
		question: "Where can I store backups?",
		answer: "Zerobyte supports local repositories, S3-compatible storage, Cloudflare R2, Google Cloud Storage, Azure Blob Storage, REST servers, SFTP targets, and many additional providers through rclone.",
	},
	{
		question: "Is my data encrypted?",
		answer: "Yes. Zerobyte relies on Restic's end-to-end encryption for repository data, and sensitive credentials stored by the app are encrypted before they are written to the database.",
	},
	{
		question: "Can I restore individual files?",
		answer: "Yes. You can browse snapshots from the web interface and restore individual files, directories, or larger paths to the original or an alternate location.",
	},
	{
		question: "Can teams use Zerobyte?",
		answer: "Yes. Zerobyte is organization-scoped and supports roles, invitations, and OIDC-based SSO for managed access.",
	},
	{
		question: "How do I deploy it?",
		answer: "Zerobyte is designed to be self-hosted and can be deployed with Docker Compose.",
	},
];
