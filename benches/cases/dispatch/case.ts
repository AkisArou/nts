// Dispatch: a bytecode interpreter's inner loop.
//
// This is what a `switch` is *for*, and the one shape where the difference
// between a jump table and a chain of comparisons is the whole program. A
// tokenizer, a regular-expression engine, a state machine and a virtual machine
// are all this loop.
//
// Eight opcodes in a repeating pattern chosen so no branch predictor gets it for
// free and so every arm is reached. The program depends on `seed`, so none of it
// folds away at compile time.
export function run(seed: number): number {
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

/**
 * The input the harness calls `run` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 7;
