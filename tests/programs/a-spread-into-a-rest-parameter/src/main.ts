// `f(a, ...rest)` — a spread element in a call's arguments.
//
//     this.emit(EventEmitter.errorMonitor, ...args);
//
// is the single spread refusal in `events`, and `EventEmitter#emit` is under
// `addListener`, `EventEmitter#on`, `net.Server`'s constructor,
// `http.Server`'s and `createServer` — 274 failing test files. One refusal per
// module, five at most anywhere, and this is the one that matters: rank by what
// clears, not by how often the message appears.
//
// # A rest parameter is one array parameter
//
// `function sum(...xs: number[])` lowers to `sum(xs: managed<[f64]>)`, and the
// *call site* builds the array. So a spread is a length this compiler does not
// know: `f(a, b)` allocates two slots and `f(a, ...rest)` allocates one plus
// however many `rest` holds.
//
// `nts_array_concat` already answers that and every backend already emits it,
// so this is the fixed part plus a fold rather than a loop the lowering has to
// build.
//
// # The concatenation is what makes it correct, not only short
//
// A rest array is **fresh on every call** in JavaScript. Passing the caller's
// array straight through would alias it, so `function f(...xs) { xs.push(1) }`
// would reach back into its caller's. `concat` returns a new array — and the
// empty leading array that `f(...rest)` concatenates with is what makes that
// fall out of the general case rather than be a rule written twice.
//
// # Three element widths, and the third had no helper
//
// `nts_array_concat` reads doubles and `nts_array_concat_ref` reads pointers.
// An `unknown[]` is neither: sixteen bytes an element, and a reference only
// when the tag says so — so the double form reads half of one and the reference
// form would retain a payload that may be a number. `nts_array_concat_value`
// is the third, retaining exactly the elements whose tag says they are
// references, which is the rule `nts_array_element` already follows for reading
// one.
//
// That is the width a variadic forwarder actually uses:
// `emit(type, ...args: unknown[])`.
//
// A narrower element is a typed array, whose storage is none of the three, and
// it is refused by name — the line `slice` and the array methods already draw.
//
// # Controls
//
// `noSpread` is the ordinary call, which is what says the change is about the
// spread rather than about rest parameters. `emptySpread` forwards nothing, so
// the concatenation has to be right at zero. `references` and `erased` are the
// other two element widths, each of which reaches a different helper — a
// fixture with only `number[]` would pass with two of the three wrong.

function sum(...xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

function forward(...args: number[]): number {
  return sum(...args);
}

function withLeading(first: number, ...args: number[]): number {
  return sum(first, ...args);
}

function joinAll(...parts: string[]): string {
  return parts.join("-");
}

function forwardStrings(...parts: string[]): string {
  return joinAll("head", ...parts);
}

function countDefined(...values: unknown[]): number {
  let seen = 0;
  for (const v of values) if (v !== undefined) seen += 1;
  return seen;
}

function forwardUnknown(first: unknown, ...rest: unknown[]): number {
  return countDefined(first, ...rest);
}

/** Under test: a spread that is the whole argument list. */
export function spreadOnly(n: number): number {
  return forward(n, 2, 3);
}

/** Under test: a leading argument and then the spread, which is `emit`'s shape. */
export function leadingThenSpread(n: number): number {
  return withLeading(n, 2, 3);
}

/** Control: forwarding nothing. */
export function emptySpread(n: number): number {
  return forward() + n * 0;
}

/** Control: the ordinary call, no spread. */
export function noSpread(n: number): number {
  return sum(n, 2, 3);
}

/** Control: reference elements, which reach `nts_array_concat_ref`. */
export function references(n: number): number {
  return forwardStrings("a", "b").length + n * 0;
}

/** Control: erased elements, which reach `nts_array_concat_value`. */
export function erased(n: number): number {
  // Mixed widths in one `unknown[]`, which is what makes the elements erased.
  // A literal `undefined` would be the honest fourth value and is refused for
  // an unrelated reason -- "`null` or `undefined` where what it stands in for
  // is not a reference" -- so the count is over three present values rather
  // than three of four.
  return forwardUnknown(n, "x", true, 3);
}
