/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../cases/LICENSE-benchmarks-game for the licence notice and conditions.
 * Naive transliteration from Drake Diedrich's C program;
 * contributed by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fasta-node-8.html
 */

// The source's character-at-a-time loops, explicit line buffers, probabilities
// and random arithmetic are unchanged. Writes append to an in-memory string.
// Each invocation starts a fresh input file, with the source's initial seed.
const IM = 139968;
const IA = 3877;
const IC = 29573;
const SEED = 42;
let randomSeed = SEED;

function fastaRand(max: number): number {
  randomSeed = (randomSeed * IA + IC) % IM;
  return max * randomSeed / IM;
}

const ALU =
  "GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCACTTTGG" +
  "GAGGCCGAGGCGGGCGGATCACCTGAGGTCAGGAGTTCGAGA" +
  "CCAGCCTGGCCAACATGGTGAAACCCCGTCTCTACTAAAAAT" +
  "ACAAAAATTAGCCGGGCGTGGTGGCGCGCGCCTGTAATCCCA" +
  "GCTACTCGGGAGGCTGAGGCAGGAGAATCGCTTGAACCCGGG" +
  "AGGCGGAGGTTGCAGTGAGCCGAGATCGCGCCACTGCACTCC" +
  "AGCCTGGGCGACAGAGCGAGACTCCGTCTCAAAAA";

const iub = "acgtBDHKMNRSVWY";
const iubP: number[] = [
  0.27, 0.12, 0.12, 0.27,
  0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02,
];
const homosapiens = "acgt";
const homosapiensP: number[] = [
  0.3029549426680,
  0.1979883004921,
  0.1975473066391,
  0.3015094502008,
];
const LINELEN = 60;

function repeatFasta(seq: string, n: number): string {
  const len = seq.length;
  let i: number;
  let b = "";
  let output = "";
  for (i = 0; i < n; i++) {
    b += seq[i % len];
    if (i % LINELEN === LINELEN - 1) {
      b += "\n";
      output += b;
      b = "";
    }
  }
  if (i % LINELEN !== 0) {
    b += "\n";
    output += b;
  }
  return output;
}

function randomFasta(seq: string, probability: number[], n: number): string {
  const len = seq.length;
  let i: number;
  let j: number;
  let b = "";
  let output = "";
  for (i = 0; i < n; i++) {
    let v = fastaRand(1.0);
    for (j = 0; j < len - 1; j++) {
      v -= probability[j];
      if (v < 0) break;
    }
    b += seq[j];
    if (i % LINELEN === LINELEN - 1) {
      b += "\n";
      output += b;
      b = "";
    }
  }
  if (i % LINELEN !== 0) {
    b += "\n";
    output += b;
  }
  return output;
}

export function renderFasta(n: number): string {
  randomSeed = SEED;
  let output = ">ONE Homo sapiens alu\n";
  output += repeatFasta(ALU, n * 2);
  output += ">TWO IUB ambiguity codes\n";
  output += randomFasta(iub, iubP, n * 3);
  output += ">THREE Homo sapiens frequency\n";
  output += randomFasta(homosapiens, homosapiensP, n * 5);
  return output;
}
