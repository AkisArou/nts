// A `try` around a call that reaches a closure **through a function value**.
//
// A raising copy is made of plain functions, and a closure's body is not one --
// so a `try` whose body called one had nothing to name and the whole function
// was refused: *"a call inside a `try` whose `throw` would not reach this
// handler: through a function value, which has no raising copy to call"*. It is
// the largest refused shape either test262 corpus has, 548 cases whose only root
// is that sentence, and 206 occurrences across `runtime/node` and
// `web-platform`.
//
// The answer is a **second uniform slot**. `Hierarchy::erased_call_slot` carries
// the entry a site that knows only the signature can call; this adds
// `raising_call_slot` beside it, carrying the same entry built from a body
// lowered with `FuncBuilder::raises` set -- an uncaught `throw` records itself on
// a global flag and returns instead of ending the program. `lower_try` decides
// which calls the `try` handles before it lowers the body, `closure_callee` names
// the raising slot for those, and `test_for_a_raise` puts the flag test
// immediately after the call. The ABI is identical to the ordinary entry's, so
// every backend reads the slot off the callee and needed no change for the
// dispatch itself.
//
// # Why this program has the shape it has, arm by arm
//
// **Two closures at one signature**, because with one the specialiser makes
// every dispatch direct (`monomorphize::retype_parameter`) and nothing goes
// through a slot at all -- the first draft of this fixture tested nothing for
// exactly that reason, and its HIR said so: `bare#Closure0` had no
// `call.closure` left in it.
//
// **The throwing closure reached both inside a `try` and outside one**, so both
// uniform entries are live on one class at once. That is what found the one real
// interaction, and the JVM lane's own guard named it:
//
//     NTS4004 `Closure0` could not be written: this class declares the method
//     `erased_call(Lnts/rt/NtsValue;)Lnts/rt/NtsValue;` twice, which the JVM
//     refuses at load as a duplicate member
//
// `declared_member` walks a slot up to the base-most layout that declares it,
// and both slots walked up to the same `Fn3__3#erased_call` -- one *member* for
// two slots. So a signature layout now gets a second abstract declaration under
// the raising name. And then a **second** failure behind it, which no verifier
// can see because JVM linkage is lazy:
//
//     java.lang.NoSuchMethodError: 'nts.rt.NtsValue
//     nts.gen.erased.Callable.erased_call$raises(nts.rt.NtsValue)'
//
// `jvm-verifies` passes a program whose root lacks a method a call names; only
// *running* it says so. **That is why this is an example and not a blocker** --
// the gate's `jvm` step is the only thing that guards this class of defect.
//
// # The controls, and each says what a different arm of the fill does
//
//   notRaised                 the same dispatch on a value that does not throw:
//                             the raising entry returns normally and the flag
//                             test falls through. Without it an example could
//                             pass on a compiler that raised unconditionally.
//   outsideATry               the ordinary entry, on the same closure class, so
//                             this program holds both fills at once.
//   cannotThrowInsideATry     a closure whose raising body is *the same program*
//                             -- measured at 98% of closures -- where the
//                             ordinary entry serves the raising slot. Nothing
//                             else tests that fill.
//   aNamedCalleeInATry        a `try` around a call to a **named** function that
//                             throws: the path that already worked, by naming
//                             the callee's own raising copy. It is the arm that
//                             says this example is about the function *value*
//                             and not about `try`.

function guarded(fn: (x: number) => number, x: number): number {
  try {
    return fn(x);
  } catch {
    return -1;
  }
}

function bare(fn: (x: number) => number, x: number): number {
  return fn(x);
}

const mayThrow = (x: number): number => {
  if (x < 0) {
    throw new Error("negative");
  }
  return x * 2;
};

const twice = (x: number): number => x + x;

function named(x: number): number {
  if (x < 0) {
    throw new Error("negative");
  }
  return x * 3;
}

// Two arms at one signature, so neither dispatch can be resolved to a class and
// both go through the slot. Read out of an array rather than written at the call
// for the same reason: a name the checker resolves to an arrow is a *known*
// closure class, which `closure_callee` makes a direct call and which this
// example is not about.
const arms: ((x: number) => number)[] = [mayThrow, twice];

/** The shape this example exists for: a `throw` crossing a call the site cannot
 *  name, reaching the handler beside it. */
export function caught(n: number): number {
  return guarded(arms[0], -(n & 7) - 1);
}

/** The same dispatch where nothing throws, so the flag test falls through and
 *  the answer is read back. */
export function notRaised(n: number): number {
  return guarded(arms[0], n & 7);
}

/** The ordinary uniform entry on the same closure class, which is what puts both
 *  fills in one program. */
export function outsideATry(n: number): number {
  return bare(arms[0], n & 7);
}

/** A closure with nothing to raise, called inside a `try`: its raising body is
 *  the same program, so the ordinary entry serves the raising slot. */
export function cannotThrowInsideATry(n: number): number {
  return guarded(arms[1], n & 7) + bare(arms[1], n & 7);
}

/** The control that says this is about the function value: a named callee's
 *  raising copy is named by the site, and that path is untouched. */
export function aNamedCalleeInATry(n: number): number {
  try {
    return named(-(n & 7) - 1);
  } catch {
    return -2;
  }
}
