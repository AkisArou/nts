// expect: an optional-chained method call (`a?.b()`)
//
// `a?.b()` is refused. `a.b()` lowers and `a?.b` lowers, so it is the
// combination and not either half:
//
//     c.bump(by)        -> lowers and crosses
//     c?.value          -> lowers and crosses
//     c?.bump(by)       -> REFUSED
//
// Two controls, and both are needed. Without `plainCall` the diagnostic reads
// as "calling a method is refused"; without `optionalProperty` it reads as
// "optional chaining is refused". Each is false and each would send a reader
// somewhere else.
//
// **The receiver is a class, deliberately.** The first draft used an interface
// with a method, and every function in the file was refused -- `run`, declared
// by `Handler` with a type that has no representation. A method on an interface
// is its own blocker, so an interface receiver would have made all three
// functions fail and the fixture would have proved nothing about `?.()`.
//
// 38 distinct sites across the profile, concentrated where an optional handler
// is invoked: `events/src/main.ts` 24, `net/src/main.ts` 12, `fs/src/glob.ts`
// 12, `stream/src/writable.ts` 7. It is how one writes "call this if it is
// there", which is what an event emitter, a socket and a glob walker all need.

class Counter {
  value: number;

  constructor(value: number) {
    this.value = value;
  }

  bump(by: number): number {
    return this.value + by;
  }
}

export function plainCall(by: number): number {
  const counter = new Counter(1);
  return counter.bump(by);
}

export function optionalProperty(present: boolean): number {
  const counter: Counter | undefined = present ? new Counter(2) : undefined;
  return counter?.value ?? 0;
}

export function optionalCall(present: boolean, by: number): number {
  const counter: Counter | undefined = present ? new Counter(3) : undefined;
  return counter?.bump(by) ?? 0;
}
