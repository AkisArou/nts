// A rest parameter whose type is a **fixed-length tuple** is not variadic at
// all. `(...args: [number]) => number` is the same type as `(a: number) =>
// number` -- which is why TypeScript accepts a plain arrow on either side of
// that assignment -- and this compiler now lowers it the same way too: one
// parameter per position, no array, no allocation.
//
// Three places decide a signature's arity, and before this they did not agree.
// The call site expanded the tuple, a closure's synthesised `call` had expanded
// it since it was written, and only the *declaration* still built an array. A
// parameter-list mismatch is not a diagnostic, so what came out was invalid HIR
// reported against the callee rather than a refusal against the construct.
//
// # What each function here would catch
//
// `throughACallbackType` is the shape that was invalid HIR with no generics
// anywhere: a closure behind a fixed-arity rest type.
//
// `countsByArity` is the one that needs saying. A generic rest's copy is named
// after the *representation* of what its type parameter bound to, and `[number]`
// and `[number, number]` both represent as an array of `f64` -- so both spelled
// `[f64]` and **three arities shared one copy**. That was harmless while the
// parameter was an array, because the array carried its own length, and it
// becomes a miscompile the moment the declaration is positional. The copy's name
// carries the arity now; this function is what says so. It answers 123, and a
// collision makes it answer 111, 222 or 333 depending which copy won.
//
// `spreadOfATuple` is the caller's half: `add(...args)` where `args` has a known
// arity is exactly that many arguments. It refused before -- `a spread element`
// -- which is `blockers/a-spread-into-a-call`.
//
// `forwardedToItsCallback` is `nextTick`'s shape, a generic rest handed to a
// callback that spreads it. It needed all three of the above at once.
//
// # The controls are the point of the file
//
// `variadicStaysAnArray` and `variadicIsNotFixed` are genuinely variable-arity.
// Their count is not known until the call, so they must go on being one array
// parameter, and a change that made *every* rest positional would answer wrong
// here rather than merely being slower.

/** Under test: a fixed-arity rest as a callback *type*. */
type OneArg = (...args: [number]) => number;

export function throughACallbackType(n: number): number {
  const f: OneArg = (k: number): number => k + 1;
  return f(n & 3);
}

/** Under test: heterogeneous positions, so the arity cannot come from the element. */
function label(...given: [number, string]): number {
  return given[0] + given[1].length;
}

export function heterogeneousPositions(n: number): number {
  return label(n & 7, "abcd");
}

/**
 * Under test: one generic rest at three arities. Three copies, not one.
 *
 * Every instantiation here represents as an array of `f64`, so the copy name
 * has nothing but the arity to tell them apart.
 */
function pack<A extends unknown[]>(...args: A): number {
  return args.length;
}

export function countsByArity(n: number): number {
  return pack(n) * 100 + pack(n, n) * 10 + pack(n, n, n);
}

/** Under test: spreading a tuple into a call that takes ordinary parameters. */
export function spreadOfATuple(n: number): number {
  const add = (a: number, b: number): number => a * 10 + b;
  const args: [number, number] = [n & 3, 7];
  return add(...args);
}

/** Under test: `nextTick`'s shape -- a generic rest forwarded to its callback. */
function tick<A extends unknown[]>(cb: (...args: A) => void, ...args: A): void {
  cb(...args);
}

export function forwardedToItsCallback(n: number): number {
  let seen = 0;
  tick(() => {
    seen += 1;
  });
  tick((a: number) => {
    seen += a * 10;
  }, n & 3);
  tick((a: number, b: number) => {
    seen += a * 100 + b * 1000;
  }, n & 1, 2);
  return seen;
}

/** Control: genuinely variadic. The count is not known until the call. */
function total(...args: number[]): number {
  let sum = 0;
  for (let i = 0; i < args.length; i++) sum += args[i]!;
  return sum;
}

export function variadicStaysAnArray(n: number): number {
  return total(n, 2, 3) * 10 + total();
}

/** Control: the same function at two different call arities. One copy, one array. */
export function variadicIsNotFixed(n: number): number {
  return total(n) * 100 + total(n, n) * 10 + total(n, n, n);
}

// # Positions that do not agree, which is where this first went wrong
//
// A tuple whose positions represent differently is an array of `Erased` --
// record 0285 -- so reading a position out to fill an argument must read at the
// **array's** element type and unerase afterwards, not at the type the position
// declares. Typing the read at the position instead claims a concrete object
// came out of an erased slot, and the verifier says exactly that:
//
//     StoreType { func: "defaultTriggerAsyncIdScope<[obj10042]x2,void>",
//                 what: "an array element read",
//                 expected: Erased, found: Managed(Object(TypeId(10042))) }
//
// **Five addons stopped building on it and nothing here noticed.** The corpus,
// the examples and the blockers all passed; `dgram`, `fs`, `http`, `net` and
// `process` did not, because none of the first three exercises a generic rest
// whose instantiation is heterogeneous. These two functions are that shape, so
// the next version of this mistake fails here instead of four steps later.

class Tagged {
  id: number;
  constructor(id: number) {
    this.id = id;
    }
}

class Named {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

function withBoth<A extends unknown[]>(cb: (...args: A) => number, ...args: A): number {
  return cb(...args);
}

/** Under test: two positions of different object types, so the element erases. */
export function heterogeneousForward(n: number): number {
  return withBoth(
    (a: Tagged, b: Named): number => a.id * 100 + b.label.length,
    new Tagged(n & 3),
    new Named("abc"),
  );
}

/** Under test: an object and a number, mixing a reference with a scalar. */
export function mixedForward(n: number): number {
  return withBoth(
    (a: Tagged, b: number): number => a.id * 10 + b,
    new Tagged(n & 3),
    7,
  );
}
