// expect: lacks-c patchedMathMethodIsSeen
//
// Assigning to a method on a builtin namespace object -- `Math.floor = f`,
// `JSON.stringify = f` -- is refused, while *calling* the same member on the
// same line number lowers without complaint.
//
// # Why it was written
//
// `third_party/node/test/parallel/test-path-resolve.js:87` does
// `process.cwd = () => ''` and then asserts `path.resolve() === '.'`. `path`
// passes that test interpreted and fails it compiled, and this file was written
// to find out whether the cause was a patched global going unseen at the call
// site.
//
// **It is not**, and that is the useful half of this fixture. `process` is not
// ambient in a standalone program, so the question was asked of `Math` and
// `JSON` instead -- and they do not silently ignore the patch, they refuse to
// compile it. `path`'s failure is something else entirely: `nts_process_cwd`
// reaches `uv_cwd()` in C (`runtime/node/internal/process.c:19`) and never
// consults the JS binding, which is a Node-API boundary question and not a
// lowering one. The two are recorded apart in `docs/conformance/nodejs.md`.
//
// # What the diagnostic says, and what is true
//
//     main.ts:16:19  NTS1001 `Math.floor`, not a member of this compiler's
//                    `Math` is not supported by this lowering yet
//     main.ts:25:19  NTS1001 `JSON.stringify`, a global member with no
//                    definition here is not supported by this lowering yet
//
// `Math.floor` *is* a member of this compiler's `Math`: `unpatchedMathMethodAnswers`
// below calls it and compiles. The refusal is of the **write**, and the message
// describes a missing member. Two different texts for the same construct on two
// namespaces is the second sign of it.
//
// # Controls
//
// Four, and they are the reason this is a claim about writes to builtin
// namespaces rather than about assignment: an ordinary object's method, a
// reassigned function-typed binding, the unpatched call, and restoring the
// original all compile and answer correctly.

/** The reduction: patch a method on a builtin namespace, then call it. */
export function patchedMathMethodIsSeen(): number {
  const original = Math.floor;
  Math.floor = (): number => 42;
  const seen = Math.floor(1.5);
  Math.floor = original;
  return seen === 42 ? 1 : 0;
}

/** The same shape on a second builtin namespace, with a different message. */
export function patchedJsonMethodIsSeen(): number {
  const original = JSON.stringify;
  JSON.stringify = (): string => "patched";
  const seen = JSON.stringify({ a: 1 });
  JSON.stringify = original;
  return seen === "patched" ? 1 : 0;
}

/** Control: the builtin answers unpatched, so the refusal is of the write. */
export function unpatchedMathMethodAnswers(): number {
  return Math.floor(1.5) === 1 ? 1 : 0;
}

/** Control: the same shape on an ordinary object compiles. */
export function patchedOwnObjectMethodIsSeen(): number {
  const holder = { value: (): string => "before" };
  holder.value = (): string => "";
  return holder.value() === "" ? 1 : 0;
}

/** Control: a reassigned function-typed binding compiles. */
export function patchedBindingIsSeen(): number {
  let fn: () => string = (): string => "before";
  fn = (): string => "";
  return fn() === "" ? 1 : 0;
}
