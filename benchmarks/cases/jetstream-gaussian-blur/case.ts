// Taken from: https://github.com/nodeca/glur

/*
* The MIT License (MIT)
* 
* Copyright (c) 2014 Andrei Tupitcyn
* 
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
* 
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
* 
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/gaussian-blur.js
// The complete original arithmetic, buffers and fixed input are retained.
// See README.md for the independent-trial adapter boundary.

import { blurRGBA } from "./blur.ts";

export const seed = 1;

export class Benchmark {
    declare width: number;
    declare height: number;
    declare radius: number;
    declare buffer: Uint32Array;

    constructor() {
        this.width = 800;
        this.height = 450;
        this.radius = 15;

        const randUint32 = (function() {
            let seed = 49734321;
            return function() {
                // Robert Jenkins' 32 bit integer hash function.
                seed = ((seed + 0x7ed55d16) + (seed << 12))  & 0xffffffff;
                seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
                seed = ((seed + 0x165667b1) + (seed << 5))   & 0xffffffff;
                seed = ((seed + 0xd3a2646c) ^ (seed << 9))   & 0xffffffff;
                seed = ((seed + 0xfd7046c5) + (seed << 3))   & 0xffffffff;
                seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
                return (seed & 0xfffffff);
            };
        })();

        const buffer = new Uint32Array(this.width * this.height);
        for (let i = 0; i < buffer.length; ++i)
            buffer[i] = randUint32();

        this.buffer = buffer;
    }

    runIteration(): void {
         blurRGBA(this.buffer, this.width, this.height, this.radius);
    }
}

// An independent work call gets one original input construction. Consecutive
// iterations keep blurring that same buffer in place, exactly as upstream.
export function runIterations(n: number): Uint32Array {
  const benchmark = new Benchmark();
  for (let iteration = 0; iteration < n; ++iteration) benchmark.runIteration();
  return benchmark.buffer;
}

export function work(n: number): number {
  if (!(n > 0)) return 0;
  const buffer = runIterations(n);
  let checksum = 0;
  for (let i = 0; i < 64; ++i) {
    const index = Math.floor(i * (buffer.length - 1) / 63);
    checksum = (checksum * 31 + buffer[index]) >>> 0;
  }
  return checksum;
}
