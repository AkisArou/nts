/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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

// JetStream 3 Stanford AES, revision 3967678fa8ab98d847ab33cf3728dba726fa854b.
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/stanford-crypto-aes.js
// All vectors, three passes and both original full bit-array assertions stay.

import { Aes, equalBits } from "./aes.ts";
import { data } from "./data.ts";

export const seed = 1;
export const originalPasses = 3;

function assert(b: boolean): void {
  if (!b)
    throw new Error;
}

export class Benchmark {
  runIteration(): number {
    let encrypted: number[] = [];
    let decrypted: number[] = [];
    for (let index = 0; index < 3; index++) {
      for (let i = 0; i < data.length; i++) {
        let item = data[i];
        let len = 32 * item.key.length;
        let aes = new Aes(item.key);
        assert(equalBits(encrypted = aes.encrypt(item.pt), item.ct));
        assert(equalBits(decrypted = aes.decrypt(item.ct), item.pt));
      }
    }
    let checksum = 0;
    for (let i = 0; i < encrypted.length; ++i) checksum = (checksum * 31 + encrypted[i]) >>> 0;
    for (let i = 0; i < decrypted.length; ++i) checksum = (checksum * 31 + decrypted[i]) >>> 0;
    return checksum;
  }
}

const benchmark = new Benchmark();

export function runIteration(): number {
  return benchmark.runIteration();
}

export function work(n: number): number {
  let checksum = 0;
  for (let iteration = 0; iteration < n; ++iteration)
    checksum = (checksum * 31 + runIteration()) >>> 0;
  return checksum;
}
