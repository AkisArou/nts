// An array handed to a parameter typed as a structural record,
// `{ readonly length: number }` -- which TypeScript accepts, since an array
// has a `length`. web-platform's `requireArguments(args, ...)` is exactly this,
// called from `convertQueuingStrategyHighWaterMark` with its argument tuple,
// and the JVM verifier rejects it: `nts/rt/NtsArrayL` is not assignable to
// the record's class (jvm-verifies.mjs, cause A, five runtime modules). C and
// LLVM pass the one pointer as the other by construction, and read the right
// length there: measured, so cause A is the JVM's alone, and this is the
// guard that a fix for it keeps C and LLVM answering.
//
// **Expected, confirmed under node:**
//
//     record (control)          2
//     array of 3                3
//     tuple of 1                1
//
// The control passes a real record, so only the array arms differ in kind.
function lengthOf(args: { readonly length: number }): number {
  return args.length;
}
observe("record (control)", String(lengthOf({ length: 2 })));
observe("array of 3", String(lengthOf([7, 8, 9])));
const tuple: [init?: string] = ["x"];
observe("tuple of 1", String(lengthOf(tuple)));
done();
