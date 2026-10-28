/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Greg Buchholz's simple C #2 program transliterated by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/mandelbrot-node-1.html
 */

// The single-threaded program, with types and stdout collected in memory.
// Each code unit of render's result is one PBM byte, including NUL and 0xff.
// Keep the original one-byte typed array and its truncating shift arithmetic.
export function render(n: number): string {
  let bit = 0;
  const byte = new Uint8Array(1);
  const iter = 50, limit = 2.0;
  let zr: number, zi: number, cr: number, ci: number, tr: number, ti: number;
  const h = n, w = h;
  let output = `P4\n${w} ${h}\n`;
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      zr = zi = tr = ti = 0;
      cr = 2 * x / w - 1.5;
      ci = 2 * y / h - 1;
      for (let i = 0; i < iter && (tr + ti <= limit * limit); ++i) {
        zi = 2 * zr * zi + ci;
        zr = tr - ti + cr;
        tr = zr * zr;
        ti = zi * zi;
      }

      byte[0] <<= 1;
      if (tr + ti <= limit * limit) byte[0] |= 0x01;
      ++bit;

      if (bit === 8) {
        output += String.fromCharCode(byte[0]);
        byte[0] = 0;
        bit = 0;
      } else if (x === w - 1) {
        byte[0] <<= 8 - w % 8;
        output += String.fromCharCode(byte[0]);
        byte[0] = 0;
        bit = 0;
      }
    }
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

// The harness passes this through an opaque input; work never closes over it.
export const seed = 256;
