import { password } from "@inquirer/prompts";

const validateConnectionCode = (value: string) => {
	const code = value.trim();

	if (!code) {
		throw new Error("A connection code is required");
	}
	if (code.length > 4096) {
		throw new Error("The connection code is too long");
	}

	return code;
};

export const promptConnectionCode = async () =>
	validateConnectionCode(await password({ message: "Connection code", mask: "*" }, { output: process.stderr }));

export const readConnectionCodeFromStdin = async (input: AsyncIterable<string | Uint8Array> = process.stdin) => {
	let value = "";

	for await (const chunk of input) {
		value += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		if (value.length > 4096) throw new Error("The connection code is too long");

		const newline = value.search(/[\r\n]/);
		if (newline !== -1) {
			value = value.slice(0, newline);
			break;
		}
	}

	return validateConnectionCode(value);
};
