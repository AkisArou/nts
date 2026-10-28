"use strict";
/*
 * SJCL is open. You can use, modify and redistribute it under a BSD
 * license or under the GNU GPL, version 2.0.
 * 
 * ---------------------------------------------------------------------
 * 
 * http://opensource.org/licenses/BSD-2-Clause
 * 
 * Copyright (c) 2009-2015, Emily Stark, Mike Hamburg and Dan Boneh at
 * Stanford University. All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 * 
 * 1. Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 * 
 * 2. Redistributions in binary form must reproduce the above copyright
 * notice, this list of conditions and the following disclaimer in the
 * documentation and/or other materials provided with the distribution.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
 * IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
 * TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 * PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 * ---------------------------------------------------------------------
 * 
 * http://opensource.org/licenses/GPL-2.0
 * 
 * The Stanford Javascript Crypto Library (hosted here on GitHub) is a
 * project by the Stanford Computer Security Lab to build a secure,
 * powerful, fast, small, easy-to-use, cross-browser library for
 * cryptography in Javascript.
 * 
 * Copyright (c) 2009-2015, Emily Stark, Mike Hamburg and Dan Boneh at
 * Stanford University.
 * 
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 * 
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
 * Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 59 Temple Place, Suite 330, Boston, MA 02111-1307 USA
*/

// Selected under the BSD-2-Clause alternative stated above.
// AES and its complete called validation dependency path, transcribed from:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/sjlc.js
// The generated tables, key schedules, encryption/decryption rounds and
// arithmetic are retained. See README.md for fixed-layout adaptations.

class Invalid {
  declare toString: () => string;
  declare message: string;

  constructor(a: string) {
    this.toString = function(this: Invalid): string { return "INVALID: " + this.message; };
    this.message = a;
  }
}

const tables: number[][][] = [[[], [], [], [], []], [[], [], [], [], []]];

export class Aes {
  declare b: number[][];

  constructor(input: number[]) {
    let a: number[] | number = input;
    this.s[0][0][0] || this.O();
    var b: number, c: number, d: number[], e: number[], f = this.s[0][4], g = this.s[1];
    b = a.length;
    var h = 1;
    if (4 !== b && 6 !== b && 8 !== b) throw new Invalid("invalid aes key size");
    this.b = [d = a.slice(0), e = []];
    for (a = b; a < 4 * b + 28; a++) {
      c = d[a - 1];
      if (0 === a % b || 8 === b && 4 === a % b)
        c = f[c >>> 24] << 24 ^ f[c >> 16 & 255] << 16 ^ f[c >> 8 & 255] << 8 ^ f[c & 255],
        0 === a % b && (c = c << 8 ^ c >>> 24 ^ h << 24, h = h << 1 ^ 283 * (h >> 7));
      d[a] = d[a - b] ^ c;
    }
    for (b = 0; a; b++, a--)
      c = d[b & 3 ? a : a - 4],
      e[b] = 4 >= a || 4 > b ? c : g[0][f[c >>> 24]] ^ g[1][f[c >> 16 & 255]] ^ g[2][f[c >> 8 & 255]] ^ g[3][f[c & 255]];
  }

  encrypt(a: number[]): number[] { return crypt(this, a, 0); }
  decrypt(a: number[]): number[] { return crypt(this, a, 1); }
  get s(): number[][][] { return tables; }

  O(): void {
    var a = this.s[0], b = this.s[1], c = a[4], d = b[4],
      e: number, f: number, g: number, h: number[] = [], k: number[] = [], l: number, n: number, m: number, p: number;
    for (e = 0; 0x100 > e; e++) k[(h[e] = e << 1 ^ 283 * (e >> 7)) ^ e] = e;
    for (f = g = 0; !c[f]; f ^= l || 1, g = k[g] || 1)
      for (m = g ^ g << 1 ^ g << 2 ^ g << 3 ^ g << 4, m = m >> 8 ^ m & 255 ^ 99,
        c[f] = m, d[m] = f, n = h[e = h[l = h[f]]], p = 0x1010101 * n ^ 0x10001 * e ^ 0x101 * l ^ 0x1010100 * f,
        n = 0x101 * h[m] ^ 0x1010100 * m, e = 0; 4 > e; e++)
        a[e][f] = n = n << 24 ^ n >>> 8, b[e][m] = p = p << 24 ^ p >>> 8;
    for (e = 0; 5 > e; e++) a[e] = a[e].slice(0), b[e] = b[e].slice(0);
  }
}

function crypt(cipher: Aes, block: number[], c: number): number[] {
  let a: Aes | number[] = cipher;
  let b: number[] | number = block;
  if (4 !== b.length) throw new Invalid("invalid aes block size");
  var d = a.b[c], e = b[0] ^ d[0], f = b[c ? 3 : 1] ^ d[1], g = b[2] ^ d[2];
  b = b[c ? 1 : 3] ^ d[3];
  var h: number[][] | number, k: number, l: number, n = d.length / 4 - 2, m: number, p = 4, r = [0, 0, 0, 0];
  h = a.s[c];
  a = h[0];
  var q = h[1], v = h[2], w = h[3], x = h[4];
  for (m = 0; m < n; m++)
    h = a[e >>> 24] ^ q[f >> 16 & 255] ^ v[g >> 8 & 255] ^ w[b & 255] ^ d[p],
    k = a[f >>> 24] ^ q[g >> 16 & 255] ^ v[b >> 8 & 255] ^ w[e & 255] ^ d[p + 1],
    l = a[g >>> 24] ^ q[b >> 16 & 255] ^ v[e >> 8 & 255] ^ w[f & 255] ^ d[p + 2],
    b = a[b >>> 24] ^ q[e >> 16 & 255] ^ v[f >> 8 & 255] ^ w[g & 255] ^ d[p + 3],
    p += 4, e = h, f = k, g = l;
  for (m = 0; 4 > m; m++)
    r[c ? 3 & -m : m] = x[e >>> 24] << 24 ^ x[f >> 16 & 255] << 16 ^ x[g >> 8 & 255] << 8 ^ x[b & 255] ^ d[p++],
    h = e, e = f, f = g, g = b, b = h;
  return r;
}

function bitLength(a: number[]): number {
  var b = a.length;
  return 0 === b ? 0 : 32 * (b - 1) + getPartial(a[b - 1]);
}

function getPartial(a: number): number {
  return Math.round(a / 0x10000000000) || 32;
}

export function equalBits(a: number[], b: number[]): boolean {
  if (bitLength(a) !== bitLength(b)) return !1;
  var c = 0, d: number;
  for (d = 0; d < a.length; d++) c |= a[d] ^ b[d];
  return 0 === c;
}
