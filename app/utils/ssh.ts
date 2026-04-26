const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;

	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}

	return btoa(binary);
};

const toPem = (base64: string, label: string) => {
	const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
	return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
};

export const generateSshKeyPairPem = async () => {
	const keyPair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 4096,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);

	const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
	const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);

	return {
		privateKeyPem: toPem(arrayBufferToBase64(privateKey), "PRIVATE KEY"),
		publicKeyPem: toPem(arrayBufferToBase64(publicKey), "PUBLIC KEY"),
	};
};

export const generatePrivateKeyPem = async () => {
	const keyPair = await generateSshKeyPairPem();
	return keyPair.privateKeyPem;
};
