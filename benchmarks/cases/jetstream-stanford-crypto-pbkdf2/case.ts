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

// JetStream 3 Stanford PBKDF2, revision 3967678fa8ab98d847ab33cf3728dba726fa854b.
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/stanford-crypto-pbkdf2.js
// The password, salt, all 2048 rounds and original output check are retained.

import { pbkdf2, hex as codecHex } from "./pbkdf2.ts";

export const seed = 1;
export const originalCount = 2048;

export function runIteration(): string {
  let hex = codecHex;
  let password = "b4db33f";
  let salt = "BA DB EE FB AD BE EF 00";
  let count = 2048;
  let output = hex.fromBits(pbkdf2(password, hex.toBits(salt), count));
  if (output !== "5436c4c0d73e425a521f4a5a13e0fffe5cd957a823f435385fa0a75068a26803")
    throw new Error("Bad output");
  return output;
}

export function work(n: number): number {
  let checksum = 0;
  for (let iteration = 0; iteration < n; ++iteration) {
    const output = runIteration();
    for (let i = 0; i < output.length; ++i) checksum = (checksum * 31 + output.charCodeAt(i)) >>> 0;
  }
  return checksum;
}
