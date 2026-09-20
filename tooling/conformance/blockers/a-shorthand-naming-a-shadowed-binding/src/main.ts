// Two locals of one name in scope, with `({ v } = src)` naming it.
//
// `({ x } = p)` resolves its variable by **name**, because the symbol the
// checker puts on the node is the property's and
// `getShorthandAssignmentValueSymbol` is not in the snapshot. That lookup is
// sound exactly while the name is unambiguous --- and here it is not: two
// blocks each declare `v`, both are in `bindings`, and nothing in the name
// distinguishes them.
//
// Refused rather than guessed. Picking either one compiles and is a coin toss,
// and the failure it buys is the one the whole feature exists to avoid: a store
// that lands somewhere nothing reads, with the variable silently keeping its
// old value.
//
// The explicit spelling `({ v: v } = src)` carries the variable's own symbol on
// its own node and works today. So does the ordinary case, where one binding of
// the name is in scope --- `examples/a-shorthand-in-an-assignment-pattern`.
//
// Lifting this is one frontend request rather than a design: the checker knows
// the answer, and the snapshot would have to carry
// `getShorthandAssignmentValueSymbol` for the node.

export function twoBlocksOneName(): number {
  let total = 0;
  {
    let v = 1;
    ({ v } = { v: 3 });
    total += v;
  }
  {
    let v = 2;
    ({ v } = { v: 4 });
    total += v;
  }
  return total;
}
