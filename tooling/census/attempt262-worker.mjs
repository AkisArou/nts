// One worker of `conformance262.mjs`: reads a Test262 path per stdin line,
// writes one JSON outcome per stdout line, in order.
//
//   node tooling/census/attempt262-worker.mjs <scratch> <nts> <cc> <suite>
//
// **One workspace per worker, never shared.** `attempt` writes `src/main.ts`
// and then compiles it, so two attempts in one directory race on that file and
// each reports a bucket for a program the other wrote -- `run262.mjs` records
// two runs doing exactly that, an hour apart, with nothing in either report to
// say so. The orchestrator gives every worker its own `<scratch>`.
//
// The isolation a test needs is still one process per test: `emit-c`, `cc` and
// the program are each a child of this worker, so nothing a test does to its
// process survives into the next one. This process only loops.

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { attempt } from "./attempt262.mjs";
import { workspace } from "./project.mjs";

const [scratch, nts, cc, suite] = process.argv.slice(2);
const dir = workspace(scratch);
const tools = { nts, cc };

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const path of lines) {
  if (path === "") continue;
  let outcome;
  try {
    outcome = attempt(dir, readFileSync(join(suite, path), "utf8"), tools);
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
