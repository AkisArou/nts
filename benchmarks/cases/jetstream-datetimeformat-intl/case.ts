import {LOCALES, shuffleOptions, log, assertCondition} from "./helper.ts";
import {random, resetRandom} from "./random.ts";

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/DateTimeFormat.js
// All original input sizes, locales, options, and arithmetic are preserved.

export interface FormatOptions extends Intl.DateTimeFormatOptions {
    locale: string;
}

export type LastResult = string | number;

export interface TestResult {
    lastResult: LastResult;
    totalLength: number;
    expectedMinLength: number;
}

export type Observation =
    | {kind: "options"; locale: string; options: Intl.DateTimeFormatOptions}
    | {kind: "format"; date: number; result: string}
    | {kind: "parts"; date: number; result: Intl.DateTimeFormatPart[]}
    | {kind: "range"; start: number; end: number; result: string};

// The source concatenates two possibly unassigned string locals. Spell the
// exact + coercion, including undefined + undefined producing NaN.
function concatenate(left: string | undefined, right: string | undefined): string | number {
    if (left === undefined && right === undefined)
        return NaN;
    return String(left) + String(right);
}

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

export function generateRandomDates(count: number): Date[] {
  const firstDate = new Date(1800, 11, 5, 13, 6);
  let currentTimeStamp = firstDate.getTime();
  const dates: Date[] = [];

  for (let i = 0; i < count; i++) {
    dates.push(new Date(currentTimeStamp));
    currentTimeStamp += 1234569;
  }
  return dates;
}

const DATE_STYLE_OPTIONS: NonNullable<Intl.DateTimeFormatOptions["dateStyle"]>[] = ["full", "long", "medium", "short"];
const TIME_STYLE_OPTIONS: NonNullable<Intl.DateTimeFormatOptions["timeStyle"]>[] = ["full", "long", "medium", "short"];

export function* dateTimeFormatOptions(): Generator<FormatOptions, void, unknown> {
  for (const locale of LOCALES) {
    for (const dateStyle of DATE_STYLE_OPTIONS) {
      for (const timeStyle of TIME_STYLE_OPTIONS) {
        yield { locale, dateStyle, timeStyle };
      }
    }
  }
}

export function runTest(verbose = false, observer?: OutputObserver): TestResult {
  let totalLength = 0;
  let lastFormatResult: string | undefined;
  let lastFormatPartResult: Intl.DateTimeFormatPart[] | undefined;
  let lastFormatRangeResult: string | undefined;
  const dates = generateRandomDates(100);
  let dateIndex = 0;

  const FORMAT_COUNT = 17;
  const FORMAT_RANGE_COUNT = 7;
  for (const { locale, dateStyle, timeStyle } of shuffleOptions(
    dateTimeFormatOptions
  )) {
    const options = { dateStyle, timeStyle };
    if (verbose) {
      log(locale, JSON.stringify(options));
    }
    const formatter = new Intl.DateTimeFormat(locale, options);
    observer?.({kind: "options", locale, options});
    for (let i = 0; i < FORMAT_COUNT; i++) {
      let date = dates[dateIndex % dates.length];
      lastFormatResult = formatter.format(date);
      observer?.({kind: "format", date: date.getTime(), result: lastFormatResult});
      totalLength += lastFormatResult.length;
      if (verbose) {
        log(date, lastFormatResult);
      }
      dateIndex++;

      date = dates[dateIndex % dates.length];
      lastFormatPartResult = formatter.formatToParts(date);
      observer?.({kind: "parts", date: date.getTime(), result: lastFormatPartResult});
      for (const part of lastFormatPartResult) {
        totalLength += part.value.length;
      }
      dateIndex++;
    }
    let dateRangeStart = dates[0];
    for (let i = 0; i < FORMAT_RANGE_COUNT; i++) {
      const date = dates[dateIndex % dates.length];
      if (dateRangeStart < date) {
        lastFormatRangeResult = formatter.formatRange(dateRangeStart, date);
        observer?.({kind: "range", start: dateRangeStart.getTime(), end: date.getTime(), result: lastFormatRangeResult});
        if (verbose) {
          log(dateRangeStart, date, lastFormatRangeResult);
        }
      }
      dateRangeStart = date;
    }
  }
  return {
    lastResult: concatenate(lastFormatResult, lastFormatRangeResult),
    totalLength,
    expectedMinLength: 438_000,
  };
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
