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
