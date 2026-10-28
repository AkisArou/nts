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
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/SeaMonster/json-parse-inspector.js
// See ../LICENSE-jetstream for the recording's additional embedded MIT notices.
// data.ts retains the entire original Inspector recording, without scaling.
//
// The original constructor serializes once before the measured iterations.
// Its instance is therefore created at module initialization, outside work.
// Every work iteration performs the original JSON.parse over that full string.
// Its previous parsed result remains live until the next parse replaces it,
// as it does in the source driver; no pre-iteration result reset is inserted.
// A bounded structural checksum observes the freshly parsed value; complete
// output is compared with the unchanged upstream result in the correctness test.

import { obj } from "./data.ts";

export class Benchmark {
    declare str: string;
    declare result: unknown;

    constructor() {
        this.str = JSON.stringify(obj);
        this.result = null;
    }
    runIteration(): void {
        this.result = JSON.parse(this.str);
    }
};

const benchmark = new Benchmark();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observeText(text: string): number {
    let checksum = text.length >>> 0;
    if (text.length === 0) return checksum;
    for (let i = 0; i < 64; i++) {
        const index = Math.floor(i * (text.length - 1) / 63);
        checksum = (checksum * 31 + text.charCodeAt(index)) >>> 0;
    }
    return checksum;
}

// The checksum visits all 846 records and their first three container levels.
// Deeper containers contribute their lengths/key counts, and long strings
// contribute 64 code units. Full recursive serialization belongs to the test,
// so a second complete JSON operation is not added to the timed parser.
export function observe(value: unknown, depth: number = 3): number {
    if (value === null) return 0;
    if (typeof value === "number") return Math.round(value * 1e6) >>> 0;
    if (typeof value === "boolean") return value ? 1 : 2;
    if (typeof value === "string") return observeText(value);
    if (Array.isArray(value)) {
        const entries: unknown[] = value;
        let checksum = entries.length >>> 0;
        if (depth > 0) {
            for (const entry of entries)
                checksum = (checksum * 31 + observe(entry, depth - 1)) >>> 0;
        }
        return checksum;
    }
    if (isRecord(value)) {
        const keys = Object.keys(value);
        let checksum = keys.length >>> 0;
        if (depth > 0) {
            for (const key of keys) {
                checksum = (checksum * 31 + observeText(key)) >>> 0;
                checksum = (checksum * 31 + observe(value[key], depth - 1)) >>> 0;
            }
        }
        return checksum;
    }
    throw new Error("JSON.parse returned a non-JSON value");
}

export function render(n: number = 1): unknown {
    if (n <= 0) return null;
    for (let i = 0; i < n; i++) benchmark.runIteration();
    return benchmark.result;
}

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        benchmark.runIteration();
        checksum = (checksum * 31 + observe(benchmark.result)) >>> 0;
    }
    return checksum;
}

// The opaque count repeats full inputs. A complete operation cannot be made
// shorter by reducing this positive integer below one; see the PR's timings.
export const seed = 1;
