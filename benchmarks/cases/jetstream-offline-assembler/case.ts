// JetStream 3.0 OfflineAssembler, pinned to
// WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b.
// The full source and embedded assembly inputs retain their BSD-2-Clause notices.
import { Benchmark } from "./program.ts";

const benchmark = new Benchmark();

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        benchmark.runIteration();
        const ast = benchmark.ast!;
        let value = ast.list.length;
        for (const node of ast.list)
            value = (value * 31 + (node.codeOrigin?.lineNumber ?? 0)) >>> 0;
        checksum = (checksum * 31 + value) >>> 0;
    }
    return checksum;
}

// The original line-by-line dump validation remains outside timing, as in
// the source driver. Return its complete AST dump for independent comparison.
export function render(n: number = 1): string {
    if (n <= 0) return "";
    for (let i = 0; i < n; i++) benchmark.runIteration();
    benchmark.validate(n);
    return benchmark.ast!.dump();
}

export const seed = 1;
