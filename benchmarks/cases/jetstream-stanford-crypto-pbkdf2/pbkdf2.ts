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
// Full called HMAC/PBKDF2 and hexadecimal-input path, transcribed from:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/sjlc.js
// See README.md for the fixed class/namespace adaptations.

import { Sha256, Invalid, concatBits, utf8ToBits, hexFromBits, partial } from "./sha256.ts";
import type { HashInput } from "./sha256.ts";

export function clampBits(a: number[], b: number): number[] {
  if (32 * a.length < b) return a;
  a = a.slice(0, Math.ceil(b / 32));
  var c = a.length;
  b = b & 31;
  0 < c && b && (a[c - 1] = partial(b, a[c - 1] & 2147483648 >> b - 1, 1));
  return a;
}

export function hexToBits(a: string): number[] {
  var b: number, c: number[] = [], d: number;
  a = a.replace(/\s|0x/g, "");
  d = a.length;
  a = a + "00000000";
  for (b = 0; b < a.length; b += 8) c.push(parseInt(a.substr(b, 8), 16) ^ 0);
  return clampBits(c, 4 * d);
}

const bitArray = { concat: concatBits, clamp: clampBits };
export const hex = { fromBits: hexFromBits, toBits: hexToBits };

export class Hmac {
  declare W: typeof Sha256;
  declare w: Sha256[];
  declare R: Sha256;
  declare aa?: boolean;

  constructor(a: number[], b?: typeof Sha256) {
    this.W = b = b || Sha256;
    var c: number[][] = [[], []], d: number, e = b.blockSize / 32;
    this.w = [new b, new b];
    a.length > e && (a = b.hash(a));
    for (d = 0; d < e; d++) c[0][d] = a[d] ^ 909522486, c[1][d] = a[d] ^ 1549556828;
    this.w[0].update(c[0]);
    this.w[1].update(c[1]);
    this.R = new b(this.w[0]);
  }

  encrypt(a: HashInput): number[] {
    if (this.aa) throw new Invalid("encrypt on already updated hmac called!");
    this.update(a);
    return this.digest(a);
  }

  // The original mac and encrypt properties refer to the same function.
  get mac(): (a: HashInput) => number[] { return this.encrypt; }

  reset(): void {
    this.R = new this.W(this.w[0]);
    this.aa = !1;
  }

  update(a: HashInput): void {
    this.aa = !0;
    this.R.update(a);
  }

  // Upstream encrypt forwards an ignored argument. This checked overload
  // preserves the original zero-argument implementation and allocation.
  digest(a?: HashInput): number[];
  digest(): number[] {
    var a = this.R.finalize(), a = (new this.W(this.w[1])).update(a).finalize();
    this.reset();
    return a;
  }
}

export function pbkdf2(password: HashInput, salt: HashInput, c?: number, d?: number, prf?: typeof Hmac): number[] {
  let a: HashInput | Hmac = password;
  let b: HashInput = salt;
  let e: typeof Hmac | number[] | undefined = prf;
  c = c || 1E4;
  if (d !== undefined && 0 > d || 0 > c) throw new Invalid("invalid params to pbkdf2");
  "string" === typeof a && (a = utf8ToBits(a));
  "string" === typeof b && (b = utf8ToBits(b));
  e = e || Hmac;
  a = new e(a);
  var f: number[], g: number, h: number, k: number, l: number[] = [], n = bitArray;
  for (k = 1; 32 * l.length < (d || 1); k++) {
    e = f = a.encrypt(n.concat(b, [k]));
    for (g = 1; g < c; g++)
      for (f = a.encrypt(f), h = 0; h < f.length; h++) e[h] ^= f[h];
    l = l.concat(e);
  }
  d && (l = n.clamp(l, d));
  return l;
}
