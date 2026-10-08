export const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, "$2");
