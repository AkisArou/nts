/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */
// Transcribed from WebKit ARES-6 Air, revision b64265f153b3178bfb4ca9f51736289f57982fce:
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Air/benchmark.js
// See ../LICENSE-ares6 for the complete third-party notices.
//
// Three of the four original recorded inputs are retained in full. The GBEmu
// input is excluded because its Octane source is GPL-2.0. This case therefore
// represents the permitted Air subset, not the complete ARES-6 Air workload.
// The original before/after hash validation remains in each measured iteration.
// n repeats complete iterations; it never changes or truncates the recorded IR.
// The host clock, verbose printing, and ARES-6 timing/reporting adapter are omitted.

import { allocateStack } from "./core.ts";
import type { Code } from "./core.ts";
import { createPayloadImagingGaussianBlurGaussianBlur } from "./payload-imaging-gaussian-blur-gaussianBlur.ts";
import { createPayloadTypescriptScanIdentifier } from "./payload-typescript-scanIdentifier.ts";
import { createPayloadAirJSACLj8C } from "./payload-airjs-ACLj8C.ts";

interface Payload {
    generate: () => Code;
    earlyHash: number;
    lateHash: number;
}

export class AirBenchmark {
    _payloads: Payload[];
    constructor()
    {
        this._payloads = [
            {generate: createPayloadImagingGaussianBlurGaussianBlur, earlyHash: 3677819581, lateHash: 1252116304},
            {generate: createPayloadTypescriptScanIdentifier, earlyHash: 1914852601, lateHash: 837339551},
            {generate: createPayloadAirJSACLj8C, earlyHash: 1373599940, lateHash: 3981283600}
        ];
    }
    
    runIteration(): number
    {
        let checksum = 0;
        for (let payload of this._payloads) {
            // Sadly about 17% of our time is in generate. I don't think that's really avoidable,
            // and I don't mind testing VMs' ability to run such "data definition" code quickly. I
            // would not have expected it to be so slow from first principles!
            let code = payload.generate();
            
            
            let hash = code.hash();
            if (hash != payload.earlyHash)
                throw new Error(`Wrong early hash for ${payload.generate.name}: ${hash}`);
            
            allocateStack(code);
            

            hash = code.hash();
            if (hash != payload.lateHash)
                throw new Error(`Wrong late hash for ${payload.generate.name}: ${hash}`);
            checksum = (checksum + hash) >>> 0;
        }
        return checksum;
    }
}

// Upstream standalone driver count; the harness seed is calibrated separately.
export const originalIterations = 150;
export const originalPayloadCount = 4;
export const includedPayloadCount = 3;

export function work(n: number): number
{
    let benchmark = new AirBenchmark();
    let checksum = 0;
    for (let iteration = 0; iteration < n; ++iteration)
        checksum = (checksum + benchmark.runIteration()) >>> 0;
    return checksum;
}

export const seed = 1;

export interface CodeObservation {
    hash: number;
    blocks: number;
    slots: number;
    instructions: number;
    frameSize: number;
    callArgAreaSize: number;
    offsets: (number | undefined)[];
}

export interface PayloadObservation {
    name: string;
    before: CodeObservation;
    after: CodeObservation;
}

// Exposes the real allocator output for differential tests without timing or I/O.
function observe(code: Code): CodeObservation
{
    let instructions = 0;
    for (let block of code)
        instructions += block.size;
    return {
        hash: code.hash(),
        blocks: code.size,
        slots: code.stackSlots.length,
        instructions,
        frameSize: code.frameSize,
        callArgAreaSize: code.callArgAreaSize,
        offsets: code.stackSlots.map(slot => slot.offsetFromFP)
    };
}

export function inspectPayloads(): PayloadObservation[]
{
    let observations: PayloadObservation[] = [];
    for (let payload of new AirBenchmark()._payloads) {
        let code = payload.generate();
        let before = observe(code);
        if (before.hash != payload.earlyHash)
            throw new Error(`Wrong early hash for ${payload.generate.name}: ${before.hash}`);
        allocateStack(code);
        let after = observe(code);
        if (after.hash != payload.lateHash)
            throw new Error(`Wrong late hash for ${payload.generate.name}: ${after.hash}`);
        observations.push({name: payload.generate.name, before, after});
    }
    return observations;
}
