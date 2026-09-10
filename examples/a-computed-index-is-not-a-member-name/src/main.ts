// `o[i]` where `i` is a variable, on an object type.
//
//     interface UnknownArrayLike { readonly [index: number]: unknown; }
//     for (let i = 0; i < buf.length; i++) buf[i] = f(source[i]);
//
//     NTS1001 `i`, which `UnknownArrayLike` does not declare
//
// A sentence about a *variable*, said of a type, at a computed index. The name
// `i` never appeared as a member anywhere; it is the loop counter's spelling.
//
// # Where the spelling came from
//
// `names_a_property` asked `literal_name(index).is_some()`, and `literal_name`
// answers for any node carrying text — an identifier carries its own. So
// `source[i]` took the property path and looked for a member called `i`.
//
// What actually names a property is an index the checker has given a **single
// value**: a string or numeric literal, or a `unique symbol`, whose whole
// purpose is to be one member name. An ordinary `number` or `string` index is
// computed, and that its spelling *could* be read as a name is a fact about how
// identifiers are stored rather than about the program.
//
// # Why it matters more than one message
//
// `fromArrayLike`'s loop is `source[i]`, so `Buffer.from` refused — and under
// it `Buffer.alloc`, `Buffer#fill`, `Buffer#indexOf`, `lastIndexOf`,
// `includes`, `transcode`, and `StringDecoder`'s constructor. `string_decoder`
// has **no own-source root refusal at all** and publishes nothing, entirely
// through that chain.
//
// This does not finish it. The refusal is now `indexing `UnknownArrayLike`,
// which is not an array` — which is **true**, and is the representation
// question underneath: an interface whose members are `length` and a numeric
// index signature is structurally an array and is not represented as one. That
// is filed rather than guessed at, in
// `blockers/an-index-signature-is-not-an-array`.
//
// A false message replaced by a true one is worth the change on its own: the
// first sends a reader to look for a member that was never written.
//
// # Controls
//
// `byLiteralString` and `byLiteralNumber` are indices the checker gives one
// value, which must go on resolving to a member at compile time.
// `bySymbol` is the `unique symbol` form that `examples/symbol-keys` is built
// on — its whole claim is that `[kTag]` costs what a field costs, so it must not
// become a lookup. `byVariable` is the computed form, on a real array where it
// has always worked.

const kTag: unique symbol = Symbol("tag");

class Keyed {
  [kTag] = 7;
  named = 3;
  other = 5;
}

/** Control: a string literal index still names a member. */
export function byLiteralString(n: number): number {
  const k = new Keyed();
  return k["named"] + n * 0;
}

/** Control: a `unique symbol` index still names a member at compile time. */
export function bySymbol(n: number): number {
  const k = new Keyed();
  return k[kTag] + n * 0;
}

const tuple: readonly [number, number, number] = [10, 20, 30];

/** Control: a numeric literal index into a tuple. */
export function byLiteralNumber(n: number): number {
  return tuple[1] + n * 0;
}

/** Control: the computed index, on an array, which is what it always was. */
export function byVariable(n: number): number {
  const xs = [1, 2, 3, 4];
  let total = 0;
  for (let i = 0; i < xs.length; i++) total += xs[i]!;
  return total + n * 0;
}

/** Control: a computed index reading and writing, as `fromArrayLike` does. */
export function copiedByIndex(n: number): number {
  const src = [1, 2, 3];
  const out = [0, 0, 0];
  for (let i = 0; i < src.length; i++) out[i] = src[i]! * 2;
  return out[0]! + out[1]! + out[2]! + n * 0;
}
