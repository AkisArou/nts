// `emit-c` exits 0 and `cc` rejects the C: a `string` branch hands a `double`
// to `nts_concat`. `describe`'s one caller passes a number, so a pass
// specialises `value` to `double` and folds `typeof value === "number"` to
// true -- and leaves the `string` branch standing, where `unerase` of the
// now-`double` parameter is the double itself. The fold made that branch dead
// and nothing pruned it. The control, a-typeof-narrowed-unknown-called-with-
// two-types, differs in one thing: a second caller passing a string, which
// keeps the parameter erased and compiles.
//
// Found by the compiler lane probing `any` as erased (2026-09-29), on a clean
// binary: an ordinary `unknown` narrowed by `typeof` and called from one place.
function describe(value: unknown): string {
  if (typeof value === "number") {
    return "n" + String(value);
  }
  if (typeof value === "string") {
    return "s" + value;
  }
  return "other";
}
observe("described", describe(7));
done();
