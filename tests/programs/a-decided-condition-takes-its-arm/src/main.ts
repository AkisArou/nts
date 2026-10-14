// A condition the checker has decided takes its arm, and the other is not
// lowered -- so a construct on the half a program cannot reach does not decide
// whether it compiles. The `if` form has folded since `7c3fc82f9`; these are the
// other two, and they are **one change** because shipping the operator without
// the conditional is what made this necessary a second time.
//
// `isDevelopment && typeof console.createTask === "function" ? f : g` with
// `isDevelopment` a literal `false` is React's own guard. Folding only the `&&`
// left `br (const false), b1, b2` with *both* arms lowered, both closures
// refused, and their values carried through block arguments into a merge
// parameter -- the one thing `excise_from_initializer` cannot cut, so module
// evaluation was dropped whole and every module-scope binding in the program went
// unwritten. Folding the conditional too is what makes the cut narrow again.

const no = false;
const yes = true;

// --- the operator, four combinations: only one per operator short-circuits ---

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
 * The operand kept is not always a boolean -- `true && x` is `x` -- so both arms
 * that yield the *right* operand are driven at a number too, where returning the
 * left one would be a type error rather than a wrong answer and would therefore
 * never have been noticed here.
 */
export function andTrueNumber(x: number): number {
  return yes && x;
}

export function orFalseNumber(x: number): number {
  return no || x;
}

// --- the conditional ---

export function condTrue(x: number): number {
  return yes ? x : x + 1;
}

export function condFalse(x: number): number {
  return no ? x : x + 1;
}

/** The literal spelling, which needs no `const` to be decided. */
export function condLiteral(x: number): number {
  return true ? x : x + 1;
}

/**
 * **Arms of different types**, so the expression's type is a union and folding
 * hands back one arm's value. If the merge block were where the representation
 * was settled, this is the arm that would say so.
 */
export function mixed(x: number): string {
  const v: string | number = yes ? "text" : x;
  return typeof v === "string" ? v : String(v);
}

export function mixedFalse(x: number): string {
  const v: string | number = no ? "text" : x;
  return typeof v === "string" ? v : String(v);
}

/** A nullable arm, where the union carries an absence. */
export function nullableArm(x: number): number {
  const v: number | null = no ? null : x;
  return v === null ? -1 : v;
}

/** Nested, so the fold reaches through its own result. */
export function nested(x: number): number {
  return yes ? (no ? x : x + 2) : x + 100;
}

// --- the shape this exists for, in both forms ---

/**
 * The dead half holds a construct this compiler refuses by name, in the
 * operator and the conditional at once -- React's statement, reduced. Before
 * this it was the example's refusal; now there is none.
 */
export function deadHalfRefuses(x: number): number {
  return no && Object.getOwnPropertyNames({ a: 1 }).length > 0 ? x : x + 1;
}

export function deadArmRefuses(x: number): number {
  return no ? Object.getOwnPropertyNames({ a: 1 }).length : x + 1;
}

// --- controls ---

/** **Control.** Nothing decides `flag`, so both halves are still lowered. */
export function undecided(x: number, flag: boolean): boolean {
  return flag && x > 0;
}

export function undecidedOr(x: number, flag: boolean): boolean {
  return flag || x > 0;
}

export function undecidedCond(x: number, flag: boolean): number {
  return flag ? x : x + 1;
}

function three(): number {
  return 3;
}

/**
 * **Control.** The *live* half is lowered whatever the fold decides: `three() > 0`
 * is `true`, so both the `||` and the `?:` short-circuit -- and the call still has
 * to happen, since a call is not a constant.
 */
export function leftStillRuns(x: number): number {
  return three() > 0 || x > 99 ? x : -1;
}

export function conditionStillRuns(x: number): number {
  return three() > 0 ? x : -1;
}

/**
 * **The direction that discards a value.** `false || b` is `b`, so the lowered
 * left operand is unused -- and if its ops went with it a call would lose its
 * side effect, which is a wrong answer rather than a refusal. An element write
 * rather than a `push`, because a closure's `push` followed by the caller's
 * `.length` was its own defect until `a795534a4`.
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

export function andFromTrueCall(x: number): number {
  const seen: number[] = [0];
  const truthy = (): true => {
    seen[0] = 1;
    return true;
  };
  const r = truthy() && x > 0;
  return seen[0]! * 10 + (r ? 1 : 0);
}
