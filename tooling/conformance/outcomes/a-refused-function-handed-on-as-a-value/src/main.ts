// **A refusal now, and a SIGSEGV until `b9b906a8a`.** The React lane's witness,
// written standalone so it needs none of their stand-ins. Recorded from a clean
// build of that commit.
//
// A top-level function the C backend refuses is handed on **as a value** and
// called later through `unknown`, which is how React calls a component.
// `drop_orphaned_bodies` drops any body that *calls* a refused function, and
// looked only at `OpKind::Call` -- so `main`, which takes `Component`'s address
// rather than calling it, survived while `Closure0#call` was dropped. The program
// built, exited 0, and jumped through a null method table: **exit 139**, where
// node prints 1.
//
// In their real program the same shape is `main_` storing
// `&nts_fnval_NtsObj_Closure3117` into React's jsx slot, with `callComponent`
// calling `descriptor->methods[35]` on a descriptor whose methods pointer is `0`.
// Every line of that cascade was true and none of them named `main`.
//
// **Why the guard that already exists did not catch it**: an *arrow* gets a
// closure layout of its own, and lowering leaves it with no method, so
// `NTS2006 closure class X reached code generation with no method to call` fires.
// A top-level **function declaration** taken as a value is a static fnval whose
// layout *does* name its `#call`, and the `#call` is only dropped later, by the
// orphan pass itself. The guard checks the layout, the layout is fine, and the
// body vanishes after the check.
//
// **Its root is somebody else's and is going to be fixed.** `apply`'s omitted
// optional generic function parameter is `probes/omitted-optional-fn`:
// `representation_of`'s function arm represents a function type as *itself*, so a
// copy's parameter keeps `U -> T` while the call's omitted argument is typed at
// the instantiated signature, which nothing lays out. When that lands this record
// moves to `agrees`, which `outcomes-check` reads as FIXED -- a note, not a
// failure. The shape being recorded is the *value* half, which stands either way.
//
// **Expected, confirmed under node:**
//
//     rendered                     1
function apply<T, U>(x: T, _seed: U, map?: (seed: U) => T): T {
  return map === undefined ? x : map(_seed);
}

function Component(): number {
  return apply<number, string>(1, "s");
}

class Held {
  readonly type: unknown;
  constructor(type: unknown) {
    this.type = type;
  }
}

function render(element: Held): number {
  return (element.type as () => number)();
}

observe("rendered", String(render(new Held(Component))));
done();
