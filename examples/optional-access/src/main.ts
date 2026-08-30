// `a?.b` — the member unless the receiver is absent, and `undefined` when it is.
//
// The same absence `??` tests, and deliberately the same one: a tag read on an
// erased value, an address comparison on a reference. What is different is what
// happens on each side — `??` keeps the left operand, this one reads through it.
//
// The receiver is lowered *once*, before the test, and read only inside the arm
// that established it is present. Evaluating it twice would be the difference
// between `a?.b` and something that calls a getter on the way in and again on
// the way out, which is why `member_of` exists separately from
// `lower_property_access`.
//
// One link. `a?.b.c` short-circuits the whole chain in JavaScript — when `a` is
// absent, `.c` is not evaluated either — and that is a property of the chain
// rather than of either access. It is refused in those words rather than
// lowered as `(a?.b).c`, which would read a member of the absent value. Every
// one of the twenty-six optional accesses in the node profile is a single link,
// which is why this is where the line is drawn.

type Opts = { level: number; name: string };

export function whenPresent(n: number, o?: Opts): number {
  return o?.level ?? n;
}

export function whenAbsent(n: number): number {
  const o: Opts | undefined = n > 2 ? { level: n, name: "x" } : undefined;
  return o?.level ?? -1;
}

// `null` and `undefined` are one absence in a compiled program, so the same
// test answers for a nullable receiver.
export function throughNull(n: number): number {
  const o: Opts | null = n > 2 ? { level: n, name: "y" } : null;
  return o?.level ?? -2;
}

export function readingAReference(n: number): number {
  const o: Opts | undefined = n > 2 ? { level: n, name: "abcd" } : undefined;
  return (o?.name ?? "").length + n;
}

// A receiver with no room for an absence: the test is a comparison against a
// value the type cannot hold, so there is none and this is an ordinary access.
export function neverAbsentReceiver(n: number): number {
  const o: Opts = { level: n, name: "z" };
  return o?.level;
}

// The result is `T | undefined`, and comparing it against `undefined` is the
// tag test the union already had.
export function comparedDirectly(n: number, o?: Opts): number {
  return o?.level === undefined ? -1 : o.level;
}
