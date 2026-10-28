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

// Transcribed from JetStream 3.0, revision 3967678fa8ab98d847ab33cf3728dba726fa854b:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/json-stringify-inspector.js
// The original BSD notice and embedded input notices are also reproduced in
// ../LICENSE-jetstream. The complete original recording is in data.ts.
//
// The constructor and runIteration retain the original operations. The typed
// result declaration is erased, preserving the constructor's first assignment.
// n repeats the complete JSON.stringify operation; it never changes the input.
// A single complete iteration is retained even when it exceeds 10 milliseconds.
// Like the source driver, work reuses one Benchmark, retaining its previous
// output until the next JSON.stringify has completed and replaces it.
//
// The adapter observes the output length and 64 evenly spaced UTF-16 code units.
// This bounded sample makes every iteration observable without another full
// traversal of the multi-megabyte output. It is not a collision-proof digest;
// correctness tests compare the complete output and its SHA-256 with upstream.

import { obj } from "./data.ts";

export class Benchmark {
    declare result: string | null;

    constructor() {
        this.result = null;
    }
    runIteration(): void {
        this.result = JSON.stringify(obj);
    }
};

const benchmark = new Benchmark();

// Return the complete result for independent validation outside timing.
export function render(n: number = 1): string {
    const benchmark = new Benchmark();
    for (let i = 0; i < n; i++) {
        benchmark.runIteration();
    }
    return benchmark.result ?? "";
}

export function observe(text: string): number {
    let checksum = text.length >>> 0;
    if (text.length === 0) return checksum;
    for (let i = 0; i < 64; i++) {
        const index = Math.floor(i * (text.length - 1) / 63);
        checksum = (checksum * 31 + text.charCodeAt(index)) >>> 0;
    }
    return checksum;
}

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        benchmark.runIteration();
        const result = benchmark.result;
        if (result === null) throw new Error("Missing JSON.stringify result");
        checksum = (checksum * 31 + observe(result)) >>> 0;
    }
    return checksum;
}

// The harness passes the complete-iteration count through its opaque input.
export const seed = 1;
