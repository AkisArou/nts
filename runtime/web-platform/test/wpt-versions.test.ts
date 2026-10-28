import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { parseWptVersions, verifyWptCorpus } from "./wpt/versions.ts";

function table() {
  const bytes = Buffer.from("test(() => {});\n");
  return { bytes, versions: {
    version: 1, directories: { common: "a".repeat(40) },
    files: { "common/control.js": {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      gitBlob: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    } },
  } };
}

test("one directory pin checks every imported file, including unused support", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nts-wpt-pins-"));
  const root = pathToFileURL(directory + sep);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "common"));
  const { bytes, versions } = table();
  writeFileSync(new URL("versions.json", root), JSON.stringify(versions));
  writeFileSync(new URL("common/control.js", root), bytes);
  assert.equal(verifyWptCorpus(root), 1);
  writeFileSync(new URL("common/control.js", root), Buffer.concat([bytes, Buffer.from("changed")]));
  assert.throws(() => verifyWptCorpus(root), /WPT source changed/);
  writeFileSync(new URL("common/control.js", root), bytes);
  writeFileSync(new URL("common/unregistered.js", root), "");
  assert.throws(() => verifyWptCorpus(root), /unregistered file in pinned WPT directory/);
});

test("the versions schema rejects unknown fields, malformed revisions and escaping paths", () => {
  const { versions } = table();
  assert.throws(() => parseWptVersions({ ...versions, extra: true }), /unknown field/);
  assert.throws(() => parseWptVersions({ ...versions, directories: { common: "old" } }), /invalid WPT directory revision/);
  assert.throws(() => parseWptVersions({ ...versions, directories: {} }), /no directory pin/);
  assert.throws(() => parseWptVersions({ ...versions, files: { "../control.js": versions.files["common/control.js"] } }), /noncanonical/);
  assert.throws(() => parseWptVersions({ ...versions, files: { "common/control.js": { ...versions.files["common/control.js"], sha256: "bad" } } }), /invalid WPT SHA-256/);
});
