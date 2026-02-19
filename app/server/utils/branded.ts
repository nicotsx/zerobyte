declare const brand: unique symbol;

export type Branded<T, B> = T & { [brand]: B };

export type ShortId = Branded<string, "ShortId">;

export const asShortId = (value: string): ShortId => value as ShortId;

export const isShortId = (value: string): value is ShortId => /^[A-Za-z0-9_-]+$/.test(value);
