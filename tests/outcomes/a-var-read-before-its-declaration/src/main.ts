// A `var` read before its declaration runs is `undefined`; nts answers its
// initializer's value. Found by test262's types/boolean/S8.3_A1_T1.js. The
// same defect through a closure is outcomes/a-hoisted-var-read-through-a-
// closure, whose note says annotating `| undefined` makes nts agree; the
// control here does that and differs in the annotation only.
//
// **Mechanism, measured 2026-09-30, and it is two wrong answers rather than
// one.** `Global` carries `initial` and `deferred`, and
// `initial: constant.or(declared).unwrap_or(0.0)` with
// `deferred: constant.is_none() && initializer.is_some()` decides them. So:
//
//   var x = true          the initializer FOLDS, so it becomes the C static
//                         initial value -- `static bool x = true;` -- and a read
//                         during `module#init` sees it. nts answers "true".
//   var b = makeIt()      it does not fold, so the global is deferred and starts
//                         at its representation's ZERO. nts answers "false".
//
// Node answers `undefined` to both. **Deferring is necessary and not
// sufficient**: a `bool`'s zero is `false`, and there is no room in the
// representation for the `undefined` the language says. So the fix is deferring
// *plus* a nullable representation, and nothing here checks that the declaration
// dominates every read before hoisting the initializer into the static value.
//
// **The `annotated` control is the proof that the fix path works**: `y: boolean |
// undefined = true` is emitted `static NtsValue y = NTS_VALUE_UNDEFINED;` and
// assigned in `module#init`, and it agrees. The downstream machinery is already
// right; what is missing is choosing that representation where a read precedes the
// declaration.
//
// **And the predicate is not purely syntactic.** A closure called before the
// declaration can read the binding too --
// `outcomes/a-hoisted-var-read-through-a-closure` is that shape -- so "no
// reference textually earlier" is an over-approximation that misses it, and
// dominance is the honest question. That is why the plan holds this as definite
// assignment rather than as a source-order check.
//
// Shared with `a-let-read-before-its-declaration`, which is **not** the same fix:
// a `let` read in its TDZ must *throw* a `ReferenceError`, not answer `undefined`,
// so widening is wrong for it. `an-undefined-incremented` was thought to be a
// third and was not: converting in `step` closed it (1bf78c21d).
function makeIt(): boolean {
  return true;
}

// @ts-expect-error -- JavaScript: a var is undefined before its declaration runs
observe("inferred", String(x));
observe("annotated", String(y));
// @ts-expect-error -- the same, where the initializer does not fold to a constant
observe("deferred", String(z));
var x = true;
var y: boolean | undefined = true;
var z = makeIt();
done();
