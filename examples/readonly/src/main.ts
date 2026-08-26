// Fixture for the type facts that decide representation.

export interface Config {
  readonly host: string; // readonly by keyword
  port: number; // writable
  timeout?: number; // optional: needs a presence bit or an undefined slot
}

// Readonly with no keyword on any declaration. Only the checker knows.
export type Frozen = Readonly<{ a: number; b: string }>;

// An index signature: this cannot be a flat struct with fixed offsets.
export interface Bag {
  [key: string]: number;
}

export interface ReadonlyBag {
  readonly [key: string]: number;
}

export const config: Config = { host: "h", port: 1 };
export const frozen: Frozen = { a: 1, b: "b" };
export const bag: Bag = {};
export const rbag: ReadonlyBag = {};

export function optionals(a: number, b?: string, ...rest: number[]): void {}
