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
// SHA256 and its complete called dependency path, transcribed from:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/sjlc.js
// The original bit packing, generated constants, compression rounds, input
// codecs and Uint32Array/fallback paths are retained. Fixed prototype members
// become class methods/accessors. Fields use declare to preserve allocation
// order. The complete upstream library is audited; uncalled cipher, PRNG and
// browser entropy APIs are outside this SHA256 workload.
// HMAC reads the original fixed block size through static class metadata
// instead of reflecting over the hash constructor's prototype.

export type HashInput = string | number[];

export class Invalid {
  declare toString: () => string;
  declare message: string;

  constructor(a: string) {
    this.toString = function(this: Invalid): string {
      return "INVALID: " + this.message;
    };
    this.message = a;
  }
}

export function concatBits(a: number[], b: number[]): number[] {
  if (0 === a.length || 0 === b.length) return a.concat(b);
  var c = a[a.length - 1], d = getPartial(c);
  return 32 === d ? a.concat(b) : shiftRight(b, d, c | 0, a.slice(0, a.length - 1));
}

function bitLength(a: number[]): number {
  var b = a.length;
  return 0 === b ? 0 : 32 * (b - 1) + getPartial(a[b - 1]);
}

export function partial(a: number, b: number, c?: number): number {
  return 32 === a ? b : (c ? b | 0 : b << 32 - a) + 0x10000000000 * a;
}

function getPartial(a: number): number {
  return Math.round(a / 0x10000000000) || 32;
}

function shiftRight(input: number[], b: number, c: number, d: number[]): number[] {
  let a: number[] | number = input;
  var e: number;
  e = 0;
  for (void 0 === d && (d = []); 32 <= b; b -= 32) d.push(c), c = 0;
  if (0 === b) return d.concat(a);
  for (e = 0; e < a.length; e++) d.push(c | a[e] >>> b), c = a[e] << 32 - b;
  e = a.length ? a[a.length - 1] : 0;
  a = getPartial(e);
  // Number spells the numeric coercion performed by partial's bitwise use.
  d.push(partial(b + a & 31, 32 < b + a ? c : Number(d.pop()), 1));
  return d;
}

export function utf8ToBits(a: string): number[] {
  a = unescape(encodeURIComponent(a));
  var b: number[] = [], c: number, d = 0;
  for (c = 0; c < a.length; c++) d = d << 8 | a.charCodeAt(c),
    3 === (c & 3) && (b.push(d), d = 0);
  c & 3 && b.push(partial(8 * (c & 3), d));
  return b;
}

export function hexFromBits(a: number[]): string {
  var b = "", c: number;
  for (c = 0; c < a.length; c++) b += ((a[c] | 0) + 0xf00000000000).toString(16).substr(4);
  return b.substr(0, bitLength(a) / 4);
}

const initialHash: number[] = [];
const roundConstants: number[] = [];

export class Sha256 {
  static readonly blockSize = 512;
  declare F: number[];
  declare A: number[];
  declare l: number;

  constructor(a?: Sha256) {
    this.b[0] || this.O();
    a ? (this.F = a.F.slice(0), this.A = a.A.slice(0), this.l = a.l) : this.reset();
  }

  static hash(a: HashInput): number[] {
    return (new Sha256).update(a).finalize();
  }

  get blockSize(): number { return 512; }
  get Y(): number[] { return initialHash; }
  get b(): number[] { return roundConstants; }

  reset(): this {
    this.F = this.Y.slice(0);
    this.A = [];
    this.l = 0;
    return this;
  }

  update(input: HashInput): this {
    let a: HashInput | number = input;
    "string" === typeof a && (a = utf8ToBits(a));
    var b: number, c = this.A = concatBits(this.A, a);
    b = this.l;
    a = this.l = b + bitLength(a);
    if (0x1fffffffffffff < a) throw new Invalid("Cannot hash more than 2^53 - 1 bits");
    if ("undefined" !== typeof Uint32Array) {
      var d = new Uint32Array(c), e = 0;
      for (b = 512 + b - (512 + b & 0x1ff); b <= a; b += 512)
        compress(this, d.subarray(16 * e, 16 * (e + 1))), e += 1;
      c.splice(0, 16 * e);
    } else for (b = 512 + b - (512 + b & 0x1ff); b <= a; b += 512)
      compress(this, c.splice(0, 16));
    return this;
  }

  finalize(): number[] {
    var a: number, b = this.A, c = this.F, b = concatBits(b, [partial(1, 1)]);
    for (a = b.length + 2; a & 15; a++) b.push(0);
    b.push(Math.floor(this.l / 0x100000000));
    for (b.push(this.l | 0); b.length;) compress(this, b.splice(0, 16));
    this.reset();
    return c;
  }

  O(): void {
    function a(a: number): number {
      return 0x100000000 * (a - Math.floor(a)) | 0;
    }
    for (var b = 0, c = 2, d: number, e: boolean; 64 > b; c++) {
      e = !0;
      for (d = 2; d * d <= c; d++) if (0 === c % d) {
        e = !1;
        break;
      }
      e && (8 > b && (this.Y[b] = a(Math.pow(c, .5))), this.b[b] = a(Math.pow(c, 1 / 3)), b++);
    }
  }
}

function compress(a: Sha256, b: number[] | Uint32Array): void {
  var c: number, d: number, e: number, f = a.F, g = a.b,
    h = f[0], k = f[1], l = f[2], n = f[3], m = f[4], p = f[5], r = f[6], q = f[7];
  for (c = 0; 64 > c; c++)
    16 > c ? d = b[c] : (d = b[c + 1 & 15], e = b[c + 14 & 15],
      d = b[c & 15] = (d >>> 7 ^ d >>> 18 ^ d >>> 3 ^ d << 25 ^ d << 14) +
        (e >>> 17 ^ e >>> 19 ^ e >>> 10 ^ e << 15 ^ e << 13) + b[c & 15] + b[c + 9 & 15] | 0),
    d = d + q + (m >>> 6 ^ m >>> 11 ^ m >>> 25 ^ m << 26 ^ m << 21 ^ m << 7) + (r ^ m & (p ^ r)) + g[c],
    q = r, r = p, p = m, m = n + d | 0, n = l, l = k, k = h,
    h = d + (k & l ^ n & (k ^ l)) + (k >>> 2 ^ k >>> 13 ^ k >>> 22 ^ k << 30 ^ k << 19 ^ k << 10) | 0;
  f[0] = f[0] + h | 0;
  f[1] = f[1] + k | 0;
  f[2] = f[2] + l | 0;
  f[3] = f[3] + n | 0;
  f[4] = f[4] + m | 0;
  f[5] = f[5] + p | 0;
  f[6] = f[6] + r | 0;
  f[7] = f[7] + q | 0;
}

// Upstream library initialization constructs a SHA256 in sjcl.prng, which
// fills these shared tables before the benchmark starts. Match that setup.
new Sha256();
