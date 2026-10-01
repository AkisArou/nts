// SIGSEGV. `named(null)`, where `named({ a })` destructures its parameter,
// called *through a closure* inside a `try`, crashes; node throws a TypeError
// that the `try` catches. Called directly in a `try` the same call does not
// crash and binds nothing (outcomes/a-parameter-pattern-given-null, its
// sibling and control): one call, two behaviours, which has twice been two
// defects. An abort erases every observation in its program, so the crash
// has a fixture of its own rather than an arm beside the direct call.
function named({ a }: { a?: number }): number | undefined { return a; }
function attempt(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "another error";
  }
  return "none";
}
// @ts-expect-error -- JavaScript: null reaches the pattern
observe("named pattern, null, through a closure", attempt(() => named(null)));
done();
