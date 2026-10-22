// `indexOf` from a position: a 5-unit needle and a 1-unit one, searched for in
// a 4 KiB text from 256 starting points.
//
// The needle is planted about every 128 units and the comma about every 64,
// so each search scans a realistic run before it finds one: the shape of a
// tokenizer looking for its next delimiter, and of a scan for a keyword.
//
// Text and needle are drawn at module load from a linear congruential
// generator -- **the needle too**, since a literal needle lets a compiler
// specialise the search for it -- and `ref.cpp` draws the identical ones. The
// seed shifts the starting points. The checksum is the positions found.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function needle(state: number): string {
  let x = state;
  let out = "";
  for (let k = 0; k < 5; k++) {
    x = next(x);
    out += String.fromCharCode(97 + ((x >>> 24) % 26));
  }
  return out;
}

const NEEDLE = needle(47);
const COMMA = String.fromCharCode(44);

function text(state: number): string {
  let x = state;
  let out = "";
  while (out.length < 4096) {
    x = next(x);
    const r = x >>> 24;
    if (r < 2) out += NEEDLE;
    else if (r < 6) out += COMMA;
    else out += String.fromCharCode(97 + (r % 26));
  }
  return out;
}

const TEXT = text(53);

export function work(seed: number): number {
  const s = (seed | 0) & 4095;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    const start = (i * 16 + s) & 4095;
    total = (total + TEXT.indexOf(NEEDLE, start)) | 0;
    total = (total * 3 + TEXT.indexOf(COMMA, start)) | 0;
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
