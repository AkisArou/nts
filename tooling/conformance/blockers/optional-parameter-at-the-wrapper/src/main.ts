// expect: emit-c --napi -> emits-addon requires 1 argument");
//
// FIXED, kept as a guard. An optional parameter crosses as optional.
//
// It used to cross as required: `withOptional` published, and the wrapper it
// got rejected the call that omits the optional argument with
// `ERR_MISSING_ARGS`. `path.basename(p)` -- which is how everyone calls it, and
// node's signature is `basename(path, suffix?)` -- compiled, linked, published,
// and threw on the ordinary call.
//
// The expectation carries the **closing quote**, and that is not decoration.
// Written as `requires 1 argument` it is a substring of the old compiler's
// `requires 1 arguments` -- the plural was unconditional -- so the fixture
// would have passed against the binary it was written to catch. Caught by
// running it against that binary rather than by reading it, which is the only
// thing that would have.
//
// With the quote, the old output reads `requires 1 arguments");` and does not
// match. `withOptional` is what produces the singular: `required` takes one
// parameter and `defaulted` takes two, so a count of one can only be an
// optional tail that stopped being counted.
//
// # What it cost, which nothing in the corpus was measuring
//
// **316 exported functions in the node profile take an optional or defaulted
// parameter** -- fs 143, stream 59, zlib 39 -- and among them are
// `net.createServer(options?, connectionListener?)` and
// `dgram.createSocket(type, listener?)`, the first and third most valuable
// exports on the board. Node's own dgram tests call `createSocket("udp4")`
// fourteen times and `createSocket()` three times.
//
// It was found by the first differential ever run against a compiled addon, and
// by nothing in node's own test files: those call each function the way their
// author wrote them, so `basename("/a/b.txt")` appears in none of the eleven
// `path` files that pass. A blocker with a fixture and no cost attached is easy
// to rank below its worth -- this one had been filed for hours as one boundary
// blocker among several.
//
// # A defaulted parameter is still required, deliberately
//
// `ParamShape::Defaulted`'s contract is that the initializer is evaluated by
// each caller that omits the argument: the lowering inlines it at every call
// site and the HIR does not carry the expression. A wrapper is a caller with
// nowhere to get it from, so passing a zero would invent a value the source
// never wrote. `defaulted` below is the control that says so.
//
// # Verified by calling it
//
// `path.basename` over seven paths and three argument lists, against
// `node:path`: 21 of 21 agree, including every one-argument call, through the
// top-level export and both namespaces.

export function required(only: string): string {
  return only;
}

export function withOptional(value: string, suffix?: string): string {
  return suffix === undefined ? value : value + suffix;
}

// Control. A defaulted parameter is not an optional one: the wrapper cannot
// evaluate the initializer, so this still requires both.
export function defaulted(value: string, suffix: string = "!"): string {
  return value + suffix;
}
