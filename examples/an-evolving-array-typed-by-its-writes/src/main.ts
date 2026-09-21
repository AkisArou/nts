// `const xs = []` filled by `push` or by index, and read only through
// `length`.
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
// # The fix asks the writes
//
// `pushed_element_type` settles from the **arguments** of the `push` calls,
// the one place the information exists in a program the checker gave up on.
// Every push must agree: two pushing different types is a union, and a dense
// array has one width.
//
// An **indexed** fill is the same question and had the same answer:
//
// ```text
// const xs = []; xs[0] = 7; xs[1] = 8; xs[1];       lowered
// const xs = []; xs[0] = 7; xs[1] = 8; xs.length;   refused
// ```
//
// `xs[0] = 7` says what the element is exactly as `xs.push(7)` does. That
// one is read off `dense_prefix_writes`, which already walks those writes to
// decide whether they are an in-order prefix --- **one walk, two answers**,
// rather than a second walk over the same assignments. Two walks deciding
// `is this an indexed write` is precisely how a third derivation of `which
// operators write` ended up inside that function; the commit before this one
// is what that cost.
//
// `growth_can_fill` applies to the indexed arm and not to the push arm,
// because those writes really do grow **by index** --- which is the
// distinction that whole function is about. So `xs[0] = "a"` on an evolving
// array still refuses where `xs.push("a")` lowers, and that is not an
// inconsistency: `nts_array_push_ref` appends a reference, and a growing
// indexed store has no slot to load and release.
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
//     rather than inventing a width. Indexed writes that disagree ---
//     `xs[0] = 7; xs[1] = "a"` --- leave the element unsettled for the same
//     reason, and note that this is *weaker* than the prefix check failing:
//     the writes are still a valid prefix whose element type nobody can name.
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

// Filled by **index** rather than by push, and read only through `length`.
const indexed = [];
indexed[0] = 7;
indexed[1] = 8;
const twoSlots = indexed.length;

export function filledByIndex(): number {
  return twoSlots;
}

const single = [];
single[0] = 42;
const oneSlot = single.length;

export function filledByOneIndex(): number {
  return oneSlot;
}

export function filledByIndexInAFunction(): number {
  const xs = [];
  xs[0] = 1;
  xs[1] = 2;
  xs[2] = 3;
  return xs.length;
}

// A compound assignment below the prefix is a read, so the prefix still stands
// and the element is still settled by the writes that created the slots.
export function compoundBelowThePrefix(): number {
  const xs = [];
  xs[0] = 1;
  xs[1] = 2;
  xs[0] += 4;
  return xs.length;
}
