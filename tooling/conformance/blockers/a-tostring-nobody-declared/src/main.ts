// expect: NTS1001 a conversion to string from `Plain`
//
// `${o}` where `o`'s class declares no `toString`.
//
// A class that *does* declare one lowers as of 2026-09-17: the conversion is a
// call to the method, dispatched where a subclass overrides it. This is the
// other half, and it is refused on purpose.
//
// The answer node gives is `"[object Object]"`. Emitting that constant is one
// line and it is the wrong line. Every `${o}` in a program that meant something
// -- a point, a socket, an error -- would print those eight characters, look
// like it worked, and give nobody a reason to write the method. **A wrong answer
// that looks like an answer is worse than a refusal**, and this is the cheapest
// possible instance of that trade: the refusal costs one diagnostic and names
// the method to add.
//
// It is not a representation problem and there is nothing to design. If the
// decision is ever revisited, what changes is this comment and one arm in the
// conversion, not any machinery.

class Plain {
  v: number;

  constructor(v: number) {
    this.v = v;
  }
}

export function describe(n: number): string {
  return `plain=${new Plain(n)}`;
}
