export const normalizeRequiredName = (name: string) => {
	const normalizedName = name.trim();

	return normalizedName.length > 0 ? normalizedName : null;
};
