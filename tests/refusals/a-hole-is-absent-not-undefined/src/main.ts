// expect: on an array of erased elements

// A hole in an array literal is stored as an `undefined`, and **a hole is not
// an `undefined`** — it is absent. Every construct that can tell them apart
// must keep refusing, and this fixture is what says so.
//
// `[1, , 3]` lowers as of 2026-09-20, because the checker types it
// `(number | undefined)[]` and `in_a_slot` gives that an `Erased` element,
// which has room for an `undefined`. An indexed read is then right: `xs[1]`
// is `undefined` on both sides. What is not right is anything asking whether
// index 1 *exists*:
//
//     1 in [1, , 3]                   false in JavaScript
//     Object.keys([1, , 3])           ["0", "2"]
//     [1, , 3].forEach(f)             calls f twice
//     [1, , 3].map(f)                 leaves the hole a hole
//     [1, , 3].join("-")              "1--3"
//
// This compiler has no sparse array, so every one of those would disagree.
// They are all refused today — measured, not assumed — and the refusals are
// for their own reasons rather than for this one, which is exactly the shape
// that goes wrong silently later: a correct rule standing behind a guard that
// nobody put there for it.
//
// So if you are here because you just taught one of these to work on an array
// of erased elements, the hole is now a wrong answer and this fixture is the
// notice.

export function forEachOverHoles(n: number): number {
  const xs = [1, , 3];
  let seen = 0;
  xs.forEach(() => {
    seen = seen + 1;
  });
  return seen + n;
}

export function joinOverHoles(n: number): string {
  const xs = [1, , 3];
  return xs.join("-") + n.toString();
}

export function mapOverHoles(n: number): number {
  const xs = [1, , 3];
  return xs.map(() => 9).length + n;
}
