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
// A link after an *optional* one is fine, and `twoOptionalLinks` below is two
// of them: each tests its own receiver, so the second is skipped exactly when
// the first produced `undefined`.
//
// A link after an optional one that is *not* itself optional is refused.
// `a?.b.c` short-circuits the whole chain in JavaScript — when `a` is absent,
// `.c` is not evaluated either — and that is a property of the chain rather
// than of either access. Lowering it as `(a?.b).c` would read a member of the
// absent value, so it is refused in those words instead.

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

// `f?.(x)` and `xs?.[i]` — the other two links in the family, and the same
// three steps as `a?.b`: lower the receiver once, test the absence it admits,
// and do the work only in the arm where it is present.
//
// What the arm holds is the whole difference. For `a?.b` it is a member read;
// for `xs?.[i]` an element read; for `f?.(x)` the indirect call through the
// closure. The arguments and the index are lowered *inside* that arm, because
// `f?.(g())` must not call `g` when `f` is absent — and a branch taken any
// earlier would get that wrong.
interface Held {
  fn?: (x: number) => number;
  items?: number[];
}

function held(n: number): Held {
  if (n < 0) {
    return {};
  }
  return { fn: (x) => x * 3, items: [10, 20, 30] };
}

export function optionalCall(n: number): number {
  return held(n).fn?.(7) ?? -1;
}

export function optionalIndex(n: number): number {
  return held(n).items?.[1] ?? -1;
}

// The short-circuit, made observable. When the receiver is absent neither the
// argument nor the index is evaluated, so `bump` never runs and `effects` stays
// zero — which is what the specification says and what the answer here counts.
let effects = 0;

function bump(): number {
  effects = effects + 1;
  return 1;
}

export function anAbsentCalleeEvaluatesNoArguments(n: number): number {
  effects = 0;
  const got = held(n).fn?.(bump()) ?? -1;
  return got * 100 + effects;
}

export function anAbsentArrayEvaluatesNoIndex(n: number): number {
  effects = 0;
  const got = held(n).items?.[bump()] ?? -1;
  return got * 100 + effects;
}

// Two links, each optional. This is a chain, and it works because each link
// tests its own receiver: `inner?.fn?.(7)` skips the call when `inner` is
// absent *and* when `fn` is.
interface Nest {
  inner?: Held;
}

function nest(n: number): Nest {
  if (n < -5) {
    return {};
  }
  return { inner: held(n) };
}

export function twoOptionalLinks(n: number): number {
  return nest(n).inner?.fn?.(7) ?? -1;
}
