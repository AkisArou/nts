// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/performanceCore.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
// The following definitions provide the minimum compatible support for the Web Performance User Timings API
// between browsers and NodeJS:
/** @internal */
export interface PerformanceHooks {
    shouldWriteNativeEvents: boolean;
    performance?: Performance;
    performanceTime?: PerformanceTime;
}
/** @internal */
export interface PerformanceTime {
    now(): number;
    timeOrigin: number;
}
/** @internal */
export interface Performance extends PerformanceTime {
    mark(name: string): void;
    measure(name: string, startMark?: string, endMark?: string): void;
    clearMeasures(name?: string): void;
    clearMarks(name?: string): void;
}
// Browser globals for the Web Performance User Timings API
declare const performance: Performance | undefined;
function tryGetPerformance() {
    // The unused Node perf_hooks loader is absent from this browser benchmark.
    if (typeof performance === "object") {
        // For now we always write native performance events when running in the browser. We may
        // make this conditional in the future if we find that native web performance hooks
        // in the browser also slow down compilation.
        return {
            shouldWriteNativeEvents: true,
            performance,
        };
    }
    return undefined;
}
function tryGetPerformanceHooks(): PerformanceHooks | undefined {
    const p = tryGetPerformance();
    if (!p)
        return undefined;
    const { shouldWriteNativeEvents, performance } = p;
    const hooks: PerformanceHooks = {
        shouldWriteNativeEvents,
        performance: undefined,
        performanceTime: undefined,
    };
    if (typeof performance.timeOrigin === "number" && typeof performance.now === "function") {
        hooks.performanceTime = performance;
    }
    if (hooks.performanceTime &&
        typeof performance.mark === "function" &&
        typeof performance.measure === "function" &&
        typeof performance.clearMarks === "function" &&
        typeof performance.clearMeasures === "function") {
        hooks.performance = performance;
    }
    return hooks;
}
const nativePerformanceHooks = tryGetPerformanceHooks();
const nativePerformanceTime = nativePerformanceHooks?.performanceTime;
/** @internal */
export function tryGetNativePerformanceHooks(): PerformanceHooks | undefined {
    return nativePerformanceHooks;
}
/**
 * Gets a timestamp with (at least) ms resolution
 *
 * @internal
 */
export const timestamp: () => number = nativePerformanceTime ? () => nativePerformanceTime.now() : Date.now;
