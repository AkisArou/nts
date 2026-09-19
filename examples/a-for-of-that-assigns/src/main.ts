// `for (v of xs)` — a head that assigns rather than declares.
//
//     NTS1001 a `for...of` without a declaration
//
// The language permits **any assignment target** in a `for...of` or `for...in`
// head: a name that already exists, a property, an element, or a destructuring
// pattern. `for_of_head` looked for a `VariableDeclaration` and refused when
// there was none, which is 36 files of the slice-1 `test/language` population.
//
// The write is the one an assignment statement makes — `place_of` already knows
// every shape an assignment target can have, and a destructuring target goes to
// `assign_pattern`, which is what `[a, b] = p` already uses. Neither was taught
// the shape a second time.
//
// # The part that is not the write
//
// **The head assigns, so what it writes is loop-carried.** `for (v of xs) { }`
// writes `v` once per iteration and the body never mentions it, so
// `assigned_symbols(body)` finds nothing — and a value written inside a loop
// and read after it has to travel as a loop parameter. Left out, it showed as
// `NotDominated`: invalid HIR, no output, no diagnostic. `survivesTheLoop` and
// `emptyLeavesItAlone` are the two arms that pin it, and they disagree with
// each other on purpose — one reads what the last iteration wrote, the other
// reads what was there before a loop that never ran.
//
// A **property** target needs none of that: `for (o.k of xs)` writes through
// storage that outlives the loop on its own. So does a module-scope global.
//
// # What is still refused, and why it is not this
//
// `for ({ x } of objs)` — a **shorthand** in an assignment pattern — refuses,
// and it refuses identically outside a loop: `({ x } = o)` does too, because
// the symbol on a shorthand is the *property's* rather than the variable's.
// Bracketed on a compiler from before this, unchanged by it. `{ x: y }` works,
// here and there.

export function assignsAName(n: number): number {
  const xs = [n, n + 1, n + 2];
  let v = 0;
  let total = 0;
  for (v of xs) {
    total += v;
  }
  return total * 10 + v;
}

/** The last element written survives the loop. */
export function survivesTheLoop(n: number): number {
  let v = -1;
  for (v of [n, n * 2]) {
    // nothing
  }
  return v;
}

/** A loop that never runs writes nothing, so the old value stands. */
export function emptyLeavesItAlone(n: number): number {
  const none: number[] = [];
  let v = n;
  for (v of none) {
    // nothing
  }
  return v;
}

/** A property target, which is storage rather than a carried value. */
export function assignsAProperty(n: number): number {
  const held = { k: 0 };
  let total = 0;
  for (held.k of [n, n + 1]) {
    total += held.k;
  }
  return total * 10 + held.k;
}

/** An element target, the same way. */
export function assignsAnElement(n: number): number {
  const slot = [0];
  let total = 0;
  for (slot[0] of [n, n + 1]) {
    total += slot[0]!;
  }
  return total * 10 + slot[0]!;
}

/** A destructuring target, which goes where `[a, b] = p` goes. */
export function assignsAPattern(n: number): number {
  const pairs: [number, number][] = [
    [n, 2],
    [3, 4],
  ];
  let a = 0;
  let b = 0;
  let total = 0;
  for ([a, b] of pairs) {
    total += a * b;
  }
  return total * 100 + a * 10 + b;
}

/** `for...in` takes an assigning head too. */
export function assignsInAForIn(n: number): number {
  const held = { aa: 1, b: 2 };
  let key = "";
  let total = 0;
  for (key in held) {
    total += key.length;
  }
  return total * 10 + key.length + n * 0;
}

/** Broken out of, so the carried value is what the break left. */
export function breaksOut(n: number): number {
  let v = 0;
  let total = 0;
  for (v of [n, n + 1, n + 2]) {
    if (v > n) {
      break;
    }
    total += v;
  }
  return total * 100 + v;
}

/** Two assigning heads, nested. */
export function nested(n: number): number {
  let a = 0;
  let b = 0;
  let total = 0;
  for (a of [n, n + 1]) {
    for (b of [10, 20]) {
      total += a * b;
    }
  }
  return total;
}

/** **Control.** The declaring head, which must be unchanged. */
export function declaresAName(n: number): number {
  let total = 0;
  for (const v of [n, n + 1]) {
    total += v;
  }
  return total;
}

/** **Control.** A declaring pattern head, likewise. */
export function declaresAPattern(n: number): number {
  const pairs: [number, number][] = [[n, 2]];
  let total = 0;
  for (const [a, b] of pairs) {
    total += a * b;
  }
  return total;
}

// # A default in an assignment pattern
//
// `[a = 7] = xs` and the `for ([a = 7] of xss)` head that reaches the same
// code. The element node is a `BinaryExpression` with `=`, so `place_of` was
// handed the *whole* of `a = 7` and refused it as `assignment to a computed
// target` — a true sentence about a question that should not have been asked.
//
// The value comes from `defaulted_array_element`, which the **binding** path
// already uses for `const [a = 7] = xs`: one derivation of when an element is
// absent and what happens then, asked by both. This was refused outside a loop
// too, so the fix is not about the head.
//
// **The default is an expression, and it runs only when the element is
// absent.** `defaultRunsOnlyWhenAbsent` is the arm for that — and it is also
// the arm that found the second half of the carried-value problem: a default
// like `a = (flag = 1)` *writes* `flag` inside the loop, on the iterations
// where the element is missing. `names_written_by` collects targets and cannot
// see it; `assigned_symbols` finds assignments in expressions and cannot see a
// bare name. Both are needed, and with only the first this was `NotDominated`.

export function aDefaultWhenAbsent(n: number): number {
  const none: number[] = [];
  let a = 0;
  [a = n] = none;
  return a;
}

export function aDefaultNotTakenWhenPresent(n: number): number {
  const one = [n];
  let a = 0;
  [a = 99] = one;
  return a;
}

/** One element present, one absent, in the same pattern. */
export function partlyDefaulted(n: number): number {
  const one = [n];
  let a = 0;
  let b = 0;
  [a, b = 9] = one;
  return a * 10 + b;
}

/** In a head, which is where the corpus writes it. */
export function aDefaultInTheHead(n: number): number {
  const xss: number[][] = [[], [n]];
  let a = 0;
  let total = 0;
  for ([a = 7] of xss) {
    total += a;
  }
  return total;
}

/**
 * The default runs **only** when the element is absent, and what it writes is
 * carried out of the loop like anything else the head assigns.
 */
export function defaultRunsOnlyWhenAbsent(n: number): number {
  const xss: number[][] = [[n]];
  let first = 0;
  let second = 0;
  let a = 0;
  let b = 0;
  for ([a = (first = 1), b = (second = 1)] of xss) {
    // nothing
  }
  return first * 10 + second;
}

// # The three shapes an assignment pattern still refused
//
// `[a = 7] = xs` landed above; these are the rest of what the corpus writes,
// and all three were one message — `assignment to a computed target` — which
// `place_of` answers truthfully about whatever node it is handed. Each is the
// **binding** path's rule, learned by the assignment path:
//
//   `[[a, b]] = xss`       a nested pattern     -> the same function, one level down
//   `[a, ...rest] = xs`    a rest element       -> `rest_tail`, shared with `bind_rest`
//   `[, a] = xs`           a hole               -> skip it, and still count it
//
// The tail is a **fresh array** — writing to it must not touch the one it came
// from — which is why `rest_tail` exists rather than a second slice built here:
// the binding path (`const [a, ...rest] = xs`) and this one differ only in
// where the tail ends up.

export function aNestedPattern(n: number): number {
  const xss: number[][] = [[1, 2]];
  let a = 0;
  let b = 0;
  [[a, b]] = xss;
  return a * 10 + b + n * 0;
}

/** Three levels, because a fix that recursed once would pass the one above. */
export function nestedThreeDeep(n: number): number {
  const deep: number[][][] = [[[9]]];
  let a = 0;
  [[[a]]] = deep;
  return a + n * 0;
}

/** An object pattern nested inside an array one, and the reverse. */
export function nestedAcrossKinds(n: number): number {
  const rows: { x: number }[] = [{ x: 7 }];
  let a = 0;
  [{ x: a }] = rows;

  const o: { p: number[] } = { p: [4, 5] };
  let b = 0;
  let c = 0;
  ({ p: [b, c] } = o);

  return a * 100 + b * 10 + c + n * 0;
}

export function aRestElement(n: number): number {
  const xs: number[] = [1, 2, 3];
  let a = 0;
  let rest: number[] = [];
  [a, ...rest] = xs;
  return a * 100 + rest.length * 10 + rest[0] + n * 0;
}

/**
 * The tail is a fresh array. Writing to it must leave the source alone, which
 * a rest implemented as an alias would fail and every arm above would pass.
 */
export function theTailIsFresh(n: number): number {
  const xs: number[] = [1, 2, 3];
  let rest: number[] = [];
  [...rest] = xs;
  rest[0] = 9;
  return xs[0] * 10 + rest[0] + n * 0;
}

/** A rest whose target is itself a pattern. */
export function aRestIntoAPattern(n: number): number {
  const xs: number[] = [1, 2, 3];
  let a = 0;
  let b = 0;
  [, ...[a, b]] = xs;
  return a * 10 + b + n * 0;
}

/**
 * A hole binds nothing and **occupies a position**. The two facts travel
 * together: skipping without counting would write `xs[0]` into `a`, and
 * `twoHoles` is the arm that fails if it does.
 */
export function aHole(n: number): number {
  const xs: number[] = [1, 2, 3];
  let a = 0;
  [, a] = xs;
  return a + n * 0;
}

export function twoHoles(n: number): number {
  const xs: number[] = [1, 2, 3];
  let a = 0;
  [, , a] = xs;
  return a + n * 0;
}
