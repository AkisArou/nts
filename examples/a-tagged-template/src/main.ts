// `` tag`a${x}b` ``, which is `tag(["a", "b"], x)`.
//
// A tagged template is a **call**, and the specification says what its
// arguments are: an array of the literal pieces first, then one argument per
// substitution in source order. So the lowering builds the array, lowers the
// substitutions left to right — which is observable, since one of them may call
// something — and hands both to the tag.
//
// # Two things were missing and only one of them was the expression
//
// `TemplateStringsArray` had no representation. lib.d.ts declares it as a
// `ReadonlyArray<string>` with a `raw` beside it, and `readonly string[]`
// already represented — so the interface was decomposed at the library boundary
// and came back with nothing, and a tag's *parameter* refused before the
// expression was ever reached. It represents as `string[]` now, which is what a
// tag receives and indexes.
//
// **`raw` is deliberately not there.** It is the un-cooked text — `\n` as two
// characters rather than one — a second string list this compiler does not
// build, so reading it refuses as an ordinary member of an array rather than
// answering the cooked strings to a program that asked for the raw ones.
//
// # What is still refused, and why each is its own sentence
//
//     a tag that is not a plain declared function
//     a tag that takes a rest parameter
//
// The first is a call-path question: `lower_call` resolves a callee through
// qualified names, generic suffixes, static and method dispatch, closures and
// imports, and duplicating any of that here would be a second derivation of
// "which function is this". The second is the spread machinery — a rest takes
// the substitutions as one array, so handing them over positionally is the
// wrong number of arguments, which the verifier caught as
// `CallArgumentCount { expected: 2, found: 3 }`.
//
// # The array's identity is not interned, and that is observable
//
// The specification interns the template object per call *site*: the same tag
// called twice in a loop receives the identical array, and `strings ===
// strings` across two calls is `true`. This rebuilds it per evaluation, so a
// tag memoising on the array's identity would miss every time. It is written
// down rather than hidden because it is the one observable difference, and the
// fix is an interned per-site constant rather than anything about this
// lowering — no arm below can see it, which is exactly why it is here.

function pieces(strings: TemplateStringsArray): number {
  return strings.length * 100 + strings[0].length;
}

/** Under test: no substitutions at all — one piece, no expression. */
export function noSubstitutions(n: number): number {
  return pieces`hello` + (n & 1);
}

function sums(strings: TemplateStringsArray, a: number, b: number): number {
  return strings.length * 1000 + a * 10 + b;
}

/** Under test: two substitutions, taken as named parameters. */
export function twoSubstitutions(n: number): number {
  return sums`x${n & 3}y${2}z`;
}

/** Under test: the pieces around the substitutions, read by length. */
function shape(strings: TemplateStringsArray, a: number): number {
  return strings[0].length * 100 + strings[1].length * 10 + a;
}

export function readsThePieces(n: number): number {
  return shape`aa${n & 7}bbb`;
}

/**
 * Under test: an **empty** leading piece, which is a real string and not an
 * absence — `` tag`${x}y` `` has pieces `["", "y"]`, so the array is length two
 * with a zero-length first element.
 */
export function anEmptyLeadingPiece(n: number): number {
  return shape`${n & 7}zzzz`;
}

let calls = 0;
function bump(v: number): number {
  calls = calls + 1;
  return v;
}

/**
 * Under test: the substitutions are evaluated **left to right**, and each
 * exactly once.
 *
 * Every other arm would agree with node if a substitution ran twice or in the
 * wrong order, because they read only the values. This counts the calls and
 * orders them, which is the only way to see it.
 */
export function evaluationOrder(n: number): number {
  calls = 0;
  const order = sums`p${bump(n & 1)}q${bump(2)}r`;
  return order * 10 + calls;
}
