/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * Naive transliteration from bearophile's program;
 * contributed by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/knucleotide-node-8.html
 */

import { renderFasta } from "../../common/clbg-fasta.ts";

// The source's line reader now consumes the same FASTA generated in memory.
// Substring keys, Map counts, sorting and arithmetic remain the source's.
// Its accidental undeclared variables are local declarations under strict TS.
function seqLines(input: string): string[] {
  const sourceLines = input.split("\n");
  sourceLines.pop(); // FASTA ends in LF; readline does not yield an extra line.
  const lines: string[] = [];
  let started = false;
  for (const line of sourceLines) {
    if (started) {
      if (line.startsWith(">")) break;
      lines.push(line);
    } else {
      started = line.startsWith(">THREE");
    }
  }
  return lines;
}

function baseCounts(bases: number, seq: string): Map<string, number> {
  const counts = new Map<string, number>();
  const size = seq.length + 1 - bases;
  for (let i = 0; i < size; i++) {
    const nucleo = seq.substring(i, i + bases);
    const v = counts.get(nucleo);
    if (v) counts.set(nucleo, v + 1);
    else counts.set(nucleo, 1);
  }
  return counts;
}

function sortedFreq(bases: number, seq: string): [string, number][] {
  const size = seq.length + 1 - bases;
  const counts = baseCounts(bases, seq);
  return Array.from(counts)
    .sort((a, b) => b[1] - a[1])
    .map((a): [string, number] => [a[0], 100.0 * a[1] / size]);
}

function specificCount(code: string, seq: string): number {
  const counts = baseCounts(code.length, seq);
  return counts.get(code) ? counts.get(code)! : 0;
}

export function render(n: number): string {
  const seq = seqLines(renderFasta(n)).map((s) => s.toUpperCase()).join("");
  let output = "";
  for (const base of [1, 2]) {
    sortedFreq(base, seq).forEach((a) => {
      output += `${a[0]} ${a[1].toFixed(3)}\n`;
    });
    output += "\n";
  }
  for (const code of ["GGT", "GGTA", "GGTATT", "GGTATTTTAATT", "GGTATTTTAATTTATAGT"]) {
    output += `${specificCount(code, seq)}\t${code}\n`;
  }
  return output;
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; i++) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// All harness drivers take the input opaquely; work never substitutes a
// constant that would let a compiler fold or hoist the workload.
export const seed = 1000;
