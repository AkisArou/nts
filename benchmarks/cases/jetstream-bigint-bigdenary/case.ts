/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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
 
// Pinned JetStream 3.0 source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/bigdenary-benchmark.js
// Revision 3967678fa8ab98d847ab33cf3728dba726fa854b. See README.md, provenance.json and ../LICENSE-jetstream.

import { BigDenary } from "./bigdenary.ts";
export { BigDenary } from "./bigdenary.ts";

const bd1 = new BigDenary('8965168485622506189945604.1235068121348084163185216');
const bd2 = new BigDenary('2480986213549488579706531.6546845013548451265890628');
type Result = BigDenary | number;
function requireDecimal(value: Result): BigDenary {
    if (!(value instanceof BigDenary))
        throw new TypeError("a.equals is not a function");
    return value;
}
const bdEquals = (a: Result, b: Result | undefined): boolean => requireDecimal(a).equals(b);

function areFirstAndLastResultsEqual(bdThunk: () => Result, areEqual: (a: Result, b: Result | undefined) => boolean = bdEquals): boolean {
    const firstResult = bdThunk();

    var lastResult: Result | undefined;
    for (var i = 0; i < 1e4; i++)
        lastResult = bdThunk();

    const equal = areEqual(firstResult, lastResult);
    observeResult(lastResult);
    return equal;
}

export class Benchmark {
    declare _verbose: boolean;
    declare _allFirstAndLastResultsAreEqual: boolean;
    constructor() {
        this._verbose = false;
        this._allFirstAndLastResultsAreEqual = true;
    }

    runIteration(): void {
        this._allFirstAndLastResultsAreEqual &&=
            areFirstAndLastResultsEqual(() => bd1.plus(bd2)) &&
            areFirstAndLastResultsEqual(() => bd1.minus(bd2)) &&
            areFirstAndLastResultsEqual(() => bd1.negated()) &&
            areFirstAndLastResultsEqual(() => bd1.comparedTo(bd2), Object.is) &&
            areFirstAndLastResultsEqual(() => bd1.multipliedBy(bd2)) &&
            areFirstAndLastResultsEqual(() => bd1.dividedBy(bd2));
    }

    validate(iterations: number): void {
        if (!this._allFirstAndLastResultsAreEqual)
            throw new Error("Expected all first and last results to be equal, but they aren't.");
    }
}

// Only bounded output strings and scalar observations survive an iteration.
let checksum = 0;
let operations = 0;
const lastResults: string[] = [];

function observeResult(result: Result | undefined): void {
    const text = String(result);
    lastResults[operations % 6] = text;
    operations++;
    for (let i = 0; i < text.length; ++i)
        checksum = (checksum * 31 + text.charCodeAt(i)) >>> 0;
    checksum = (checksum * 31 + text.length) >>> 0;
}

const benchmark = new Benchmark();
export const seed = 1;

export function work(n: number): number {
    checksum = 0;
    operations = 0;
    for (let i = 0; i < n; ++i)
        benchmark.runIteration();
    benchmark.validate(n);
    return checksum;
}

export function observation(): {operations: number; results: string[]; checksum: number; valid: boolean} {
    return {operations, results: lastResults.slice(), checksum, valid: benchmark._allFirstAndLastResultsAreEqual};
}

export function render(n: number = 1): string[] {
    work(n);
    return n > 0 ? lastResults.slice() : [];
}
