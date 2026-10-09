// expect: emit-jvm -> implements-interface nts.gen.Closure0 nts.rt.NtsTextPairCallback
//
// **FIXED 2026-10-09, kept as a guard** (MainClaude). Reachability now counts
// the outside as a caller of every closure's written and uniform entries when a
// library's surface carries a function type (`surface_carries_a_function`), so
// `Closure0` keeps the typed `call` its face binds. The record of the defect
// follows, with its expectation as it was:
//
//   expect: emit-jvm -> lacks-interface nts.gen.Closure0 nts.rt.NtsTextPairCallback
//
// A closure that leaves the program only through an exported return: `joiner`
// hands a `Pair` to its caller, and nothing in TypeScript calls a `Pair`.
// Reachability does not count the exported return as a use of the closure's
// bodies, so it prunes them all: the emitted `Closure0` has a constructor and
// nothing else -- no typed `call`, no `erased_call` -- and `Fn3_3__4` is an
// empty concrete class. A Java caller of `joiner()` receives an
// `erased.Callable` it cannot call at all. Nothing refuses and TypeScript
// answers nothing wrong (it never calls the closure), so only the class file
// shows it. Found 2026-10-09 probing receiver step 2 (6f460194b); it predates
// that step -- 65d7fad72 and 0fa1cb472 emit the same shell.
//
// Control, one difference: add `export function use(f: Pair): void { f("x",
// "y"); }`. Then `Closure0 extends Fn3_3__4 implements
// nts.rt.NtsTextPairCallback` with `call(String, String)` and `erased_call`,
// and this expectation reports FIXED.
//
// The fix belongs to reachability: an exported function's returned value
// escapes, so a closure it returns keeps the bodies its function type's face
// needs (its typed `call` and the uniform entry), as a call site would.
export type Pair = (a: string, b: string) => void;

let last = "";
const holder = { tag: "h" };

export function joiner(): Pair {
  return (a: string, b: string): void => {
    last = holder.tag + ":" + a + "|" + b;
  };
}

export function lastSeen(): string {
  return last;
}
