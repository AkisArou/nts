// A bigint compared with `===` / `!==` against an erased value.
//
// The backends spell a mixed comparison against an `NtsValue` only for the
// primitives they have an arm for -- a string, a number, a boolean -- and a
// bigint was not one: `items[1] === 1n << 100n` over an `unknown[]` emitted
// C's `==` between an `NtsValue` and an `__int128`, which clang refuses. The
// bigint is erased now, so it is the erased comparison, by value.

/** A bigint in an erased slot against a computed bigint, both ways round. */
export function sameBigint(n: number): boolean {
  const items: unknown[] = ["first", 1n << 100n, n > 0];
  return items[1] === 1n << 100n && (1n << 100n) === items[1] && items[0] !== 1n;
}

/** A value equal in magnitude but not a bigint is not equal. */
export function notANumber(n: number): boolean {
  const items: unknown[] = [];
  items.push(Number(n | 0));
  return items[0] !== BigInt(n | 0);
}

/** An `unknown` parameter compared with bigints of either sign. */
function classify(value: unknown): number {
  if (value === 0n) return 0;
  if (value === -1n) return 1;
  if (value !== 2n ** 64n) return 2;
  return 3;
}
export function compares(n: number): number {
  const choice = (n | 0) % 4;
  const value: unknown = choice === 0 ? 0n : choice === 1 ? -1n : choice === 2 ? 2n ** 64n : "text";
  return classify(value);
}
