// Processed **before** `provider.ts`, because that file imports a value from
// this one — and this one names `Counter` only as a *type*.
//
// That is the shape the bug needs, and it is exactly `stream`'s:
// `readable.ts` imports a value from `from.ts`, and `from.ts` imports
// `Readable` with `import type`. So `from.ts` is the dependency, is interned
// first, and reaches the `Readable` symbol while holding none of its
// declarations.
import type { Counter } from "./provider.js";

export function readCount(c: Counter): number {
  return c.count;
}

export function offset(n: number): number {
  return (n + 1) | 0;
}
