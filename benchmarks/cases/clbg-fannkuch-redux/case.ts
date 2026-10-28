/*
 * The Computer Language Benchmarks Game -- BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Naive transliteration from Rex Kerr's Scala program
 * contributed by Isaac Gouy
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fannkuchredux-node-8.html
 */

// The single-threaded Node.js #8 program. The source's implicit globals are
// local typed variables, so each harness call starts the original computation
// afresh. The two console writes become the returned output string.
export function render(n: number): string {
  const perm1: number[] = [n];
  for (let i = 0; i < n; i++) perm1[i] = i;
  const perm: number[] = [n];
  const count: number[] = [n];
  let f = 0, flips = 0, nperm = 0, checksum = 0;
  let i: number, k: number, r: number;

  r = n;
  while (r > 0) {
    i = 0;
    while (r != 1) { count[r - 1] = r; r -= 1; }
    while (i < n) { perm[i] = perm1[i]; i += 1; }

    // Count flips and update max and checksum.
    f = 0;
    k = perm[0];
    while (k != 0) {
      i = 0;
      while (2 * i < k) {
        const t = perm[i]; perm[i] = perm[k - i]; perm[k - i] = t;
        i += 1;
      }
      k = perm[0];
      f += 1;
    }
    if (f > flips) flips = f;
    if ((nperm & 0x1) == 0) checksum += f; else checksum -= f;

    // Use incremental change to generate another permutation.
    let more = true;
    while (more) {
      if (r == n) {
        return `${checksum}\nPfannkuchen(${n}) = ${flips}\n`;
      }
      const p0 = perm1[0];
      i = 0;
      while (i < r) {
        const j = i + 1;
        perm1[i] = perm1[j];
        i = j;
      }
      perm1[r] = p0;

      count[r] -= 1;
      if (count[r] > 0) more = false; else r += 1;
    }
    nperm += 1;
  }
  return `Pfannkuchen(${n}) = ${flips}\n`;
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; i++) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// The driver passes this input opaquely (argv in Node, volatile in the native
// and JVM drivers), so the optimizer cannot hoist work out of its timed loop.
export const seed = 8;
