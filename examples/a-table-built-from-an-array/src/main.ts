// `new Set([1, 2, 3])` and `new Map([[k, v]])`, which were refused outright.
//
//     NTS1001 a `new Set` with contents, which needs the iteration protocol
//
// The ledger read *"the constructors and the spread still want an array"*,
// which sounds like a restriction and was not one: they took **nothing**. An
// array argument refused exactly as a `Set` argument did.
//
// # An array only, and that is the whole feature
//
// The constructors take any iterable, and an arbitrary one needs `Iterable<T>`
// to be representable — a library interface whose `[Symbol.iterator]` has to be
// dispatched, which is the larger piece the whole iteration family sits behind.
// An array needs none of it: the length is known and the elements are indexed.
// `new Set(anotherSet)` is still refused, by name.
//
// # Nothing new in the runtime, deliberately
//
// The loop calls `nts_set_add` and `nts_map_set` — the same externals
// `lower_table_method` already emits for `s.add(v)` and `m.set(k, v)`. So the
// three backends need no change and cannot disagree about this. A helper added
// for one of them red-gates the other two and there is no allowance list for
// that, which is the reason to build an operation out of pieces every backend
// already has rather than to add a fourth.
//
// # The index read is emitted *checked*
//
// Not because it can fail — `i < nts_length(xs)` is exactly the relation
// `bounds.rs` is built to eliminate — but because that is where the decision
// belongs. Asserting the elimination here would be a second derivation of the
// same proof. Verified on the artifact rather than assumed: the prepared HIR
// reads `array.get unchecked` and the C is a plain `NTS_ITEMS(v, double)[i]`.
//
// # The empty literal needed the expectation
//
// `new Set<number>([])` types its literal `never[]` and falls back to the
// *contextual* type, which is the constructor's `Iterable<T>` — not an array,
// so the literal refused for the shape it was about to be given. The contents
// are lowered at `T[]` instead. A Map's element is a two-field tuple this has
// no representation for at that point, so `new Map<K, V>([])` keeps refusing
// and `emptyMap` is deliberately absent below.

export function setSize(n: number): number {
  const s = new Set<number>([n, n + 1, n + 2]);
  return s.size;
}

/** Duplicates collapse, which is the only reason to reach for a `Set`. */
export function setDedupes(n: number): number {
  const s = new Set<number>([n, n, n + 1]);
  return s.size * 10 + (s.has(n) ? 1 : 0);
}

/** Strings, so the key is a reference and hashes rather than compares. */
export function setOfStrings(n: number): number {
  const s = new Set<string>(["a", "b", "a"]);
  return s.size * n + (s.has("b") ? 1 : 0);
}

/** From a variable rather than a literal — the same array, no contextual type. */
export function setFromAVariable(n: number): number {
  const xs = [n, n + 1];
  const s = new Set<number>(xs);
  return s.size * 10 + (s.has(n + 1) ? 1 : 0);
}

/** Empty, which is where the contextual type had to be supplied. */
export function emptySet(n: number): number {
  const s = new Set<number>([]);
  return s.size + n;
}

export function mapSize(n: number): number {
  const m = new Map<string, number>([
    ["a", n],
    ["b", n + 1],
  ]);
  return m.size * 100 + m.get("b")!;
}

/** A later key wins, as it does in node — the loop runs in array order. */
export function mapLastWins(n: number): number {
  const m = new Map<string, number>([
    ["a", n],
    ["a", n + 5],
  ]);
  return m.size * 100 + m.get("a")!;
}

/** Number keys, so the map is not quietly a string map. */
export function mapOfNumbers(n: number): number {
  const m = new Map<number, number>([
    [1, n],
    [2, n * 2],
  ]);
  return m.size * 100 + m.get(2)!;
}

/** **Control.** Empty then filled, which worked before any of this. */
export function builtByHand(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n);
  s.add(n + 1);
  return s.size * 10 + (s.has(n) ? 1 : 0);
}

/** **Control.** A plain array walk, the machinery the loop is made of. */
export function overAnArray(n: number): number {
  const xs = [n, n + 1, n + 2];
  let total = 0;
  for (const v of xs) {
    total += v;
  }
  return total;
}
