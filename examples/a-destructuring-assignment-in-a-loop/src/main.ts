// `[line] = next()` inside a loop -- a destructuring *assignment* whose names
// are loop-carried.
//
// `assigned_symbols` decides which names a loop carries as block parameters,
// and took only a bare name as an assignment's target. A pattern's names were
// never carried, so the header kept reading the value from before the loop:
//
//     let [line] = next();
//     while (line !== null) { ...; [line] = next(); }
//
// ran forever, a GJS-style `for (let [line] = read(); line !== null; [line] =
// read())` over a file's lines with it, and `[a, b] = [b, a + 1]` in a `for`
// was invalid HIR -- refused at emit, no diagnostic on the source. At module
// scope all of it passed, since a global is stored rather than carried, which
// is why nothing saw it: `tooling/sweep/probe.sh` runs module-scope statements.
//
// A shorthand (`({ line, n } = o)`) carries the *property's* symbol on its
// node, so its binding is found by name, as the store itself finds it.

/** The `i`th of three values from `n`, and ten times it; `null` past them. */
function pair(n: number, i: number): [number | null, number] {
  if (i < 3) return [n + i, (n + i) * 10];
  return [null, 0];
}

/** A `while` whose condition reads what the body's pattern wrote. */
export function whileReadsThePattern(n: number): number {
  let i = 0;
  let total = 0;
  let [value] = pair(n, i);
  while (value !== null) {
    total += value;
    i++;
    [value] = pair(n, i);
  }
  return total * 10 + i;
}

/** The GJS line-reading shape: a pattern in the head and in the update. */
export function forHeadAndUpdate(n: number): number {
  let i = 0;
  let total = 0;
  for (let [value, tens] = pair(n, i); value !== null; [value, tens] = pair(n, ++i)) {
    total += value + tens;
  }
  return total * 10 + i;
}

/** A swap: both names carried, each reading the other's previous value. */
export function swapInAFor(n: number): number {
  let a = n;
  let b = 0;
  for (let i = 0; i < 3; i++) {
    [a, b] = [b, a + 1];
  }
  return a * 100 + b;
}

/** Object patterns: a shorthand, a renamed key, and a default. */
export function objectPatterns(n: number): number {
  let x = n;
  let y = 0;
  let z = 0;
  for (let i = 0; i < 3; i++) {
    ({ x, k: y } = { x: x + 1, k: y + 2 });
    ({ z = 5 } = {} as { z?: number });
  }
  return x * 100 + y * 10 + z;
}

/** Zero iterations: what the pattern would write never arrives. */
export function neverRuns(n: number): number {
  let a = n;
  let b = n;
  for (let i = 0; i < 0; i++) {
    [a, b] = [i, i];
  }
  return a + b;
}
