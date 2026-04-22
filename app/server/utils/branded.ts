declare const brand: unique symbol;

type Branded<T, B> = T & { [brand]: B };

export type ShortId = Branded<string, "ShortId">;

export const asShortId = (value: string): ShortId => value as ShortId;
