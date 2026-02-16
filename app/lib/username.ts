const USERNAME_ALLOWED_CHARACTERS_REGEX = /^[a-z0-9_.-]+$/i;

export const normalizeUsername = (username: string): string => username.trim().toLowerCase();

export const isValidUsername = (username: string): boolean => USERNAME_ALLOWED_CHARACTERS_REGEX.test(username);
