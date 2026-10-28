/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * regex-dna program contributed by Jesse Millikan
 * Base on the Ruby version by jose fco. gonzalez
 * fixed by Matthew Wilson
 * ported to Node.js and sped up by Roman Pletnev
 * converted from regex-dna program
 * fixed by Josh Goldfoot
 * multi thread by Andrey Filatkin
 * sequential by Isaac Gouy
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/regexredux-node-4.html
 */

import { renderFasta } from "../../common/clbg-fasta.ts";

// The published sequential Node #4 program. Only stdin/stdout are replaced:
// the input is generated here and every output line is collected in memory.
// Keep the literal RegExp objects and the original match/replace operations.
// An nts refusal on RegExp is an intended finding, not a reason to change them.
export function render(n: number): string {
  const regExps: RegExp[] = [
    /agggtaaa|tttaccct/ig,
    /[cgt]gggtaaa|tttaccc[acg]/ig,
    /a[act]ggtaaa|tttacc[agt]t/ig,
    /ag[act]gtaaa|tttac[agt]ct/ig,
    /agg[act]taaa|ttta[agt]cct/ig,
    /aggg[acg]aaa|ttt[cgt]ccct/ig,
    /agggt[cgt]aa|tt[acg]accct/ig,
    /agggta[cgt]a|t[acg]taccct/ig,
    /agggtaa[cgt]|[acg]ttaccct/ig,
  ];
  let data = renderFasta(n);
  const initialLen = data.length;
  data = data.replace(/^>.*\n|\n/mg, "");
  const cleanedLen = data.length;
  let output = "";
  for (let j = 0; j < regExps.length; j++) {
    const re = regExps[j];
    const m = data.match(re);
    output += `${re.source} ${m ? m.length : 0}\n`;
  }
  const endLen = data
    .replace(/tHa[Nt]/g, "<4>")
    .replace(/aND|caN|Ha[DS]|WaS/g, "<3>")
    .replace(/a[NSt]|BY/g, "<2>")
    .replace(/<[^>]*>/g, "|")
    .replace(/\|[^|][^|]*\|/g, "-")
    .length;
  output += `\n${initialLen}\n${cleanedLen}\n${endLen}\n`;
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

// Every driver passes this input opaquely. The kernel uses its argument so a
// native compiler cannot fold the workload or hoist it out of the timed loop.
export const seed = 4000;
