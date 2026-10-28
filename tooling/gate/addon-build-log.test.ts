import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnTest } from "./test-wait.ts";

test("an opaque addon failure retains complete compiler/linker output and the real exit status", t => {
  const directory = mkdtempSync(join(tmpdir(), "addon-build-log-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = readFileSync(new URL("../conformance/build-floor.sh", import.meta.url), "utf8");
  const start = source.indexOf("judge() {"), end = source.indexOf("\njobs=", start);
  assert.ok(start >= 0 && end > start, "the real addon judge is the subject");
  const bin = join(directory, "bin"), logs = join(directory, "run/addons-build");
  for (const path of [bin, logs, join(directory, "tooling/gate"), join(directory, "tooling/conformance"), join(directory, "runtime/node/http")]) mkdirSync(path, { recursive: true });
  writeFileSync(join(bin, "timeout"), '#!/bin/sh\nshift\nexec "$@"\n');chmodSync(join(bin, "timeout"), 0o755);
  writeFileSync(join(directory, "tooling/gate/token.sh"), '#!/bin/sh\nexec "$@"\n');chmodSync(join(directory, "tooling/gate/token.sh"), 0o755);
  const stdout = Array.from({ length: 90 }, (_, i) => `opaque stdout line ${i}\n`).join("");
  const stderr = "compiler/linker diagnostic without a recognised prefix\nlast unfiltered detail\n";
  writeFileSync(join(bin, "node"), "#!/bin/sh\nexit 0\n");chmodSync(join(bin, "node"), 0o755);
  writeFileSync(join(directory, "runtime/node/http/shape.mjs"), "");
  writeFileSync(join(directory, "stdout"), stdout);writeFileSync(join(directory, "stderr"), stderr);
  writeFileSync(join(directory, "tooling/conformance/build.sh"), 'cat stdout\ncat stderr >&2\nexit 23\n');
  const script = join(directory, "judge.sh");
  writeFileSync(script, `set -u\n${source.slice(start, end)}\nundefined_nts() { :; }\nunpinned_of() { :; }\nshaped_names() { echo 1; }\nPUBLISHES_NOTHING=\ncompiler=$1\nverdicts=$2\nout_dir=$2\naddon_logs=$3\njudge http\n[ "$judged" = fail ]\n`);
  const result = spawnTest("bash", [script, "/bin/true", directory, logs], { cwd: directory, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /REGRESSED/);
  assert.match(result.stdout, /no error, Error:, TS or NTS line/);
  assert.equal(readFileSync(join(logs, "http.build.log"), "utf8"), stdout + stderr);
  assert.equal(readFileSync(join(logs, "http.build.status"), "utf8"), "23\n");
  // Earlier output cannot turn a command's nonzero exit into a successful build.
  writeFileSync(join(directory, "stdout"), "47 bytes\n");
  const partial = spawnTest("bash", [script, "/bin/true", directory, logs], { cwd: directory, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(partial.status, 0, partial.stdout + partial.stderr);
  assert.match(partial.stdout, /REGRESSED/);
  assert.equal(readFileSync(join(logs, "http.build.status"), "utf8"), "23\n");
});
