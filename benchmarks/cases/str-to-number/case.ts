// `Number(s)`: 256 run-time strings parsed, half integers and half decimals
// with exponents, and the values summed.
//
// Integers are what most text holds (counts, ids, ports) and the decimals are
// the full grammar: a sign, a fraction, `e` or `E`, and a signed exponent.
// Every value is correctly rounded on every side, so the sum, taken in one
// order, is the same sixty-four bits everywhere.
//
// The texts are drawn at module load from a linear congruential generator, so
// nothing folds, and `ref.cpp` draws the identical ones. The seed rotates the
// order they are summed in, which the bits of the sum carry.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function numbers(count: number, state: number): string[] {
  let x = state;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    x = next(x);
    let text = ((x >>> 24) & 3) === 0 ? "-" : "";
    const decimal = (i & 1) === 1;
    x = next(x);
    const whole = decimal ? 1 + ((x >>> 24) % 4) : 1 + ((x >>> 24) % 7);
    for (let k = 0; k < whole; k++) {
      x = next(x);
      // No leading zero, so the integers read the same in every grammar.
      const digit = k === 0 ? 1 + ((x >>> 24) % 9) : (x >>> 24) % 10;
      text += String.fromCharCode(48 + digit);
    }
    if (decimal) {
      text += ".";
      x = next(x);
      const fraction = 1 + ((x >>> 24) % 6);
      for (let k = 0; k < fraction; k++) {
        x = next(x);
        text += String.fromCharCode(48 + ((x >>> 24) % 10));
      }
      x = next(x);
      text += ((x >>> 24) & 1) === 0 ? "e" : "E";
      x = next(x);
      text += ((x >>> 24) & 1) === 0 ? "-" : "+";
      x = next(x);
      text += String((x >>> 24) % 21);
    }
    out.push(text);
  }
  return out;
}

const TEXTS = numbers(256, 67);

export function work(seed: number): number {
  const s = (seed | 0) & 255;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    total += Number(TEXTS[(i + s) & 255]!);
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
