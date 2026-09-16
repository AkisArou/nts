// An options object, which is how JavaScript passes named arguments.
//
// `count({ depth: n })` where the parameter is declared `Options` refused with
//
//     a `Options` where a `an anonymous type` is wanted, which is a pointer
//     cast between two structs that do not agree about where their shared
//     fields are
//
// -- 87 distinct sites across six `runtime/node` modules, the second-largest
// refusal in the tree, and a message about field offsets for a program that has
// none of that in it.
//
// # One modifier, measured one variable at a time
//
// It refused exactly when the literal **supplied a value for a `?` property**.
// Not when it omitted one, not when every property was required, not when the
// literal was empty:
//
//     depth: number       { depth: n }               compiled
//     depth, encoding?    { depth: n }               compiled   omits it
//     depth?              { }                        compiled   omits it
//     depth?              { depth: n }               refused
//     depth, encoding?    { depth: n, encoding: "u" } refused
//
// And it was the modifier rather than the representation, which is the part no
// reading of the message would have given:
//
//     encoding?: string             { encoding: "u" }        refused
//     encoding?: string             { encoding: undefined }  compiled
//     encoding: string | undefined  { encoding: "u" }        compiled
//
// Those two declarations have the same representation.
//
// # Two derivations of one fact
//
// `count(o: Options)` was not lowered as taking `Options`. It became
// `count@0obj8(o: managed<obj#8>)` -- a *structural copy*, keyed by
// `structural_instantiations` on the **checker's** type of the argument -- while
// `lower_object_literal` built the literal at its **contextual** type, the
// parameter's declared one. They agree until the literal supplies an optional
// property, at which point the checker types it present on the literal and
// optional on the declaration.
//
// A literal is built to order and has no prior layout to cast from, so the
// declared type is the answer and the structural pass skips it. That also makes
// every call passing an `Options`-shaped literal share one copy.

interface Options {
  depth?: number;
  encoding?: string;
  recursive?: boolean;
}

function count(o: Options): number {
  return (o.depth ?? 0) + (o.recursive === true ? 100 : 0) + (o.encoding === undefined ? 0 : 10);
}

/** One optional property supplied, the other two omitted. */
export function partial(n: number): number {
  return count({ depth: n });
}

/** All three supplied, which used to be the same refusal. */
export function whole(n: number): number {
  return count({ depth: n, encoding: "u", recursive: true });
}

/** None supplied. This compiled before and must go on doing so. */
export function empty(n: number): number {
  void n;
  return count({});
}

/** A different subset again, so one shared copy has to serve all four. The
 *  arms answer 0, 10, 100 and 110 apart from `depth`, so a literal built at the
 *  wrong layout reads a neighbouring field rather than agreeing by accident. */
export function middle(n: number): number {
  return count({ depth: n, recursive: false });
}

/** A required property beside the optional ones, since the two are laid out
 *  together and the refusal moved with the optional one. */
interface WithRequired {
  id: number;
  label?: string;
}

function describe(o: WithRequired): number {
  return o.id + (o.label === undefined ? 0 : 1000);
}

export function required(n: number): number {
  return describe({ id: n, label: "x" });
}
