/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Denis Gribov; based on C by Ledhug; un-buffered by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/pidigits-node-3.html
 */

// Native arbitrary-precision bigint is intentional: nts refusing it is useful.
// This preserves both extract(3) and extract(4), the divisions, and every update.
// Only stdout is collected in memory; pad uses the number of digits actually
// emitted so a final line beginning with zero keeps that zero (e.g. n = 60).
function pad(i: number, digitsInLine: number): string {
  let res = i.toString();
  let count = digitsInLine - res.length;
  while (count > 0) {
    res = "0" + res;
    count--;
  }
  count = 10 - digitsInLine;
  while (count > 0) {
    res += " ";
    count--;
  }
  return res;
}

export function render(n: number): string {
  let output = "";
  let i = 0, ns = 0;
  let k = 0;
  let k2 = 1;
  let acc = 0n;
  let den = 1n;
  let num = 1n;
  let tmp = 0n;
  let d3 = 0n;
  let d4 = 0n;

  while (i < n) {
    k++;
    k2 += 2;

    acc += num * 2n;
    acc *= BigInt(k2);
    den *= BigInt(k2);
    num *= BigInt(k);

    if (num > acc) {
      continue;
    }

    tmp = num * 3n;
    tmp = tmp + acc;
    d3 = tmp / den;

    tmp = tmp + num;
    d4 = tmp / den;

    if (d3 !== d4) {
      continue;
    }

    const d = Number(d3);
    ns = ns * 10 + d;
    i++;
    const last = i >= n;
    if (i % 10 === 0 || last) {
      output += pad(ns, i % 10 === 0 ? 10 : i % 10) + "\t:" + i + "\n";
      ns = 0;
    }

    if (last) break;

    acc -= den * BigInt(d);
    acc *= 10n;
    num *= 10n;
  }
  return output;
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; ++i) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// The harness passes the digit count through an opaque input.
export const seed = 500;
