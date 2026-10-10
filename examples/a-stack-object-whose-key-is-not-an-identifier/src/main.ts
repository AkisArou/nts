// An object built on the stack, whose function-valued key is not an
// identifier.
//
// A stack object zeroes each field holding a reference before its first store,
// so the end of the frame releases a null rather than garbage. The C backend
// spelled that one store with the key as written, `v1_frame.minus one = 0;`,
// where every other access spells it `minus_x20one`, and clang refused the
// program. Found by `examples/a-function-named-where-it-is-written`, whose
// object literal has a key `"minus one"`.
//
// The control is the same object with identifier keys; each arm differs from
// it in the one key.

export function aKeyWithASpace(n: number): number {
  const table = { "minus one": (x: number): number => x - 1, plain: (x: number): number => x + n };
  return table["minus one"](n) + table.plain(n);
}

export function aKeyThatIsANumber(n: number): number {
  const table = { 1: (x: number): number => x - 1, plain: (x: number): number => x + n };
  return table[1](n) + table.plain(n);
}

export function identifierKeys(n: number): number {
  const table = { minusOne: (x: number): number => x - 1, plain: (x: number): number => x + n };
  return table.minusOne(n) + table.plain(n);
}
