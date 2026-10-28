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
// Pinned JetStream 3.0 source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/JetStreamDriver.js
// Revision 3967678fa8ab98d847ab33cf3728dba726fa854b. See README.md, provenance.json and ../LICENSE-jetstream.

const initialSeed = 49734321;
let currentSeed = initialSeed;
export function resetRandom(): void { currentSeed = initialSeed; }
export function random(): number {
// Robert Jenkins' 32 bit integer hash function.
    currentSeed = ((currentSeed + 0x7ed55d16) + (currentSeed << 12))  & 0xffff_ffff;
    currentSeed = ((currentSeed ^ 0xc761c23c) ^ (currentSeed >>> 19)) & 0xffff_ffff;
    currentSeed = ((currentSeed + 0x165667b1) + (currentSeed << 5))   & 0xffff_ffff;
    currentSeed = ((currentSeed + 0xd3a2646c) ^ (currentSeed << 9))   & 0xffff_ffff;
    currentSeed = ((currentSeed + 0xfd7046c5) + (currentSeed << 3))   & 0xffff_ffff;
    currentSeed = ((currentSeed ^ 0xb55a4f09) ^ (currentSeed >>> 16)) & 0xffff_ffff;
    // Note that Math.random should return a value that is
    // greater than or equal to 0 and less than 1. Here, we
    // cast to uint32 first then divided by 2^32 for double.
    return (currentSeed >>> 0) / 0x1_0000_0000;
}
