const decodeCanonicalBase64Url = (value: string) => {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

	const decoded = Buffer.from(value, "base64url");

	return decoded.toString("base64url") === value ? decoded : null;
};

export const readMachineIdentity = (credential: string): string | null => {
	if (credential.length > 512) return null;

	const parts = credential.split(".");
	if (parts.length !== 4 || parts[0] !== "zba1") return null;

	const identityBytes = decodeCanonicalBase64Url(parts[1] ?? "");
	const versionText = parts[2] ?? "";
	const secret = decodeCanonicalBase64Url(parts[3] ?? "");

	if (!identityBytes || identityBytes.length === 0 || identityBytes.length > 128) return null;
	if (!/^(0|[1-9][0-9]{0,9})$/.test(versionText) || Number(versionText) > 2_147_483_647) return null;
	if (!secret || secret.length !== 32) return null;

	const identity = identityBytes.toString("utf8");

	return Buffer.from(identity).equals(identityBytes) ? identity : null;
};
