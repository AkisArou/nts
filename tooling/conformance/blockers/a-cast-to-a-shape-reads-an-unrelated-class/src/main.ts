// expect: NTS1001 `Unrelated` where the anonymous `{ stack? }` is wanted -- the anonymous `{ stack? }` holds `stack` and `Unrelated` has no field of that name and type, so a pointer cast leaves the read with nothing to land on
//
// A cast to an object *shape* reads a field of an unrelated class at the shape's
// offset. `held.stack` on an `Unrelated` -- which has no `stack` -- is undefined
// in JavaScript, so both functions answer -1; nts reads *something* of
// `Unrelated` at that offset and takes a length off it (4, 5, ...), for 58 of 58
// `nts check` cases. It compiles, exits 0 and answers confidently. The `unknown`
// arm is how a `catch` binding arrives. Found by the React lane (their #5) and
// confirmed independently by the compiler lane, whose probe this adapts.
//
// **A wrong answer until the compiler lane's 2026-10-04 wave, which refuses it by
// name; moved here from `outcomes/` then.** It answered a length (4, 5, ...) where
// node answers -1. The refusal is the honest half of the fix the paragraph below
// asks for. The two arms that must keep agreeing moved to
// `outcomes/a-class-narrowing-that-travels-is-read-correctly`, because a blocker
// is only compiled and they need running.
//
// **What was recorded before, as a wrong answer.** 921606dbe refused
// an `as` to a type with fields, and f86cc4403 withdrew it: an object literal's
// own type is anonymous too, and `examples/pushing-onto-an-array-of-erased-elements`
// reads one back through exactly this syntax, correctly -- a control the refusal
// broke. The two are statically indistinguishable, so the fix is a *checked*
// unerase (a descriptor test at the read, aborting with a sentence), React's #2/#5.
//

class Unrelated {
  first = 11;
  second = 22;
  constructor(public label: string) {}
}

export function stackOfUnrelated(n: number): number {
  const thing: object = new Unrelated(`x${n}`);
  if (typeof thing === "object" && thing !== null) {
    const held = thing as { stack?: string };
    return typeof held.stack === "string" ? held.stack.length : -1;
  }
  return 0;
}

export function stackOfCaught(n: number): number {
  const caught: unknown = new Unrelated(`y${n}`);
  if (typeof caught === "object" && caught !== null) {
    const held = caught as { stack?: string };
    return typeof held.stack === "string" ? held.stack.length : -1;
  }
  return 0;
}
