// A table copied into a `number[]` in a program whose own `number[]` stores
// are all integers -- `dispatch`'s `run`, verbatim, whose array is
// `int32_t[]` when it is the whole program -- so element narrowing would choose integer storage for every
// `number[]` here, and integer facts for every read of one, were it not for
// the copies. A copy (`nts_map_keys_into`) writes the table's numbers without
// a store narrowing can see; it is a runtime call taking the array, so the
// type stays the language's: double storage, no facts from the stores alone.
// The fractions below would read wrong under either narrowing, and an
// integer array would be one the copy cannot fill. (The walk the copy
// replaced kept the same storage, from the doubles it stored.)

/** `dispatch`'s own `run`, verbatim: the array that narrows on its own. */
export function dispatched(seed: number): number {
  const length = 512;
  const program = new Array<number>(length);
  // Are We Fast Yet's own generator, and the multiplier matters: a product
  // above 2^53 is *rounded* before `| 0` in JavaScript and wraps exactly in
  // C++, so a larger one would make the two references different programs.
  // That is what `Math.imul` exists for, and the checksum gate caught it.
  let state = seed | 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1309 + 13849) & 65535;
    program[i] = state & 7;
  }

  let acc = 0;
  let count = 0;
  for (let round = 0; round < 64; round += 1) {
    for (let pc = 0; pc < length; pc += 1) {
      switch (program[pc]) {
        case 0:
          acc = (acc + 1) | 0;
          break;
        case 1:
          acc = (acc - 3) | 0;
          break;
        case 2:
          acc = (acc * 2) | 0;
          break;
        case 3:
          acc = acc ^ 0x5a5a;
          break;
        case 4:
          acc = (acc >> 1) | 0;
          break;
        // Falls through, which a jump table has to get right as much as a
        // chain of tests does.
        case 5:
          count = (count + 1) | 0;
        case 6:
          acc = (acc + count) | 0;
          break;
        default:
          acc = (acc | 1) | 0;
          break;
      }
    }
  }
  return (acc + count) | 0;
}

/** Fractions copied out, each read where a fraction and a whole number differ. */
export function fractions(n: number): number {
  const xs = Array.from(new Set([0.5, 1.5 + (n & 1)]));
  const half = xs[0] * 2;
  const floored = Math.floor(xs[1]) === xs[1] ? 1 : 0;
  const truncated = (xs[1] | 0) + xs[1];
  return half * 1000 + floored * 100 + truncated + (n & 3);
}

/** Whole numbers copied out, summed. */
export function summed(n: number): number {
  const xs = Array.from(new Set([1, 2, 3 + (n & 7)]));
  let total = 0;
  for (const x of xs) total = (total + x) | 0;
  return total + (n & 1);
}
