// expect: NTS1001 indexing an object type, which is not an array
//
// **A member keyed by `Symbol.iterator` is refused where it is read through an
// object type.** `iteratorOf` views an `unknown` as a record whose one member
// is `[Symbol.iterator]` and reads it; the read is the refused construct. The
// refusal cuts the three module-scope prints that call `iteratorOf`: the
// program prints nothing, and node prints `true`, `true`, `true`.
//
// The view's spelling does not matter: a named interface with the same
// member (`indexing `MaybeIterable`, which is not an array`) and
// `Partial<Iterable<unknown>>` are refused alike, and so is the key held in a
// `symbol`-typed `const`, whose initialiser `Symbol.iterator` is also refused
// as "a global member with no definition here".
//
// **Control**, measured and not kept in this file: the same program with the
// key written `"@@iterator"`, in the view's type and in the read, a one-key
// difference. It compiles on all three compilers below and prints node's lines
// for it, `false`, `true`, `true` (an array has no `@@iterator` member).
//
// **Measured the same** on 2e8eedb17, efc71ad44 and bcf750d4b.
//
// **Found by the React lane.** `getIteratorFn`
// (runtime/react/packages/shared/src/ReactSymbols.ts:35), React's test for an
// iterable child, is this shape: upstream reads
// `maybeIterable[MAYBE_ITERATOR_SYMBOL]` over `any`, and the typed port reads
// it through `{ [Symbol.iterator]?: unknown; ["@@iterator"]?: unknown }`. The
// child reconciler calls it from `createChild`, `updateSlot`, `updateFromMap`,
// `reconcileChildrenIteratable` and `reconcileChildFibersImpl`, so with the
// Array.isArray root
// (blockers/an-unknown-narrowed-by-isarray-passed-as-an-array) out of the
// way, it is what refuses `reconcileChildFibers` and cuts the module-scope
// initialisers of `reconcileChildFibers` and `mountChildFibers`; beginWork's
// `reconcileChildren` and `updatePortalComponent` stop there. Today the GTK
// counter's chain from `main` stops earlier, at the LazyComponent root.
function iteratorOf(value: unknown): ((this: unknown) => Iterator<unknown>) | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as { [Symbol.iterator]?: unknown };
  const method = record[Symbol.iterator];
  if (typeof method === "function") {
    return method as (this: unknown) => Iterator<unknown>;
  }
  return null;
}

console.log(iteratorOf([1, 2]) !== null);
console.log(iteratorOf({ a: 1 }) === null);
console.log(iteratorOf("s") === null);
