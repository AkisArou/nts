import {LOCALES, shuffleOptions, log, assertCondition} from "./helper.ts";
import {random, resetRandom} from "./random.ts";

// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/intl/src/NumberFormat.js
// All original input sizes, locales, options, and arithmetic are preserved.

export interface FormatOptions extends Intl.NumberFormatOptions {
    locale: string;
}

export type LastResult = string | undefined;

export interface TestResult {
    lastResult: LastResult;
    totalLength: number;
    expectedMinLength: number;
}

export type Observation =
    | {kind: "options"; options: FormatOptions}
    | {kind: "format"; value: number; result: string}
    | {kind: "parts"; value: number; result: Intl.NumberFormatPart[]};

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

const CURRENCIES = ["USD", "EUR", "JPY", "INR", "NGN"];

const NUMBER_UNITS = [
  "acre",
  "bit",
  "byte",
  "celsius",
  "centimeter",
  "day",
  "degree",
  "fahrenheit",
  "fluid-ounce",
  "foot",
  "gallon",
  "gigabit",
  "gigabyte",
  "gram",
  "hectare",
  "hour",
  "inch",
  "kilobit",
  "kilobyte",
  "kilogram",
  "kilometer",
  "liter",
  "megabit",
  "megabyte",
  "meter",
  "microsecond",
  "mile",
  "mile-scandinavian",
  "milliliter",
  "millimeter",
  "millisecond",
  "minute",
  "month",
  "nanosecond",
  "ounce",
  "percent",
  "petabyte",
  "pound",
  "second",
  "stone",
  "terabit",
  "terabyte",
  "week",
  "yard",
  "year",
];

export function* numberFormatOptions(): Generator<FormatOptions, void, unknown> {
  const currencyDisplayOptions: NonNullable<Intl.NumberFormatOptions["currencyDisplay"]>[] = ["symbol", "narrowSymbol", "code", "name"];
  const unitDisplayOptions: NonNullable<Intl.NumberFormatOptions["unitDisplay"]>[] = ["short", "long", "narrow"];

  for (const locale of LOCALES) {
    for (const currency of CURRENCIES) {
      for (const currencyDisplay of currencyDisplayOptions) {
        yield { locale, style: "currency", currency, currencyDisplay };
      }
    }
    for (const unit of NUMBER_UNITS.slice(0, 20)) {
      for (const unitDisplay of unitDisplayOptions) {
        yield { locale, style: "unit", unit, unitDisplay };
      }
    }
    yield { locale, style: "decimal" };
    yield { locale, style: "percent" };
  }
}

export function runTest(verbose = false, observer?: OutputObserver): TestResult {
  let lastResult: string | undefined;
  let totalLength = 0;
  const NUMBER_FORMAT_COUNT = 10;
  let counter = 1;
  for (const options of shuffleOptions(numberFormatOptions).slice(0, 200)) {
    const formatter = new Intl.NumberFormat(options.locale, options);
    observer?.({kind: "options", options});
    if (verbose) {
      log(options.locale, JSON.stringify(options));
    }
    for (let i = 0; i < NUMBER_FORMAT_COUNT; i++) {
      counter += 599;
      const value = counter % 10_000;
      lastResult = formatter.format(value);
      observer?.({kind: "format", value, result: lastResult});
      if (verbose) {
        log(value, lastResult);
      }
      totalLength += lastResult.length;
      const formatPartsResult = formatter.formatToParts(value);
      observer?.({kind: "parts", value, result: formatPartsResult});
      for (const part of formatPartsResult) {
        totalLength += part.value.length;
      }
    }
  }
  return { lastResult, totalLength, expectedMinLength: 40_000 };
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
