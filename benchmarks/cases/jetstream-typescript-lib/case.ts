// JetStream 3.0 TypeScript-lib: one complete original 118-file compilation.
// Source: WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b/TypeScript.
// BSD-2-Clause driver, Apache-2.0 compiler/declaration inputs, MIT Immer input.
// All applicable notices are reproduced in ../LICENSE-jetstream.
import { compileTest } from "./driver.ts";
import type { CompileResult } from "./driver.ts";
import { configuration } from "./config.ts";
import { sourceFiles } from "./input.ts";

// The original operation already constructs all these diagnostic strings.
export function inspect(): CompileResult {
    return compileTest(configuration, sourceFiles);
}

export function observe(result: CompileResult): number {
    let checksum = result.resultFilesCount >>> 0;
    for (const diagnostic of result.diagnostics) {
        checksum = (checksum * 31 + diagnostic.length) >>> 0;
        for (let index = 0; index < diagnostic.length; index++) {
            checksum = (checksum * 31 + diagnostic.charCodeAt(index)) >>> 0;
        }
    }
    return checksum;
}

export function work(n: number): number {
    let checksum = 0;
    for (let index = 0; index < n; index++) {
        checksum = (checksum * 31 + observe(inspect())) >>> 0;
    }
    return checksum;
}

export const seed = 1;
