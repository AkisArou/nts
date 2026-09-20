// Reading an element of an array that `map` produced.
//
//     const xs: string[] = ["a", "b"];
//     const ys = xs.map((s) => s + "!");
//     ys[0]
//
// Correct on C, LLVM and the JVM. **Wrong under reference counting**, where it
// disagrees with node and the bytes read back are freed memory. Listed in
// `tooling/gate/rc.sh`'s `known_failing`, which is what keeps a wrong answer
// counted rather than absorbed.
//
// # This fixture was named after a cause, and the cause was wrong
//
// It arrived as *"a mapped tuple in a concatenation"* — `Object.entries(o)
// .map((e) => e[0] + "=" + e[1].toString()).join(",")` — and a first boundary
// said it needed three things at once: two or more elements, a number
// conversion, and a **tuple** element. Every one of those was measured, and
// the conclusion was still wrong, because each comparison changed more than
// one thing at a time. The shape above has no tuple, no number, no conversion
// and no concatenation of two reads, and it fails.
//
// What actually separates the failing shapes from the passing ones is **how
// the result is read**:
//
//     ys[0]                        fails
//     for (const y of ys) { … }    fails
//     ys.join(",")                 passes
//     ys.length                    passes
//     xs.map(…).join(",")          passes
//
// `join` and `length` are runtime calls that read the array's storage
// themselves. An element read the compiled program performs — `array.get` —
// is what hands back freed memory. And the callback has to **produce a new
// string**: `xs.map((s) => s)` passes, and so does reading an element of an
// array that was written as a literal.
//
// # The original shape, kept
//
// `mappedTupleInAConcatenation` is the program this started from. It ends in
// `join`, which passes in the small shape above, so it is a *second* failing
// combination rather than an instance of the first — and that is why it stays:
// two failing shapes that a single explanation has to cover.
//
// # What is ruled out
//
// Each checked rather than assumed. It is **not** the ownership optimiser:
// `NTS_RC_NAIVE=1` — every retain and release the model asks for and none of
// the analysis that removes them — fails identically, so the disagreement is
// in the counting model or the runtime. It is **not** the frame-allocated
// string `nts_number_to_string` writes into, since `[e[1]].join("")` in its
// place fails too and the smallest shape has no number in it. It is **not**
// the source array, which reads back correctly afterwards. And it is **not**
// the `array.new uninitialized` plus read-then-release of the previous
// element, which the passing shapes have as well.
//
// **No cause is named here.** The last one was measured, written down, and
// wrong; what this file is for is the shapes.

const words: string[] = ["a", "b"];

/** The smallest failing program. */
export function anElementOfAMappedArray(n: number): string {
  const ys = words.map((s) => s + "!");
  return ys[0] + (n < 1 ? "" : "?");
}

/** A walk over the same array, which fails the same way. */
export function walkedInstead(n: number): string {
  const ys = words.map((s) => s + "!");
  let out = "";
  for (const y of ys) {
    out = out + y;
  }
  return out + (n < 1 ? "" : "?");
}

/** `join` reads the storage in the runtime, and passes. */
export function joinedInstead(n: number): string {
  const ys = words.map((s) => s + "!");
  return ys.join(",") + (n < 1 ? "" : "?");
}

/** So does the length, which reads no element at all. */
export function lengthOnly(n: number): number {
  const ys = words.map((s) => s + "!");
  return ys.length + (n < 1 ? 0 : 0);
}

/** A callback that produces no new string passes, element read and all. */
export function anIdentityMap(n: number): string {
  const ys = words.map((s) => s);
  return ys[0] + (n < 1 ? "" : "?");
}

/** And an element of an array that was written out, which is the other control. */
export function aLiteralArray(n: number): string {
  return words[0] + (n < 1 ? "" : "?");
}

const pairs: [string, number][] = [
  ["a", 1],
  ["b", 2],
];

/**
 * The shape this fixture started from. It ends in `join`, which the small
 * shape above passes — so it is a second failing combination, and any
 * explanation has to cover both.
 */
export function mappedTupleInAConcatenation(n: number): string {
  return pairs.map((e) => e[0] + "=" + e[1].toString()).join(",") + (n < 1 ? "" : "?");
}

/** The same work as a walk, which passes — so it is `map`, not the expression. */
export function theSameWorkInALoop(n: number): string {
  let out = "";
  for (const e of pairs) {
    out = out + e[0] + "=" + e[1].toString() + ";";
  }
  return out + (n < 1 ? "" : "?");
}
