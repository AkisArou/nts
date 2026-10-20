// The `bytes` row's shape, reduced: one `const length` sizes a typed array
// and bounds the loops that fill and read it. The counter is a whole number
// in [0, length), and an integer when `length` only bounds the loop. When the
// same constant also sized the view, the counter was a double: `new
// Uint8Array(length)` checks `length` against -1 and 2^53, a comparison joined
// `length` to 2^53, which is no integer, and `i < length` joined the counter
// to `length`. Every read then paid an f64 bounds test and a truncation:
// 47% of the row on Wasm, counted (11,710,702 against 6,206,842 insn/op, node
// 5,487,253), found and reduced by the Wasm lane.
//
// `sized` is the bytes shape. `bounded` is the control: the same loop, where
// the constant's only use is the bound.
//
// expect-ir: all: block params in sized are integer
// expect-ir: all: block params in bounded are integer

export function sized(seed: number): number {
  const length = 4096;
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) data[i] = (i * seed) & 255;
  let a = 1;
  for (let i = 0; i < length; i++) a = (a + data[i]!) % 65521;
  return a;
}

export function bounded(seed: number): number {
  const data = new Uint8Array(4096);
  for (let i = 0; i < data.length; i++) data[i] = (i * seed) & 255;
  const length = 4096;
  let a = 1;
  for (let i = 0; i < length; i++) a = (a + data[i]!) % 65521;
  return a;
}
