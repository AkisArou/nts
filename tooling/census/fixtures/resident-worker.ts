import { waitFor, testProcessResult, TEST_HANG_MS } from "../../gate/test-wait.ts";
// Fake compiler input for the real resident worker pool's kernel controls.
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSync, inResidentWorker } from "../worker-memory.ts";
if (!inResidentWorker()) throw new Error("fixture outside resident scope");
const directory = process.argv[2];
const deadlineWait = (path: string) => waitFor(`resident fixture barrier ${path}`,()=>existsSync(path));
for await (const path of createInterface({ input: process.stdin })) {
  let held: Buffer | undefined;
  if (path === "oom") {
    const result = testProcessResult(compileSync({ memoryCapKb: 96 * 1024 }, "python3", ["-c", "chunks=[]\nwhile True: chunks.append(bytearray(8*1024*1024))"], { encoding: "utf8", timeout: TEST_HANG_MS }), "the fixture allocation to reach its resident cap");
    // The parent must override this non-memory result from the kernel counter.
    process.stdout.write(`${JSON.stringify({ path, bucket: "compiler-result", status: result.status })}\n`);
    continue;
  }
  if (path === "survivor") {
    const currentKb = Number(/^VmRSS:\s+(\d+) kB$/m.exec(readFileSync("/proc/self/status", "utf8"))![1]);
    held = Buffer.alloc(Math.floor(256 * 2 ** 20 * 0.6 - currentKb * 1024), 1);
    writeFileSync(join(directory, "survivor-ready"), "ready");
    await deadlineWait(join(directory, "release"));
  }
  if (path === "victim") {
    await deadlineWait(join(directory, "survivor-ready"));
    // Fixture only: make the allocating task the deterministic kernel victim.
    writeFileSync("/proc/self/oom_score_adj", "1000");
    held = Buffer.alloc(130 * 2 ** 20, 1);
    throw new Error("fixture allocation should have hit the aggregate cap");
  }
  process.stdout.write(`${JSON.stringify({ path, bucket: "strict-pass", pid: process.pid, held: held?.length ?? 0 })}\n`);
}
