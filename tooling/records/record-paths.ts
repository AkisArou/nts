import {RECORD} from '../conformance/outcomes-verdict.ts';
export const BACKENDS = ["c", "llvm", "jvm"] as const;
export const typescriptRecord = (backend: string) => `results/typescript/${backend}/cases.tsv`;
export const TEST262_SLICES = { language: "test/language", builtins: "test/built-ins", annexb: "test/annexB", staging: "test/staging", harness: "test/harness" } as const;
export const test262Record = (backend: string, slice: string) => `results/test262/${backend}/${slice}.tsv`;
export const TEST262_RECORDS = BACKENDS.flatMap(backend => Object.keys(TEST262_SLICES).map(slice => test262Record(backend, slice)));
export const benchmarkRecord = (backend: string) => `results/benchmarks/${backend}/outcomes.tsv`;
export const outcomesRecord = (name: string) => `tests/outcomes/${name}/${RECORD}`;
