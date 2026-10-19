// A function that returns a value on one path and falls off its end on
// another returns `undefined` there. TypeScript infers `number | undefined`
// for `pick`, and the end of its body is where that `undefined` comes from.
//
// It was invalid HIR (`FellThrough`): `close_body` could not tell this case
// from a dead end, because it saw only the representation, and an erased
// result says nothing about whether `undefined` is owed. It asks the
// signature's checker type now. Pinned before as the outcome
// `a-function-that-can-fall-off-its-end`; test262's `for-in/return*` and
// `for-inof-finally` are the loop form, found by the JVM lane's census.

function pick(c: boolean) {
  if (c) return 42;
}

/** `pick` taken and fallen off. */
export function picked(n: number): string {
  return String(pick(n > 0));
}

/** The control, which always compiled: the same body ending `return undefined;`. */
export function explicit(n: number): string {
  const f = (c: boolean) => {
    if (c) return 42;
    return undefined;
  };
  return String(f(n > 0));
}

function firstKey(o: Record<string, string>) {
  for (const k in o) {
    return k;
  }
}

/** A loop whose body always returns: an object with no keys falls off. */
export function firstKeyOf(n: number): string {
  const o: Record<string, string> = {};
  for (let i = 0; i < n % 3; i++) o[`k${i}`] = "v";
  return String(firstKey(o));
}

function firstValue(xs: number[]) {
  for (const x of xs) {
    return x * 2;
  }
}

/** The same over values: an empty array falls off. */
export function firstValueOf(n: number): string {
  const xs: number[] = [];
  for (let i = 0; i < n % 3; i++) xs.push(i + n);
  return String(firstValue(xs));
}

const firstKeyArrow = (o: Record<string, string>) => {
  for (const k in o) {
    return k.length;
  }
};

/** The same inside a closure. */
export function arrowKeyOf(n: number): string {
  const o: Record<string, string> = {};
  for (let i = 0; i < n % 3; i++) o[`key${i}`] = "v";
  return String(firstKeyArrow(o));
}

// And the end that is dead: `while (true)` leaves an exit edge the lowering
// has not folded, and `T` here is a `number`, which no `undefined` fits. The
// checker's `T` names no `undefined`, so the end stays `FellThrough` and the
// function compiles, as it did before.
function until<T>(next: () => T, ok: (t: T) => boolean): T {
  while (true) {
    const t = next();
    if (ok(t)) return t;
  }
}

/** The dead end, which must keep compiling. */
export function untilAbove(n: number): number {
  let k = 0;
  return until(
    () => ++k,
    (t) => t > (n | 0) % 5,
  );
}
