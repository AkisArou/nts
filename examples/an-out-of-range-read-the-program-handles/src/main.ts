// An array read past the end, where the source is handling the absence.
//
//     const hexLow = unhexTable[nextChar] ?? -1;
//     if (!(hexLow >= 0)) { out[outIndex++] = 37; continue; }
//
// `querystring`'s table is 256 entries and `nextChar` is a `charCodeAt`, so it
// can be anything. `unescapeBuffer("%0日")` **aborted the process** where
// node answers a replacement character:
//
//     nts: refused: index 26085 is outside [0, 256), core dumped
//
// A refusal costs a test. This costs the process, and it is reachable from
// three characters any query string can contain.
//
// # The compiler was not missing the information
//
// `noUncheckedIndexedAccess` is on in `runtime/node`'s config, so tsgo already
// types that read `number | undefined`. The `??` is not the author being
// defensive — it is the author doing exactly what the type demands, on the very
// next line. The compiler had the fact and aborted anyway, which makes this a
// decision in the lowering rather than a gap in what it knew.
//
// **This fixture sets the flag itself.** `tsconfig.fixtures.json` does not, and
// the first version of this probe was written without it: the `??` folded away
// before lowering ever saw it, the HIR read `array.get` straight into a
// comparison, and the fixture measured a different language than the corpus
// does. Nothing in the output said so.
//
// # The rule, which is narrower than "stop aborting"
//
// The trapping read is right for the common case, and the comment it lives
// under says why: **a `double` slot has nowhere to put an `undefined`**, so the
// representation comes from the array and the bounds test is what makes that
// honest. Three things follow from taking that sentence literally.
//
// `xs[i]!` keeps the trap. The `!` is the author's claim that the index is in
// range, and an abort on a violated claim is the documented bargain. Without
// this every counted loop in the corpus would pay a call and a tag test for an
// index it had already sworn to — the checker types *every* element access
// `T | undefined` under this flag and narrows only at the parent, so the access
// node cannot tell the two apart on its own.
//
// An `unknown[]` keeps the trap too, for now, because its slot *can* hold the
// absence: paying a call to discover that buys nothing.
// `benches/cases/erasure-stored-unknown` reads `values[i]` 200,000 times in its
// inner loop and the first version of this change turned that load into a call.
// Caught by emitting the benchmark program and grepping for the call **before
// any timing** — which is the stronger check, because zero calls is not a
// measurement with an error bar.
//
// What is left is the case with no other answer: a slot that cannot represent
// the absence, read by a program that is looking for it.
//
// # Controls
//
// `asserted` and `summedInALoop` are the `!` forms, and they are the reason
// this fixture is not simply "an out-of-range read". `erasedSlot` is the
// `unknown[]` form. All three must keep `array.get`; if any of them starts
// emitting a call, the rule has been widened past what was measured.
// `inRange` is the ordinary read that was never at issue.

const table: number[] = [10, 20, 30, 40];
const held: unknown[] = [1, "two", 3];

/** Under test: a read past the end, with the absence handled. */
export function guarded(code: number): number {
  const v = table[code] ?? -1;
  return v >= 0 ? v : 37;
}

/** Under test: the absence tested rather than defaulted. */
export function tested(code: number): number {
  const v = table[code];
  if (v === undefined) return 99;
  return v + 1;
}

/** Control: the ordinary in-range read. */
export function inRange(code: number): number {
  return table[code & 3] ?? -1;
}

/** Control: `!` is a claim, and it keeps the trapping read. */
export function asserted(code: number): number {
  return table[code & 3]!;
}

/** Control: the counted loop that must not pay for a call. */
export function summedInALoop(n: number): number {
  let sum = 0;
  for (let i = 0; i < table.length; i++) {
    sum += table[i]!;
  }
  return sum + n * 0;
}

/** Control: a slot that can hold the absence keeps its load. */
export function erasedSlot(i: number): number {
  const v = held[i & 2];
  return typeof v === "number" ? v : -1;
}
