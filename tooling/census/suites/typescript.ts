import {oracleToolchainLocation} from '../../gate/host-environment.ts';
// The TypeScript conformance suite's selection: every case under
// `tests/typescript/<under>`, as the records `nts-test262-protocol select`
// writes for test262, so the runner treats both suites alike.
//
// A case is a strict TypeScript file with test262's front matter. Its
// `features:` name the concepts it exercises; they are the suite's index from
// concept to case, and the report's by-feature section. A TypeScript case has
// no negatives (a program that must not compile is `tests/refusals`'s), no
// includes and no flags beyond `module` and `async`.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { bodyOf, featuresOf, flagsOf, harnessFor, harnessHashOf } from "../project.ts";
import {REPOSITORY,oracleIdentity} from "../../differential/oracle-services.ts";

const ORACLE_FILE = "oracle.ts";
const sourceHash = (file: URL) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A raw checkpoint measures this source oracle, not only the nts binary. */
export function typescriptOracleIdentity() {
  return {
    oracle: oracleIdentity(oracleToolchainLocation()),
    materializer: {
      roots: [ORACLE_FILE],
      producer: "pinned transpileModule",
      harness: harnessHashOf("ts"),
      suiteSha256: sourceHash(new URL(import.meta.url)),
      oracleSha256: sourceHash(new URL("./typescript-oracle.ts",import.meta.url)),
      preparationSha256: sourceHash(new URL("../attempt262-worker.ts",import.meta.url)),
      referenceSources: ['../typescript-oracles.ts','../typescript-oracle-results.ts','../typescript-oracle-capture.ts'].map(file=>[file,sourceHash(new URL(file,import.meta.url))]),
      workspaceSha256: sourceHash(new URL("../project.ts", import.meta.url)),
      fixtureOptionsSha256: sourceHash(new URL("../../../tsconfig.fixtures.json", import.meta.url)),
    },
  };
}

/** The record one case is selected as, in the protocol's shape. */
export type Selected = {
  path: string;
  schedule: "planned";
  variant_id: string;
  strict_prefix: string;
  includes: string[];
  features: string[];
  flags: string[];
  source_hash: string;
  body_hash: string;
  function_token: false;
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Every `.ts` case under `root/under`, sorted by path. */
export function selectTypescript(root: string, under: string): Selected[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) files.push(path);
    }
  };
  walk(join(root, under));
  return files.map((file) => {
    const source = readFileSync(file, "utf8");
    const path = relative(root, file);
    return {
      path,
      schedule: "planned",
      variant_id: `${path}#strict`,
      strict_prefix: "",
      includes: [],
      features: featuresOf(source),
      flags: flagsOf(source),
      source_hash: hash(source),
      body_hash: hash(bodyOf(source)),
      function_token: false,
    };
  });
}

function typeScriptOracleBody(source: string): string { return `${harnessFor(source)}\n${bodyOf(source)}\nexport {};\n`; }

/** The selected suite is authored as .ts; its harness supplies ESM scope. */
export function materialiseTypeScriptOracle(source: string, scratch: string): string {
  const file = join(scratch, "oracle.ts");
  writeFileSync(join(scratch, "package.json"), JSON.stringify({type: "module"}) + "\n");
  writeFileSync(file, typeScriptOracleBody(source));
  return file;
}

/** Create the original inputs before the first capture consults their parent
 * listings. Executable snapshots live elsewhere and can be released at once. */
export function materialiseTypeScriptOracleProject(source:string,directory:string):string{
  mkdirSync(directory,{recursive:true});
  const file=materialiseTypeScriptOracle(source,directory);
  writeFileSync(join(directory,'oracle.js'),'');
  writeFileSync(join(directory,'tsconfig.json'),JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),files:[file],include:[]})+'\n');
  return file;
}

