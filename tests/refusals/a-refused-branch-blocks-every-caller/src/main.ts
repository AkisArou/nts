// expect: emit-c --napi -> lacks-c callsSupportedBranchOnly
//
// The form is `lacks-c` rather than the diagnostic text because the diagnostic
// this fixture is about is the **cascade**, and `blockers-check.mjs` matches the
// root. The root here is `\`i\`, which \`Odd\` does not declare` -- true, and not
// the point. What the fixture asserts is that the *caller* does not reach the C
// at all, which is the claim the module cost below rests on.
//
// **A refusal is function-granular, not branch-granular.** One unsupported
// construct inside a function refuses the whole function, and every caller
// cascades — including a caller whose arguments can never reach the branch that
// was refused.
//
// # The control is the same logic, split
//
//     polymorphic(value: number | Odd)   one refused branch   REFUSED
//       callsSupportedBranchOnly()       passes 21, never reaches it   REFUSED
//     scalarOnly(value: number)          the supported branch alone    crosses
//       callsSplitFunction()             calls it                      crosses
//
// The two callers are identical in what they compute and in what they can
// reach. The only difference is whether the callee also contains a branch they
// do not take.
//
// # Where it bites: this is why `string_decoder` is blocked
//
// `Buffer.from` is polymorphic over a string, an ArrayBuffer, a typed array and
// a generic array-like object. **Two** refusals remain on the path into it, both
// in the array-like branch:
//
//     buffer/src/main.ts:196  objectToBuffer   an erased value where a concrete one is wanted
//     buffer/src/main.ts:218  fromArrayLike    `i`, which `UnknownArrayLike` does not declare
//
// Neither is the subject of an NTS1003 line, so both are roots rather than
// cascades, and both must clear before the branch compiles.
//
// This read *three* until 2026-09-10 and named a third at `main.ts:184`, in
// `isTypedArrayView`. That refusal is real and is not on this path.
// `isTypedArrayView` occurs twice in the file -- its definition at 180 and one
// call at 484, inside `Buffer.copyBytesFrom`. `objectToBuffer` calls
// `ArrayBuffer.isView`, `hasArrayLikeShape` and `fromArrayLike`, and
// `hasArrayLikeShape` is not refused at all. The three had been read off their
// proximity in one region of the file rather than off the call graph, which is
// the same mistake as ranking a blocker by reach: the question is what calls it,
// and adjacency does not answer that.
//
// `string_decoder` never takes that branch. `string_decoder/src/main.ts:32` and
// `:34` are
//
//     Buffer.from(view.buffer, view.byteOffset, view.byteLength)
//     Buffer.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
//
// the ArrayBuffer overload and the typed-array overload. It is blocked by code
// it cannot call, and it is a module with **zero own-source refusals**.
//
// # Why this is filed rather than routed around
//
// The obvious move is to have `bytesOf` call something narrower than the
// polymorphic entry point. That is rewriting correct source to dodge a refusal:
// `Buffer.from(arrayBuffer, byteOffset, length)` is node's documented API for a
// view over existing memory *without copying*, and anything else would change
// what the module does or where its bytes live.
//
// The general shape matters more than the one module. Every unsupported
// construct's blast radius is its enclosing function's entire transitive caller
// set, so a roots table counts constructs and **understates reach** — one root
// in a hot polymorphic helper can hold several modules shut.

//
// # Controlled by forcing the claim false
//
// MainClaude found three vacuous instruments in one night by forcing the answer
// rather than by reading the fixture, and this one was put through the same
// check. Removing the refused branch from `polymorphic` -- so the claim "the
// caller does not reach the C" becomes false -- makes
// `callsSupportedBranchOnly` **appear** in the emitted C, so the fixture would
// report FIXED rather than sitting silent. It can fail, which is what makes its
// passing worth anything.

interface Odd {
  readonly length: unknown;
  readonly [index: number]: unknown;
}

function polymorphic(value: number | Odd): number {
  if (typeof value === "number") return value * 2;
  let total = 0;
  for (let i = 0; i < 3; i++) total += Number(value[i]);
  return total;
}

/** The reduction: a caller that can only reach the supported branch. */
export function callsSupportedBranchOnly(): number {
  return polymorphic(21);
}

function scalarOnly(value: number): number {
  return value * 2;
}

/** Control: the same computation, with the refused branch in another function. */
export function callsSplitFunction(): number {
  return scalarOnly(21);
}
