import { readFileSync } from "node:fs";
import { compileSync, serialRun } from "../worker-memory.ts";
const tools = { memoryCapKb: 96 * 1024 };
serialRun(tools);
const groups = [];
for (let i = 0; i < 2; i++) {
  const result = compileSync(tools, "sh", ["-c", "cat /proc/self/cgroup"], { encoding: "utf8" });
  if (result.status !== 0 || result.memoryKilled) throw new Error(`serial compiler failed: ${result.stderr}`);
  groups.push(result.stdout.trim());
}
console.log(JSON.stringify({ groups, own: readFileSync("/proc/self/cgroup", "utf8").trim(), boundary: process.env.NTS_CENSUS_WORKER_GROUP }));
