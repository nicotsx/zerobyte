const UNSAFE_MACHINE_NAME_CHARACTERS_REGEX = /[\p{Cc}\p{Cf}]/gu;

export const MACHINE_NAME_MAX_LENGTH = 100;

export const normalizeMachineName = (name: string): string => name.trim();

export const isValidMachineName = (name: string): boolean => {
	const normalizedName = normalizeMachineName(name);
	const hasValidLength = normalizedName.length >= 1 && normalizedName.length <= MACHINE_NAME_MAX_LENGTH;
	const hasUnsafeCharacters = name.search(UNSAFE_MACHINE_NAME_CHARACTERS_REGEX) !== -1;
	return hasValidLength && !hasUnsafeCharacters;
};

export const getMachineDisplayName = (name: string): string => {
	const sanitizedName = name.replace(UNSAFE_MACHINE_NAME_CHARACTERS_REGEX, "").trim();
	return sanitizedName || "Unnamed machine";
};
