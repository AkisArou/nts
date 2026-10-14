// expect: emit-c --napi -> calls (() => { try { exports.alwaysThrows(); return "no throw"; } catch (e) { return e.code; } })() === "ERR_FIXTURE"
// control: typeof exports.alwaysThrows === "function"
//
// FIXED, and kept as a guard.
//
// This fixture's own class writes `code = "ERR_FIXTURE"` with **no modifiers**,
// so it was only ever the boundary half -- which is worth saying, because the
// thing it stands for in `runtime/node` had two halves and this one reproduces
// exactly one of them. `internal/errors.ts` writes `override readonly code =
// "ERR_..."` on ninety-four classes, and a property declaration with two or more
// modifiers lost its initialiser outright: the modifiers occupy one slot and any
// number of children, `child_slots` took one, every slot after them shifted, the
// *name* came back as `readonly`, and the store was dropped in silence. There
// the `code` was never set inside the compiled program at all.
//
// A fixture that reproduces one half of a defect is worth having and worth
// labelling. This one would have gone green on the boundary fix alone while
// every error in the tree still arrived without a code.
//
// The boundary half was that `nts_thrown_class` answers with the class's own
// name -- `ERR_OUT_OF_RANGE`, not `RangeError` -- so the wrapper's two
// comparisons missed, it built a generic error, and it set `name` to the class.
// Node has `name` `"RangeError"` and `code` `"ERR_OUT_OF_RANGE"`; this had the
// two swapped, with the right string under the wrong property and `instanceof
// RangeError` false.
//
// `nts_napi_error_classes` is emitted per program from what each constructor's
// allocation site actually assigns, not from the class name: six of those
// ninety-four have a `code` that is not their name -- `AbortError` is
// `ABORT_ERR` -- so the name would have been a wrong value for those six.
//
// Measured on `os.getPriority` against node over the twelve inputs
// `test-os-process-priority.js` uses plus three more: 15 of 15 agree on `code`,
// on `name`, and on `instanceof RangeError`. None did before.
//
// A thrown error's `code` does not cross the boundary.
//
// Node's errors carry `code`, and its tests assert on it constantly -- **792 of
// node's `parallel` suite**, 91 in `fs`, 49 in `stream`, 41 in `http`. Ours
// arrive with the right constructor, the right `name` and the right `message`,
// and no `code` at all:
//
//     + actual - expected
//       Comparison {
//     -   code: 'ERR_INVALID_ARG_TYPE',
//         name: 'TypeError'
//       }
//
// # Where it goes, which is one argument
//
// The wrapper builds the error with Node-API's own constructors, deliberately
// -- `napi_create_type_error` rather than a generic error with `.name` set, so
// `instanceof TypeError` holds. The first parameter of each is the **code**:
//
//     napi_create_range_error(env, NULL, message, &error);
//     napi_create_type_error(env, NULL, message, &error);
//     napi_create_error(env, NULL, message, &error);
//
// A string there puts `code` on the error, which is the mechanism node itself
// uses. The wrapper already reads the class off the thrown object to choose
// among the three; whether it can read a `code` field the same way is the
// question, and it may be as hard as the field crossing was.
//
// # What it is worth today
//
// Not 792. For most of those the module does not publish the function yet, so
// the code is the wall *behind* the current one.
//
// **14 of `fs`'s failing test files differ in the missing `code` and nothing
// else** -- message, name and constructor all match. `test-fs-chown-type-check`,
// `test-fs-lchown`, `test-fs-make-callback`, `test-fs-readlink-type-check` and
// ten more, on a module already on the axis, where the function is published,
// the validation runs and the error arrives one property short.
//
// Counted by reading each diff rather than by taking the group: `fs`'s largest
// failure group is 40 files sharing the message "Expected values to be strictly
// deep-equal", and 26 of those 40 differ in something else as well.
//
// # The expectation states the defect, not the repair
//
// The `calls` form reports `FIXED` when its expression answers false, so a
// fixture filing a defect has to assert what is true **now**: `e.code` is
// `undefined`. When the code starts crossing, the expression goes false and the
// run says `FIXED` and names it -- which is the announcement wanted, in the
// place it will be seen.
//
// Writing it the other way round -- asserting `e.code === "ERR_FIXTURE"`, the
// repaired state -- reads better and reports `FIXED` immediately, on a compiler
// where nothing has been fixed. That was the first version.
//
// # The `emit-c --napi ->` prefix is required and was not obvious
//
// Without it the runner takes the `hir` path, writes no C, and reports
// `NOTHING EMITTED` -- which is correct about what it saw and says nothing
// about the code. The first version of this fixture spent a run on that.
//
// # The control is not decoration here
//
// `calls` on an unpublished name answers false for every expression, and false
// would read as "reproduces" forever. The control asserts the function is
// published and callable before the expression is believed either way.

class FixtureError extends Error {
  code = "ERR_FIXTURE";

  constructor(message: string) {
    super(message);
    this.name = "TypeError";
  }
}

export function alwaysThrows(): number {
  throw new FixtureError("the fixture always throws");
}
