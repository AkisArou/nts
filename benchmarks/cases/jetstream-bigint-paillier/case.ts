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

// Pinned JetStream 3.0 source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/paillier-benchmark.js
// Revision 3967678fa8ab98d847ab33cf3728dba726fa854b. See README.md, provenance.json and ../LICENSE-jetstream.

import { paillierBigint, PublicKey, PrivateKey } from "./paillier.ts";
import { resetRandom } from "./random.ts";
export { PublicKey, PrivateKey, generateRandomKeysSync } from "./paillier.ts";

export class Benchmark {
    declare _verbose: boolean;
    declare _c1DecryptedIsCorrect: boolean;
    declare _c2DecryptedIsCorrect: boolean;
    declare _decryptedMulIsCorrect: boolean;
    constructor() {
        this._verbose = false;
        this._c1DecryptedIsCorrect = true;
        this._c2DecryptedIsCorrect = true;
        this._decryptedMulIsCorrect = true;
    }

    runIteration(): void {
        const { publicKey, privateKey } = paillierBigint.generateRandomKeysSync(1024);

        const m1 = 12345678901234567890n;
        const m2 = 5n;

        const c1 = publicKey.encrypt(m1);
        const c1Decrypted = privateKey.decrypt(c1);
        this._c1DecryptedIsCorrect &&= c1Decrypted === 12345678901234567890n;

        const c2 = publicKey.encrypt(m2);
        const encryptedSum = publicKey.addition(c1, c2);
        const c2Decrypted = privateKey.decrypt(encryptedSum);
        this._c2DecryptedIsCorrect &&= c2Decrypted === 12345678901234567895n;

        const k = 10n;
        const encryptedMul = publicKey.multiply(c1, k);
        const decryptedMul = privateKey.decrypt(encryptedMul);
        this._decryptedMulIsCorrect &&= decryptedMul === 123456789012345678900n;
        observe(publicKey, privateKey, c1, c2, encryptedSum, encryptedMul, c1Decrypted, c2Decrypted, decryptedMul);
    }

    validate(iterations: number): void {
        if (!this._c1DecryptedIsCorrect)
            throw new Error("Bad value: c1Decrypted!");

        if (!this._c2DecryptedIsCorrect)
            throw new Error("Bad value: c2Decrypted!");

        if (!this._decryptedMulIsCorrect)
            throw new Error("Bad value: decryptedMul!");
    }
}

let checksum = 0;
let completedIterations = 0;
let lastResults: string[] = [];

function observe(publicKey: PublicKey, privateKey: PrivateKey, c1: bigint, c2: bigint, encryptedSum: bigint, encryptedMul: bigint, decrypted1: bigint, decryptedSum: bigint, decryptedMul: bigint): void {
    lastResults = [String(publicKey.n), String(publicKey.g), String(privateKey.lambda), String(privateKey.mu), String(privateKey._p), String(privateKey._q), String(c1), String(c2), String(encryptedSum), String(encryptedMul), String(decrypted1), String(decryptedSum), String(decryptedMul)];
    for (let valueIndex = 0; valueIndex < lastResults.length; ++valueIndex) {
        const text = lastResults[valueIndex];
        for (let i = 0; i < text.length; ++i)
            checksum = (checksum * 31 + text.charCodeAt(i)) >>> 0;
        checksum = (checksum * 31 + text.length) >>> 0;
    }
    completedIterations++;
}

const benchmark = new Benchmark();
export const seed = 1;

export function work(n: number): number {
    checksum = 0;
    completedIterations = 0;
    for (let i = 0; i < n; ++i) {
        // The original driver resets this exact stream before every iteration.
        resetRandom();
        benchmark.runIteration();
    }
    benchmark.validate(n);
    return checksum;
}

export function render(n: number = 1): string[] {
    work(n);
    return n > 0 ? lastResults.slice() : [];
}

export function observation(): {iterations: number; values: string[]; checksum: number; valid: boolean} {
    return {iterations: completedIterations, values: lastResults.slice(), checksum, valid: benchmark._c1DecryptedIsCorrect && benchmark._c2DecryptedIsCorrect && benchmark._decryptedMulIsCorrect};
}
