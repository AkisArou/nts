// expect: a `finally` that spans a `yield`, which is iterator closing
//
// **The refusal is broader than the defect, measured 2026-09-13 by lifting it
// and running.** It is at the generator's `try`, so it rejects every generator
// with a `finally` spanning a `yield`. Only one of the three shapes below is
// actually wrong:
//
//     toExhaustion   walked to the end       agrees with node
//     viaCatch       a `catch`, not a        agrees, and is not refused
//                    `finally`
//     leftByBreak    abandoned by `break`    0 where node gives 1
//
// So the `finally` runs correctly when the body reaches its own end -- the
// split preserves the block and the resumption walks into it like any other.
// What is missing is only `gen.return()`: a `for...of` left by `break` has to
// resume the generator *into* its `finally`, and nothing here does. An
// abandoned walk simply stops calling the resumption and the frame sits at
// whatever state it stopped in.
//
// # Why it is refused at the generator and not at the loop
//
// The ledger's stated reason: the loop that abandons it is in another function,
// so the `try` is the only place that can see the question. That is true of
// *this* check and not of the question -- both facts are available to a
// whole-program pass, which is how `Naming::throwing` and
// `Naming::presence_keys` already answer things neither end knows alone.
//
// Narrowing it to "a walk that can exit abruptly, over a generator that guards
// a yield" would let exhaustive walks compile with correct answers. **How many
// of the 16 corpus refusals that clears is unmeasured** and is the number to
// take before building: a narrowing that clears none is a refusal moved rather
// than a program compiled.
//
// 16 refusals across `stream`, `fs`, `http`, `util`, `assert`, `buffer`,
// `timers` and `events`.

let closed = 0;

function* guarded(limit: number): Generator<number> {
  try {
    for (let i = 0; i < limit; i++) yield i;
  } finally {
    closed = closed + 1;
  }
}

/** Under test, and **correct** once the refusal is lifted. */
export function toExhaustion(n: number): number {
  closed = 0;
  let total = 0;
  for (const v of guarded(n & 3)) total += v;
  return total * 10 + closed;
}

/** Under test, and the whole of what is wrong: node runs the `finally`. */
export function leftByBreak(n: number): number {
  closed = 0;
  let total = 0;
  for (const v of guarded(8)) {
    if (v > (n & 3)) break;
    total += v;
  }
  return total * 10 + closed;
}

function* caught(limit: number): Generator<number> {
  try {
    for (let i = 0; i < limit; i++) yield i;
  } catch {
    closed = closed + 100;
  }
}

/** Control: a `catch` spanning a yield is not refused and agrees. */
export function viaCatch(n: number): number {
  closed = 0;
  let total = 0;
  for (const v of caught(n & 3)) total += v;
  return total * 10 + closed;
}
