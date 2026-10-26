// The TypeScript conformance suite's selection: every case under
// `tests/typescript/<under>`, as the records `nts-test262-protocol select`
// writes for test262, so the runner treats both suites alike.
//
// A case is a strict TypeScript file with test262's front matter. Its
// `features:` name the concepts it exercises; they are the suite's index from
// concept to case, and the report's by-feature section. A TypeScript case has
// no negatives (a program that must not compile is `tests/refusals`'s), no
// includes and no flags beyond `module` and `async`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { bodyOf, featuresOf, flagsOf, harnessFor } from "../project.ts";

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

/**
 * Whether node passes a case: the oracle a TypeScript case is admitted by.
 * A case node fails is wrong, whatever nts does with it, and is reported as
 * no verdict, by name, rather than counted for or against the compiler.
 *
 * Node runs the harness and the case as one TypeScript file with
 * `--experimental-transform-types`, which strips the types and transforms
 * the runtime-bearing syntax -- enums, namespaces, parameter properties --
 * as TypeScript emit does.
 */
export function oracle(source: string, scratch: string): { ok: true } | { ok: false; why: string } {
  // **A module, so strict.** nts compiles every case strict, and node ran an
  // `oracle.ts` with no import as a sloppy script: `this` in a plain function
  // was `globalThis` there, so a case could pass the oracle on an answer nts
  // is right not to give.
  const file = join(scratch, "oracle.mts");
  writeFileSync(file, `${harnessFor(source)}\n${bodyOf(source)}\n`);
  const run = spawnSync(process.execPath, ["--experimental-transform-types", "--no-warnings", file], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const said = `${run.stderr ?? ""}${run.stdout ?? ""}`;
  if (run.status !== 0) {
    const line = said.split("\n").find((text) => /Error|error/.test(text)) ?? said.split("\n")[0] ?? "";
    return { ok: false, why: run.signal ? `node was stopped by ${run.signal}` : line.trim().slice(0, 200) };
  }
  // **An async case passes by its completion line, not its exit status**, as
  // attempt262 judges nts: `$DONE(error)` prints `Test262:AsyncTestFailure:`
  // and node still exits 0, so a wrong async case was admitted.
  if (flagsOf(source).includes("async") && !/^Test262:AsyncTestComplete$/m.test(run.stdout ?? "")) {
    const failure = /^Test262:AsyncTestFailure:.*$/m.exec(run.stdout ?? "")?.[0];
    return { ok: false, why: (failure ?? "the async case never called $DONE").slice(0, 200) };
  }
  return { ok: true };
}
