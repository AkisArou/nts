// `const xs = []` filled by `push` and read only through `length`.
//
// The **read** used to decide whether the declaration lowered, which is not a
// property of the declaration at all:
//
//     const xs = []; xs.push(7); xs[0];         lowered
//     const xs = []; xs.push(7); xs.length;     refused
//     const xs = []; xs.push(7); xs.join(",");  lowered
//
// Same declaration, same write, three outcomes decided by the expression that
// reads the result.
//
// # Why, measured rather than inferred
//
// `evolved_type` walks every node carrying the name's symbol and takes the
// checker's type at each. Printing what it saw for the two spellings:
//
// ```text
//   xs[0]      node=116 parent=PROPERTY_ACCESS  ty=None   (the push receiver)
//              node=127 parent=ELEMENT_ACCESS   ty=Some(Array(f64))
//
//   xs.length  node=116 parent=PROPERTY_ACCESS  ty=None
//              node=127 parent=PROPERTY_ACCESS  ty=None
// ```
//
// So it was not an unsettled `never[]` vetoing a settled sibling --- the case
// `is_an_unsettled_array` exists for. There was **no type at any reference**,
// and nothing to settle from. The refusal named it: *an array of **any***,
// which is TypeScript's evolving array working as specified. `const xs = []`
// stays `any[]` until a reference forces the element type, `.length` never
// forces it --- `length` is on the array whatever it holds --- and neither does
// the receiver of the `push` that supplies the type, which is why a second
// push did not help either.
//
// # The fix asks the arguments
//
// `pushed_element_type` settles from the **arguments** of the `push` calls,
// the one place the information exists in a program the checker gave up on.
// Every push must agree: two pushing different types is a union, and a dense
// array has one width.
//
// # The arms that must keep refusing, and are not written here
//
// An example arm that disagrees with node is a known failure rather than a
// fixture, so these live in `tooling/conformance/blockers` instead:
//
//   * **push mixed with an indexed write** --- `xs.push(7); xs[1] = 8` --- stays
//     conservative, which `dense_prefix_writes` returning `Some(0)` is the
//     guard for. `written_as_a_dense_prefix` had always said so in its own
//     words: a name with no indexed writes at all passes because push appends
//     by definition, and anything mixed keeps the refusal it had.
//   * **pushes of disagreeing types** --- `xs.push(7); xs.push("a")` --- refuses
//     rather than inventing a width.
//
// Found by `tooling/conformance/fuzz-statements.mjs` on its first productive
// run, whose refusal map is keyed by the generating *shape* rather than by the
// message: `4 push:` and `9 pushThenIndex:` sat beside `9 fillSparse:`, which
// is correctly refused by design. Two of those three rows were a gap and one
// was the design; keyed by the message all three read as one row of 22.

const numbers = [];
numbers.push(7);
const oneNumber = numbers.length;

const several = [];
several.push(1);
several.push(2);
several.push(3);
const threeNumbers = several.length;

const words = [];
words.push("a");
words.push("bc");
const twoWords = words.length;

export function pushedOnce(): number {
  return oneNumber;
}

export function pushedThrice(): number {
  return threeNumbers;
}

export function pushedStrings(): number {
  return twoWords;
}

// The same in a function body, which is decided by different code and is the
// pairing that found the defect next door.
export function inAFunction(): number {
  const xs = [];
  xs.push(4);
  xs.push(5);
  return xs.length;
}

// Filled in a loop, which is how `examples/growable` writes it, and read only
// through `length`.
export function filledInALoop(n: number): number {
  const xs = [];
  for (let i = 0; i < 3 + (n - n); i++) {
    xs.push(i);
  }
  return xs.length;
}

// A push whose argument is a string expression rather than a literal: the
// argument's *type* is what settles the element, not its syntax.
export function builtStrings(n: number): number {
  const parts = [];
  for (let i = 0; i < 2 + (n - n); i++) {
    parts.push("p" + String(i));
  }
  return parts.length;
}
