import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cachedEmission, measure } from "../conformance/c-compiles.mjs";

const clang = spawnSync("clang", ["--version"]);

test("C validation catches a missing descriptor and treats empty output as unmeasured", {
  skip: clang.error ? "clang is required for the C instrument's control" : false,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-c-compiles-control-"));
  try {
    const cached = join(dir, "cached");
    mkdirSync(cached);
    const common = { project: "unused", root: dir, compiler: "unused", env: process.env, work: join(dir, "out"), cached, cc: "clang" };
    const program = join(cached, "program.c");
    const descriptor = "static const int descriptor = 1;\n";
    const reference = "const int *lookup(void) { return &descriptor; }\n";
    writeFileSync(program, descriptor + reference);
    assert.equal((await measure(common)).category, "compiles");
    // Sabotage the definition while keeping its use: exactly the runtime bug.
    writeFileSync(program, reference);
    const rejected = await measure(common);
    assert.equal(rejected.category, "rejected");
    assert.match(rejected.why, /undeclared identifier 'descriptor'/);
    writeFileSync(program, "");
    assert.equal((await measure(common)).category, "not-measured");
    rmSync(program);
    assert.equal((await measure(common)).category, "not-measured");
    writeFileSync(program, descriptor + reference);
    assert.equal((await measure({ ...common, cc: join(dir, "missing-clang") })).category, "not-measured");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reuse requires the producing compiler and a successful emission", () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-c-compiles-provenance-"));
  try {
    writeFileSync(join(dir, ".emitted-by"), "compiler-hash\n");
    writeFileSync(join(dir, "http.status"), "0\n");
    assert.equal(cachedEmission("runtime/node/http", dir, "compiler-hash"), join(dir, "http"));
    assert.equal(cachedEmission("runtime/node/http", dir, "other-compiler"), null);
    assert.equal(cachedEmission("runtime/web-platform", dir, "compiler-hash"), null);
    writeFileSync(join(dir, "http.status"), "1\n");
    assert.equal(cachedEmission("runtime/node/http", dir, "compiler-hash"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed or silent emitter cannot pass the C check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-c-compiles-emission-"));
  try {
    const compiler = join(dir, "compiler.mjs");
    writeFileSync(compiler, "#!/usr/bin/env node\nprocess.exit(Number(process.env.TEST_EMIT_STATUS));\n");
    chmodSync(compiler, 0o755);
    const common = { project: "fixture", root: dir, compiler, work: join(dir, "out"), cached: null, cc: "clang" };
    for (const status of [0, 1]) {
      const result = await measure({ ...common, env: { ...process.env, TEST_EMIT_STATUS: String(status) } });
      assert.equal(result.category, "not-measured");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
