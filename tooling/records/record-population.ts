// Pending populations inspect sources and retained records; they never run a recorder.
import {existsSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataDirectory} from '../gate/reader-inputs/main.ts';
import {selectTypescript} from '../census/suites/typescript.ts';
import {parseTypeScriptRecord,pendingCases} from '../census/typescript-record.ts';
import {benchmarkCases} from '../bench/build-records.ts';
import {parseBenchmarkRecord} from '../bench/outcomes.ts';
import {BENCH_AGREE_BACKENDS,parseRunRecord,pendingRuns,runsRecord} from '../bench/run-outcomes.ts';
import {outcomeInventory,RECORD} from '../conformance/outcomes-verdict.ts';
import {outcomeFixtures} from '../conformance/outcomes-project.ts';
import {pendingFixtures,recordPath} from '../differential/oracle-records.ts';
import {DEX_RECORD,dexTargets,recordedTargets} from '../android/dex-record.ts';
import {ARMS,COMPILE_ARMS,compileTimeModules,readCounterTable} from '../gate/compile-counter.ts';
import {RUST_SELECTOR_CASE,rustSelectorPending} from '../gate/rust-selector-write.ts';
import {RUST_SELECTOR_RECORD} from '../gate/rust-selector-record.ts';
import {inventory} from './pending.ts';
import type {Kind,Pending} from './record-pending.ts';
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
export const BACKENDS = ["c", "llvm", "jvm"] as const;
export const TYPESCRIPT_CASES=dataDirectory(new URL('../../tests/typescript/',import.meta.url));
export const typescriptRecord = (backend: string) => `results/typescript/${backend}/cases.tsv`;
export const TEST262_SLICES = { language: "test/language", builtins: "test/built-ins", annexb: "test/annexB", staging: "test/staging", harness: "test/harness" } as const;
export const test262Record = (backend: string, slice: string) => `results/test262/${backend}/${slice}.tsv`;
export const TEST262_RECORDS = BACKENDS.flatMap(backend => Object.keys(TEST262_SLICES).map(slice => test262Record(backend, slice)));
export const benchmarkRecord = (backend: string) => `results/benchmarks/${backend}/outcomes.tsv`;
export const outcomesRecord = (name: string) => `tests/outcomes/${name}/${RECORD}`;
export function findPending(root: string, kind: Kind): Pending[] {
  switch (kind) {
    case 'rust-selector': return rustSelectorPending(root)?[{kind,name:RUST_SELECTOR_CASE,record:RUST_SELECTOR_RECORD}]:[];
    case "oracle-counts":
      return pendingFixtures(root).map(name => ({ kind, name, record: recordPath(name) }));
    case "test262":
      // Its record holds the cases that ran, so the tree cannot say which are
      // new: they are what its census listed (acceptedIn's listed pending).
      return [];
    case "typescript": {
      const sources = selectTypescript(root, relative(SOURCE_ROOT,fileURLToPath(TYPESCRIPT_CASES))).map(row => row.path);
      return BACKENDS.flatMap(backend => pendingCases(parseTypeScriptRecord(read(root, typescriptRecord(backend))), sources)
        .map(name => ({ kind, name, record: typescriptRecord(backend) })));
    }
    case "benchmarks":
      return BACKENDS.flatMap(backend => {
        const recorded = parseBenchmarkRecord(read(root, benchmarkRecord(backend))).rows.filter(row => row.scope === "compile").map(row => row.path);
        return inventory(recorded, benchmarkCases(root)).pending.map(name => ({ kind, name, record: benchmarkRecord(backend) }));
      });
    case "benchmark-runs":
      return BENCH_AGREE_BACKENDS.flatMap(backend => {
        const file = runsRecord(backend), record = existsSync(join(root, file)) ? parseRunRecord(read(root, file)) : null;
        return pendingRuns(record, benchmarkCases(root)).map(name => ({ kind, name, record: file }));
      });
    case "outcomes": {
      const directory = join(root, "tests/outcomes");
      return outcomeInventory(directory, outcomeFixtures(directory)).pending
        .map(name => ({ kind, name: `tests/outcomes/${name}`, record: outcomesRecord(name) }));
    }
    case "dex": {
      const recorded = existsSync(join(root, DEX_RECORD)) ? recordedTargets(read(root, DEX_RECORD)) : [];
      return inventory(recorded, dexTargets(root)).pending.map(name => ({ kind, name, record: DEX_RECORD }));
    }
    case "compile-times":
      // A module with no row in an arm's table lacks both of that arm's records.
      return ARMS.flatMap(arm => {
        const { table, calibration } = COMPILE_ARMS[arm], recorded = readCounterTable(read(root, table), arm).rows;
        return compileTimeModules(root).filter(name => !recorded.has(name))
          .flatMap(name => [{ kind, name, record: table }, { kind, name, record: calibration }]);
      });
  }
}
