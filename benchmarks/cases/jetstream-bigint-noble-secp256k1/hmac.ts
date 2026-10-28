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

import { ByteBuffer } from './byte-buffer.ts';
import { Sha256 } from './sha256.ts';
import { Transform } from './stream-state.ts';

const ZEROS = ByteBuffer.alloc(128);
type FinalHash = (this: Hmac) => ByteBuffer;

class CipherBase extends Transform {
  declare hashMode: boolean;
  declare digest: FinalHash;
  declare final: FinalHash | undefined;
  declare __final: FinalHash;
  declare _final: null;
  declare _decoder: null;
  declare _encoding: null;
  constructor(hashMode: 'digest', finalMethod: FinalHash) {
    super();
    this.hashMode = typeof hashMode === 'string';
    if (this.hashMode) this.digest = this._finalOrDigest;
    else this.final = this._finalOrDigest;
    if (finalMethod) {
      this.__final = finalMethod;
      this._final = null;
    }
    this._decoder = null;
    this._encoding = null;
  }
  update(this: Hmac, data: Uint8Array): Hmac;
  update(this: Hmac, data: Uint8Array, inputEnc?: never, outputEnc?: never): Hmac | void {
    var outData = this._update(data);
    if (this.hashMode) return this;
    return outData;
  }
  _finalOrDigest(this: Hmac, outputEnc?: never): ByteBuffer {
    var outData = this.__final() || ByteBuffer.alloc(0);
    return outData;
  }
}

export class Hmac extends CipherBase {
  declare _alg: string;
  declare _key: Uint8Array;
  declare _ipad: ByteBuffer;
  declare _opad: ByteBuffer;
  declare _hash: Sha256;
  constructor(alg: string, key: Uint8Array) {
  super('digest', Hmac.finishHash)

  var blocksize = (alg === 'sha512' || alg === 'sha384') ? 128 : 64

  this._alg = alg
  this._key = key
  if (key.length > blocksize) {
    var hash = shaFactory(alg)
    key = hash.update(key).digest()
  } else if (key.length < blocksize) {
    key = ByteBuffer.concat([key, ZEROS], blocksize)
  }

  var ipad = this._ipad = ByteBuffer.allocUnsafe(blocksize)
  var opad = this._opad = ByteBuffer.allocUnsafe(blocksize)

  for (var i = 0; i < blocksize; i++) {
    ipad[i] = key[i] ^ 0x36
    opad[i] = key[i] ^ 0x5C
  }
  this._hash = shaFactory(alg)
  this._hash.update(ipad)
}
  _update(data: Uint8Array): void {
  this._hash.update(data)
}
  static finishHash(this: Hmac): ByteBuffer {
  var h = this._hash.digest()
  var hash = shaFactory(this._alg)
  return hash.update(this._opad).update(h).digest()
}
}

export function shaFactory(algorithm: string): Sha256 {
  algorithm = algorithm.toLowerCase();
  if (algorithm !== 'sha256') throw new Error(algorithm + ' is not supported (we accept pull requests)');
  return new Sha256();
}
export function createHmac(alg: string, key: Uint8Array): Hmac {
  alg = alg.toLowerCase();
  return new Hmac(alg, key);
}
