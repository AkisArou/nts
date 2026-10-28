/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Ian Osgood; modified for Node.js by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/spectralnorm-node-1.html
 */

// The single-threaded program's ordinary arrays, four matrix functions,
// loop nesting, division, and accumulation order are unchanged.
function A(i: number, j: number): number {
  return 1 / ((i + j) * (i + j + 1) / 2 + i + 1);
}

function Au(u: number[], v: number[]): void {
  for (let i = 0; i < u.length; ++i) {
    let t = 0;
    for (let j = 0; j < u.length; ++j) {
      t += A(i, j) * u[j];
    }
    v[i] = t;
  }
}

function Atu(u: number[], v: number[]): void {
  for (let i = 0; i < u.length; ++i) {
    let t = 0;
    for (let j = 0; j < u.length; ++j) {
      t += A(j, i) * u[j];
    }
    v[i] = t;
  }
}

function AtAu(u: number[], v: number[], w: number[]): void {
  Au(u, w);
  Atu(w, v);
}

function spectralnorm(n: number): number {
  const u: number[] = [], v: number[] = [], w: number[] = [];
  let vv = 0, vBv = 0;
  for (let i = 0; i < n; ++i) {
    u[i] = 1;
    v[i] = w[i] = 0;
  }
  for (let i = 0; i < 10; ++i) {
    AtAu(u, v, w);
    AtAu(v, u, w);
  }
  for (let i = 0; i < n; ++i) {
    vBv += u[i] * v[i];
    vv += v[i] * v[i];
  }
  return Math.sqrt(vBv / vv);
}

export function render(n: number): string {
  return spectralnorm(n).toFixed(9) + "\n";
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; ++i) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Passed by the harness as an opaque input, never captured by work.
export const seed = 128;
