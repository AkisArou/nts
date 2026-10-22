// Reading characters: `s.charCodeAt(i)` and `s[i] === "x"` over a 4 KiB
// string built at run time.
//
// `strings` reads a 43-unit literal; this reads a string nothing could know at
// compile time, so its length is not a constant and the loop bound and every
// index come from the value itself. `s[i]` makes a one-unit string and
// compares it, which is how a great deal of TypeScript tests a character.
//
// The text is drawn at module load from a linear congruential generator, and
// `ref.cpp` draws the identical text. ASCII, so one `char` is one code unit.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function letters(count: number, state: number): string {
  let x = state;
  let out = "";
  for (let i = 0; i < count; i++) {
    x = next(x);
    out += String.fromCharCode(97 + ((x >>> 24) % 26));
  }
  return out;
}

const TEXT = letters(4096, 17);

export function work(seed: number): number {
  const step = seed | 0;
  let total = 0;
  for (let i = 0; i < TEXT.length; i++) {
    total = (total + TEXT.charCodeAt(i) * step) | 0;
    if (TEXT[i] === "x") {
      total = (total + i) | 0;
    }
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
