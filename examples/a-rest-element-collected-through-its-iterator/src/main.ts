// `const [...xs] = iter` collects what the iterator yields.
//
// The refusal this replaces named the feature rather than guessing at it -- *"a rest element over
// a value that is not an array, which needs it collected through its iterator first"* -- and the
// machinery it pointed at was already in `build_array_from`, serving `Array.from`. It is
// `collect_a_walk` now, with two callers: `Array.from(xs)`, which has its argument as a **node**
// and lowers it itself, and a rest element, whose source is already a **value**.
//
// # Why `Array.from` is an arm of this file
//
// The two share a core now, so a change to one can answer for the other silently. `viaArrayFrom`
// collects the same generator the rest arms do and must give the same answer; if the extraction
// had changed the collecting loop, this is the arm that says so rather than a reviewer's reading.
//
// `restOfAnArray` is the other direction: an **array** source keeps `nts_array_slice`, a memcpy
// of one run of memory, and never reaches the walk. `build_array_from`'s own comment prices the
// difference at **8.7x** -- 462.77 us against 53.07 us over 256 elements -- so routing arrays
// through the iterator would be a regression dressed as generality.
//
// # What still refuses, so the boundary is explicit
//
// # And the control compiler says "agrees" about this file
//
// It checks **58 cases across 2 functions** where this one checks **174 across 6**: four arms are
// refused, their cases are *declined*, and `nts check` prints `agreed on every case` about the two
// that remain. A verdict is not coverage, and the count beside it is the only thing that says so --
// which is why the differential's two-pin form, comparing what each arm *compared*, is what holds
// this file rather than either run's verdict alone.
//
// `[...x]` over an **`Iterable`-typed parameter** -- which is what an unannotated
// `([...x]) => f(x)` infers, and the shape test262's 190 cases are written in -- still refuses,
// one wall further in than before: the walk calls `[Symbol.iterator]` on an interface **no class
// in this program implements**, so the protocol has no body to call. That is the interface
// dispatch question, not this one, and the refusal now names it.

function* three(): Generator<number> {
  yield 1;
  yield 2;
  yield 3;
}

function* counting(limit: number): Generator<number> {
  for (let i = 0; i < limit; i += 1) {
    yield i * 2;
  }
}

/** The whole of a generator, collected. */
export function restOfAGenerator(n: number): number {
  const [...xs] = three();
  return xs.length * 100 + (xs[0] ?? 0) * 10 + (xs[2] ?? 0) + (n & 7);
}

/** A hole first: the iterator has advanced, so the tail is what is left. */
export function anElisionThenTheRest(n: number): number {
  const [, ...xs] = three();
  return xs.length * 100 + (xs[0] ?? 0) * 10 + (n & 7);
}

/** Two holes, so only the last element remains. */
export function twoElisionsThenTheRest(n: number): number {
  const [, , ...xs] = three();
  return xs.length * 100 + (xs[0] ?? 0) * 10 + (n & 7);
}

/** A generator of a length the argument decides, so the walk is not three by coincidence. */
export function restOfACountedGenerator(n: number): number {
  const [...xs] = counting(n & 7);
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  return xs.length * 100 + total + (n & 7);
}

/** `Array.from` over the same generator: the other caller of the shared core. */
export function viaArrayFrom(n: number): number {
  const xs = Array.from(counting(n & 7));
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  return xs.length * 100 + total + (n & 7);
}

/** An **array** source keeps its slice and never reaches the walk. */
export function restOfAnArray(n: number): number {
  const source = [1, 2, 3, 4];
  const [, ...xs] = source;
  return xs.length * 100 + (xs[0] ?? 0) * 10 + (n & 7);
}
