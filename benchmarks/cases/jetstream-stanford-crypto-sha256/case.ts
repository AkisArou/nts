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

// JetStream 3 Stanford SHA256, revision 3967678fa8ab98d847ab33cf3728dba726fa854b.
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/stanford-crypto-sha256.js
// Keep the initial input, all 4500 rounds and the original hash validation.
// Only the unused Date.now() timing local is omitted. n repeats complete
// original iterations; it never scales the input or the internal round count.
// See sha256.ts for the SJCL BSD-2-Clause licence choice and source credits.

import { Sha256, hexFromBits } from "./sha256.ts";

export const seed = 1;
export const originalRounds = 4500;

export function runIteration(): number[] {
  let hash = Sha256.hash("b4d");
  for (let i = 0; i < 4500; ++i) {
    hash = Sha256.hash(hash);
  }
  if (hexFromBits(hash) !== "719043495be84b97fe4f5d7e61c99d6d1ba0cd6974a6b10c684c25a44ddd0c03")
    throw new Error("Bad result");
  return hash;
}

export function work(n: number): number {
  let checksum = 0;
  for (let iteration = 0; iteration < n; ++iteration) {
    const hash = runIteration();
    for (let i = 0; i < hash.length; ++i) checksum = (checksum * 31 + hash[i]) >>> 0;
  }
  return checksum;
}
