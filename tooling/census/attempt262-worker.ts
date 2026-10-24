// One worker of `conformance262.ts`: reads a Test262 path per stdin line,
// writes one JSON outcome per stdout line, in order.
//
//   node tooling/census/attempt262-worker.ts <scratch> <nts> <cc> <suite> [memory-cap-kb] [object-cache] [backend] [fresh] [js|ts]
//
// `<suite>` is the root the paths are relative to; the last argument is the
// language the cases are written in (`project.ts` `Language`).
//
// **One workspace per worker, never shared.** `attempt` writes `src/main.js`
// and then compiles it, so two attempts in one directory race on that file and
// each reports a bucket for a program the other wrote -- `run262.ts` records
// two runs doing exactly that, an hour apart, with nothing in either report to
// say so. The orchestrator gives every worker its own `<scratch>`.
//
// The isolation a test needs is still one process per test: `emit-c`, `cc` and
// the program are each a child of this worker, so nothing a test does to its
// process survives into the next one. This process only loops.

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { attempt } from "./attempt262.ts";
import { inResidentWorker } from "./worker-memory.ts";
import { workspace } from "./project.ts";
import { oracle } from "./suites/typescript.ts";

const [scratch, nts, cc, suite, memoryCapKb, objectCache, backend, fresh, language] = process.argv.slice(2);
const tools = {
  nts,
  cc,
  memoryCapKb: Number(memoryCapKb ?? 0),
  objectCache,
  backend: backend ?? "c",
  fresh: fresh === "fresh",
  language: language === "ts" ? ("ts" as const) : ("js" as const),
};
if (!inResidentWorker()) throw new Error("resident cap: census worker was started without its bounded scope");
const dir = workspace(scratch, tools.language);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const path of lines) {
  if (path === "") continue;
  let outcome;
  try {
    const source = readFileSync(join(suite, path), "utf8");
    // A TypeScript case is admitted by node first: one node fails is a wrong
    // case, and is reported as that rather than measured against nts.
    const admitted = tools.language === "ts" ? oracle(source, dir) : { ok: true as const };
    outcome = admitted.ok ? attempt(dir, source, tools, join(suite, path)) : { bucket: "oracle", why: admitted.why };
  } catch (error) {
    // A throw out of `attempt` is this instrument failing, not the test: it is
    // reported as such, never dropped, so the orchestrator's reconciliation
    // still counts one row per case.
    outcome = {
      bucket: "infrastructure-error",
      why: `the attempt threw: ${String(error?.message ?? error).split("\n")[0]}`,
    };
  }
  // The build directory holds a full runtime copy per case; `/tmp`-style
  // inode exhaustion is how a long run on this box dies, so it goes now.
  rmSync(join(dir, "out"), { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ path, ...outcome })}\n`);
}
