// A callback taking the index.
//
// One walk over one local array, and the shape of the case took three tries
// because each earlier one measured something other than the callback:
//
//   - a *grown* array of objects: `push` reallocates and takes a reference to
//     what it stores, so 22 allocations and 53 operations were the array's;
//   - a module-scope `const` array: a managed global is a slot the reader
//     borrows from, so every read took a reference — 375 operations;
//   - the walk inside an outer `for` loop: `total` is then assigned inside a
//     callback nested in a loop, which boxes it into a cell, and every
//     iteration retains the box — 342 operations.
//
// What is left measures the walk. The elements are numbers, so a read produces
// a double and there is no reference to take; the index is the loop's own
// counter, which exists for the bounds test and the increment whether or not
// the callback names it.

export function work(n: number): number {
  const values = [n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7];
  // `reduce` rather than `forEach`, and that is the fourth thing this case had
  // to change. A `forEach` that assigns an outer local boxes it into a *cell* —
  // `v40->value` in the emitted C — even though the callback is inlined into
  // the same function and the assignment could be loop-carried. That is a real
  // cost and a pre-existing one, and it is not the index's: `reduce`'s
  // accumulator is loop-carried by construction, which is what keeps it free of
  // an allocation, so it leaves only the walk to measure.
  return values.reduce((sum, value, at) => sum + value * at, 0);
}
