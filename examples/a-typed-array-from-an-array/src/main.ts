// `new Uint8Array([1, 2, 3])`, which was refused by name.
//
//     NTS1001 a `new Uint8Array` from a value
//
// The constructor already took a length and an `ArrayBuffer`; a third argument
// shape — "copy from what I am given" — was refused rather than read as a
// length, which would have allocated whatever the pointer happened to be. That
// refusal was the right one to have; this is the case it was holding open.
//
// # An array only, and nothing new in the runtime
//
// Any other iterable needs `Iterable<T>` to be representable, which is library
// interface dispatch and the larger piece the whole iteration family sits
// behind. `new Uint8Array(anotherView)` is still refused by name: that wants
// `nts_view_set`, which copies between two *views* and is a different
// operation.
//
// The fill is `Place::Element` per index — what `a[i] = v` already lowers to on
// a view. So the narrowing each element needs is the one the assignment path
// already decides, in **one place**, rather than a second rule here that would
// agree with it until it did not. `narrowsLikeAStore` is the arm that holds the
// two together: `300` becomes `44` and `-1` becomes `255`, which is what node
// answers and what `a[0] = 300` has always answered.
//
// # The empty literal needed the expectation
//
// `new Uint8Array([])` types its literal `never[]` and falls back to the
// *contextual* type, which is the constructor's `ArrayLike<number> |
// Iterable<number>` — not an array, so the literal refused for the shape it was
// about to be given. The argument is lowered at `number[]` instead, asked of
// the **node** rather than of the lowered value, because the value is what the
// expectation decides.
//
// # `number[]`, and not the view's own element
//
// Expecting `Array(u8)` is the obvious spelling and it is wrong twice over. It
// puts the narrowing in two places — here and at the store — and it builds a
// `u8` array, which is a representation an array literal otherwise never has:
// every `number[]` is `f64`, and no TypeScript type asks for anything else.
//
// It also produced **wrong answers**. With `Array(u8)` the arms below agreed
// with node on every pool value except the small non-negative integers, where
// the *specialized* copy of the enclosing function read zeroes out of the
// source array. That is a latent defect in something else — reached only
// because this expectation manufactured a shape nothing else makes — and it is
// recorded rather than chased: with the expectation at `number[]` there is no
// program that builds one.
//
// Worth the note because the failure looked like this feature's: two cases out
// of two hundred, in one arm, and only for arguments a reduction would have
// used.

export function fromALiteral(n: number): number {
  const a = new Uint8Array([n, n + 1, n + 2]);
  return a.length * 100 + a[1]!;
}

/** The store's narrowing, not a second copy of it. */
export function narrowsLikeAStore(n: number): number {
  const a = new Uint8Array([300 + n, -1]);
  return a[0]! * 1000 + a[1]!;
}

export function fromAVariable(n: number): number {
  const xs = [n, n * 2, n * 3];
  const a = new Int32Array(xs);
  return a.length * 1000 + a[2]!;
}

/** Floats, where no narrowing happens at all. */
export function doubles(n: number): number {
  const a = new Float64Array([n / 2, n / 4]);
  return a[0]! * 100 + a[1]!;
}

/** Empty, which is where the contextual type had to be supplied. */
export function fromEmpty(n: number): number {
  const a = new Uint8Array([]);
  return a.length + n;
}

/** **Control.** A length, which the constructor always took. */
export function fromALength(n: number): number {
  const a = new Uint8Array(3);
  a[0] = n;
  return a.length * 100 + a[0]!;
}

/** **Control.** A buffer, the other shape it always took. */
export function overABuffer(n: number): number {
  const b = new ArrayBuffer(4);
  const a = new Uint8Array(b);
  a[3] = n;
  return a.length * 100 + a[3]!;
}

// # The same object under its other two names
//
// `Uint8Array.of(1, 2, 3)` and `Uint8Array.from(xs)` were both `not a member of
// this compiler's Uint8Array`. `from` with one array argument *is*
// `new Uint8Array(xs)`, so it routes to the same code rather than deciding
// again what a `Uint8Array` is; `typed_array_shape` is the one place the width
// and the storage tag come from, asked by all three.
//
// `of` takes its elements as *arguments*, so there is no node to lower as an
// array — this builds one, with the argument count as its length, which is why
// those stores are unchecked: `ArrayNew` made exactly those slots a line
// earlier.
//
// **`from`'s second argument is a mapping function and is refused by name.**
// Ignoring it would be a silently wrong answer, which is the failure mode this
// whole file is about.

export function ofThreeValues(n: number): number {
  const a = Uint8Array.of(n, n + 1, n + 2);
  return a.length * 100 + a[2]!;
}

/** `of` narrows exactly as the constructor does, for the same reason. */
export function ofNarrows(n: number): number {
  const a = Uint8Array.of(300 + n, -1);
  return a[0]! * 1000 + a[1]!;
}

/** No arguments at all, which is an empty view rather than a refusal. */
export function ofNothing(n: number): number {
  const a = Uint8Array.of();
  return a.length + n;
}

export function fromALiteralArgument(n: number): number {
  const a = Uint8Array.from([n, n + 1]);
  return a.length * 100 + a[1]!;
}

export function fromAVariableArgument(n: number): number {
  const xs = [n, n + 1, n + 2];
  const a = Int32Array.from(xs);
  return a.length * 1000 + a[2]!;
}

/** Floats through `of`, where nothing narrows. */
export function ofDoubles(n: number): number {
  const a = Float64Array.of(n / 2, n / 4);
  return a[0]! * 100 + a[1]!;
}
