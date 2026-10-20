// `a?.b!.c` -- a non-null assertion inside an optional chain.
//
// `!` only asserts a type, and it does not end the chain it sits in: when `a`
// is absent the whole of `a?.b!.c` is `undefined`, as `a?.b?.c` would be.
// Parentheses end a chain, `(a?.b)!.c` reads `c` of `undefined`; `!` does not.
// Lowering's chain walks stopped at the `!`, so `.c` was read of the
// `undefined` the `?.` had made, and every backend threw where node answers
// `undefined` (C, LLVM and the JVM a TypeError): the TypeScript suite's
// expressions/non-null-in-optional-chain.
//
// The control, an-optional-chain-without-a-non-null-assertion, writes each
// chain with `?.` where this one has `!`.
class Leaf {
  label: string | undefined;
  size: number;
  constructor(label: string | undefined, size: number) {
    this.label = label;
    this.size = size;
  }
  grow(): number {
    this.size = this.size + 1;
    return this.size;
  }
}

type Tree = { child?: Leaf };

function tree(seed: number): Tree | undefined {
  if ((seed & 1) === 0) return undefined;
  return { child: new Leaf((seed & 2) === 0 ? undefined : "leaf", seed & 7) };
}

/** Under test: a property after the `!`, the tree absent or present. */
export function label(seed: number): string {
  const read = tree(seed)?.child!.label;
  return read === undefined ? "absent" : read;
}

/** Under test: a number after the `!`. */
export function size(seed: number): number {
  return tree(seed)?.child!.size ?? -1;
}

/** Under test: a method called after the `!`, as a statement and as a value. */
export function grown(seed: number): number {
  const t = tree(seed);
  t?.child!.grow();
  return t?.child!.grow() ?? -1;
}

/** The boundary: parentheses end a chain, so an absent tree throws here. */
export function parenthesized(seed: number): string {
  try {
    const read = (tree(seed)?.child)!.label;
    return read === undefined ? "absent" : read;
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "other";
  }
}
