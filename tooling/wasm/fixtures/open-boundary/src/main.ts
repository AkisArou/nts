// Open values at the public boundary: a JS primitive crosses as the open value
// it is, and an open primitive comes back as the JS value it denotes. An
// object, a function, a symbol or a bigint is refused by name, either way.

// Every primitive kind straight through: -0 and NaN, numbers past a small
// integer's range, `undefined` apart from `null`.
export function same(value: unknown): unknown {
  return value;
}

export function kind(value: unknown): string {
  return value === null ? "null" : typeof value;
}

export function sum(value: unknown, n: number): number {
  return typeof value === "number" ? value + n : typeof value === "string" ? value.length : -1;
}

// An open result made here, of each kind.
export function made(n: number): unknown {
  const at = ((n % 7) + 7) % 7;
  if (at === 0) return n * 0.5;
  if (at === 1) return `n${n}`;
  if (at === 2) return n > 2;
  if (at === 3) return undefined;
  if (at === 4) return null;
  if (at === 5) return 2 ** 40 + n;
  return -0;
}

// An object made here has no JS form at this boundary yet.
export function anObject(n: number): unknown {
  return n > 100 ? { n } : n;
}

// Two open parameters, compared as JS compares them.
export function equal(a: unknown, b: unknown): boolean {
  return a === b;
}
