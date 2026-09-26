// `o.name` and `o["name"]` name the same member, and three separate questions
// used to be asked of the dot form only: which member a refused name is read
// *for*, whether a callee is a `Math`/`Number`/`String` intrinsic, and whether
// it is a `console` method. So `console["error"](e)` reached none of them and
// refused as "`console`, a global with no definition here", where
// `console.error(e)` has always lowered.
//
// Each `Dot` arm is the control: it lowered before this example existed, and its
// `Bracket` twin is what the shared read of the access is for. On a compiler
// built before it, the five bracket arms refuse and the four dot arms agree --
// which is the only way round that tests anything.

/** **Control.** The dot spelling of the arm below it. */
export function absDot(x: number): number {
  return Math.abs(x);
}

export function absBracket(x: number): number {
  return Math["abs"](x);
}

/** Two arguments, so the bracket read is not only tested at arity one. */
export function maxBracket(x: number): number {
  return Math["max"](x, 4);
}

/** **Control.** */
export function isNaNDot(x: number): boolean {
  return Number.isNaN(x / x);
}

export function isNaNBracket(x: number): boolean {
  return Number["isNaN"](x / x);
}

/** **Control.** */
export function fromCharCodeDot(x: number): string {
  return String.fromCharCode(x);
}

export function fromCharCodeBracket(x: number): string {
  return String["fromCharCode"](x);
}

/**
 * The shape the React lane reported, whose dot twin `examples/console` holds:
 * `console.error` writes to stderr, and the bracket spelling writes the same
 * line in the same place.
 */
export function errorBracket(x: number): number {
  console["error"]("bracket", x);
  return x + 1;
}

/**
 * **The boundary, and it refuses deliberately.** `k` is a *variable*, so
 * `Math[k]` is a member decided at run time -- and reading it as the name `k`
 * would put it in the same slot as `Math["k"]`. That `k`'s type is the literal
 * `"abs"` here, so TypeScript itself resolves the member, is what makes this
 * worth holding rather than assuming: the refusal is a choice, not an accident
 * of what the checker knows.
 */
const k = "abs";

export function viaVariable(x: number): number {
  return Math[k](x);
}
