import { waitFor, testProcessResult, TEST_HANG_MS } from "../../gate/test-wait.ts";
// Fake compiler input for the real resident worker pool's kernel controls.
import { createInterface } from "node:readline";
import { closeSync, constants, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    // A small fixed allocation, independent of RSS accounting, leaves room
    // for module loading, kernel charges and the next worker's startup.
    held = Buffer.alloc(4 * 2 ** 20, 1);
    const group = process.env.NTS_CENSUS_WORKER_GROUP!;
    const residentBytes = Number(readFileSync(join("/sys/fs/cgroup", group, "memory.current"), "utf8"));
    const workerBytes = Number(process.env.NTS_CENSUS_WORKER_MAX_BYTES);
    const aggregateBytes = Number(readFileSync(join("/sys/fs/cgroup", dirname(group), "memory.max"), "utf8"));
    if (!(residentBytes < aggregateBytes / 4)) throw new Error(`survivor fixture lacks headroom: ${residentBytes} of ${aggregateBytes} aggregate bytes`);
    // Open both ends before publishing readiness: no writer is needed yet,
    // and the read cannot return EOF. Polling existsSync here charged kernel
    // path memory during victim reaping and could trigger a second OOM.
    const release = openSync(join(directory, "release"), constants.O_RDWR);
    const released = Buffer.alloc(1);
    try {
      writeFileSync(join(directory, "survivor-ready"), JSON.stringify({ heldBytes: held.length, residentBytes, workerBytes, aggregateBytes }));
      if (readSync(release, released, 0, 1, null) !== 1) throw new Error("survivor fixture was not released");
    } finally { closeSync(release); }
  }
  if (path === "victim") {
    await deadlineWait(join(directory, "survivor-ready"));
    // Fixture only: make the allocating task the deterministic kernel victim.
    writeFileSync("/proc/self/oom_score_adj", "1000");
    const group = process.env.NTS_CENSUS_WORKER_GROUP!;
    const aggregateBytes = Number(readFileSync(join("/sys/fs/cgroup", dirname(group), "memory.max"), "utf8"));
    const workerBytes = Number(readFileSync(join("/sys/fs/cgroup", group, "memory.max"), "utf8"));
    const residentBytes = Number(readFileSync(join("/sys/fs/cgroup", group, "memory.current"), "utf8"));
    const requestedBytes = aggregateBytes * 2;
    if (!(residentBytes + requestedBytes < workerBytes)) throw new Error("victim fixture could reach its own worker cap");
    writeFileSync(join(directory, "victim-request"), JSON.stringify({ requestedBytes, aggregateBytes, workerBytes, oomScoreAdj: Number(readFileSync("/proc/self/oom_score_adj", "utf8")) }));
    // Only the aggregate can fire: this exceeds it but fits the worker cap.
    held = Buffer.alloc(requestedBytes, 1);
    throw new Error("fixture allocation should have hit the aggregate cap");
  }
  process.stdout.write(`${JSON.stringify({ path, bucket: "strict-pass", pid: process.pid, held: held?.length ?? 0 })}\n`);
}
