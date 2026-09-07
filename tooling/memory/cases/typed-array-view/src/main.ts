// A view over a buffer, and a second view over the same buffer, in a loop.
//
// `examples/array-buffer` writes down what a *buffer* costs: two allocations,
// a struct and a separate block of bytes, because a view must not be
// invalidated by its buffer changing length. This case writes down what a
// **view** costs on top of that, which is the question `ManagedType::View`
// raised and did not answer.
//
// The answer had better be one allocation each and nothing per element. A view
// is a window -- an offset, a length, a kind and a pointer to the buffer it
// borrows -- so a second view over one buffer must not copy the bytes it can
// already see. A lowering that copied would still give every right answer this
// program computes, and would be caught here and nowhere else in this
// directory: `examples/typed-array-aliasing` catches it by *answer*, and this
// catches it by *cost*, which is the half that survives a correct copy.
//
// The `subarray` is the third view and the interesting one. It is a window on
// a window, and it must reach the same buffer rather than the view it was cut
// from -- one allocation, not one plus a retained chain.
export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    const buffer = new ArrayBuffer(64);
    const bytes = new Uint8Array(buffer);
    const words = new Uint32Array(buffer);
    const window = bytes.subarray(8, 24);
    bytes[0] = i;
    total = (total + words[0]! + window.length) | 0;
  }
  return total;
}
