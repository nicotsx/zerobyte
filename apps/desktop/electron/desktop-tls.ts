import { session } from "electron";
import { KeyObject, randomBytes, X509Certificate } from "node:crypto";
import { SubjectAlternativeNameExtension, X509CertificateGenerator } from "@peculiar/x509";

export const createDesktopTls = async () => {
	const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
	const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
	const certificate = await X509CertificateGenerator.createSelfSigned({
		serialNumber: randomBytes(16).toString("hex"),
		name: "CN=Zerobyte Desktop",
		notBefore: new Date(Date.now() - 60_000),
		notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
		signingAlgorithm: algorithm,
		keys,
		extensions: [new SubjectAlternativeNameExtension([{ type: "ip", value: "127.0.0.1" }])],
	});
	const cert = certificate.toString("pem");
	const expected = new X509Certificate(cert);

	session.defaultSession.setCertificateVerifyProc(({ hostname, certificate }, callback) => {
		if (hostname !== "127.0.0.1") {
			callback(-3); // Use Chromium's normal verification for other hosts.
			return;
		}

		try {
			callback(new X509Certificate(certificate.data).raw.equals(expected.raw) ? 0 : -2);
		} catch {
			callback(-2);
		}
	});

	return { cert, key: KeyObject.from(keys.privateKey).export({ type: "pkcs8", format: "pem" }) };
};
