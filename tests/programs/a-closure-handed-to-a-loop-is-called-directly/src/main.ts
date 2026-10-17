// A closure handed to a function is called directly in the copy made for it.
//
// Monomorphizing `drive` for the one closure class it receives types the
// parameter as that class, and a closure class is final, so which body a call
// through the parameter reaches is known. The copy redirected a call made
// through the closure's uniform entry and left one made through its written
// entry -- the slot a call typed against the signature uses -- on the table:
// 4,096 indirect calls a run in `benchmarks/cases/closures`, which clang can
// neither inline nor vectorize through.
//
// The control is the same closure called where it is made, which lowering
// already makes direct.
//
// expect-ir: all: no call.closure in drive
// expect-ir: all: no call.closure in local

function drive(f: (x: number) => number, times: number): number {
  let total = 0;
  for (let i = 0; i < times; i++) {
    total = (total ^ f(i)) | 0;
  }
  return total;
}

function local(step: number, times: number): number {
  const mix = (x: number): number => (((x * 31) ^ (x >>> 2)) + step) | 0;
  let total = 0;
  for (let i = 0; i < times; i++) {
    total = (total ^ mix(i)) | 0;
  }
  return total;
}

export function handed(step: number, times: number): number {
  const count = times & 255;
  const mix = (x: number): number => (((x * 31) ^ (x >>> 2)) + step) | 0;
  return (drive(mix, count) + local(step, count)) | 0;
}

console.log(handed(5, 100), handed(-3, 7), handed(0, 0));
