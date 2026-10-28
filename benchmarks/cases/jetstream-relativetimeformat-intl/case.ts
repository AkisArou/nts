import {LOCALES, shuffleOptions, log, assertCondition} from "./helper.ts";
import {random, resetRandom} from "./random.ts";

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/RelativeTimeFormat.js
// All original input sizes, locales, options, and arithmetic are preserved.

export interface FormatOptions extends Intl.RelativeTimeFormatOptions {
    locale: string;
}

export type LastResult = string | undefined;

export interface TestResult {
    lastResult: LastResult;
    totalLength: number;
    expectedMinLength: number;
}

export type Observation =
    | {kind: "options"; locale: string; options: Intl.RelativeTimeFormatOptions}
    | {kind: "format"; value: number; unit: Intl.RelativeTimeFormatUnit; result: string}
    | {kind: "parts"; value: number; unit: Intl.RelativeTimeFormatUnit; result: Intl.RelativeTimeFormatPart[]};

export type OutputObserver = (output: Observation) => void;

/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
 * Copyright 2025 Google LLC
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

const UNITS: Intl.RelativeTimeFormatUnit[] = [
  "year",
  "quarter",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
];

export function* relativeTimeFormatOptions(): Generator<FormatOptions, void, unknown> {
  const styleOptions: NonNullable<Intl.RelativeTimeFormatOptions["style"]>[] = ["long", "short", "narrow"];
  const numericOptions: NonNullable<Intl.RelativeTimeFormatOptions["numeric"]>[] = ["always", "auto"];
  for (const locale of LOCALES) {
    for (const style of styleOptions) {
      for (const numeric of numericOptions) {
        yield { locale, style, numeric };
      }
    }
  }
}

export function runTest(verbose = false, observer?: OutputObserver): TestResult {
  let lastResult: string | undefined;
  let totalLength = 0;
  const RELATIVE_TIME_FORMAT_COUNT = 100;
  let unitIndex = 0;
  for (const { locale, style, numeric } of shuffleOptions(
    relativeTimeFormatOptions
  )) {
    const options = { style, numeric };
    if (verbose) {
      log(locale, JSON.stringify(options));
    }
    const formatter = new Intl.RelativeTimeFormat(locale, options);
    observer?.({kind: "options", locale, options});
    for (let i = 0; i < RELATIVE_TIME_FORMAT_COUNT; i++) {
      const unit = UNITS[unitIndex % UNITS.length];
      unitIndex++;
      const value = random() * 100 - 50;
      lastResult = formatter.format(value, unit);
      observer?.({kind: "format", value, unit, result: lastResult});
      if (verbose) {
        log(value, unit, lastResult);
      }
      totalLength += lastResult.length;
      const formatPartsResult = formatter.formatToParts(value, unit);
      observer?.({kind: "parts", value, unit, result: formatPartsResult});
      for (const part of formatPartsResult) {
        totalLength += part.value.length;
      }
    }
  }
  return { lastResult, totalLength, expectedMinLength: 432_000 };
}

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/benchmark.js
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

export class Benchmark {
  iterationCount: number | undefined;
  verbose: boolean;
  lastResult: LastResult | undefined;
  totalLength = 0;
  expectedMinLength = 0;

  constructor({ iterationCount, verbose = false }: {iterationCount?: number; verbose?: boolean} = {}) {
    this.iterationCount = iterationCount;
    this.verbose = verbose;
  }

  runIteration(observer?: OutputObserver): void {
    // See implementations in src/.
    const { lastResult, totalLength, expectedMinLength } = runTest(
      this.verbose, observer
    );
    this.lastResult = lastResult;
    this.totalLength += totalLength;
    this.expectedMinLength = expectedMinLength;
  }

  validate(): void {
    const expectedMinTotalLength = this.expectedMinLength * Number(this.iterationCount);
    assertCondition(
      this.totalLength >= expectedMinTotalLength,
      `Invalid totalLength = ${this.totalLength}, expected >= ${expectedMinTotalLength}`
    );
  }
}

export const seed = 1;
export const originalIterations = 2;
export const defaultEnabled = false;

// The source driver reuses one Benchmark. Keep its lastResult alive while the
// next complete runTest allocates and formats its replacements.
const benchmark = new Benchmark();

function foldResult(checksum: number, value: LastResult | undefined): number {
    if (typeof value === "string") {
        for (let i = 0; i < value.length; ++i)
            checksum = (checksum * 31 + value.charCodeAt(i)) >>> 0;
    } else if (typeof value === "number") {
        checksum = (checksum * 31 + value) >>> 0;
    }
    return checksum;
}

export function work(n: number): number {
    benchmark.iterationCount = n;
    benchmark.totalLength = 0;
    benchmark.expectedMinLength = 0;
    let checksum = 0;
    for (let i = 0; i < n; ++i) {
        // JetStream resets its deterministic RNG before every iteration.
        resetRandom();
        const previousLength = benchmark.totalLength;
        benchmark.runIteration();
        checksum = (checksum * 31 + benchmark.totalLength - previousLength) >>> 0;
        checksum = foldResult(checksum, benchmark.lastResult);
    }
    benchmark.validate();
    return checksum;
}

export interface IterationObservation {
    lastResult: LastResult | undefined;
    totalLength: number;
    expectedMinLength: number;
    outputs: Observation[];
}

export interface Snapshot {
    lastResult: LastResult | undefined;
    totalLength: number;
    expectedMinLength: number;
    iterations: IterationObservation[];
}

export function render(n: number): Snapshot {
    const benchmark = new Benchmark({iterationCount: n});
    const iterations: IterationObservation[] = [];
    for (let i = 0; i < n; ++i) {
        resetRandom();
        const outputs: Observation[] = [];
        const previousLength = benchmark.totalLength;
        benchmark.runIteration(output => outputs.push(output));
        iterations.push({lastResult: benchmark.lastResult,
            totalLength: benchmark.totalLength - previousLength,
            expectedMinLength: benchmark.expectedMinLength, outputs});
    }
    benchmark.validate();
    return {lastResult: benchmark.lastResult, totalLength: benchmark.totalLength,
        expectedMinLength: benchmark.expectedMinLength, iterations};
}
