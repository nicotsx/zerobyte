import { toast } from "sonner";

export async function copyToClipboard(textToCopy: string) {
	// Navigator clipboard api needs a secure context (https)
	if (navigator.clipboard && window.isSecureContext) {
		await navigator.clipboard.writeText(textToCopy);
		toast.success("Copied to clipboard");
	} else {
		// Use the 'out of viewport hidden text area' trick
		const textArea = document.createElement("textarea");
		textArea.value = textToCopy;

		// Move textarea out of the viewport so it's not visible
		textArea.style.position = "absolute";
		textArea.style.left = "-999999px";

		document.body.prepend(textArea);
		textArea.select();

		try {
			document.execCommand("copy");
			toast.success("Copied to clipboard");
		} catch (error) {
			console.error(error);
		} finally {
			textArea.remove();
		}
	}
}
