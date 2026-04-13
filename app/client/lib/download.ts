type DownloadFileOptions = {
	content: BlobPart;
	contentType?: string;
	fileName: string;
};

export function downloadFile({ content, contentType = "application/octet-stream", fileName }: DownloadFileOptions) {
	const blob = new Blob([content], { type: contentType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");

	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
