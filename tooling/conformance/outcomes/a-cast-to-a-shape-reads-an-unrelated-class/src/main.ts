// A cast to an object *shape* reads a field of an unrelated class at the shape's
// offset. `held.stack` on an `Unrelated` -- which has no `stack` -- is undefined
// in JavaScript, so both functions answer -1; nts reads *something* of
// `Unrelated` at that offset and takes a length off it (4, 5, ...), for 58 of 58
// `nts check` cases. It compiles, exits 0 and answers confidently. The `unknown`
// arm is how a `catch` binding arrives. Found by the React lane (their #5) and
// confirmed independently by the compiler lane, whose probe this adapts.
//
// **Now recorded as the refusal it is on main.** 921606dbe refuses an `as` to a
// type with fields on a value of unknown layout ("... would read them at that
// type's offsets"), which is honest: the wrong lengths are gone. Recorded as the
// refusal, so a regression that reads the offset again shows CHANGED and fails;
// a checked unerase that answers -1 shows FIXED. The same refusal caught
// `JSON.stringify`'s `toJSON` lookup reading offset 0 of an arbitrary object.
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
