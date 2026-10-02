// expect: a `for...of` inside a `try` over a generator this site did not make
//
// A generator frame that **arrived** here -- as a parameter, a field, or another call's result
// -- is stepped through `Hierarchy::generator_slot`, the one index every abstract generator
// declares its resumption at. That slot holds the **ordinary** body, so a `throw` from it ends
// the program where the handler two lines up would have caught it. Refused by name rather than
// left to end the program, which is the raising row's rule wherever a raise cannot be carried.
//
// `e22963ec9` fixed the other half: a generator stepped **where it was made** names its raising
// resumption by the one strip `without_the_raising_suffix` exists to be, and `protocol_step`
// tests the flag after it. That is `steppedWhereItWasMade` below, the control, and it must go on
// compiling -- a rule refusing every guarded step would satisfy this file's expectation and
// break the shape the other commit exists for.
//
// # Why a slot is not built for it, measured rather than argued
//
// The fix is a raising resumption at a slot of its own, and the JVM lane cleared the design --
// no new JVM code, because `declared_member` already maps a frame's `upTo__resume` to the base's
// name, and UNFILLED/SHADOWED name a missing or shadowed fill. What stops it is the price:
// `generator_slot` is **uniform**, so a raising one is a *fifth* program-wide index -- a word per
// descriptor in every program, on `raising_call_slot`'s terms, and ungated for the reason that
// slot's doc gives (a syntactic probe cannot be sound here, because which bodies get copies is
// decided in `naming`, after the numbering).
//
// And `runtime/node` makes **zero** indirect generator steps: `stream`, `fs`, `readline` and
// `util` emit no `call.virtual[..] Generator*#resume` and no `@raises__resume` at all. So the
// slot is width paid for a dispatch the corpora never make, and this refusal costs them nothing.
// The day a population dispatches there, the design is in the plan and this file is what says so.
//
// # The other shape, which is a record and not this
//
// `outcomes/a-generator-passed-in-and-stepped-inside-a-try-ends-the-program` (the JVM lane's)
// puts the `try` in the **caller** rather than in the stepping function, and still ends the
// program: `throwing_symbols` walks for a `throw` keyword and for calls, and a generator step is
// neither, so the stepping function is in no raising set and gets no copy for the caller's `try`
// to name. That is the same arm the `RequireObjectCoercible` guard needed, one construct over,
// and it is the second half of this.

function* countingToward(limit: number): Generator<number> {
  let i = 0;
  while (true) {
    if (i > limit) {
      throw new RangeError("too far");
    }
    yield i;
    i += 1;
  }
}

/** Refused: the frame arrives as a parameter, and the `try` is in this same function. */
function sumOf(g: Generator<number>): number {
  let seen = 0;
  try {
    for (const x of g) {
      seen += x;
      if (seen > 100) {
        break;
      }
    }
    return seen;
  } catch {
    return -1;
  }
}

export function throughAParameter(n: number): number {
  return sumOf(countingToward(n & 7));
}

/** The control: the same generator, stepped where it was made. `e22963ec9`'s shape. */
export function steppedWhereItWasMade(n: number): number {
  let seen = 0;
  try {
    for (const x of countingToward(n & 7)) {
      seen += x;
      if (seen > 100) {
        break;
      }
    }
    return seen;
  } catch {
    return -1;
  }
}
