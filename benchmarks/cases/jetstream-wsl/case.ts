// JetStream 3.0 WSL, WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b.
// All 148 original files and their BSD-2-Clause notices are retained in wsl.ts.
import { Benchmark, resetTrial, trialCounters, tests } from "./wsl.ts";

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        resetTrial();
        const benchmark = new Benchmark();
        benchmark.buildStdlib();
        benchmark.run();
        const counters = trialCounters();
        const value = (counters.eBuffers * 31 + counters.anonymousVariables) >>> 0;
        checksum = (checksum * 31 + value) >>> 0;
    }
    return checksum;
}

export function inspect(): { eBuffers: number; anonymousVariables: number; testNames: string[] } {
    work(1);
    const counters = trialCounters();
    return { eBuffers: counters.eBuffers, anonymousVariables: counters.anonymousVariables, testNames: Object.keys(tests).sort() };
}

export const seed = 1;
