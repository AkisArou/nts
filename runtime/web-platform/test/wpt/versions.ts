// One source identity for each imported WPT path, governed by its directory pin.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

export interface WptFilePin {
  sha256: string;
  gitBlob: string;
  /** An upstream path when a notice is stored beside the local adapter. */
  source?: string;
}

export interface WptVersions {
  version: 1;
  directories: Record<string, string>;
  files: Record<string, WptFilePin>;
}

const resolutionRoot = new URL("https://web-platform.test/");

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${label}: unknown field ${key}`);
}

function canonical(path: string, root = false): void {
  const url = new URL(path, resolutionRoot);
  assert.ok((path !== "" || root) && !path.includes("\\") && !path.includes("\0") &&
    url.origin === resolutionRoot.origin && url.pathname.slice(1) === path &&
    url.search === "" && url.hash === "", `noncanonical WPT source path: ${path}`);
}

export function directoryRevision(versions: WptVersions, path: string): string {
  canonical(path);
  const directory = Object.keys(versions.directories)
    .filter((name) => name === "" || path.startsWith(name + "/"))
    .sort((a, b) => b.length - a.length)[0];
  assert.notEqual(directory, undefined, `WPT source has no directory pin: ${path}`);
  return versions.directories[directory!]!;
}

export function parseWptVersions(input: unknown): WptVersions {
  const table = record(input, "WPT versions must be an object");
  keys(table, ["version", "directories", "files"], "WPT versions");
  assert.equal(table.version, 1, "unsupported WPT versions schema");
  const directories: Record<string, string> = Object.create(null);
  for (const [path, revision] of Object.entries(record(table.directories, "WPT directory pins must be an object"))) {
    canonical(path, true);
    assert.ok(typeof revision === "string" && /^[0-9a-f]{40}$/.test(revision), `invalid WPT directory revision: ${path}`);
    directories[path] = revision;
  }
  const files: Record<string, WptFilePin> = Object.create(null);
  for (const [path, value] of Object.entries(record(table.files, "WPT file pins must be an object"))) {
    canonical(path);
    const pin = record(value, `invalid WPT file pin: ${path}`);
    keys(pin, ["sha256", "gitBlob", "source"], path);
    assert.ok(typeof pin.sha256 === "string" && /^[0-9a-f]{64}$/.test(pin.sha256), `invalid WPT SHA-256: ${path}`);
    assert.ok(typeof pin.gitBlob === "string" && /^[0-9a-f]{40}$/.test(pin.gitBlob), `invalid WPT Git blob: ${path}`);
    assert.ok(pin.source === undefined || typeof pin.source === "string", `invalid WPT upstream path: ${path}`);
    if (pin.source !== undefined) canonical(pin.source);
    files[path] = { sha256: pin.sha256, gitBlob: pin.gitBlob, ...(pin.source === undefined ? {} : { source: pin.source }) };
  }
  const versions: WptVersions = { version: 1, directories, files };
  for (const [path, pin] of Object.entries(files)) directoryRevision(versions, pin.source ?? path);
  return versions;
}

export function readWptVersions(root: URL): WptVersions {
  return parseWptVersions(JSON.parse(readFileSync(new URL("versions.json", root), "utf8")));
}

export function verifiedWptSource(root: URL, path: string, versions: WptVersions): Buffer {
  canonical(path);
  assert.ok(Object.hasOwn(versions.files, path), `unpinned WPT source: ${path}`);
  const pin = versions.files[path]!;
  directoryRevision(versions, pin.source ?? path);
  const bytes = readFileSync(new URL(path, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256, `WPT source changed: ${path}`);
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    pin.gitBlob, `upstream blob changed: ${path}`);
  return bytes;
}

/** check.sh checks the complete inventory, including files no selected case loads. */
export function verifyWptCorpus(root: URL): number {
  const versions = readWptVersions(root);
  const inspected = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(new URL(directory + "/", root), { withFileTypes: true })) {
      const path = directory + "/" + entry.name;
      if (entry.isDirectory()) walk(path);
      else {
        assert.ok(Object.hasOwn(versions.files, path), `unregistered file in pinned WPT directory: ${path}`);
        inspected.add(path);
      }
    }
  };
  for (const directory of Object.keys(versions.directories)) if (directory !== "") walk(directory);
  for (const path of Object.keys(versions.files)) {
    verifiedWptSource(root, path, versions);
    inspected.add(path);
  }
  return inspected.size;
}
