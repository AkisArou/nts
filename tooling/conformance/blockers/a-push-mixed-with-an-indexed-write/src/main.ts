// expect: NTS1001 a module-scope variable of unrepresentable type (an array of any)
//
// `xs.push(7); xs[1] = 8` on an evolving array: filled *both* ways.
//
// `dense_prefix_writes` reports how many indexed writes form an in-order
// prefix from slot 0. A push does not advance that count -- it appends at
// whatever the length is, which this walk cannot see -- so the write at index 1
// is not the slot-0 it expects and the name is rejected.
//
// **Conservative on purpose**, and `written_as_a_dense_prefix` said so in its
// own words before it was renamed: a name with no indexed writes at all passes,
// because push appends by definition, and anything mixed keeps the refusal it
// had. Settling the type here would let a *growing* indexed write reach an
// array whose length the analysis does not know, and growth is by one --
// `xs[5] = v` on a length-1 array wants four holes, and a hole is
// `undefined`.
//
// The sibling guard `an-evolving-array-read-only-through-length` is the shape
// that *does* lower: push alone, with `dense_prefix_writes` answering
// `Some(0)`.

const xs = [];
xs.push(7);
xs[1] = 8;
export const count: number = xs.length;
