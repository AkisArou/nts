import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readArityRows, hasPublishedExport } from "./addon-manifest.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("both observer queries reject incomplete, altered or unbound publication metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "nts-addon-manifest-"));
  const source = "/* generated glue */\n";
  const exports = [{ path: ["nul\0key"], kind: "function", name: "nul\0key", arity: 1, required: 1, symbol: "callback" }];
  const original = { version: 1, source_sha256: hash(source), exports_sha256: hash(JSON.stringify(exports)), export_count: 1, exports };
  const write = (document: unknown) => writeFileSync(join(directory, "addon.exports.json"), JSON.stringify(document));
  const observers = [() => readArityRows(directory), () => hasPublishedExport(directory, "nul\0key")];
  try {
    writeFileSync(join(directory, "addon.c"), source);
    write(original);
    assert.equal(readArityRows(directory).length, 1);
    assert.equal(hasPublishedExport(directory, "nul\0key"), true);
    assert.equal(hasPublishedExport(directory, "missing"), false);
    for (const document of [
      { ...original, exports: [] },
      { ...original, exports: [{ ...exports[0], arity: 2 }] },
      { ...original, version: 2 },
      { ...original, exports: [{ ...exports[0], required: -1 }] },
    ]) {
      write(document);
      for (const observe of observers) assert.throws(observe, /Node-API export manifest:/);
    }
    writeFileSync(join(directory, "addon.exports.json"), "{");
    for (const observe of observers) assert.throws(observe, /malformed JSON/);
    rmSync(join(directory, "addon.exports.json"));
    for (const observe of observers) assert.throws(observe, /missing or unreadable/);
    write(original);
    writeFileSync(join(directory, "addon.c"), source + "changed");
    for (const observe of observers) assert.throws(observe, /glue hash/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("the arity command distinguishes absent artifacts from a complete empty publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "nts-arity-manifest-"));
  const observer = fileURLToPath(new URL("./arity-agreement.mjs", import.meta.url));
  const run = () => spawnSync(process.execPath, [observer, "fixture"], {
    env: { ...process.env, NTS_ADDON_OUT: directory }, encoding: "utf8",
  });
  try {
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Node-API export manifest: missing or unreadable/);
    const module = join(directory, "fixture.build");
    // A valid zero-export capsule is a measured empty surface.
    mkdirSync(module);
    const source = "/* empty publication */\n";
    writeFileSync(join(module, "addon.c"), source);
    const document = { version: 1, source_sha256: hash(source), exports_sha256: hash("[]"), export_count: 0, exports: [] };
    writeFileSync(join(module, "addon.exports.json"), JSON.stringify(document));
    const empty = run();
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /0 published function\(s\)/);
    assert.match(empty.stdout, /publish no function at all/);
    rmSync(join(module, "addon.exports.json"));
    assert.notEqual(run().status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
