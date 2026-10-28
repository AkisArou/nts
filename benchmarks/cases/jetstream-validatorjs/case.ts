/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
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

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/validatorjs/benchmark.js
// n repeats complete original fixture runs. No fixture or library input is scaled.
import {runTest} from './fixtures.ts';

export const EXPECTED_ASSERTION_COUNT = 10114;
export const originalIterations = 120;
export const seed = 1;

export class Benchmark {
  assertionCount = 0;

  runIteration() {
    this.assertionCount = runTest();
  }

  validate() {
    if (!(this.assertionCount === EXPECTED_ASSERTION_COUNT)) {
      throw new Error(`Expected ${EXPECTED_ASSERTION_COUNT} assertions, but got ${this.assertionCount}`);
    }
  }
}


// The original JetStream driver keeps one Benchmark across iterations. Reset
// only its scalar validation result for a stable zero-iteration failure.
const benchmark = new Benchmark();

export function work(n: number): number {
  benchmark.assertionCount = 0;
  let checksum = 0;
  for (let i = 0; i < n; ++i) {
    benchmark.runIteration();
    checksum = (checksum * 31 + benchmark.assertionCount) >>> 0;
  }
  benchmark.validate();
  return checksum;
}

export interface ValidationSnapshot {
  assertionCount: number;
  iterations: number[];
}

export function render(n: number): ValidationSnapshot {
  const benchmark = new Benchmark();
  const iterations: number[] = [];
  for (let i = 0; i < n; ++i) {
    benchmark.runIteration();
    iterations.push(benchmark.assertionCount);
  }
  benchmark.validate();
  return {assertionCount: benchmark.assertionCount, iterations};
}
