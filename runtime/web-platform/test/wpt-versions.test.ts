import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

interface FileHash {
  sha256: string;
  gitBlob: string;
}

interface FixturePin extends FileHash {
  path: string;
  revision: string;
}

interface DirectoryPin {
  revision: string;
  files: Record<string, FileHash>;
  harnessReferences?: Record<string, FileHash>;
}

interface Versions {
  directories: Record<string, DirectoryPin>;
  license: FixturePin;
}

interface Manifest {
  revisions: Record<string, string>;
  fixtures: FixturePin[];
  support: FixturePin[];
  license: FixturePin;
}

const root = new URL("./wpt/", import.meta.url);
const versions = JSON.parse(readFileSync(new URL("versions.json", root), "utf8")) as Versions;

function directoryFor(path: string): DirectoryPin {
  const candidates = Object.keys(versions.directories)
    .filter((directory) => path === directory || path.startsWith(directory + "/"))
    .sort((a, b) => b.length - a.length);
  const directory = candidates[0];
  assert.notEqual(directory, undefined, `${path}: missing directory pin`);
  const pin = versions.directories[directory as string];
  assert.ok(pin !== undefined);
  return pin;
}

test("WPT versions use one revision per directory across all area manifests", () => {
  const manifested = new Set<string>();
  for (const path of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
    if (path !== "events-abort/manifest.json" && !path.endsWith("-manifest.json")) continue;
    const manifest = JSON.parse(readFileSync(new URL(path, root), "utf8")) as Manifest;
    for (const [directory, revision] of Object.entries(manifest.revisions)) {
      assert.equal(directoryFor(directory).revision, revision, `${path}: ${directory}`);
    }
    for (const entry of [...manifest.fixtures, ...manifest.support]) {
      const directory = directoryFor(entry.path);
      assert.equal(directory.revision, entry.revision, `${path}: ${entry.path} revision`);
      assert.deepEqual(directory.files[entry.path], {
        sha256: entry.sha256,
        gitBlob: entry.gitBlob,
      }, `${path}: ${entry.path} hashes`);
      manifested.add(entry.path);
    }
    // The one unchanged upstream licence has identical bytes at these pins.
    assert.equal(manifest.license.sha256, versions.license.sha256, `${path}: licence SHA-256`);
    assert.equal(manifest.license.gitBlob, versions.license.gitBlob, `${path}: licence Git blob`);
  }
  const recorded = Object.values(versions.directories).flatMap((directory) => Object.keys(directory.files));
  assert.equal(new Set(recorded).size, recorded.length, "a shared file is recorded once");
  assert.deepEqual([...manifested].sort(), recorded.sort(), "every copied manifest entry is in the table");
});

test("WPT versions identify the exact bytes of every copied fixture and helper", () => {
  const entries = Object.values(versions.directories).flatMap((directory) => Object.entries(directory.files));
  entries.push([versions.license.path, versions.license]);
  for (const [path, pin] of entries) {
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."), path);
    const bytes = readFileSync(new URL(path, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256, `${path}: SHA-256`);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
      pin.gitBlob, `${path}: Git blob`);
  }
});
