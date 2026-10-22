// UTF-8 encoding: `new TextEncoder().encode(s)` over 64 strings, a quarter each
// ASCII, ASCII with Latin-1, ASCII with CJK, and ASCII with characters above
// the BMP, and every byte produced summed.
//
// `encode` is how a program writes it, and it makes a fresh `Uint8Array` per
// string. The four kinds take the encoder's one-, two-, three- and four-byte
// arms; the last are surrogate pairs in UTF-16. No string holds a lone
// surrogate, which every encoder replaces but not all with the same bytes.
//
// The strings are drawn at module load from a linear congruential generator,
// so nothing folds, and `ref.cpp` draws the identical ones. The seed rotates
// the order, which the checksum carries.
function next(x: number): number {
  return (Math.imul(x, 1664525) + 1013904223) | 0;
}

function texts(count: number, state: number): string[] {
  let x = state;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const kind = i & 3;
    x = next(x);
    const length = 16 + ((x >>> 24) % 33);
    let text = "";
    for (let k = 0; k < length; k++) {
      x = next(x);
      const r = x >>> 24;
      if (kind === 0 || r >= 64) text += String.fromCharCode(97 + (r % 26));
      else if (kind === 1) text += String.fromCharCode(0xe0 + (r % 32));
      else if (kind === 2) text += String.fromCharCode(0x4e00 + r * 37);
      else text += String.fromCodePoint(0x1f600 + r);
    }
    out.push(text);
  }
  return out;
}

const TEXTS = texts(64, 73);

export function work(seed: number): number {
  const s = (seed | 0) & 63;
  const encoder = new TextEncoder();
  let total = 0;
  for (let i = 0; i < 64; i++) {
    const bytes = encoder.encode(TEXTS[(i + s) & 63]!);
    let sum = bytes.length;
    for (let k = 0; k < bytes.length; k++) {
      sum = (sum + bytes[k]!) | 0;
    }
    total = (total * 31 + sum) | 0;
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
