// A cast to an object *shape* reads a field of an unrelated class at the shape's
// offset. `held.stack` on an `Unrelated` -- which has no `stack` -- is undefined
// in JavaScript, so both functions answer -1; nts reads *something* of
// `Unrelated` at that offset and takes a length off it (4, 5, ...), for 58 of 58
// `nts check` cases. It compiles, exits 0 and answers confidently. The `unknown`
// arm is how a `catch` binding arrives. Found by the React lane (their #5) and
// confirmed independently by the compiler lane, whose probe this adapts.
//
// **Recorded as the wrong answer, which is what main does.** 921606dbe refused
// an `as` to a type with fields, and f86cc4403 withdrew it: an object literal's
// own type is anonymous too, and `examples/pushing-onto-an-array-of-erased-elements`
// reads one back through exactly this syntax, correctly -- a control the refusal
// broke. The two are statically indistinguishable, so the fix is a *checked*
// unerase (a descriptor test at the read, aborting with a sentence), React's #2/#5.
// On that day this flips to FIXED if the read answers -1, or CHANGED to an abort --
// either is right; the lengths 2 and 5 below are not.

class Unrelated {
  first = 11;
  second = 22;
  constructor(public label: string) {}
}

function stackOfUnrelated(n: number): number {
  const thing: object = new Unrelated(`x${n}`);
  if (typeof thing === "object" && thing !== null) {
    const held = thing as { stack?: string };
    return typeof held.stack === "string" ? held.stack.length : -1;
  }
  return 0;
}

function stackOfCaught(n: number): number {
  const caught: unknown = new Unrelated(`y${n}`);
  if (typeof caught === "object" && caught !== null) {
    const held = caught as { stack?: string };
    return typeof held.stack === "string" ? held.stack.length : -1;
  }
  return 0;
}

observe("object", String(stackOfUnrelated(7)));
observe("unknown", String(stackOfCaught(1234)));
done();
