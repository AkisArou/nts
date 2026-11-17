// **Ours, not upstream's: a closure held in a class field, called inside a
// `try`, throws to its handler.** `call` reads `h.f` and calls it inside its
// own `try`; the closure throws and the `catch` answers, as node's does. A
// field callee is asked whether it can raise as a parameter callee is (#478);
// before, only a parameter was, and this ended the program with an uncaught
// error and no refusal.
//
// The control differs in one thing: the same field read in the caller and
// passed to `guard` as a parameter, whose `try` calls it.
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
