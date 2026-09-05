const UNSAFE_LABEL_CHARACTERS_REGEX = /[\p{Cc}\p{Cf}]/u;
const PATH_SEPARATOR_REGEX = /[\\/]/u;
const WINDOWS_DRIVE_PREFIX_REGEX = /^[a-zA-Z]:/u;
const POSIX_DOT_DIRECTORY_REGEX = /^\.{1,2}$/u;
const POSIX_TILDE_PATH_REGEX = /^~[\p{L}\p{N}._-]*$/u;

export const UNNAMED_MACHINE_LABEL = "Unnamed machine";
export const UNAVAILABLE_MACHINE_LABEL = "Unavailable machine";
export const ALLOWED_LOCATION_LABEL = "Allowed location";

export const isSafePresentationLabel = (value: string): boolean => {
	const normalizedValue = value.trim();
	const isEmpty = normalizedValue.length === 0;
	const hasUnsafeCharacters = UNSAFE_LABEL_CHARACTERS_REGEX.test(value);
	const hasPathSeparator = PATH_SEPARATOR_REGEX.test(normalizedValue);
	const hasWindowsDrivePrefix = WINDOWS_DRIVE_PREFIX_REGEX.test(normalizedValue);
	const isPosixDotDirectory = POSIX_DOT_DIRECTORY_REGEX.test(normalizedValue);
	const isPosixTildePath = POSIX_TILDE_PATH_REGEX.test(normalizedValue);
	return (
		!isEmpty &&
		!hasUnsafeCharacters &&
		!hasPathSeparator &&
		!hasWindowsDrivePrefix &&
		!isPosixDotDirectory &&
		!isPosixTildePath
	);
};

export const getSafePresentationLabel = (value: string, fallback: string): string => {
	const normalizedValue = value.trim();
	const isSafe = isSafePresentationLabel(value);
	return isSafe ? normalizedValue : fallback;
};

export const getSafeMachinePresentationLabel = (value: string): string =>
	getSafePresentationLabel(value, UNNAMED_MACHINE_LABEL);

export const getSafeAllowedLocationLabel = (value: string): string =>
	getSafePresentationLabel(value, ALLOWED_LOCATION_LABEL);
