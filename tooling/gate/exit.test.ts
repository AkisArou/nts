import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTest } from "./test-wait.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXIT = new URL("./exit.ts", import.meta.url).href;

// A report several pipe buffers long, a diagnostic, then the verdict line, the
// way a gate step prints them. Ended by process.exit() instead, the verdict
// line was lost in 1 of 10 runs under sh; through exitAfterOutput every run
// must deliver every line.
const REPORT = `
import { exitAfterOutput } from ${JSON.stringify(EXIT)};
for (let i = 0; i < 4000; i++) console.log("  known  project-" + i + ": an entry long enough to fill a pipe buffer quickly");
console.error("  a diagnostic on stderr");
console.log("  whole: the verdict line");
exitAfterOutput(3);
`;

test("a tool's whole report reaches its pipe before the tool exits with its verdict", () => {
  for (let run = 0; run < 20; run++) {
    const result = spawnTest(process.execPath, ["--input-type=module", "-e", REPORT], { encoding: "utf8", maxBuffer: 64 << 20 }, "a report ended by exitAfterOutput");
    assert.equal(result.status, 3, result.stderr);
    const lines = result.stdout.split("\n");
    assert.equal(lines.length, 4002, `run ${run}: ${lines.length - 2} of 4001 lines arrived`);
    assert.equal(lines.at(-2), "  whole: the verdict line");
    assert.match(result.stderr, /a diagnostic on stderr/);
  }
});

test("no tooling script ends with a bare process.exit", () => {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (/\.(?:ts|mjs)$/.test(entry.name) && !/\.test\.(?:ts|mjs)$/.test(entry.name)) {
        readFileSync(path, "utf8").split("\n").forEach((line, index) => {
          if (line.startsWith("process.exit(")) found.push(`${relative(ROOT, path)}:${index + 1}`);
        });
      }
    }
  };
  walk(join(ROOT, "tooling"));
  assert.deepEqual(found, [], "end a tool with exitAfterOutput(verdict) from tooling/gate/exit.ts, so its report reaches a pipe whole");
});
