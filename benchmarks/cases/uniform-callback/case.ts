// Two callback classes, reached through a signature wider than either body.
// The any[] element remains erased, so the loop cannot bypass the uniform
// entry's admission test. Supplied numbers keep the before/after checksum
// equal; the default row prices the entry's undefined branch without asking
// the old compiler to time its known wrong answer on omitted arguments.
export function work(seed: number): number {
  const values: any[] = [seed, seed + 1];
  const listeners: ((value: any) => number)[] = [
    (value: number): number => value + 3,
    (value: number): number => value - 3,
  ];
  let total = 0;
  for (let i = 0; i < 1024; i++) {
    const callback = listeners[i & 1];
    total += callback(values[i & 1]);
  }
  return total;
}
export const seed = 5;

// expect-ir: all: count call.closure in work#whole == 1
// expect-ir: all: count tagof in Closure0#erased_call == 1
// expect-ir: all: count tagof in Closure1#erased_call == 1
