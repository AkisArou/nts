// A Web IDL brand check written directly: `#field in value` behind a
// type predicate, called on a value whose class the caller already knows
// statically and on one it does not. The control for
// `tests/refusals/a-write-once-module-function-installed-by-a-static-block`,
// which routes the same check through a module-scope function installed by
// a static block and is refused for that routing alone.
//
// This compiles today, and says what "compiles" costs: the known-class
// call below is not folded. The generated C boxes the `Widget` into a
// value and calls the check, which re-tests the tag and the class
// descriptor. Folding a brand check on a statically known class is
// compiler work this fixture's output will keep agreeing with node
// through; the numbers are the same either way, the call is the finding.
class Widget {
  #isReady = true;

  get ready(): boolean {
    return this.#isReady;
  }

  static is(value: unknown): value is Widget {
    return typeof value === "object" && value !== null && #isReady in value;
  }
}

export function known(seed: number): number {
  const w = new Widget();
  return (Widget.is(w) ? 1 : 0) + seed;
}

export function untyped(seed: number): number {
  const values: unknown[] = [new Widget(), seed, "widget", null];
  let hits = 0;
  for (const value of values) {
    if (Widget.is(value) && value.ready) hits += 1;
  }
  return hits * 10 + seed;
}
