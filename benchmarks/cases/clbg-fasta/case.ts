/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * Naive transliteration from Drake Diedrich's C program;
 * contributed by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fasta-node-8.html
 */

import { renderFasta } from "../../common/clbg-fasta.ts";

// The generator is shared with the cases whose upstream input is a FASTA file.
// It retains the source's algorithm and returns its complete stdout in memory.
export function render(n: number): string {
  return renderFasta(n);
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; i++) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// The harness makes this argument opaque in every lane; keeping it in the
// exported entry point prevents constant folding or loop-invariant hoisting.
export const seed = 10000;
