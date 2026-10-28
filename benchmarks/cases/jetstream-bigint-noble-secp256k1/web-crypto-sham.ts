// The MIT License

// Copyright (c) 2013 Dominic Tarr

// Permission is hereby granted, free of charge, 
// to any person obtaining a copy of this software and 
// associated documentation files (the "Software"), to 
// deal in the Software without restriction, including 
// without limitation the rights to use, copy, modify, 
// merge, publish, distribute, sublicense, and/or sell 
// copies of the Software, and to permit persons to whom 
// the Software is furnished to do so, 
// subject to the following conditions:

// The above copyright notice and this permission notice 
// shall be included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, 
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES 
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR 
// ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, 
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/web-crypto-sham.js

/*
 * Copyright (C) 2018-2024 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
*/
// RNG source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js

import { createHmac, shaFactory } from './hmac.ts';
import type { Hmac } from './hmac.ts';
import type { ByteBuffer } from './byte-buffer.ts';

type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray;

// The original driver resets this generator before each iteration.
let seed = 49734321;
export function resetRandom(): void { seed = 49734321; }
function random(): number {
  seed = ((seed + 0x7ed55d16) + (seed << 12))  & 0xffff_ffff;
  seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffff_ffff;
  seed = ((seed + 0x165667b1) + (seed << 5))   & 0xffff_ffff;
  seed = ((seed + 0xd3a2646c) ^ (seed << 9))   & 0xffff_ffff;
  seed = ((seed + 0xfd7046c5) + (seed << 3))   & 0xffff_ffff;
  seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffff_ffff;
  return (seed >>> 0) / 0x1_0000_0000;
}

export const webCryptoSham = {
  getRandomValues<T extends IntegerArray>(array: T): T {
    if (!(array instanceof Int8Array || array instanceof Uint8Array || array instanceof Int16Array || array instanceof Uint16Array || array instanceof Int32Array || array instanceof Uint32Array || array instanceof Uint8ClampedArray))
      throw new TypeError('Expected an integer array');
    if (array.byteLength > 65536)
      throw new RangeError('Can only request a maximum of 65536 bytes');
    var i = 0, r: number | undefined;
    for (; i < array.length; i++) {
      if ((i & 0x03) === 0) r = random() * 0x100000000;
      array[i] = (Number(r) >>> ((i & 0x03) << 3)) & 0xff;
    }
    return array;
  },
  subtle: {
    async digest(algorithm: string, data: Uint8Array | ArrayBuffer): Promise<ByteBuffer> {
      if (data instanceof ArrayBuffer)
        throw new TypeError(`ArrayBuffer data is not supported.`);
      let internalAlgorithm;
      switch (algorithm) {
        case "SHA-256": internalAlgorithm = "sha256"; break;
        default: throw new TypeError(`Unsupported digest() algorithm: ${algorithm}.`);
      }
      return shaFactory(internalAlgorithm).update(data).digest();
    },
    async importKey(format: string, keyData: Uint8Array, algorithm: { name: string; hash: { name: string } }, extractable: boolean, keyUsages: string[]): Promise<Hmac> {
      if (format !== "raw" || algorithm.name !== "HMAC" || algorithm.hash.name !== "SHA-256" || extractable || keyUsages.length !== 1 || keyUsages[0] !== "sign")
        throw new TypeError('Unsupported importKey() arguments.');
      return createHmac("sha256", keyData);
    },
    async sign(algorithmName: string, key: Hmac, message: Uint8Array): Promise<ByteBuffer> {
      if (algorithmName !== "HMAC") throw new TypeError('Unsupported importKey() arguments.');
      return key.update(message).digest();
    }
  }
};
