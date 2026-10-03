// A tagged template supplies one immutable cooked object followed by its
// substitutions, evaluated once from left to right. The object is cached by
// source site and shared across copies of the containing function.
//
// Tagged calls use the ordinary argument convention, including defaults,
// excess arguments and rest packing. The larger identity witness is beside
// this example. Tags currently use plain declared functions; raw-string access,
// invalid cooked entries and writable template casts remain named boundaries.

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
