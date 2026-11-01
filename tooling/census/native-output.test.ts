// Exercise the actual native-stop producer and census classifier together.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binary = resolve(root, process.env.NTS_BIN ?? "target/release/nts");

test("C, LLVM and JVM census rows cannot hide wrong output before a native decline", () => {
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const base = join(homedir(), ".cache/nts-native-output-tests");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "case-"));
  try {
    const helper = join(scratch, "run.ts");
    writeFileSync(helper, `
import {attempt} from ${JSON.stringify(join(root, "tooling/census/attempt262.ts"))};
import {workspace} from ${JSON.stringify(join(root, "tooling/census/project.ts"))};
import {serialRun} from ${JSON.stringify(join(root, "tooling/census/worker-memory.ts"))};
const [nts,backend,scratch] = process.argv.slice(2);
const tools={nts,backend,cc:"cc",language:"ts",memoryCapKb:6000000,objectCache:${JSON.stringify(join(homedir(), ".cache/nts/c-objects"))}};
serialRun(tools);
const dir=workspace(scratch,"ts");
const source=(array,text,method="log")=>\
  "const values="+array+"; console."+method+"(values[0]); const text="+text+\
  "; const claimed=text as unknown as number; console."+method+"(claimed+1); console."+method+"('after');";
const cases=[source("new Array<number>(1)","'5'"),source("[0]","'5'"),source("[0]","5"),source("new Array<number>(1)","'5'","error"),source("[0]","'5'","error")];
console.log(JSON.stringify(cases.map(body=>attempt(dir,body,tools))));
`);
    for (const backend of ["c", "llvm", "jvm"]) {
      const run = spawnSync(process.execPath, [helper, binary, backend, join(scratch, backend)], {
        encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
      });
      assert.equal(run.status, 0, `${backend}: ${run.stderr}`);
      const rows = JSON.parse(run.stdout.trim());
      assert.deepEqual(rows.map(row => row.bucket), ["wrong-output", "crash", "strict-pass", "wrong-output", "crash"], backend);
      assert.deepEqual(rows[0].printed, { stdout: "0\n", stderr: "" }, backend);
      assert.deepEqual(rows[0].nodeOutput, { stdout: "undefined\n51\nafter\n", stderr: "" }, backend);
      assert.deepEqual(rows[3].printed, { stdout: "", stderr: "0\n" }, backend);
      assert.deepEqual(rows[3].nodeOutput, { stdout: "", stderr: "undefined\n51\nafter\n" }, backend);
      assert.match(rows[1].runtimeFailure.output, /^nts: refused/m, backend);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
