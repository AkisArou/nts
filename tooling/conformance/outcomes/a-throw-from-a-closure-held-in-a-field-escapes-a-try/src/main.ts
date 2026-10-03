// **Ours, not upstream's: a closure held in a class field, called inside a
// `try`, throws past the handler.** `call` reads `h.f` and calls it inside its
// own `try`; the closure throws, and the compiled program ends with an uncaught
// error where node catches it. No refusal, so this is a silent wrong answer.
//
// The control differs in one thing and agrees: the same field read in the
// caller and passed to `guard` as a parameter, whose `try` calls it. A
// parameter callee is carried; a field callee is not, and reading the field
// into a local inside the `try`'s function first does not help either.
//
// React reaches this in `getComponentNameFromType`'s lazy arm,
// `try { return getComponentNameFromType(lazy._init(lazy._payload)); } catch
// { return null; }`: a lazy component whose initializer throws (a pending
// promise, which is how Suspense works) would end the program instead of
// answering `null`.
//
// **Expected, confirmed under node:**
//
//     a field callee      ok caught
//     a parameter callee (control)   ok caught
class Holder {
  readonly f: () => string;
  constructor(f: () => string) {
    this.f = f;
  }
}

function call(h: Holder): string {
  try {
    return h.f();
  } catch (error) {
    return "caught";
  }
}

function guard(f: () => string): string {
  try {
    return f();
  } catch (error) {
    return "caught";
  }
}

const fine = new Holder(() => "ok");
const throwing = new Holder(() => {
  throw new Error("x");
});
observe("a parameter callee (control)", guard(fine.f) + " " + guard(throwing.f));
observe("a field callee", call(fine) + " " + call(throwing));
done();
