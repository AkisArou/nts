// `false && b` never evaluates `b`, so `b` should not have to *compile* either.
// The `if` spelling of that has folded since `7c3fc82f9`; the operator spelling
// still lowered its dead side, and refused for constructs on the half a program
// cannot reach -- React's `isDevelopment && typeof console.createTask ===
// "function"` being the shape that reported it.
//
// Four combinations, because the operator and the decided value each have two
// values and only one of the four short-circuits per operator. `undecided` and
// `undecidedOr` are the controls that keep the branch path alive, and
// `leftStillRuns` is the one that says the *live* operand is still lowered.

const no = false;
const yes = true;

/** `false && b` is `false`: `b` decides nothing, whatever `x` is. */
export function andFalse(x: number): boolean {
  return no && x > 0;
}

/** `true && b` is `b`. */
export function andTrue(x: number): boolean {
  return yes && x > 0;
}

/** `true || b` is `true`. */
export function orTrue(x: number): boolean {
  return yes || x > 0;
}

/** `false || b` is `b`. */
export function orFalse(x: number): boolean {
  return no || x > 0;
}

/**
 * The operand kept is not always a boolean -- `true && x` is `x` and has `x`'s
 * type -- so the two arms that yield the *right* operand are driven at a number
 * as well, where returning the left one would be a type error rather than a
 * wrong answer and would therefore never have been noticed here.
 */
export function andTrueNumber(x: number): number {
  return yes && x;
}

export function orFalseNumber(x: number): number {
  return no || x;
}

/** The literal spelling, which needs no `const` to be decided. */
export function andFalseLiteral(x: number): boolean {
  return false && x > 0;
}

export function orTrueLiteral(x: number): boolean {
  return true || x > 0;
}

/**
 * **The shape this exists for.** The dead operand holds a construct this
 * compiler refuses by name, and a production build cannot reach it. On a
 * compiler built before the fold this function is the example's one refusal.
 */
export function deadOperandRefuses(x: number): number {
  return no && Object.getOwnPropertyNames({ a: 1 }).length > 0 ? x : x + 1;
}

/** **Control.** Nothing decides `flag`, so both operands are still lowered. */
export function undecided(x: number, flag: boolean): boolean {
  return flag && x > 0;
}

export function undecidedOr(x: number, flag: boolean): boolean {
  return flag || x > 0;
}

function three(): number {
  return 3;
}

/**
 * **Control.** The *live* operand is lowered whatever the fold decides:
 * `three() > 0` is `true`, so the `||` short-circuits -- and the call still has
 * to happen, since a call is not a constant.
 */
export function leftStillRuns(x: number): number {
  return three() > 0 || x > 99 ? x : -1;
}

/**
 * **The direction that discards the left operand's value**, which the first
 * version of this example did not cover. `false || b` is `b`, so the lowered
 * left operand is unused -- and if its ops went with it, a call would lose its
 * side effect. That is a wrong answer rather than a refusal, so it is the arm
 * worth having: `falsy()` must still have run. It reads as a bare `falsy();`
 * statement in the emitted C, which is where this was checked as well as here.
 *
 * The witness is an element *write* rather than a `push`, and a local array
 * rather than a module-scope one, for two separate reasons. Local, because the
 * differential restarts a run to get past a declined case and a counter that
 * accumulated across cases would answer differently on the second pass. An
 * element write, because `seen.push(1)` inside a closure followed by
 * `seen.length` in the caller **answers 0 here and 1 in node** -- a pre-existing
 * fold of a constant length that a closure's mutation escapes, unrelated to this
 * example and reduced separately. Writing an existing element is visible.
 */
export function orFromFalseCall(x: number): number {
  const seen: number[] = [0];
  const falsy = (): false => {
    seen[0] = 1;
    return false;
  };
  const r = falsy() || x > 0;
  return seen[0]! * 10 + (r ? 1 : 0);
}

/** The same, for `true && b`. */
export function andFromTrueCall(x: number): number {
  const seen: number[] = [0];
  const truthy = (): true => {
    seen[0] = 1;
    return true;
  };
  const r = truthy() && x > 0;
  return seen[0]! * 10 + (r ? 1 : 0);
}
